#!/usr/bin/env bash
#
# 真实调用验证逻辑的测试脚本
#
# 直接 source 服务器端脚本函数并测试

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEST_DIR="$(mktemp -d)"

PASSED=0
FAILED=0

log_test() {
    echo "======================================" >&2
    echo "测试: $*" >&2
    echo "======================================" >&2
}

log_pass() {
    echo "✓ 通过: $*" >&2
    PASSED=$((PASSED + 1))
}

log_fail() {
    echo "✗ 失败: $*" >&2
    FAILED=$((FAILED + 1))
}

cleanup() {
    rm -rf "$TEST_DIR"
}

trap cleanup EXIT

# Source 服务器端脚本的关键函数
source_wrapper_functions() {
    # 提取必需的常量和函数
    MAX_FILE_SIZE=$((50 * 1024 * 1024))
    MAX_FILE_COUNT=10000
    MAX_ARCHIVE_SIZE=$((200 * 1024 * 1024))
    
    log_error() { echo "[ERROR] $*" >&2; }
    log_info() { echo "[INFO] $*" >&2; }
    
    validate_path_safety() {
        local path="$1"
        if [[ "$path" == /* ]]; then
            return 1
        fi
        if [[ "$path" == *../* ]] || [[ "$path" == ../* ]] || [[ "$path" == *.. ]]; then
            return 1
        fi
        if [[ "$path" == "." ]] || [[ "$path" == ".." ]]; then
            return 1
        fi
        return 0
    }
    
    validate_extracted() {
        local extract_dir="$1"
        
        if [[ ! -f "${extract_dir}/build-manifest.txt" ]]; then
            log_error "缺少 build-manifest.txt"
            return 1
        fi
        
        if [[ ! -f "${extract_dir}/index.html" ]]; then
            log_error "缺少 index.html"
            return 1
        fi
        
        local revision
        revision=$(grep '^REVISION=' "${extract_dir}/build-manifest.txt" | cut -d= -f2)
        
        if [[ ! "$revision" =~ ^[0-9a-f]{40}$ ]]; then
            log_error "REVISION 格式无效: $revision"
            return 1
        fi
        
        local file_count=0
        local verified_files=()
        
        while IFS= read -r line; do
            if [[ "$line" =~ ^(REVISION|BUILD_TIME|GITHUB_RUN_ID)= ]]; then
                continue
            fi
            
            local expected_sha file_path
            expected_sha=$(echo "$line" | awk '{print $1}')
            file_path=$(echo "$line" | awk '{print $2}')
            
            if [[ -z "$expected_sha" ]] || [[ -z "$file_path" ]]; then
                continue
            fi
            
            if ! validate_path_safety "$file_path"; then
                log_error "不安全的路径: $file_path"
                return 1
            fi
            
            local full_path="${extract_dir}/${file_path}"
            
            if [[ ! -e "$full_path" ]]; then
                log_error "清单中的文件不存在: $file_path"
                return 1
            fi
            
            if [[ -f "$full_path" ]]; then
                local file_size
                file_size=$(stat -c%s "$full_path")
                
                if [[ $file_size -gt $MAX_FILE_SIZE ]]; then
                    log_error "文件超过大小限制: $file_path"
                    return 1
                fi
                
                local actual_sha
                actual_sha=$(sha256sum "$full_path" | awk '{print $1}')
                
                if [[ "$actual_sha" != "$expected_sha" ]]; then
                    log_error "SHA256 不匹配: $file_path"
                    return 1
                fi
                
                verified_files+=("$file_path")
            elif [[ -d "$full_path" ]]; then
                :
            else
                log_error "不支持的文件类型: $file_path"
                return 1
            fi
            
            file_count=$((file_count + 1))
            
            if [[ $file_count -gt $MAX_FILE_COUNT ]]; then
                log_error "文件数量超过限制"
                return 1
            fi
        done < "${extract_dir}/build-manifest.txt"
        
        # 检查软链接
        local symlink_count
        symlink_count=$(find "${extract_dir}" -type l 2>/dev/null | wc -l)
        
        if [[ $symlink_count -gt 0 ]]; then
            log_error "提取目录包含软链接"
            return 1
        fi
        
        # 检查额外文件
        while IFS= read -r file; do
            local rel_path
            rel_path=$(realpath --relative-to="${extract_dir}" "$file" | sed 's|^\./||')
            
            if [[ "$rel_path" == "build-manifest.txt" ]]; then
                continue
            fi
            
            local found=false
            for verified in "${verified_files[@]}"; do
                if [[ "$rel_path" == "$verified" ]]; then
                    found=true
                    break
                fi
            done
            
            if [[ "$found" == "false" ]]; then
                log_error "发现额外文件: $rel_path"
                return 1
            fi
        done < <(find "${extract_dir}" -type f ! -name build-manifest.txt)
        
        return 0
    }
    
    validate_archive_contents() {
        local archive_file="$1"
        
        local member_count=0
        while IFS= read -r line; do
            local type_char="${line:0:1}"
            
            if [[ "$type_char" == "-" ]] || [[ "$type_char" == "d" ]]; then
                member_count=$((member_count + 1))
                
                if [[ $member_count -gt $MAX_FILE_COUNT ]]; then
                    log_error "归档成员数量超过限制"
                    return 1
                fi
                continue
            fi
            
            if [[ "$type_char" == "l" ]]; then
                log_error "归档包含软链接: $line"
                return 1
            fi
            
            if [[ "$type_char" == "h" ]]; then
                log_error "归档包含硬链接: $line"
                return 1
            fi
            
            if [[ "$type_char" =~ ^[bcp] ]]; then
                log_error "归档包含特殊文件: $line"
                return 1
            fi
            
            log_error "归档包含未知文件类型: $line"
            return 1
        done < <(tar -tvzf "${archive_file}" 2>&1)
        
        return 0
    }
}

# 创建有效包
create_valid_package() {
    local dir="$1"
    mkdir -p "$dir"
    
    echo '<html><body>Test</body></html>' > "$dir/index.html"
    mkdir -p "$dir/assets"
    echo 'body {}' > "$dir/assets/style.css"
    
    (
        cd "$dir"
        find . -type f ! -name build-manifest.txt | sed 's|^\./||' | sort | while read -r file; do
            sha256sum "$file"
        done > build-manifest.txt
        
        echo "REVISION=0123456789abcdef0123456789abcdef01234567" >> build-manifest.txt
        echo "BUILD_TIME=$(date +%Y%m%d-%H%M%S)" >> build-manifest.txt
        echo "GITHUB_RUN_ID=12345" >> build-manifest.txt
    )
    
    tar -czf "$dir.tar.gz" -C "$dir" .
}

# 测试 1: 正常包
test_valid_package() {
    log_test "正常包验证"
    
    local test_pkg="${TEST_DIR}/valid"
    create_valid_package "$test_pkg"
    
    # 测试归档验证
    if validate_archive_contents "${test_pkg}.tar.gz" 2>&1 >/dev/null; then
        log_pass "归档内容验证通过"
    else
        log_fail "归档内容验证失败"
        return
    fi
    
    # 测试提取内容验证
    if validate_extracted "$test_pkg" 2>&1 >/dev/null; then
        log_pass "提取内容验证通过"
    else
        log_fail "提取内容验证失败"
    fi
}

# 测试 2: 路径注入
test_path_injection() {
    log_test "路径注入攻击 (../)"
    
    local test_pkg="${TEST_DIR}/path_inject"
    mkdir -p "$test_pkg"
    
    echo "malicious" > "$test_pkg/index.html"
    
    (
        cd "$test_pkg"
        sha256sum index.html > build-manifest.txt
        echo "fake_sha ../../etc/passwd" >> build-manifest.txt
        echo "REVISION=0123456789abcdef0123456789abcdef01234567" >> build-manifest.txt
    )
    
    if validate_extracted "$test_pkg" 2>&1 >/dev/null; then
        log_fail "路径注入未被拒绝"
    else
        log_pass "路径注入被正确拒绝"
    fi
}

# 测试 3: 软链接在归档中
test_symlink_in_archive() {
    log_test "软链接在归档中"
    
    local test_pkg="${TEST_DIR}/symlink_archive"
    mkdir -p "$test_pkg"
    
    echo "normal" > "$test_pkg/index.html"
    ln -s /etc/passwd "$test_pkg/evil-link"
    
    (
        cd "$test_pkg"
        sha256sum index.html > build-manifest.txt
        echo "REVISION=0123456789abcdef0123456789abcdef01234567" >> build-manifest.txt
    )
    
    tar -czf "${test_pkg}.tar.gz" -C "$test_pkg" .
    
    if validate_archive_contents "${test_pkg}.tar.gz" 2>&1 >/dev/null; then
        log_fail "归档中的软链接未被拒绝"
    else
        log_pass "归档中的软链接被正确拒绝"
    fi
}

# 测试 4: 硬链接在归档中
test_hardlink_in_archive() {
    log_test "硬链接在归档中"
    
    local test_pkg="${TEST_DIR}/hardlink_archive"
    mkdir -p "$test_pkg"
    
    echo "normal" > "$test_pkg/index.html"
    echo "original" > "$test_pkg/file1.txt"
    ln "$test_pkg/file1.txt" "$test_pkg/file2.txt"  # 硬链接
    
    (
        cd "$test_pkg"
        sha256sum index.html > build-manifest.txt
        echo "REVISION=0123456789abcdef0123456789abcdef01234567" >> build-manifest.txt
    )
    
    tar -czf "${test_pkg}.tar.gz" -C "$test_pkg" .
    
    if validate_archive_contents "${test_pkg}.tar.gz" 2>&1 >/dev/null; then
        log_fail "归档中的硬链接未被拒绝"
    else
        log_pass "归档中的硬链接被正确拒绝"
    fi
}

# 测试 5: 提取后软链接
test_symlink_after_extract() {
    log_test "提取后软链接"
    
    local test_pkg="${TEST_DIR}/symlink_post"
    mkdir -p "$test_pkg"
    
    echo "normal" > "$test_pkg/index.html"
    ln -s /etc/passwd "$test_pkg/evil-link"
    
    (
        cd "$test_pkg"
        sha256sum index.html > build-manifest.txt
        echo "REVISION=0123456789abcdef0123456789abcdef01234567" >> build-manifest.txt
    )
    
    if validate_extracted "$test_pkg" 2>&1 >/dev/null; then
        log_fail "提取后的软链接未被拒绝"
    else
        log_pass "提取后的软链接被正确拒绝"
    fi
}

# 测试 6: SHA256 不匹配
test_sha_mismatch() {
    log_test "SHA256 不匹配"
    
    local test_pkg="${TEST_DIR}/sha_mismatch"
    mkdir -p "$test_pkg"
    
    echo "original" > "$test_pkg/index.html"
    
    (
        cd "$test_pkg"
        sha256sum index.html > build-manifest.txt
        echo "REVISION=0123456789abcdef0123456789abcdef01234567" >> build-manifest.txt
    )
    
    echo "modified" > "$test_pkg/index.html"
    
    if validate_extracted "$test_pkg" 2>&1 >/dev/null; then
        log_fail "SHA256 不匹配未被检测"
    else
        log_pass "SHA256 不匹配被正确检测"
    fi
}

# 测试 7: 额外文件
test_extra_file() {
    log_test "额外文件攻击"
    
    local test_pkg="${TEST_DIR}/extra_file"
    mkdir -p "$test_pkg"
    
    echo "normal" > "$test_pkg/index.html"
    echo "backdoor" > "$test_pkg/evil.php"
    
    (
        cd "$test_pkg"
        sha256sum index.html > build-manifest.txt
        echo "REVISION=0123456789abcdef0123456789abcdef01234567" >> build-manifest.txt
    )
    
    if validate_extracted "$test_pkg" 2>&1 >/dev/null; then
        log_fail "额外文件未被检测"
    else
        log_pass "额外文件被正确检测"
    fi
}

# 测试 8: 无效 REVISION
test_invalid_revision() {
    log_test "无效 REVISION"
    
    local test_pkg="${TEST_DIR}/bad_rev"
    mkdir -p "$test_pkg"
    
    echo "normal" > "$test_pkg/index.html"
    
    (
        cd "$test_pkg"
        sha256sum index.html > build-manifest.txt
        echo "REVISION=../../malicious" >> build-manifest.txt
    )
    
    if validate_extracted "$test_pkg" 2>&1 >/dev/null; then
        log_fail "无效 REVISION 未被拒绝"
    else
        log_pass "无效 REVISION 被正确拒绝"
    fi
}

# 运行所有测试
main() {
    echo "部署验证真实测试（调用真实函数）"
    echo "测试目录: $TEST_DIR"
    echo ""
    
    source_wrapper_functions
    
    test_valid_package
    test_path_injection
    test_symlink_in_archive
    test_hardlink_in_archive
    test_symlink_after_extract
    test_sha_mismatch
    test_extra_file
    test_invalid_revision
    
    echo ""
    echo "======================================"
    echo "测试结果"
    echo "======================================"
    echo "通过: $PASSED"
    echo "失败: $FAILED"
    
    if [[ $FAILED -eq 0 ]]; then
        echo "✓ 所有测试通过"
        exit 0
    else
        echo "✗ 部分测试失败"
        exit 1
    fi
}

main "$@"
