#!/usr/bin/env bash
#
# 测试 package_build() 不污染 stdout
#
# 成功标准：
# 1. stdout 仅包含单行可读文件路径
# 2. 该路径对应的文件存在且可读
# 3. 所有日志和警告在 stderr

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEST_DIR="$(mktemp -d)"

cleanup() {
    rm -rf "$TEST_DIR"
}

trap cleanup EXIT

echo "=========================================" >&2
echo "测试 package_build() stdout 纯净性" >&2
echo "=========================================" >&2
echo "" >&2

# 创建假的构建产物
mkdir -p "$TEST_DIR/dist"
cat > "$TEST_DIR/dist/index.html" << 'EOF'
<!DOCTYPE html>
<html>
<head><title>Test</title></head>
<body><h1>Test Page</h1></body>
</html>
EOF

mkdir -p "$TEST_DIR/dist/assets"
cat > "$TEST_DIR/dist/assets/style.css" << 'EOF'
body { margin: 0; padding: 20px; }
EOF

cat > "$TEST_DIR/dist/health.json" << 'EOF'
{"status":"ok","service":"dashcam","version":"test","revision":"test","buildTime":"test"}
EOF

# 创建清单
cat > "$TEST_DIR/build-manifest.txt" << 'EOF'
d8da08994a7d20aed3346a7d58b7a99042cf21662c65f47c8480f84fcdc9cd8b  assets/style.css
fa95ed3b80027ec852efea35186167cfa8b5be20a2bbff8bcc7962d8bf9a7887  health.json
c5e99c94039b841d72b05fe09c0793b2e92521eb260ee84372bbdb59eba83ddb  index.html
REVISION=0123456789abcdef0123456789abcdef01234567
BUILD_TIME=20261108-112200
GITHUB_RUN_ID=12345678
EOF

# Source deploy 脚本（仅加载函数）
export BUILD_DIR="$TEST_DIR/dist"
export MANIFEST_FILE="$TEST_DIR/build-manifest.txt"

# 重定义日志函数（避免依赖）
log_info() { echo "[INFO] $*" >&2; }
log_error() { echo "[ERROR] $*" >&2; }

# 提取 package_build 函数
source <(sed -n '/^# 打包构建产物/,/^}/p' "${SCRIPT_DIR}/deploy-via-wrapper.sh")

echo "[1] 调用 package_build()，捕获 stdout..." >&2

# 捕获 stdout（stderr 显示到终端）
PACKAGE_FILE=$(package_build)
EXIT_CODE=$?

echo "" >&2
echo "=========================================" >&2
echo "验证结果" >&2
echo "=========================================" >&2

FAILED=0

# 验证 1: 退出码
if [[ $EXIT_CODE -eq 0 ]]; then
    echo "✓ 退出码: 0" >&2
else
    echo "✗ 退出码: $EXIT_CODE (期望 0)" >&2
    FAILED=1
fi

# 验证 2: stdout 是单行
LINE_COUNT=$(echo "$PACKAGE_FILE" | wc -l)
if [[ $LINE_COUNT -eq 1 ]]; then
    echo "✓ stdout 行数: 1" >&2
else
    echo "✗ stdout 行数: $LINE_COUNT (期望 1)" >&2
    echo "  内容: $PACKAGE_FILE" >&2
    FAILED=1
fi

# 验证 3: 路径不含警告/日志关键字
if echo "$PACKAGE_FILE" | grep -qE '\[INFO\]|\[ERROR\]|tar:|warning:|changed'; then
    echo "✗ stdout 包含日志/警告关键字" >&2
    echo "  内容: $PACKAGE_FILE" >&2
    FAILED=1
else
    echo "✓ stdout 无日志/警告污染" >&2
fi

# 验证 4: 文件存在且可读
if [[ -f "$PACKAGE_FILE" ]]; then
    echo "✓ 包文件存在: $PACKAGE_FILE" >&2
else
    echo "✗ 包文件不存在: $PACKAGE_FILE" >&2
    FAILED=1
fi

# 验证 5: 文件可读且是有效 tar.gz
if [[ -f "$PACKAGE_FILE" ]] && tar -tzf "$PACKAGE_FILE" >/dev/null 2>&2; then
    CONTENT_COUNT=$(tar -tzf "$PACKAGE_FILE" 2>/dev/null | wc -l)
    echo "✓ 包文件有效 tar.gz，包含 $CONTENT_COUNT 个条目" >&2
else
    echo "✗ 包文件不是有效 tar.gz" >&2
    FAILED=1
fi

echo "" >&2
if [[ $FAILED -eq 0 ]]; then
    echo "✓ 所有验证通过" >&2
    echo "" >&2
    echo "stdout 输出（实际部署时捕获）:" >&2
    echo "  $PACKAGE_FILE" >&2
    exit 0
else
    echo "✗ 部分验证失败" >&2
    exit 1
fi
