#!/usr/bin/env bash
#
# 安全部署脚本 - 将构建产物部署到生产环境
# 
# 功能：
# - 可验证的产物清单
# - 版本化目录结构
# - 原子化符号链接切换
# - 失败自动回滚
# - 健康检查验证
# - 保留历史版本

set -euo pipefail

# 配置变量（从环境变量读取）
DEPLOY_USER="${DEPLOY_USER:-}"
DEPLOY_HOST="${DEPLOY_HOST:-}"
DEPLOY_PATH="${DEPLOY_PATH:-/srv/dashcam}"
REVISION="${REVISION:-}"
BUILD_DIR="./dist"
MANIFEST_FILE="./build-manifest.txt"

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${GREEN}[INFO]${NC} $*"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $*"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $*"
}

# 参数验证
validate_params() {
    local missing_params=()
    
    [[ -z "$DEPLOY_USER" ]] && missing_params+=("DEPLOY_USER")
    [[ -z "$DEPLOY_HOST" ]] && missing_params+=("DEPLOY_HOST")
    [[ -z "$DEPLOY_PATH" ]] && missing_params+=("DEPLOY_PATH")
    [[ -z "$REVISION" ]] && missing_params+=("REVISION")
    
    if [[ ${#missing_params[@]} -gt 0 ]]; then
        log_error "缺少必需的环境变量: ${missing_params[*]}"
        exit 1
    fi
    
    if [[ ! -d "$BUILD_DIR" ]]; then
        log_error "构建目录不存在: $BUILD_DIR"
        exit 1
    fi
    
    if [[ ! -f "$MANIFEST_FILE" ]]; then
        log_error "构建清单文件不存在: $MANIFEST_FILE"
        exit 1
    fi
}

# 生成部署指纹（基于内容哈希）
generate_fingerprint() {
    local short_hash
    short_hash=$(sha256sum "$MANIFEST_FILE" | cut -c1-8)
    echo "${short_hash}"
}

# 测试 SSH 连接
test_ssh_connection() {
    log_info "测试 SSH 连接..."
    if ! ssh -o BatchMode=yes -o ConnectTimeout=10 \
        "${DEPLOY_USER}@${DEPLOY_HOST}" "echo 'SSH 连接成功'" &>/dev/null; then
        log_error "无法连接到部署服务器"
        return 1
    fi
    log_info "SSH 连接验证成功"
}

# 准备远程部署目录
prepare_remote_directory() {
    local release_name=$1
    local release_path="${DEPLOY_PATH}/releases/${release_name}"
    
    log_info "准备远程目录: ${release_path}"
    
    ssh "${DEPLOY_USER}@${DEPLOY_HOST}" bash <<-EOF
		set -euo pipefail
		mkdir -p "${DEPLOY_PATH}/releases"
		mkdir -p "${release_path}"
		
		# 清理可能存在的同名未完成部署
		if [[ -d "${release_path}" ]]; then
		    rm -rf "${release_path}"
		    mkdir -p "${release_path}"
		fi
	EOF
}

# 上传构建产物
upload_build_artifacts() {
    local release_name=$1
    local release_path="${DEPLOY_PATH}/releases/${release_name}"
    
    log_info "上传构建产物到 ${release_path}..."
    
    # 使用 rsync 上传，只传输 dist/ 目录内容
    rsync -az --delete \
        --exclude='*.mp4' \
        --exclude='*.webm' \
        --exclude='recordings/' \
        --exclude='.env' \
        --exclude='.env.*' \
        "${BUILD_DIR}/" \
        "${DEPLOY_USER}@${DEPLOY_HOST}:${release_path}/"
    
    # 上传构建清单
    scp "${MANIFEST_FILE}" \
        "${DEPLOY_USER}@${DEPLOY_HOST}:${release_path}/build-manifest.txt"
    
    log_info "构建产物上传完成"
}

# 远程验证构建产物
verify_remote_build() {
    local release_name=$1
    local release_path="${DEPLOY_PATH}/releases/${release_name}"
    
    log_info "验证远程构建产物完整性..."
    
    ssh "${DEPLOY_USER}@${DEPLOY_HOST}" bash <<-EOF
		set -euo pipefail
		cd "${release_path}"
		
		# 验证关键文件存在
		if [[ ! -f "index.html" ]]; then
		    echo "错误: index.html 不存在"
		    exit 1
		fi
		
		if [[ ! -f "build-manifest.txt" ]]; then
		    echo "错误: build-manifest.txt 不存在"
		    exit 1
		fi
		
		# 验证清单中的 REVISION
		if ! grep -q "REVISION=${REVISION}" build-manifest.txt; then
		    echo "错误: 构建清单中的 REVISION 不匹配"
		    exit 1
		fi
		
		echo "远程构建产物验证通过"
	EOF
}

# 原子切换 current 符号链接
atomic_switch_current() {
    local release_name=$1
    local release_path="${DEPLOY_PATH}/releases/${release_name}"
    local current_link="${DEPLOY_PATH}/current"
    
    log_info "原子切换 current 符号链接..."
    
    ssh "${DEPLOY_USER}@${DEPLOY_HOST}" bash <<-EOF
		set -euo pipefail
		
		# 保存旧版本用于回滚
		if [[ -L "${current_link}" ]]; then
		    OLD_RELEASE=\$(readlink "${current_link}")
		    echo "\${OLD_RELEASE}" > "${DEPLOY_PATH}/.previous-release"
		else
		    echo "" > "${DEPLOY_PATH}/.previous-release"
		fi
		
		# 创建临时符号链接
		ln -snf "${release_path}" "${current_link}.tmp"
		
		# 原子性地重命名（mv 是原子操作）
		mv -Tf "${current_link}.tmp" "${current_link}"
		
		echo "符号链接已切换到: ${release_name}"
	EOF
    
    log_info "current 符号链接切换完成"
}

# 健康检查
health_check() {
    log_info "执行健康检查..."
    
    local check_result
    check_result=$(ssh "${DEPLOY_USER}@${DEPLOY_HOST}" bash <<-'EOF'
		set -euo pipefail
		CURRENT_PATH="${DEPLOY_PATH}/current"
		
		# 检查符号链接是否有效
		if [[ ! -L "$CURRENT_PATH" ]]; then
		    echo "ERROR: current 不是符号链接"
		    exit 1
		fi
		
		if [[ ! -e "$CURRENT_PATH" ]]; then
		    echo "ERROR: current 指向的目标不存在"
		    exit 1
		fi
		
		# 检查关键文件
		if [[ ! -f "$CURRENT_PATH/index.html" ]]; then
		    echo "ERROR: index.html 不存在"
		    exit 1
		fi
		
		# 检查健康检查端点（如果存在）
		if [[ -f "$CURRENT_PATH/health.json" ]]; then
		    if grep -q '"status".*"ok"' "$CURRENT_PATH/health.json"; then
		        echo "健康检查端点验证通过"
		    fi
		fi
		
		echo "OK"
	EOF
    )
    
    if [[ "$check_result" != "OK" ]]; then
        log_error "健康检查失败: $check_result"
        return 1
    fi
    
    log_info "健康检查通过"
}

# 回滚到上一个版本
rollback() {
    log_warn "执行回滚..."
    
    ssh "${DEPLOY_USER}@${DEPLOY_HOST}" bash <<-EOF
		set -euo pipefail
		
		if [[ ! -f "${DEPLOY_PATH}/.previous-release" ]]; then
		    echo "错误: 无法找到上一个版本信息"
		    exit 1
		fi
		
		PREVIOUS_RELEASE=\$(cat "${DEPLOY_PATH}/.previous-release")
		
		if [[ -z "\${PREVIOUS_RELEASE}" ]]; then
		    echo "错误: 没有可回滚的版本"
		    exit 1
		fi
		
		if [[ ! -d "\${PREVIOUS_RELEASE}" ]]; then
		    echo "错误: 上一个版本目录不存在"
		    exit 1
		fi
		
		ln -snf "\${PREVIOUS_RELEASE}" "${DEPLOY_PATH}/current.tmp"
		mv -Tf "${DEPLOY_PATH}/current.tmp" "${DEPLOY_PATH}/current"
		
		echo "已回滚到: \${PREVIOUS_RELEASE}"
	EOF
    
    log_info "回滚完成"
}

# 清理旧版本（保留最近 5 个版本）
cleanup_old_releases() {
    log_info "清理旧版本..."
    
    ssh "${DEPLOY_USER}@${DEPLOY_HOST}" bash <<-EOF
		set -euo pipefail
		
		cd "${DEPLOY_PATH}/releases"
		
		# 获取当前版本
		CURRENT_RELEASE=""
		if [[ -L "${DEPLOY_PATH}/current" ]]; then
		    CURRENT_RELEASE=\$(basename \$(readlink "${DEPLOY_PATH}/current"))
		fi
		
		# 保留最近 5 个版本（按修改时间排序）
		ls -t | tail -n +6 | while read -r old_release; do
		    # 不删除当前版本
		    if [[ "\${old_release}" != "\${CURRENT_RELEASE}" ]]; then
		        echo "删除旧版本: \${old_release}"
		        rm -rf "\${old_release}"
		    fi
		done
		
		echo "旧版本清理完成"
	EOF
}

# 主部署流程
main() {
    log_info "==================== 开始部署 ===================="
    log_info "Revision: ${REVISION}"
    log_info "Target: ${DEPLOY_USER}@${DEPLOY_HOST}:${DEPLOY_PATH}"
    
    # 参数验证
    validate_params
    
    # 生成版本名称
    local fingerprint
    fingerprint=$(generate_fingerprint)
    local release_name="${REVISION:0:8}-${fingerprint}"
    log_info "Release name: ${release_name}"
    
    # 测试连接
    test_ssh_connection
    
    # 准备目录
    prepare_remote_directory "$release_name"
    
    # 上传构建产物
    upload_build_artifacts "$release_name"
    
    # 验证构建
    verify_remote_build "$release_name"
    
    # 原子切换
    atomic_switch_current "$release_name"
    
    # 健康检查
    if ! health_check; then
        log_error "健康检查失败，开始回滚"
        rollback
        exit 1
    fi
    
    # 清理旧版本
    cleanup_old_releases
    
    log_info "==================== 部署成功 ===================="
    log_info "新版本已上线: ${release_name}"
    log_info "访问地址: https://dashcam.abei.me"
}

# 错误处理
trap 'log_error "部署过程中发生错误，退出码: $?"' ERR

# 执行主流程
main "$@"
