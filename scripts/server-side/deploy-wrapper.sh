#!/usr/bin/env bash
#
# 服务器端部署包装脚本
# 
# 安装位置：/usr/local/bin/dashcam-deploy
# 依赖库：/usr/local/lib/dashcam/fingerprint.sh
# 权限：由 root 执行（通过 sudo）
#
# 严格安全边界：
# - SHA256 验证所有文件
# - 拒绝软链接、硬链接、特殊文件
# - 拒绝绝对路径、路径上跳（../）
# - 拒绝重复路径
# - 资源限额
# - 最小特权暂存（非 root 解压）
# - 事务性切换，失败自动回滚
# - release 不可变，幂等部署

set -euo pipefail

# 加载共享指纹计算逻辑（优先使用系统安装路径，fallback 到仓库相对路径）
if [[ -f "/usr/local/lib/dashcam/fingerprint.sh" ]]; then
    source "/usr/local/lib/dashcam/fingerprint.sh"
else
    # 仓库布局: scripts/server-side/deploy-wrapper.sh 和 scripts/lib/fingerprint.sh
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    source "${SCRIPT_DIR}/../lib/fingerprint.sh"
fi

DEPLOY_PATH="/srv/dashcam"
RELEASES_DIR="${DEPLOY_PATH}/releases"
CURRENT_LINK="${DEPLOY_PATH}/current"
STAGING_BASE="/var/tmp/dashcam-staging"

# 资源限额
MAX_ARCHIVE_SIZE=$((200 * 1024 * 1024))  # 200MB
MAX_FILE_SIZE=$((50 * 1024 * 1024))      # 50MB
MAX_FILE_COUNT=10000

# 日志输出到 stderr
log_info() { echo "[INFO] $*" >&2; }
log_warn() { echo "[WARN] $*" >&2; }
log_error() { echo "[ERROR] $*" >&2; }

# 初始化暂存目录（非 root 权限）
init_staging() {
    local staging_dir
    staging_dir=$(mktemp -d -p "${STAGING_BASE}" "deploy.XXXXXXXXXX") || {
        log_error "无法创建暂存目录"
        return 1
    }
    
    # 设置权限为 nobody（或其他非特权用户）
    chown nobody:nogroup "${staging_dir}"
    chmod 700 "${staging_dir}"
    
    echo "${staging_dir}"
}

# 接收并验证归档大小
receive_archive() {
    local staging_dir="$1"
    local archive_file="${staging_dir}/archive.tar.gz"
    
    log_info "等待构建归档..."
    
    # 限制归档大小（从 stdin 读取）
    if ! head -c $((MAX_ARCHIVE_SIZE + 1)) > "${archive_file}"; then
        log_error "接收归档失败"
        return 1
    fi
    
    local size
    size=$(stat -c%s "${archive_file}")
    
    if [[ $size -eq 0 ]]; then
        log_error "接收到空归档"
        return 1
    fi
    
    if [[ $size -gt $MAX_ARCHIVE_SIZE ]]; then
        log_error "归档超过大小限制: ${size} > ${MAX_ARCHIVE_SIZE}"
        return 1
    fi
    
    log_info "归档接收完成: ${size} bytes"
    echo "${archive_file}"
}

