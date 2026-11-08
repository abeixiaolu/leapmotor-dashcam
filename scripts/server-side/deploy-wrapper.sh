#!/usr/bin/env bash
#
# 服务器端部署包装脚本
# 
# 安装位置：/usr/local/bin/dashcam-deploy
# 用途：接收 GitHub Actions 推送的构建产物并部署
# 权限：由 root 执行，但仅限特定操作
#
# 受限命令设计：
# - 接收上传的 tar.gz 构建包
# - 验证清单完整性
# - 解压到版本目录
# - 原子切换符号链接
# - 健康检查和回滚
# - 清理旧版本
#
# 不提供：
# - Shell 访问
# - 文件浏览
# - 任意命令执行
# - Docker 权限
# - sudo 权限

set -euo pipefail

DEPLOY_PATH="/srv/dashcam"
RELEASES_DIR="${DEPLOY_PATH}/releases"
CURRENT_LINK="${DEPLOY_PATH}/current"
UPLOAD_DIR="${DEPLOY_PATH}/.upload"

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info() { echo -e "${GREEN}[INFO]${NC} $*"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $*"; }
log_error() { echo -e "${RED}[ERROR]${NC} $*"; }

# 初始化上传目录
init_upload() {
    mkdir -p "${UPLOAD_DIR}"
    chmod 700 "${UPLOAD_DIR}"
    
    # 清理可能存在的旧上传
    find "${UPLOAD_DIR}" -type f -mmin +60 -delete 2>/dev/null || true
    
    echo "${UPLOAD_DIR}"
}

# 接收构建包
receive_package() {
    local upload_dir="$1"
    local package_file="${upload_dir}/build-package.tar.gz"
    
    log_info "等待接收构建包..."
    
    # 从 stdin 读取 tar.gz
    cat > "${package_file}"
    
    if [[ ! -f "${package_file}" ]]; then
        log_error "构建包接收失败"
        return 1
    fi
    
    local size=$(stat -f%z "${package_file}" 2>/dev/null || stat -c%s "${package_file}")
    log_info "构建包接收完成: $(numfmt --to=iec-i --suffix=B "${size}" 2>/dev/null || echo "${size} bytes")"
    
    echo "${package_file}"
}

# 验证构建包
validate_package() {
    local package_file="$1"
    local upload_dir=$(dirname "${package_file}")
    
    log_info "验证构建包完整性..."
    
    # 解压到临时目录
    tar -xzf "${package_file}" -C "${upload_dir}"
    
    # 检查必需文件
    if [[ ! -f "${upload_dir}/build-manifest.txt" ]]; then
        log_error "缺少 build-manifest.txt"
        return 1
    fi
    
    if [[ ! -f "${upload_dir}/index.html" ]]; then
        log_error "缺少 index.html"
        return 1
    fi
    
    # 验证清单中的文件
    local expected_files=$(grep -v '^REVISION=' "${upload_dir}/build-manifest.txt" | \
                          grep -v '^BUILD_TIME=' | \
                          grep -v '^GITHUB_RUN_ID=' | \
                          awk '{print $2}' || true)
    
    for file in ${expected_files}; do
        if [[ ! -f "${upload_dir}/${file}" ]]; then
            log_error "清单中的文件不存在: ${file}"
            return 1
        fi
    done
    
    log_info "构建包验证通过"
}

# 提取版本信息
extract_version_info() {
    local manifest_file="$1"
    
    local revision=$(grep '^REVISION=' "${manifest_file}" | cut -d= -f2)
    local build_time=$(grep '^BUILD_TIME=' "${manifest_file}" | cut -d= -f2)
    
    if [[ -z "$revision" ]]; then
        log_error "无法从清单中提取 REVISION"
        return 1
    fi
    
    # 生成指纹（基于清单内容）
    local fingerprint=$(sha256sum "${manifest_file}" | cut -c1-8)
    local release_name="${revision:0:8}-${fingerprint}"
    
    echo "${release_name}"
}

# 安装到版本目录
install_release() {
    local upload_dir="$1"
    local release_name="$2"
    local release_dir="${RELEASES_DIR}/${release_name}"
    
    log_info "安装版本: ${release_name}"
    
    # 创建版本目录
    mkdir -p "${RELEASES_DIR}"
    
    # 如果目标目录已存在，先删除
    if [[ -d "${release_dir}" ]]; then
        log_warn "目标版本目录已存在，先删除"
        rm -rf "${release_dir}"
    fi
    
    mkdir -p "${release_dir}"
    
    # 移动文件到版本目录
    # 排除 build-package.tar.gz
    find "${upload_dir}" -mindepth 1 -maxdepth 1 ! -name "build-package.tar.gz" \
        -exec mv {} "${release_dir}/" \;
    
    # 设置权限（保持 root:root，文件 644，目录 755）
    chmod -R u=rwX,go=rX "${release_dir}"
    
    log_info "版本安装完成: ${release_dir}"
    echo "${release_dir}"
}

# 原子切换符号链接
switch_current() {
    local release_dir="$1"
    local release_name=$(basename "${release_dir}")
    
    log_info "切换 current 符号链接到: ${release_name}"
    
    # 保存旧版本用于回滚
    if [[ -L "${CURRENT_LINK}" ]]; then
        OLD_RELEASE=$(readlink "${CURRENT_LINK}")
        echo "${OLD_RELEASE}" > "${DEPLOY_PATH}/.previous-release"
    else
        echo "" > "${DEPLOY_PATH}/.previous-release"
    fi
    
    # 创建临时符号链接
    ln -snf "${release_dir}" "${CURRENT_LINK}.tmp"
    
    # 原子性地重命名
    mv -Tf "${CURRENT_LINK}.tmp" "${CURRENT_LINK}"
    
    log_info "符号链接切换完成"
}

# 健康检查
health_check() {
    log_info "执行健康检查..."
    
    # 检查符号链接
    if [[ ! -L "${CURRENT_LINK}" ]]; then
        log_error "current 不是符号链接"
        return 1
    fi
    
    if [[ ! -e "${CURRENT_LINK}" ]]; then
        log_error "current 指向的目标不存在"
        return 1
    fi
    
    # 检查关键文件
    if [[ ! -f "${CURRENT_LINK}/index.html" ]]; then
        log_error "index.html 不存在"
        return 1
    fi
    
    # 检查健康检查端点
    if [[ -f "${CURRENT_LINK}/health.json" ]]; then
        if grep -q '"status".*"ok"' "${CURRENT_LINK}/health.json"; then
            log_info "健康检查端点验证通过"
        fi
    fi
    
    log_info "健康检查通过"
}

# 回滚
rollback() {
    log_warn "执行回滚..."
    
    if [[ ! -f "${DEPLOY_PATH}/.previous-release" ]]; then
        log_error "无法找到上一版本信息"
        return 1
    fi
    
    PREVIOUS_RELEASE=$(cat "${DEPLOY_PATH}/.previous-release")
    
    if [[ -z "${PREVIOUS_RELEASE}" ]]; then
        log_error "没有可回滚的版本"
        return 1
    fi
    
    if [[ ! -d "${PREVIOUS_RELEASE}" ]]; then
        log_error "上一版本目录不存在: ${PREVIOUS_RELEASE}"
        return 1
    fi
    
    ln -snf "${PREVIOUS_RELEASE}" "${CURRENT_LINK}.tmp"
    mv -Tf "${CURRENT_LINK}.tmp" "${CURRENT_LINK}"
    
    log_info "已回滚到: ${PREVIOUS_RELEASE}"
}

# 清理旧版本
cleanup_old_releases() {
    log_info "清理旧版本..."
    
    # 获取当前版本
    CURRENT_RELEASE=""
    if [[ -L "${CURRENT_LINK}" ]]; then
        CURRENT_RELEASE=$(basename "$(readlink "${CURRENT_LINK}")")
    fi
    
    # 保留最近 5 个版本
    cd "${RELEASES_DIR}"
    ls -t | tail -n +6 | while read -r old_release; do
        if [[ "${old_release}" != "${CURRENT_RELEASE}" ]]; then
            log_info "删除旧版本: ${old_release}"
            rm -rf "${old_release}"
        fi
    done
    
    log_info "旧版本清理完成"
}

# 清理上传目录
cleanup_upload() {
    local upload_dir="$1"
    rm -rf "${upload_dir}"
}

# 主流程
main() {
    log_info "==================== 开始部署 ===================="
    
    # 初始化上传目录
    local upload_dir
    upload_dir=$(init_upload)
    
    # 接收构建包
    local package_file
    package_file=$(receive_package "${upload_dir}")
    
    # 验证构建包
    validate_package "${package_file}"
    
    # 提取版本信息
    local release_name
    release_name=$(extract_version_info "${upload_dir}/build-manifest.txt")
    log_info "版本名称: ${release_name}"
    
    # 安装到版本目录
    local release_dir
    release_dir=$(install_release "${upload_dir}" "${release_name}")
    
    # 原子切换
    switch_current "${release_dir}"
    
    # 健康检查
    if ! health_check; then
        log_error "健康检查失败，开始回滚"
        rollback
        cleanup_upload "${upload_dir}"
        exit 1
    fi
    
    # 清理旧版本
    cleanup_old_releases
    
    # 清理上传目录
    cleanup_upload "${upload_dir}"
    
    log_info "==================== 部署成功 ===================="
    log_info "新版本已上线: ${release_name}"
    log_info "当前版本: $(readlink "${CURRENT_LINK}")"
}

# 错误处理
trap 'log_error "部署过程中发生错误，退出码: $?"' ERR

# 执行主流程
main "$@"
