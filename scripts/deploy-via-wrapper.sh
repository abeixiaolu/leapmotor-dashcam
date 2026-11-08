#!/usr/bin/env bash
#
# GitHub Actions 部署脚本 - 通过服务器端受限包装器部署
# 
# 严格协议：stdin 传输 tar.gz，stdout 传输进度和结果，stderr 输出错误

set -euo pipefail

# 配置变量（从环境变量读取）
DEPLOY_USER="${DEPLOY_USER:-}"
DEPLOY_HOST="${DEPLOY_HOST:-}"
REVISION="${REVISION:-}"
BUILD_DIR="./dist"
MANIFEST_FILE="./build-manifest.txt"

# 日志输出到 stderr（避免污染 stdout）
log_info() {
    echo "[INFO] $*" >&2
}

log_warn() {
    echo "[WARN] $*" >&2
}

log_error() {
    echo "[ERROR] $*" >&2
}

# 参数验证
validate_params() {
    local missing_params=()
    
    [[ -z "$DEPLOY_USER" ]] && missing_params+=("DEPLOY_USER")
    [[ -z "$DEPLOY_HOST" ]] && missing_params+=("DEPLOY_HOST")
    [[ -z "$REVISION" ]] && missing_params+=("REVISION")
    
    # 验证 REVISION 格式（必须是 40 字符 SHA）
    if [[ ! "$REVISION" =~ ^[0-9a-f]{40}$ ]]; then
        log_error "REVISION 必须是 40 字符的十六进制 SHA: $REVISION"
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

# 测试 SSH 连接（不使用 echo，避免污染 stdout）
test_ssh_connection() {
    log_info "测试 SSH 连接..."
    if ! ssh -o BatchMode=yes \
             -o ConnectTimeout=10 \
             -o StrictHostKeyChecking=yes \
             -o IdentitiesOnly=yes \
        "${DEPLOY_USER}@${DEPLOY_HOST}" \
        true 2>&1; then
        log_error "无法连接到部署服务器"
        return 1
    fi
    log_info "SSH 连接验证成功"
}

# 打包构建产物
package_build() {
    log_info "打包构建产物..."
    
    local temp_dir
    temp_dir=$(mktemp -d) || {
        log_error "无法创建临时目录"
        return 1
    }
    
    local package_file="${temp_dir}/build-package.tar.gz"
    
    # 复制构建产物到临时目录
    cp -r "${BUILD_DIR}"/* "${temp_dir}/" 2>&1 >&2
    cp "${MANIFEST_FILE}" "${temp_dir}/" 2>&1 >&2
    
    # 创建 tar.gz 包
    (
        cd "${temp_dir}" || exit 1
        tar -czf build-package.tar.gz \
            --exclude='build-package.tar.gz' \
            --exclude='*.mp4' \
            --exclude='*.webm' \
            --exclude='recordings' \
            --exclude='.env' \
            --exclude='.env.*' \
            . 2>&1 >&2
    )
    
    local package_path="${temp_dir}/build-package.tar.gz"
    local size
    size=$(stat -f%z "${package_path}" 2>/dev/null || stat -c%s "${package_path}")
    log_info "构建包创建完成: ${package_path} (${size} bytes)"
    
    # 返回路径到 stdout（供 main 捕获）
    printf '%s\n' "${package_path}"
}

# 部署到服务器
deploy_to_server() {
    local package_file="$1"
    
    log_info "开始部署到服务器..."
    log_info "目标: ${DEPLOY_USER}@${DEPLOY_HOST}"
    log_info "版本: ${REVISION}"
    
    # 通过 SSH 管道传输构建包到服务器端包装脚本
    # 服务器输出到 stderr，避免污染 stdout
    if cat "${package_file}" | \
        ssh -o BatchMode=yes \
            -o StrictHostKeyChecking=yes \
            -o IdentitiesOnly=yes \
            "${DEPLOY_USER}@${DEPLOY_HOST}" 2>&1 >&2; then
        log_info "部署成功"
        return 0
    else
        log_error "部署失败"
        return 1
    fi
}

# 验证部署结果（通过专用验证协议）
verify_deployment() {
    log_info "验证部署结果..."
    
    # 获取当前版本（使用绝对路径 readlink）
    local current_release
    current_release=$(ssh -o BatchMode=yes \
                          -o StrictHostKeyChecking=yes \
                          -o IdentitiesOnly=yes \
                          "${DEPLOY_USER}@${DEPLOY_HOST}" \
                          "readlink -f /srv/dashcam/current 2>/dev/null || echo ''")
    
    if [[ -z "$current_release" ]]; then
        log_error "无法读取当前版本"
        return 1
    fi
    
    log_info "当前版本: ${current_release}"
    
    # 检查是否包含当前 revision（前 8 位）
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
    local temp_dir
    temp_dir=$(dirname "${package_file}")
    
    if [[ -d "$temp_dir" ]] && [[ "$temp_dir" == /tmp/* ]]; then
        rm -rf "$temp_dir" 2>&1 >&2
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