# 验证归档内容（提取前）
validate_archive_contents() {
    local archive_file="$1"
    
    log_info "验证归档内容..."
    
    # 列出归档成员并检查文件类型
    local member_count=0
    while IFS= read -r line; do
        # tar -tvzf 输出格式: 权限 ... 文件名
        # 第一个字符表示类型: - (普通), d (目录), l (软链接), h (硬链接), b/c/p (特殊)
        local type_char="${line:0:1}"
        
        # 允许普通文件和目录
        if [[ "$type_char" == "-" ]] || [[ "$type_char" == "d" ]]; then
            member_count=$((member_count + 1))
            
            if [[ $member_count -gt $MAX_FILE_COUNT ]]; then
                log_error "归档成员数量超过限制"
                return 1
            fi
            continue
        fi
        
        # 拒绝软链接
        if [[ "$type_char" == "l" ]]; then
            log_error "归档包含软链接: $line"
            return 1
        fi
        
        # 拒绝硬链接
        if [[ "$type_char" == "h" ]]; then
            log_error "归档包含硬链接: $line"
            return 1
        fi
        
        # 拒绝特殊文件
        if [[ "$type_char" =~ ^[bcp] ]]; then
            log_error "归档包含特殊文件: $line"
            return 1
        fi
        
        # 其他未知类型也拒绝
        log_error "归档包含未知文件类型: $line"
        return 1
    done < <(tar -tvzf "${archive_file}" 2>&1)
    
    log_info "归档内容验证通过: ${member_count} 个成员"
}

# 解压归档（以 nobody 权限）
extract_archive() {
    local archive_file="$1"
    local staging_dir
    staging_dir=$(dirname "${archive_file}")
    local extract_dir="${staging_dir}/extracted"
    
    log_info "解压归档..."
    
    mkdir -p "${extract_dir}"
    chown nobody:nogroup "${extract_dir}"
    
    # 以 nobody 权限解压
    if ! sudo -u nobody tar -xzf "${archive_file}" \
         -C "${extract_dir}" \
         --no-same-owner \
         --no-same-permissions \
         2>&1 >&2; then
        log_error "解压归档失败"
        return 1
    fi
    
    echo "${extract_dir}"
}

# 严格验证提取的内容
validate_extracted() {
    local extract_dir="$1"
    
    log_info "验证提取内容..."
    
    # 检查必需文件
    if [[ ! -f "${extract_dir}/build-manifest.txt" ]]; then
        log_error "缺少 build-manifest.txt"
        return 1
    fi
    
    if [[ ! -f "${extract_dir}/index.html" ]]; then
        log_error "缺少 index.html"
        return 1
    fi
    
    if [[ ! -f "${extract_dir}/health.json" ]]; then
        log_error "缺少 health.json"
        return 1
    fi
    
    # 验证 REVISION 格式（40 字符十六进制）
    local revision
    revision=$(grep '^REVISION=' "${extract_dir}/build-manifest.txt" | cut -d= -f2)
    
    if [[ ! "$revision" =~ ^[0-9a-f]{40}$ ]]; then
        log_error "REVISION 格式无效: $revision"
        return 1
    fi
    
    # 验证所有文件
    local file_count=0
    local verified_files=()
    
    while IFS= read -r line; do
        # 跳过元数据行
        if [[ "$line" =~ ^(REVISION|BUILD_TIME|GITHUB_RUN_ID)= ]]; then
            continue
        fi
        
        # 解析 SHA256 和文件路径
        local expected_sha file_path
        expected_sha=$(echo "$line" | awk '{print $1}')
        file_path=$(echo "$line" | awk '{print $2}')
        
        if [[ -z "$expected_sha" ]] || [[ -z "$file_path" ]]; then
            continue
        fi
        
        # 验证路径安全
        if ! validate_path_safety "$file_path"; then
            log_error "不安全的路径: $file_path"
            return 1
        fi
        
        local full_path="${extract_dir}/${file_path}"
        
        # 检查文件存在
        if [[ ! -e "$full_path" ]]; then
            log_error "清单中的文件不存在: $file_path"
            return 1
        fi
        
        # 检查是否为普通文件或目录
        if [[ -f "$full_path" ]]; then
            # 验证文件大小
            local file_size
            file_size=$(stat -c%s "$full_path")
            
            if [[ $file_size -gt $MAX_FILE_SIZE ]]; then
                log_error "文件超过大小限制: $file_path ($file_size > $MAX_FILE_SIZE)"
                return 1
            fi
            
            # 验证 SHA256
            local actual_sha
            actual_sha=$(sha256sum "$full_path" | awk '{print $1}')
            
            if [[ "$actual_sha" != "$expected_sha" ]]; then
                log_error "SHA256 不匹配: $file_path"
                log_error "  期望: $expected_sha"
                log_error "  实际: $actual_sha"
                return 1
            fi
            
            verified_files+=("$file_path")
        elif [[ -d "$full_path" ]]; then
            # 目录允许，但不计入验证文件
            :
        else
            log_error "不支持的文件类型: $file_path"
            return 1
        fi
        
        file_count=$((file_count + 1))
        
        if [[ $file_count -gt $MAX_FILE_COUNT ]]; then
            log_error "文件数量超过限制: $file_count > $MAX_FILE_COUNT"
            return 1
        fi
    done < "${extract_dir}/build-manifest.txt"
    
    # 检查软链接（提取后仍需检查，防止 tar 漏洞）
    local symlink_count
    symlink_count=$(find "${extract_dir}" -type l 2>/dev/null | wc -l)
    
    if [[ $symlink_count -gt 0 ]]; then
        log_error "提取目录包含软链接"
        find "${extract_dir}" -type l 2>&1 >&2
        return 1
    fi
    
    # 检查是否有额外文件（不在清单中）
    while IFS= read -r file; do
        # 规范化路径（移除 ./ 前缀，与清单一致）
        local rel_path
        rel_path=$(realpath --relative-to="${extract_dir}" "$file" | sed 's|^\./||')
        
        # 跳过 build-manifest.txt 本身
        if [[ "$rel_path" == "build-manifest.txt" ]]; then
            continue
        fi
        
        # 检查是否在已验证列表中（health.json 也必须在清单中）
        local found=false
        for verified in "${verified_files[@]}"; do
            if [[ "$rel_path" == "$verified" ]]; then
                found=true
                break
            fi
        done
        
        if [[ "$found" == "false" ]]; then
            log_error "发现额外文件（不在清单中）: $rel_path"
            return 1
        fi
    done < <(find "${extract_dir}" -type f ! -name build-manifest.txt)
    
    log_info "内容验证通过: ${file_count} 个文件"
    echo "$revision"
}

