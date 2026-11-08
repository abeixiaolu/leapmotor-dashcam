# 主会话配置清单

## PR 信息

- **PR 地址**：https://github.com/abeixiaolu/leapmotor-dashcam/pull/1
- **分支**：`cursor/github-actions-ci-cd-1347`

## 配置步骤

### 1. 生成 SSH 密钥（本地 Mac）

```bash
ssh-keygen -t ed25519 -C "github-actions-deploy" \
    -f ~/.ssh/github_deploy_ed25519 -N ""
```

### 2. 配置生产服务器

详细步骤：[docs/SERVER_SETUP.md](SERVER_SETUP.md)

快速清单：

```bash
# SSH 到服务器
ssh root@124.223.96.15

# 创建用户
useradd -r -s /bin/bash -d /home/dashcam-deploy -m dashcam-deploy

# 创建暂存目录
mkdir -p /var/tmp/dashcam-staging
chmod 1777 /var/tmp/dashcam-staging

# 安装部署脚本和共享库（从 PR 分支获取）
install -m 755 -o root -g root deploy-wrapper.sh /usr/local/bin/dashcam-deploy
mkdir -p /usr/local/lib/dashcam
install -m 644 -o root -g root fingerprint.sh /usr/local/lib/dashcam/fingerprint.sh

# 配置 sudo
visudo -f /etc/sudoers.d/dashcam-deploy
# 添加: dashcam-deploy ALL=(root) NOPASSWD:NOSETENV: /usr/local/bin/dashcam-deploy

# 配置 SSH
mkdir -p /home/dashcam-deploy/.ssh
chmod 700 /home/dashcam-deploy/.ssh

cat > /home/dashcam-deploy/.ssh/authorized_keys <<'EOF'
command="sudo /usr/local/bin/dashcam-deploy",no-port-forwarding,no-X11-forwarding,no-agent-forwarding,no-pty ssh-ed25519 <步骤1的公钥> github-actions-deploy
EOF

chmod 600 /home/dashcam-deploy/.ssh/authorized_keys
chown -R dashcam-deploy:dashcam-deploy /home/dashcam-deploy/.ssh
```

### 3. 验证安全限制

```bash
# 应执行部署脚本（缺少输入会报错）
ssh -i ~/.ssh/github_deploy_ed25519 dashcam-deploy@124.223.96.15 < /dev/null

# 以下应失败
ssh -i ~/.ssh/github_deploy_ed25519 dashcam-deploy@124.223.96.15 /bin/bash
ssh -i ~/.ssh/github_deploy_ed25519 dashcam-deploy@124.223.96.15 ls /
```

### 4. 配置 GitHub Secrets

| Secret 名称 | 值 |
|------------|---|
| `DEPLOY_SSH_KEY` | `cat ~/.ssh/github_deploy_ed25519` 的完整输出 |
| `DEPLOY_SSH_KNOWN_HOSTS` | `124.223.96.15 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOrUXRIcEVO3c0bjADU8/LzpqNt/CrebxbCp+PWq5H08` |

### 5. 配置 GitHub Variables

| Variable 名称 | 值 |
|--------------|---|
| `DEPLOY_USER` | `dashcam-deploy` |
| `DEPLOY_HOST` | `124.223.96.15` |

### 6. 测试和合并

1. 观察 PR CI 检查（test-and-build 应成功）
2. 合并 PR 到 master
3. 观察自动部署
4. 访问 https://dashcam.abei.me 验证

## 已知限制

- PR 的 CI 会跳过部署步骤（manifest 和 artifact 生成），这是预期行为
- 仅 master 分支推送或手动触发会执行部署
- 部署脚本需要完整的 40 字符 SHA commit

## 参考文档

- [docs/SERVER_SETUP.md](SERVER_SETUP.md) - 服务器配置详细步骤
- [docs/DEPLOYMENT.md](DEPLOYMENT.md) - 完整部署文档
- [docs/SECURITY.md](SECURITY.md) - 安全最佳实践
