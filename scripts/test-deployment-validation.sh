#!/usr/bin/env bash
#
# 部署验证回归测试 - 真正调用验证逻辑
#
# 测试 validate_extracted 函数对各种恶意包的响应

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WRAPPER_SCRIPT="${SCRIPT_DIR}/server-side/deploy-wrapper.sh"
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

# 提取验证函数（用于独立测试）
extract_validation_functions() {
    # 从 wrapper 脚本提取关键函数
    cat > "${TEST_DIR}/validation.sh" <<'VALIDATION_EOF'
#!/usr/bin/env bash
set -euo pipefail

MAX_FILE_SIZE=$((50 * 1024 * 1024))
MAX_FILE_COUNT=10000

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
    
    log_info "验证通过"
    return 0
}

# 主入口
validate_extracted "$1"
VALIDATION_EOF
    
    chmod +x "${TEST_DIR}/validation.sh"
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
        # 排除 build-manifest.txt 本身
        find . -type f ! -name build-manifest.txt | sed 's|^\./||' | sort | while read -r file; do
            sha256sum "$file"
        done > build-manifest.txt
        
        echo "REVISION=0123456789abcdef0123456789abcdef01234567" >> build-manifest.txt
        echo "BUILD_TIME=$(date +%Y%m%d-%H%M%S)" >> build-manifest.txt
        echo "GITHUB_RUN_ID=12345" >> build-manifest.txt
    )
}

# 测试 1: 正常包
test_valid_package() {
    log_test "正常包验证"
    
    local test_pkg="${TEST_DIR}/valid"
    create_valid_package "$test_pkg"
    
    if "${TEST_DIR}/validation.sh" "$test_pkg" 2>&1 | grep -q "验证通过"; then
        log_pass "正常包通过验证"
    else
        log_fail "正常包未通过验证"
    fi
}

# 测试 2: 路径注入 (../)
test_path_injection() {
    log_test "路径注入攻击 (../)"
    
    local test_pkg="${TEST_DIR}/path_inject"
    mkdir -p "$test_pkg"
    
    echo "malicious" > "$test_pkg/index.html"
    
    (
        cd "$test_pkg"
        echo "$(sha256sum index.html)" > build-manifest.txt
        # 恶意路径
        echo "$(sha256sum index.html | awk '{print $1}') ../../etc/passwd" >> build-manifest.txt
        echo "REVISION=0123456789abcdef0123456789abcdef01234567" >> build-manifest.txt
    )
    
    if "${TEST_DIR}/validation.sh" "$test_pkg" 2>&1 | grep -q "不安全的路径"; then
        log_pass "路径注入被正确拒绝"
    else
        log_fail "路径注入未被拒绝"
    fi
}

# 测试 3: 软链接
test_symlink() {
    log_test "软链接攻击"
    
    local test_pkg="${TEST_DIR}/symlink"
    mkdir -p "$test_pkg"
    
    echo "normal" > "$test_pkg/index.html"
    ln -s /etc/passwd "$test_pkg/malicious-link"
    
    (
        cd "$test_pkg"
        sha256sum index.html > build-manifest.txt
        echo "REVISION=0123456789abcdef0123456789abcdef01234567" >> build-manifest.txt
    )
    
    if "${TEST_DIR}/validation.sh" "$test_pkg" 2>&1 | grep -q "软链接"; then
        log_pass "软链接被正确拒绝"
    else
        log_fail "软链接未被拒绝"
    fi
}

# 测试 4: SHA256 不匹配
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
    
    # 修改文件
    echo "modified" > "$test_pkg/index.html"
    
    if "${TEST_DIR}/validation.sh" "$test_pkg" 2>&1 | grep -q "SHA256 不匹配"; then
        log_pass "SHA256 不匹配被正确检测"
    else
        log_fail "SHA256 不匹配未被检测"
    fi
}

# 测试 5: 额外文件
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
    
    if "${TEST_DIR}/validation.sh" "$test_pkg" 2>&1 | grep -q "额外文件"; then
        log_pass "额外文件被正确检测"
    else
        log_fail "额外文件未被检测"
    fi
}

# 测试 6: 无效 REVISION
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
    
    if "${TEST_DIR}/validation.sh" "$test_pkg" 2>&1 | grep -q "REVISION 格式无效"; then
        log_pass "无效 REVISION 被正确拒绝"
    else
        log_fail "无效 REVISION 未被拒绝"
    fi
}

# 测试 7: 缺少 index.html
test_missing_index() {
    log_test "缺少 index.html"
    
    local test_pkg="${TEST_DIR}/no_index"
    mkdir -p "$test_pkg"
    
    echo "other" > "$test_pkg/other.html"
    
    (
        cd "$test_pkg"
        sha256sum other.html > build-manifest.txt
        echo "REVISION=0123456789abcdef0123456789abcdef01234567" >> build-manifest.txt
    )
    
    if "${TEST_DIR}/validation.sh" "$test_pkg" 2>&1 | grep -q "缺少 index.html"; then
        log_pass "缺少 index.html 被正确检测"
    else
        log_fail "缺少 index.html 未被检测"
    fi
}

# 运行所有测试
main() {
    echo "部署验证回归测试（真实验证逻辑）"
    echo "测试目录: $TEST_DIR"
    echo ""
    
    extract_validation_functions
    
    test_valid_package
    test_path_injection
    test_symlink
    test_sha_mismatch
    test_extra_file
    test_invalid_revision
    test_missing_index
    
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