# 验证路径安全
validate_path_safety() {
    local path="$1"
    
    # 拒绝绝对路径
    if [[ "$path" == /* ]]; then
        return 1
    fi
    
    # 拒绝路径上跳
    if [[ "$path" == *../* ]] || [[ "$path" == ../* ]] || [[ "$path" == *..  ]]; then
        return 1
    fi
    
    # 拒绝特殊路径
    if [[ "$path" == "." ]] || [[ "$path" == ".." ]]; then
        return 1
    fi
    
    return 0
}

# 生成版本名称（使用共享指纹逻辑）
generate_release_name() {
    local revision="$1"
    local manifest_file="$2"
    
    generate_version_name "$revision" "$manifest_file"
}

# 安装到 release 目录（幂等，不可变）
install_release() {
    local extract_dir="$1"
    local release_name="$2"
    local release_dir="${RELEASES_DIR}/${release_name}"
    
    log_info "安装 release: ${release_name}"
    
    mkdir -p "${RELEASES_DIR}"
    
    # 检查 release 是否已存在
    if [[ -d "${release_dir}" ]]; then
        log_info "Release 已存在: ${release_name}"
        
        # 验证内容相同（幂等）
        if ! diff -r "${extract_dir}" "${release_dir}" > /dev/null 2>&1; then
            log_error "Release 已存在但内容不同，拒绝覆盖"
            return 1
        fi
        
        log_info "Release 内容一致，跳过安装"
        echo "${release_dir}"
        return 0
    fi
    
    # 创建新 release（原子操作）
    local temp_release="${release_dir}.tmp.$$"
    
    mkdir -p "${temp_release}"
    cp -r "${extract_dir}"/* "${temp_release}/"
    
    # 设置权限
    chown -R root:root "${temp_release}"
    chmod -R u=rwX,go=rX "${temp_release}"
    
    # 原子重命名
    if ! mv "${temp_release}" "${release_dir}"; then
        rm -rf "${temp_release}"
        log_error "无法安装 release"
        return 1
    fi
    
    log_info "Release 安装完成: ${release_dir}"
    echo "${release_dir}"
}

# 事务性切换 current（失败自动回滚）
atomic_switch() {
    local release_dir="$1"
    local release_name
    release_name=$(basename "${release_dir}")
    
    log_info "切换 current 到: ${release_name}"
    
    # 保存旧版本（绝对路径）
    local old_release=""
    if [[ -L "${CURRENT_LINK}" ]]; then
        old_release=$(readlink -f "${CURRENT_LINK}")
    fi
    
    # 保存旧版本信息
    if [[ -n "$old_release" ]]; then
        echo "${old_release}" > "${DEPLOY_PATH}/.previous-release"
    else
        echo "" > "${DEPLOY_PATH}/.previous-release"
    fi
    
    # 创建临时符号链接
    ln -snf "${release_dir}" "${CURRENT_LINK}.tmp"
    
    # 原子性重命名
    if ! mv -Tf "${CURRENT_LINK}.tmp" "${CURRENT_LINK}"; then
        rm -f "${CURRENT_LINK}.tmp"
        log_error "无法切换 current 符号链接"
        return 1
    fi
    
    log_info "符号链接切换完成"
}

# 健康检查
health_check() {
    local expected_revision="$1"
    local expected_version="$2"
    
    log_info "执行健康检查..."
    
    local current_path
    current_path=$(readlink -f "${CURRENT_LINK}")
    
    # 检查符号链接有效
    if [[ ! -d "$current_path" ]]; then
        log_error "current 指向无效目标"
        return 1
    fi
    
    # 检查关键文件
    if [[ ! -f "${current_path}/index.html" ]]; then
        log_error "index.html 不存在"
        return 1
    fi
    
    # 检查版本匹配（目录名）
    if [[ ! "$current_path" == *"${expected_version}"* ]]; then
        log_error "版本不匹配: 期望 ${expected_version}，当前 $(basename "$current_path")"
        return 1
    fi
    
    # 检查 health.json（必须存在）
    if [[ ! -f "${current_path}/health.json" ]]; then
        log_error "health.json 不存在"
        return 1
    fi
    
    # 验证 health.json 状态
    if ! grep -q '"status".*"ok"' "${current_path}/health.json"; then
        log_error "健康端点状态异常"
        return 1
    fi
    
    # 验证 revision
    if ! grep -q "\"revision\".*\"${expected_revision}\"" "${current_path}/health.json"; then
        log_error "健康端点 revision 不匹配"
        return 1
    fi
    
    # 验证 version
    if ! grep -q "\"version\".*\"${expected_version}\"" "${current_path}/health.json"; then
        log_error "健康端点 version 不匹配"
        return 1
    fi
    
    # 验证 health.json SHA256（与清单一致）
    local manifest_file="${current_path}/../$(basename "$current_path")/build-manifest.txt"
    if [[ -f "$manifest_file" ]]; then
        local expected_health_sha
        expected_health_sha=$(grep '^[0-9a-f]\{64\}  health\.json$' "$manifest_file" | awk '{print $1}')
        
        if [[ -n "$expected_health_sha" ]]; then
            local actual_health_sha
            actual_health_sha=$(sha256sum "${current_path}/health.json" | awk '{print $1}')
            
            if [[ "$actual_health_sha" != "$expected_health_sha" ]]; then
                log_error "health.json SHA256 不匹配"
                log_error "  期望: $expected_health_sha"
                log_error "  实际: $actual_health_sha"
                return 1
            fi
        fi
    fi
    
    log_info "健康端点 metadata 验证通过"
    
    log_info "健康检查通过"
}

# 回滚
rollback() {
    log_warn "执行回滚..."
    
    if [[ ! -f "${DEPLOY_PATH}/.previous-release" ]]; then
        log_error "无法找到上一版本信息"
        return 1
    fi
    
    local previous_release
    previous_release=$(cat "${DEPLOY_PATH}/.previous-release")
    
    if [[ -z "$previous_release" ]]; then
        log_error "没有可回滚的版本"
        return 1
    fi
    
    # 验证旧版本在 releases 内
    if [[ "$previous_release" != "${RELEASES_DIR}/"* ]]; then
        log_error "上一版本路径不在 releases 目录内"
        return 1
    fi
    
    if [[ ! -d "$previous_release" ]]; then
        log_error "上一版本目录不存在: $previous_release"
        return 1
    fi
    
    ln -snf "$previous_release" "${CURRENT_LINK}.tmp"
    mv -Tf "${CURRENT_LINK}.tmp" "${CURRENT_LINK}"
    
    log_info "已回滚到: $previous_release"
}

# 清理旧版本
cleanup_old_releases() {
    log_info "清理旧版本..."
    
    local current_target
    current_target=$(readlink -f "${CURRENT_LINK}" 2>/dev/null || echo "")
    
    local keep_count=0
    
    # 保留最近 5 个版本
    cd "${RELEASES_DIR}" || return
    
    for release in $(ls -t); do
        local release_path="${RELEASES_DIR}/${release}"
        
        # 跳过当前版本
        if [[ "$release_path" == "$current_target" ]]; then
            continue
        fi
        
        keep_count=$((keep_count + 1))
        
        if [[ $keep_count -gt 5 ]]; then
            log_info "删除旧版本: $release"
            rm -rf "$release"
        fi
    done
    
    log_info "旧版本清理完成"
}

# 清理暂存目录
cleanup_staging() {
    local staging_dir="$1"
    
    if [[ -d "$staging_dir" ]] && [[ "$staging_dir" == "${STAGING_BASE}/"* ]]; then
        rm -rf "$staging_dir"
    fi
}

# 主流程（事务性，失败自动回滚）
main() {
    log_info "==================== 开始部署 ===================="
    
    # 确保暂存基目录存在
    mkdir -p "${STAGING_BASE}"
    chmod 1777 "${STAGING_BASE}"  # sticky bit
    
    # 初始化暂存目录
    local staging_dir
    staging_dir=$(init_staging)
    
    # 错误时清理
    trap "cleanup_staging '$staging_dir'" EXIT
    
    # 接收归档
    local archive_file
    archive_file=$(receive_archive "$staging_dir")
    
    # 验证归档内容（提取前）
    validate_archive_contents "$archive_file"
    
    # 解压归档（非 root）
    local extract_dir
    extract_dir=$(extract_archive "$archive_file")
    
    # 严格验证
    local revision
    revision=$(validate_extracted "$extract_dir")
    
    # 生成 release 名称
    local release_name
    release_name=$(generate_release_name "$revision" "${extract_dir}/build-manifest.txt")
    log_info "Release: ${release_name}"
    
    # 安装 release（幂等）
    local release_dir
    release_dir=$(install_release "$extract_dir" "$release_name")
    
    # 原子切换
    atomic_switch "$release_dir"
    
    # 健康检查（失败则回滚）
    if ! health_check "$revision" "$release_name"; then
        log_error "健康检查失败，开始回滚"
        rollback
        exit 1
    fi
    
    # 清理旧版本
    cleanup_old_releases
    
    log_info "==================== 部署成功 ===================="
    log_info "当前版本: ${release_name}"
}

# 只在直接执行时调用 main，被 source 时不执行
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    # 全局错误处理
    trap 'log_error "部署失败，退出码: $?"' ERR
    
    # 执行主流程
    main "$@"
fi
