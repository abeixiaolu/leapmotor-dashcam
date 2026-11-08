# 后续配置要点

本文档说明需要主会话完成的配置步骤（不在云 VM 中进行）。

## PR 信息

- **PR 地址**：https://github.com/abeixiaolu/leapmotor-dashcam/pull/1
- **分支**：`cursor/github-actions-ci-cd-1347`
- **状态**：等待配置和测试

## 设计方案

### 受限部署接口

基于现有部署状态（`/srv/dashcam` 为 `root:root 755`，current 由 root 持有），采用受限部署接口设计：

- 创建 `dashcam-deploy` 专用用户（无 shell，无家目录）
- 通过 sudo 执行固定的部署包装脚本（`/usr/local/bin/dashcam-deploy`）
- authorized_keys 限制仅能执行部署命令
- 不给 CI ubuntu/sudo/docker 通用权限

### 工作流程

```
GitHub Actions → SSH (受限密钥) → dashcam-deploy 用户 → sudo 执行固定命令 → root 部署脚本
```

## 需要主会话完成的配置

### 1. 生成 SSH 密钥对（本地机器）

**在你的本地 Mac 上执行**（不要在服务器或云 VM 上）：

```bash
# 生成专用于部署的 SSH 密钥
ssh-keygen -t ed25519 -C "github-actions-deploy" \
    -f ~/.ssh/github_deploy_ed25519 -N ""

# 查看私钥（添加到 GitHub Secret DEPLOY_SSH_KEY）
cat ~/.ssh/github_deploy_ed25519

# 查看公钥（添加到服务器）
cat ~/.ssh/github_deploy_ed25519.pub
```

### 2. 配置生产服务器（124.223.96.15）

**详细步骤请参考：[docs/SERVER_SETUP.md](SERVER_SETUP.md)**

快速步骤：

```bash
# SSH 连接到服务器（使用原有 Mac SSH）
ssh root@124.223.96.15

# 1. 创建受限部署用户
useradd -r -s /usr/sbin/nologin -M dashcam-deploy

# 2. 安装服务器端部署包装脚本
# （需要先从 PR 分支获取 scripts/server-side/deploy-wrapper.sh）
cp scripts/server-side/deploy-wrapper.sh /usr/local/bin/dashcam-deploy
chmod 755 /usr/local/bin/dashcam-deploy
chown root:root /usr/local/bin/dashcam-deploy

# 3. 配置 sudo 权限
visudo -f /etc/sudoers.d/dashcam-deploy
# 添加: dashcam-deploy ALL=(root) NOPASSWD:NOSETENV: /usr/local/bin/dashcam-deploy

# 4. 创建 SSH 目录
mkdir -p /home/dashcam-deploy/.ssh
chmod 700 /home/dashcam-deploy/.ssh
chown dashcam-deploy:dashcam-deploy /home/dashcam-deploy/.ssh

# 5. 配置 SSH 授权密钥（受限命令）
# 将步骤 1 生成的公钥添加到 authorized_keys，格式如下：
cat > /home/dashcam-deploy/.ssh/authorized_keys <<'EOF'
command="sudo /usr/local/bin/dashcam-deploy",no-port-forwarding,no-X11-forwarding,no-agent-forwarding,no-pty ssh-ed25519 <粘贴步骤1生成的公钥> github-actions-deploy
EOF

chmod 600 /home/dashcam-deploy/.ssh/authorized_keys
chown dashcam-deploy:dashcam-deploy /home/dashcam-deploy/.ssh/authorized_keys

# 6. 创建上传临时目录
mkdir -p /srv/dashcam/.upload
chmod 700 /srv/dashcam/.upload

exit
```

### 3. 使用已知的 SSH Known Hosts

已从正常经认证的 SSH 获得可信服务器公开 known_hosts：

```
124.223.96.15 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOrUXRIcEVO3c0bjADU8/LzpqNt/CrebxbCp+PWq5H08
```

ED25519 指纹：`SHA256:aM/Ph1dWSFQmCqnLtvx3Q2TtdWMky20pWAaE6nUPuIc`

这个值将用于 GitHub Secret `DEPLOY_SSH_KNOWN_HOSTS`。

### 4. 配置 GitHub Secrets

**说明**：当前云 VM 环境无法配置 GitHub Actions secrets。需要主会话通过以下方式之一配置：

- GitHub Web UI：Settings → Secrets and variables → Actions → Secrets
- GitHub CLI (`gh secret set`)
- GitHub API
- 或其他有权限的方式

#### Secret 1: `DEPLOY_SSH_KEY`

| 字段 | 值 |
|------|---|
| 名称 | `DEPLOY_SSH_KEY` |
| 类型 | Repository secret |
| 值 | 步骤 1 中 `cat ~/.ssh/github_deploy_ed25519` 的完整输出 |
| 格式 | 包含 `-----BEGIN OPENSSH PRIVATE KEY-----` 和 `-----END OPENSSH PRIVATE KEY-----` 标记，包含所有换行符 |

#### Secret 2: `DEPLOY_SSH_KNOWN_HOSTS`

| 字段 | 值 |
|------|---|
| 名称 | `DEPLOY_SSH_KNOWN_HOSTS` |
| 类型 | Repository secret |
| 值 | `124.223.96.15 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOrUXRIcEVO3c0bjADU8/LzpqNt/CrebxbCp+PWq5H08` |
| 格式 | 明文主机密钥行（不需要哈希化） |

