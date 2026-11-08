#!/usr/bin/env bash
#
# 测试客户端、CI、Server 指纹计算一致性

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEST_DIR="$(mktemp -d)"

cleanup() {
    rm -rf "$TEST_DIR"
}

trap cleanup EXIT

# 加载共享指纹逻辑
source "${SCRIPT_DIR}/lib/fingerprint.sh"

# 模拟 CI 构建
simulate_ci_build() {
    local dist_dir="$1"
    local manifest_file="$2"
    local revision="$3"
    local build_time="$4"
    
    mkdir -p "$dist_dir"
    
    # 创建测试文件
    echo '<!DOCTYPE html><html><body>Test</body></html>' > "$dist_dir/index.html"
    mkdir -p "$dist_dir/assets"
    echo 'body { margin: 0; }' > "$dist_dir/assets/style.css"
    cp "${SCRIPT_DIR}/../public/health.json" "$dist_dir/"
    
    # 模拟 CI 步骤
    (
        cd "$dist_dir"
        
        # 步骤 1: 生成清单（排除 health.json）
        find . -type f ! -name 'health.json' | sed 's|^\./||' | sort | while read -r file; do
            sha256sum "$file"
        done > "$manifest_file"
        
        # 步骤 2: 追加 metadata
        echo "REVISION=${revision}" >> "$manifest_file"
        echo "BUILD_TIME=${build_time}" >> "$manifest_file"
        echo "GITHUB_RUN_ID=12345678" >> "$manifest_file"
        
        # 步骤 3: 计算指纹
        local fingerprint
        fingerprint=$(calculate_fingerprint "$manifest_file")
        local version="${revision:0:8}-${fingerprint}"
        
        # 步骤 4: 注入 metadata 到 health.json
        sed -i "s/__VERSION_PLACEHOLDER__/${version}/g" health.json
        sed -i "s/__REVISION_PLACEHOLDER__/${revision}/g" health.json
        sed -i "s/__BUILD_TIME_PLACEHOLDER__/${build_time}/g" health.json
        
        # 步骤 5: 追加 health.json 到清单
        sha256sum health.json >> "$manifest_file"
    )
}

echo "==========================================="
echo "指纹一致性测试"
echo "==========================================="

REVISION="0123456789abcdef0123456789abcdef01234567"
BUILD_TIME="20261108-110500"
DIST_DIR="${TEST_DIR}/dist"
MANIFEST_FILE="${TEST_DIR}/build-manifest.txt"

# 模拟 CI 构建
echo "[1] 模拟 CI 构建..."
simulate_ci_build "$DIST_DIR" "$MANIFEST_FILE" "$REVISION" "$BUILD_TIME"

# 客户端计算
echo "[2] 客户端计算版本..."
CLIENT_VERSION=$(generate_version_name "$REVISION" "$MANIFEST_FILE")
echo "    CLIENT_VERSION: ${CLIENT_VERSION}"

# Server 计算
echo "[3] Server 计算版本..."
source "${SCRIPT_DIR}/server-side/deploy-wrapper.sh"
SERVER_VERSION=$(generate_release_name "$REVISION" "$MANIFEST_FILE")
echo "    SERVER_VERSION: ${SERVER_VERSION}"

# Health.json 中的版本
echo "[4] Health.json 中的版本..."
HEALTH_VERSION=$(jq -r .version "${DIST_DIR}/health.json")
echo "    HEALTH_VERSION: ${HEALTH_VERSION}"

# 验证一致性
echo ""
echo "==========================================="
echo "一致性验证"
echo "==========================================="

SUCCESS=true

if [[ "${CLIENT_VERSION}" == "${SERVER_VERSION}" ]]; then
    echo "✓ 客户端与 Server 一致: ${CLIENT_VERSION}"
else
    echo "✗ 客户端与 Server 不一致:"
    echo "    CLIENT: ${CLIENT_VERSION}"
    echo "    SERVER: ${SERVER_VERSION}"
    SUCCESS=false
fi

if [[ "${CLIENT_VERSION}" == "${HEALTH_VERSION}" ]]; then
    echo "✓ 客户端与 Health.json 一致: ${CLIENT_VERSION}"
else
    echo "✗ 客户端与 Health.json 不一致:"
    echo "    CLIENT: ${CLIENT_VERSION}"
    echo "    HEALTH:  ${HEALTH_VERSION}"
    SUCCESS=false
fi

if [[ "${SERVER_VERSION}" == "${HEALTH_VERSION}" ]]; then
    echo "✓ Server 与 Health.json 一致: ${SERVER_VERSION}"
else
    echo "✗ Server 与 Health.json 不一致:"
    echo "    SERVER: ${SERVER_VERSION}"
    echo "    HEALTH:  ${HEALTH_VERSION}"
    SUCCESS=false
fi

echo ""
if $SUCCESS; then
    echo "✓ 所有指纹计算一致"
    exit 0
else
    echo "✗ 指纹计算存在不一致"
    exit 1
fi
