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

# Source 真实的服务器端脚本
source "${SCRIPT_DIR}/server-side/deploy-wrapper.sh"

# 创建有效包
create_valid_package() {
    local dir="$1"
    mkdir -p "$dir"
    
    echo '<html><body>Test</body></html>' > "$dir/index.html"
    mkdir -p "$dir/assets"
    echo 'body {}' > "$dir/assets/style.css"
    echo '{"status":"ok","service":"dashcam","version":"test","revision":"test","buildTime":"test"}' > "$dir/health.json"
    
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
    echo "部署验证真实测试（source 真实 wrapper 函数）"
    echo "测试目录: $TEST_DIR"
    echo ""
    
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