### 5. 配置 GitHub Variables

在 GitHub 仓库设置中添加（Settings → Secrets and variables → Actions → Variables）：

| 变量名 | 值 | 说明 |
|--------|---|------|
| `DEPLOY_USER` | `dashcam-deploy` | 受限部署用户名 |
| `DEPLOY_HOST` | `124.223.96.15` | 服务器 IP |

### 6. 验证配置

```bash
# 测试 SSH 连接（应该立即执行部署脚本，因为 authorized_keys 限制了命令）
# 由于没有输入构建包，脚本会报错，但这验证了 SSH 和 sudo 配置正确
ssh -i ~/.ssh/github_deploy_ed25519 dashcam-deploy@124.223.96.15 < /dev/null

# 验证无法获取 shell（应该失败）
ssh -i ~/.ssh/github_deploy_ed25519 dashcam-deploy@124.223.96.15 /bin/bash
# 预期：失败或被拒绝

# 验证无法执行其他命令（应该失败）
ssh -i ~/.ssh/github_deploy_ed25519 dashcam-deploy@124.223.96.15 ls /
# 预期：失败或被拒绝
```

如果：
- ✅ 第一个命令显示部署脚本开始执行（然后因为缺少输入而失败）
- ✅ 第二、三个命令被拒绝或失败

说明受限配置正确。

### 7. 更新 README 徽章

编辑 `README.md`，将徽章 URL 中的占位符替换为实际仓库信息：

```markdown
# 当前（占位符）
[![CI](https://github.com/USERNAME/REPO/actions/workflows/ci.yml/badge.svg)](https://github.com/USERNAME/REPO/actions/workflows/ci.yml)

# 应改为
[![CI](https://github.com/abeixiaolu/leapmotor-dashcam/actions/workflows/ci.yml/badge.svg)](https://github.com/abeixiaolu/leapmotor-dashcam/actions/workflows/ci.yml)
```

## 测试步骤

### 测试 1: PR 检查（当前 PR）

1. 观察 https://github.com/abeixiaolu/leapmotor-dashcam/pull/1 的 Checks
2. 确认 `test-and-build` job 成功
3. 确认不触发 `deploy-production` job

### 测试 2: 部署流程（合并后）

1. 完成上述所有配置
2. 合并 PR 到 `master`
3. 观察 Actions 页面的部署流程
4. 验证 https://dashcam.abei.me 显示新版本

### 测试 3: 回滚机制（可选）

```bash
# SSH 连接服务器
ssh deploy@124.223.96.15

# 查看版本
ls -la /srv/dashcam/releases/
ls -la /srv/dashcam/current

# 手动回滚到上一版本
ln -snf /srv/dashcam/releases/<old-version> /srv/dashcam/current.tmp
mv -Tf /srv/dashcam/current.tmp /srv/dashcam/current
```

## 安全注意事项

### ✅ 必须遵守

- SSH 密钥在本地 Mac 生成，不在服务器或云 VM 生成
- 不要在 GitHub Actions 日志中输出真实密钥
- 不要将私钥提交到 Git 仓库
- 不要复制个人 Mac 的主 SSH 密钥
- 定期轮换 SSH 密钥（建议每季度）

### ⚠️ 推荐配置

- 启用 GitHub 分支保护规则（要求 PR 审查）
- 启用 GitHub Dependabot 安全更新
- 配置服务器防火墙（限制 SSH 访问）
- 配置 fail2ban 防止 SSH 暴力破解

## 故障排查

### SSH 连接失败

**错误**: `Permission denied (publickey)`

**检查**:
1. 公钥是否已添加到服务器 `/home/deploy/.ssh/authorized_keys`
2. `.ssh` 目录权限是否为 `700`
3. `authorized_keys` 文件权限是否为 `600`
4. SSH 密钥格式是否正确（Ed25519）

### Host key verification failed

**错误**: `Host key verification failed`

**解决**:
1. 重新运行 `ssh-keyscan -H 124.223.96.15`
2. 更新 GitHub Secret `DEPLOY_SSH_KNOWN_HOSTS`

### 健康检查失败

**错误**: `ERROR: index.html 不存在`

**检查**:
1. 构建是否成功（查看 Actions 日志）
2. `dist/` 目录是否包含 `index.html`
3. 部署用户是否有读写权限

## 快速参考

| 文档 | 用途 |
|------|------|
| [QUICK_START_CICD.md](QUICK_START_CICD.md) | 15 分钟配置指南 |
| [DEPLOYMENT.md](DEPLOYMENT.md) | 完整部署文档 |
| [GITHUB_SECRETS_CHECKLIST.md](GITHUB_SECRETS_CHECKLIST.md) | 配置清单 |
| [SECURITY.md](SECURITY.md) | 安全最佳实践 |

## 下一步

1. [ ] 在本地 Mac 生成 SSH 密钥对
2. [ ] 配置生产服务器（创建用户、授权密钥）
3. [ ] 获取 SSH known_hosts
4. [ ] 在 GitHub 添加 Secrets
5. [ ] 在 GitHub 添加 Variables
6. [ ] 验证 SSH 连接
7. [ ] 观察 PR 的 CI 检查
8. [ ] 更新 README 徽章 URL
9. [ ] 合并 PR
10. [ ] 验证自动部署成功

---

**配置完成后，请回复主会话确认，以便观察部署流程。**
