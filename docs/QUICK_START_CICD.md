# CI/CD 快速开始指南

本指南帮助你在 15 分钟内完成 GitHub Actions CI/CD 配置。

## 前置条件

- 有管理员权限的 GitHub 仓库
- 可以 SSH 访问的生产服务器（`124.223.96.15`）
- 本地已安装 `ssh`, `ssh-keygen`, `ssh-keyscan`

## 步骤 1: 生成 SSH 密钥对（2 分钟）

在你的本地机器（不是服务器）执行：

```bash
# 生成专用于部署的 SSH 密钥
ssh-keygen -t ed25519 -C "github-actions-deploy" \
    -f ~/.ssh/github_deploy_ed25519 -N ""

# 查看私钥（稍后添加到 GitHub Secret）
cat ~/.ssh/github_deploy_ed25519

# 查看公钥（稍后添加到服务器）
cat ~/.ssh/github_deploy_ed25519.pub
```

**保存这两个文件的内容**，稍后会用到。

---

## 步骤 2: 配置服务器（5 分钟）

SSH 连接到生产服务器：

```bash
ssh root@124.223.96.15
```

在服务器上执行：

```bash
# 1. 创建部署用户
sudo useradd -r -s /bin/bash -m -d /home/deploy deploy

# 2. 创建部署目录
sudo mkdir -p /srv/dashcam/releases
sudo chown -R deploy:deploy /srv/dashcam

# 3. 切换到 deploy 用户
sudo su - deploy

# 4. 配置 SSH 授权密钥
mkdir -p ~/.ssh
chmod 700 ~/.ssh

# 5. 将步骤 1 生成的公钥内容粘贴到下面（替换 YOUR_PUBLIC_KEY_HERE）
cat >> ~/.ssh/authorized_keys <<'EOF'
YOUR_PUBLIC_KEY_HERE
EOF

chmod 600 ~/.ssh/authorized_keys

# 6. 退出 deploy 用户
exit

# 7. 安装必需工具（如果未安装）
sudo apt update && sudo apt install -y rsync

# 8. 退出服务器
exit
```

---

## 步骤 3: 验证服务器配置（2 分钟）

在本地机器执行：

```bash
# 测试 SSH 连接（使用步骤 1 生成的私钥）
ssh -i ~/.ssh/github_deploy_ed25519 deploy@124.223.96.15 "echo 'SSH 连接成功'"

# 如果看到 "SSH 连接成功"，说明配置正确
```

可选：使用验证脚本进行完整检查

```bash
# 确保脚本有执行权限
chmod +x scripts/verify-server-setup.sh

# 运行验证脚本
./scripts/verify-server-setup.sh deploy 124.223.96.15
```

---

## 步骤 4: 获取 SSH Known Hosts（1 分钟）

在本地机器执行：

```bash
# 扫描服务器主机密钥
ssh-keyscan -H 124.223.96.15 > /tmp/known_hosts_deploy.txt

# 查看内容
cat /tmp/known_hosts_deploy.txt
```

**保存这个文件的内容**，稍后添加到 GitHub Secret。

---

## 步骤 5: 配置 GitHub Secrets 和 Variables（3 分钟）

1. 在 GitHub 仓库页面，点击 **Settings**
2. 在左侧菜单选择 **Secrets and variables** → **Actions**

### 添加 Secrets

点击 **New repository secret**，添加以下两个 Secret：

#### Secret 1: `DEPLOY_SSH_KEY`

- **Name**: `DEPLOY_SSH_KEY`
- **Value**: 步骤 1 中 `cat ~/.ssh/github_deploy_ed25519` 的完整输出
  - 必须包含 `-----BEGIN OPENSSH PRIVATE KEY-----` 和 `-----END OPENSSH PRIVATE KEY-----`
  - 包含所有换行符

#### Secret 2: `DEPLOY_SSH_KNOWN_HOSTS`

- **Name**: `DEPLOY_SSH_KNOWN_HOSTS`
- **Value**: 步骤 4 中 `ssh-keyscan` 的输出

### 添加 Variables

点击 **Variables** 标签，然后点击 **New repository variable**，添加以下三个 Variable：

| Name | Value |
|------|-------|
| `DEPLOY_USER` | `deploy` |
| `DEPLOY_HOST` | `124.223.96.15` |
| `DEPLOY_PATH` | `/srv/dashcam` |

---

## 步骤 6: 测试 CI/CD（2 分钟）

### 6.1 测试 PR 流程

```bash
# 创建测试分支
git checkout -b test-ci-setup

# 做一个微小的改动（比如修改 README）
echo "# CI/CD 已配置" >> README.md

# 提交并推送
git add README.md
git commit -m "test: 测试 CI/CD 配置"
git push origin test-ci-setup

# 在 GitHub 创建 PR
```

在 GitHub PR 页面，检查 **Checks** 标签：

- ✅ `test-and-build` job 应该成功运行
- ✅ 不应该触发 `deploy-production` job（PR 不部署）

### 6.2 测试部署流程

合并 PR 到 `master`，或者直接推送到 `master`：

```bash
git checkout master
git merge test-ci-setup
git push origin master
```

在 GitHub Actions 页面观察：

- ✅ `test-and-build` job 成功
- ✅ `deploy-production` job 成功

访问 https://dashcam.abei.me 验证新版本已上线。

---

## 完成！🎉

现在你的 CI/CD 流水线已配置完成。从现在开始：

- **PR** → 自动运行测试和构建
- **合并到 master** → 自动测试、构建、部署到生产环境
- **失败回滚** → 健康检查失败时自动回滚

---

## 下一步

- 查看 [docs/DEPLOYMENT.md](./DEPLOYMENT.md) 了解详细配置和故障排查
- 查看 [docs/GITHUB_SECRETS_CHECKLIST.md](./GITHUB_SECRETS_CHECKLIST.md) 了解配置清单
- 定期轮换 SSH 密钥（建议每季度一次）

---

## 常见问题

### Q: SSH 连接失败？

A: 检查：
1. 公钥是否已添加到服务器 `/home/deploy/.ssh/authorized_keys`
2. `.ssh` 目录权限是否为 `700`
3. `authorized_keys` 文件权限是否为 `600`
4. 服务器防火墙是否允许 SSH 连接

### Q: 健康检查失败？

A: 检查：
1. `/srv/dashcam/current` 符号链接是否正确
2. 构建产物是否包含 `index.html`
3. 部署用户是否有读写权限

### Q: 如何手动回滚？

A: SSH 连接到服务器：

```bash
ssh deploy@124.223.96.15
ls -lt /srv/dashcam/releases/
ln -snf /srv/dashcam/releases/<旧版本> /srv/dashcam/current.tmp
mv -Tf /srv/dashcam/current.tmp /srv/dashcam/current
```

---

**遇到问题？** 查看 [docs/DEPLOYMENT.md](./DEPLOYMENT.md) 中的故障排查章节。
