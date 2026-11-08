#!/usr/bin/env bash
#
# GitHub Actions 部署脚本 - 通过服务器端受限包装器部署
# 
# 功能：
# - 打包构建产物
# - 通过 SSH 传输到服务器端包装脚本
# - 等待部署完成
# - 验证部署结果

set -euo pipefail

# 配置变量（从环境变量读取）
DEPLOY_USER="${DEPLOY_USER:-}"
DEPLOY_HOST="${DEPLOY_HOST:-}"
REVISION="${REVISION:-}"
BUILD_DIR="./dist"
MANIFEST_FILE="./build-manifest.txt"

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

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

# 打包构建产物
package_build() {
    log_info "打包构建产物..."
    
    local temp_dir=$(mktemp -d)
    local package_file="${temp_dir}/build-package.tar.gz"
    
    # 复制构建产物到临时目录
    cp -r "${BUILD_DIR}"/* "${temp_dir}/"
    cp "${MANIFEST_FILE}" "${temp_dir}/"
    
    # 创建 tar.gz 包
    cd "${temp_dir}"
    tar -czf build-package.tar.gz \
        --exclude='build-package.tar.gz' \
        --exclude='*.mp4' \
        --exclude='*.webm' \
        --exclude='recordings' \
        --exclude='.env' \
        --exclude='.env.*' \
        .
    
    cd - > /dev/null
    
    local package_path="${temp_dir}/build-package.tar.gz"
    local size=$(stat -f%z "${package_path}" 2>/dev/null || stat -c%s "${package_path}")
    log_info "构建包创建完成: ${package_path} ($(numfmt --to=iec-i --suffix=B "${size}" 2>/dev/null || echo "${size} bytes"))"
    
    echo "${package_path}"
}

# 部署到服务器
deploy_to_server() {
    local package_file="$1"
    
    log_info "开始部署到服务器..."
    log_info "目标: ${DEPLOY_USER}@${DEPLOY_HOST}"
    log_info "版本: ${REVISION}"
    
    # 通过 SSH 管道传输构建包到服务器端包装脚本
    if cat "${package_file}" | \
        ssh -o BatchMode=yes \
            "${DEPLOY_USER}@${DEPLOY_HOST}" \
            "sudo /usr/local/bin/dashcam-deploy"; then
        log_info "部署成功"
        return 0
    else
        log_error "部署失败"
        return 1
    fi
}

# 验证部署结果
verify_deployment() {
    log_info "验证部署结果..."
    
    local current_release
    current_release=$(ssh "${DEPLOY_USER}@${DEPLOY_HOST}" \
        "readlink /srv/dashcam/current" 2>/dev/null || echo "")
    
    if [[ -z "$current_release" ]]; then
        log_error "无法读取当前版本"
        return 1
    fi
    
    log_info "当前版本: ${current_release}"
    
    # 检查是否包含当前 revision
    if [[ "$current_release" == *"${REVISION:0:8}"* ]]; then
        log_info "部署版本验证通过"
        return 0
    else
        log_warn "当前版本可能不是最新部署的版本"
        return 1
    fi
}

# 清理临时文件
cleanup() {
    local package_file="$1"
    local temp_dir=$(dirname "${package_file}")
    
    if [[ -d "$temp_dir" ]] && [[ "$temp_dir" == /tmp/* ]]; then
        rm -rf "$temp_dir"
        log_info "临时文件已清理"
    fi
}

# 主流程
main() {
    log_info "==================== 开始部署 ===================="
    log_info "Revision: ${REVISION}"
    log_info "Target: ${DEPLOY_USER}@${DEPLOY_HOST}"
    
    # 参数验证
    validate_params
    
    # 测试连接
    test_ssh_connection
    
    # 打包构建产物
    local package_file
    package_file=$(package_build)
    
    # 部署到服务器
    if deploy_to_server "${package_file}"; then
        # 验证部署
        verify_deployment
        
        # 清理临时文件
        cleanup "${package_file}"
        
        log_info "==================== 部署成功 ===================="
        log_info "访问地址: https://dashcam.abei.me"
        exit 0
    else
        # 清理临时文件
        cleanup "${package_file}"
        
        log_error "==================== 部署失败 ===================="
        exit 1
    fi
}

# 错误处理
trap 'log_error "部署过程中发生错误，退出码: $?"' ERR

# 执行主流程
main "$@"
