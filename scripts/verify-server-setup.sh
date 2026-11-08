#!/usr/bin/env bash
#
# 服务器配置验证脚本
# 
# 用途：在配置部署流程之前，验证服务器端配置是否正确
# 执行：./scripts/verify-server-setup.sh <deploy-user> <deploy-host>

set -euo pipefail

DEPLOY_USER="${1:-}"
DEPLOY_HOST="${2:-}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_ok() {
    echo -e "${GREEN}✓${NC} $*"
}

log_warn() {
    echo -e "${YELLOW}⚠${NC} $*"
}

log_error() {
    echo -e "${RED}✗${NC} $*"
}

if [[ -z "$DEPLOY_USER" ]] || [[ -z "$DEPLOY_HOST" ]]; then
    echo "用法: $0 <deploy-user> <deploy-host>"
    echo "示例: $0 deploy 124.223.96.15"
    exit 1
fi

TARGET="${DEPLOY_USER}@${DEPLOY_HOST}"
DEPLOY_PATH="/srv/dashcam"

echo "=========================================="
echo "服务器配置验证"
echo "目标: $TARGET"
echo "=========================================="
echo

# 1. SSH 连接测试
echo "1. 测试 SSH 连接..."
if ssh -o BatchMode=yes -o ConnectTimeout=10 "$TARGET" "echo 'SSH 连接成功'" &>/dev/null; then
    log_ok "SSH 连接成功"
else
    log_error "SSH 连接失败"
    echo "   请确认："
    echo "   - SSH 公钥已添加到服务器 ~/.ssh/authorized_keys"
    echo "   - 服务器防火墙允许 SSH 连接"
    echo "   - 用户名和主机地址正确"
    exit 1
fi
echo

# 2. 检查部署用户权限
echo "2. 检查部署用户权限..."

# 检查是否有 sudo 权限（应该没有）
SUDO_CHECK=$(ssh "$TARGET" "sudo -n true 2>&1 || echo 'no-sudo'")
if [[ "$SUDO_CHECK" == *"no-sudo"* ]]; then
    log_ok "部署用户无 sudo 权限（符合最小权限原则）"
else
    log_warn "部署用户有 sudo 权限（建议移除）"
fi

# 检查 shell
SHELL_CHECK=$(ssh "$TARGET" "echo \$SHELL")
log_ok "用户 shell: $SHELL_CHECK"
echo

# 3. 检查部署目录
echo "3. 检查部署目录..."

DIR_CHECK=$(ssh "$TARGET" bash <<'EOF'
if [[ ! -d "/srv/dashcam" ]]; then
    echo "NOT_EXISTS"
elif [[ ! -w "/srv/dashcam" ]]; then
    echo "NOT_WRITABLE"
else
    echo "OK"
fi
EOF
)

if [[ "$DIR_CHECK" == "OK" ]]; then
    log_ok "部署目录 $DEPLOY_PATH 存在且可写"
elif [[ "$DIR_CHECK" == "NOT_EXISTS" ]]; then
    log_warn "部署目录不存在，将在首次部署时创建"
elif [[ "$DIR_CHECK" == "NOT_WRITABLE" ]]; then
    log_error "部署目录存在但不可写"
    echo "   请执行: sudo chown -R $DEPLOY_USER:$DEPLOY_USER $DEPLOY_PATH"
    exit 1
fi

# 检查子目录
ssh "$TARGET" "mkdir -p $DEPLOY_PATH/releases" 2>/dev/null && \
    log_ok "releases 子目录已准备"
echo

# 4. 检查必需工具
echo "4. 检查必需工具..."

TOOLS=("rsync" "sha256sum" "find" "ln" "mv")
for tool in "${TOOLS[@]}"; do
    if ssh "$TARGET" "which $tool &>/dev/null"; then
        log_ok "$tool 已安装"
    else
        log_error "$tool 未安装"
        echo "   请执行: sudo apt install $tool"
    fi
done
echo

# 5. 检查磁盘空间
echo "5. 检查磁盘空间..."

DISK_INFO=$(ssh "$TARGET" "df -h $DEPLOY_PATH | tail -1")
DISK_USAGE=$(echo "$DISK_INFO" | awk '{print $5}' | sed 's/%//')
DISK_AVAIL=$(echo "$DISK_INFO" | awk '{print $4}')

echo "   可用空间: $DISK_AVAIL"
if [[ $DISK_USAGE -lt 80 ]]; then
    log_ok "磁盘空间充足（已使用 ${DISK_USAGE}%）"
elif [[ $DISK_USAGE -lt 90 ]]; then
    log_warn "磁盘空间紧张（已使用 ${DISK_USAGE}%）"
else
    log_error "磁盘空间不足（已使用 ${DISK_USAGE}%）"
fi
echo

# 6. 测试文件创建和删除
echo "6. 测试文件操作..."

TEST_FILE="$DEPLOY_PATH/.deploy-test-$$"
if ssh "$TARGET" "echo 'test' > $TEST_FILE && rm $TEST_FILE"; then
    log_ok "文件创建和删除测试通过"
else
    log_error "文件操作失败"
    exit 1
fi
echo

# 7. 检查现有部署
echo "7. 检查现有部署..."

CURRENT_EXISTS=$(ssh "$TARGET" "[[ -L $DEPLOY_PATH/current ]] && echo 'YES' || echo 'NO'")
if [[ "$CURRENT_EXISTS" == "YES" ]]; then
    CURRENT_TARGET=$(ssh "$TARGET" "readlink $DEPLOY_PATH/current")
    log_ok "当前版本: $CURRENT_TARGET"
    
    RELEASE_COUNT=$(ssh "$TARGET" "ls -1 $DEPLOY_PATH/releases/ 2>/dev/null | wc -l")
    log_ok "历史版本数: $RELEASE_COUNT"
else
    log_warn "尚无部署版本（首次部署）"
fi
echo

# 8. 生成 known_hosts 条目
echo "8. 生成 SSH known_hosts 条目..."
echo "   将以下内容添加到 GitHub Secret DEPLOY_SSH_KNOWN_HOSTS:"
echo
ssh-keyscan -H "$DEPLOY_HOST" 2>/dev/null
echo

# 总结
echo "=========================================="
echo "验证完成"
echo "=========================================="
echo
echo "后续步骤："
echo "1. 确保所有检查项都通过（绿色 ✓）"
echo "2. 将 SSH 公钥添加到服务器（如果尚未添加）"
echo "3. 将上面生成的 known_hosts 添加到 GitHub Secret"
echo "4. 在 GitHub 配置 Secrets 和 Variables（参考 docs/DEPLOYMENT.md）"
echo "5. 创建 PR 测试 CI 流程"
echo
