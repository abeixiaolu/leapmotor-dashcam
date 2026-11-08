# 部署文档

本文档说明如何配置 GitHub Actions CI/CD 流水线，实现自动化测试、构建和部署到生产环境。

## 概述

### 工作流功能

- **PR 检查**：在 Pull Request 上执行测试和构建，但不部署
- **主分支部署**：推送到 `master` 分支时自动部署到生产环境
- **手动触发**：支持 `workflow_dispatch` 手动触发部署
- **串行部署**：使用 `concurrency` 控制，防止并发部署互相覆盖
- **最小权限**：仅授予必需的 `contents: read` 权限

### 部署策略

- **版本化目录**：`/srv/dashcam/releases/<revision>-<fingerprint>/`
- **符号链接**：`/srv/dashcam/current` 指向当前版本
- **原子切换**：使用 `mv -Tf` 实现原子性符号链接更新
- **失败回滚**：健康检查失败时自动回滚到上一版本
- **历史保留**：保留最近 5 个版本

## 必需的 GitHub 配置

### 1. GitHub Secrets（敏感信息）

在 GitHub 仓库设置 → Secrets and variables → Actions → Secrets 中添加：

#### `DEPLOY_SSH_KEY`

**用途**：用于 SSH 连接到生产服务器的私钥

**生成方法**：

```bash
# 在部署管理员的本地机器上执行（不要在云 VM 中生成）
ssh-keygen -t ed25519 -C "github-actions-deploy" -f ~/.ssh/github_deploy_ed25519 -N ""

# 查看私钥内容（需要添加到 GitHub Secret）
cat ~/.ssh/github_deploy_ed25519

# 查看公钥内容（需要添加到服务器）
cat ~/.ssh/github_deploy_ed25519.pub
```

**值的格式**：完整的私钥内容，包括头尾标记

```
-----BEGIN OPENSSH PRIVATE KEY-----
b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW
...（省略中间内容）...
-----END OPENSSH PRIVATE KEY-----
```

#### `DEPLOY_SSH_KNOWN_HOSTS`

**用途**：SSH 已知主机密钥，用于验证服务器身份，防止中间人攻击

**生成方法**：

```bash
# 方法 1: 使用 ssh-keyscan 扫描服务器（推荐）
ssh-keyscan -H 124.223.96.15 > known_hosts_temp.txt

# 查看内容
cat known_hosts_temp.txt

# 方法 2: 从现有 known_hosts 提取（如果已经连接过）
ssh-keygen -H -F 124.223.96.15 | grep -v "^#"
```

**值的格式**：哈希化的已知主机条目

```
|1|base64hash...==|base64hash...== ssh-ed25519 AAAAC3Nza...
```

**安全说明**：
- 使用哈希化的主机名（`-H` 选项），避免泄露服务器 IP
- 确保是目标服务器的真实密钥，防止中间人攻击
- 定期更新（当服务器密钥变更时）

### 2. GitHub Variables（非敏感配置）

在 GitHub 仓库设置 → Secrets and variables → Actions → Variables 中添加：

| 变量名 | 示例值 | 说明 |
|--------|--------|------|
| `DEPLOY_USER` | `deploy` | SSH 连接用户名（需在服务器上创建） |
| `DEPLOY_HOST` | `124.223.96.15` | 生产服务器 IP 地址 |
| `DEPLOY_PATH` | `/srv/dashcam` | 部署根目录路径 |

## 服务器端配置

### 1. 创建部署用户

在生产服务器 `124.223.96.15` 上执行：

```bash
# 创建专用部署用户（无登录 shell，仅用于部署）
sudo useradd -r -s /bin/bash -m -d /home/deploy deploy

# 创建部署目录结构
sudo mkdir -p /srv/dashcam/releases
sudo chown -R deploy:deploy /srv/dashcam

# 切换到 deploy 用户
sudo su - deploy

# 创建 .ssh 目录
mkdir -p ~/.ssh
chmod 700 ~/.ssh
```

### 2. 配置 SSH 授权密钥

将前面生成的公钥添加到服务器：

```bash
# 在服务器上，以 deploy 用户执行
cat >> ~/.ssh/authorized_keys <<'EOF'
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIExamplePublicKeyHere github-actions-deploy
EOF

chmod 600 ~/.ssh/authorized_keys
```

### 3. （推荐）使用受限命令限制 SSH 权限

为了进一步提高安全性，可以限制该密钥只能执行部署相关命令：

编辑 `/home/deploy/.ssh/authorized_keys`，在公钥前添加限制选项：

```
command="/home/deploy/deploy-command.sh",no-port-forwarding,no-X11-forwarding,no-agent-forwarding,no-pty ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIExamplePublicKeyHere github-actions-deploy
```

创建 `/home/deploy/deploy-command.sh`：

```bash
#!/bin/bash
# 受限命令脚本 - 仅允许执行部署相关操作

set -euo pipefail

case "$SSH_ORIGINAL_COMMAND" in
    # 允许的命令模式
    "echo 'SSH 连接成功'")
        echo 'SSH 连接成功'
        ;;
    bash\ -c\ "set -euo pipefail"*)
        # 允许执行 bash 脚本（部署脚本使用）
        eval "$SSH_ORIGINAL_COMMAND"
        ;;
    mkdir\ -p\ /srv/dashcam/*)
        eval "$SSH_ORIGINAL_COMMAND"
        ;;
    rsync\ --server*)
        # 允许 rsync 上传文件
        eval "$SSH_ORIGINAL_COMMAND"
        ;;
    scp\ *)
        # 允许 scp 上传文件
        eval "$SSH_ORIGINAL_COMMAND"
        ;;
    *)
        echo "拒绝执行命令: $SSH_ORIGINAL_COMMAND" >&2
        exit 1
        ;;
esac
```

设置执行权限：

```bash
chmod 755 /home/deploy/deploy-command.sh
```

**注意**：受限命令方案可以进一步提高安全性，但需要仔细测试以确保不会阻止合法的部署操作。如果遇到问题，可以临时移除限制进行调试。

### 4. 验证部署用户权限

确保 `deploy` 用户具有以下最小权限：

- 读写 `/srv/dashcam/` 目录及其子目录
- 无需 sudo 权限
- 无法访问其他用户的文件
- 无法修改系统配置

```bash
# 验证目录权限
ls -la /srv/dashcam/
# 应该显示 owner: deploy:deploy

# 验证无 sudo 权限
sudo -l -U deploy
# 应该显示 "User deploy is not allowed to run sudo"
```

## 现有基础设施集成

### Docker 容器和反向代理

生产环境已有以下配置（无需修改）：

- **dashcam-static 容器**：内部 Docker 容器运行 Caddy 静态文件服务器
- **homely-caddy 反向代理**：已配置 `dashcam.abei.me` 的反向代理规则
- **DNS 解析**：`dashcam.abei.me` → `124.223.96.15` 已配置

部署流程通过更新 `/srv/dashcam/current` 符号链接实现版本切换，容器内的 Caddy 会自动服务新版本的静态文件，无需重启容器或修改配置。

## 安全考虑

### 已实施的安全措施

1. **最小权限原则**
   - GitHub Actions 仅授予 `contents: read` 权限
   - 部署用户无 sudo 权限
   - SSH 密钥仅用于部署操作

2. **可靠的 SSH 验证**
   - 使用 `known_hosts` 验证服务器身份
   - 不禁用 `StrictHostKeyChecking`
   - 私钥存储在 GitHub Secrets 中加密

3. **敏感数据保护**
   - 不上传源码（仅上传 `dist/` 构建产物）
   - 排除录像文件（`*.mp4`, `*.webm`, `recordings/`）
   - 排除环境变量文件（`.env`, `.env.*`）
   - 不部署后端 API（仅静态文件）

4. **可追溯性**
   - 每次部署生成 `build-manifest.txt`，包含文件哈希和元数据
   - 版本目录包含 Git commit SHA 和内容指纹
   - GitHub Actions 提供完整的部署日志

5. **失败保护**
   - 健康检查失败自动回滚
   - 串行部署防止并发冲突
   - 保留历史版本支持手动回滚

### 推荐的额外安全措施

1. **定期轮换 SSH 密钥**：每 3-6 个月更新 `DEPLOY_SSH_KEY`

2. **监控部署日志**：定期检查 GitHub Actions 日志，发现异常行为

3. **限制 GitHub Actions 访问**：
   - 仅授权可信的贡献者
   - 启用分支保护规则（要求 PR 审查）

4. **服务器安全加固**：
   - 配置防火墙（仅开放必需端口）
   - 启用 fail2ban 防止 SSH 暴力破解
   - 定期更新系统补丁

## 部署流程

### 自动部署流程

1. 开发者推送代码到 `master` 分支
2. GitHub Actions 触发 CI workflow
3. 执行测试和构建（`test-and-build` job）
4. 如果测试通过，生成构建产物和清单
5. 上传构建产物到 GitHub Artifacts
6. 执行部署（`deploy-production` job）
7. 下载构建产物
8. 配置 SSH 连接
9. 执行 `scripts/deploy.sh` 部署脚本：
   - 生成版本标识符
   - 上传构建产物到新版本目录
   - 验证远程构建完整性
   - 原子切换 `current` 符号链接
   - 执行健康检查
   - 失败时自动回滚
   - 清理旧版本（保留最近 5 个）

### 手动触发部署

在 GitHub 仓库页面：

1. 点击 **Actions** 标签
2. 选择 **CI** workflow
3. 点击 **Run workflow**
4. 选择 `master` 分支
5. 点击 **Run workflow** 确认

### 手动回滚

如果需要手动回滚到上一个版本：

```bash
# SSH 连接到服务器
ssh deploy@124.223.96.15

# 查看历史版本
ls -lt /srv/dashcam/releases/

# 切换到指定版本
ln -snf /srv/dashcam/releases/<version-name> /srv/dashcam/current.tmp
mv -Tf /srv/dashcam/current.tmp /srv/dashcam/current

# 验证
ls -la /srv/dashcam/current
```

## 测试和验证

### 本地测试部署脚本

在本地测试部署脚本（需要有服务器访问权限）：

```bash
# 设置环境变量
export DEPLOY_USER="deploy"
export DEPLOY_HOST="124.223.96.15"
export DEPLOY_PATH="/srv/dashcam"
export REVISION="test123456"

# 准备测试构建
pnpm build

# 生成测试清单
cd dist
find . -type f | sort | xargs sha256sum > ../build-manifest.txt
echo "REVISION=${REVISION}" >> ../build-manifest.txt
cd ..

# 执行部署脚本（需要配置 SSH 密钥）
./scripts/deploy.sh
```

### 验证 GitHub Actions 配置

在创建 PR 后：

1. 检查 PR 的 Checks 标签，确认 `test-and-build` job 成功
2. 验证没有触发 `deploy-production` job（仅 PR 不部署）
3. 合并到 `master` 后，验证自动部署成功
4. 访问 `https://dashcam.abei.me` 确认新版本已上线

### 验证服务器配置

```bash
# 测试 SSH 连接
ssh deploy@124.223.96.15 "echo 'SSH 连接成功'"

# 检查部署目录权限
ssh deploy@124.223.96.15 "ls -la /srv/dashcam/"

# 检查 rsync 可用性
ssh deploy@124.223.96.15 "which rsync"
```

## 故障排查

### 常见问题

#### 1. SSH 连接失败

**错误信息**：`Permission denied (publickey)`

**解决方法**：
- 确认 `DEPLOY_SSH_KEY` 格式正确（包含头尾标记）
- 确认公钥已添加到服务器 `/home/deploy/.ssh/authorized_keys`
- 检查服务器 `.ssh` 目录和文件权限（700 和 600）

#### 2. Host key verification failed

**错误信息**：`Host key verification failed`

**解决方法**：
- 更新 `DEPLOY_SSH_KNOWN_HOSTS` 为最新的服务器密钥
- 使用 `ssh-keyscan -H 124.223.96.15` 重新获取

#### 3. 构建产物上传失败

**错误信息**：`rsync: command not found`

**解决方法**：
- 在服务器上安装 rsync：`sudo apt install rsync`

#### 4. 健康检查失败

**错误信息**：`ERROR: index.html 不存在`

**解决方法**：
- 检查构建配置（`vite.config.ts` 中的 `base: "./"` 是否正确）
- 确认 `dist/` 目录包含所有必需文件
- 检查 `rsync` 排除规则是否过于严格

#### 5. 部署后访问 404

**可能原因**：
- `current` 符号链接指向错误
- Caddy 配置的根目录不正确
- 文件权限问题

**解决方法**：
```bash
# 检查符号链接
ssh deploy@124.223.96.15 "ls -la /srv/dashcam/current"

# 检查实际文件
ssh deploy@124.223.96.15 "ls -la /srv/dashcam/current/"

# 检查 Caddy 配置（如果需要）
# （通常无需修改，除非容器配置变更）
```

## 维护建议

### 定期任务

1. **每月**：审查部署日志，确认无异常
2. **每季度**：轮换 SSH 密钥
3. **每半年**：清理极旧的版本目录（自动清理保留 5 个，可手动清理更旧的）

### 监控指标

建议监控以下指标（可集成到现有监控系统）：

- 部署成功率
- 部署耗时
- 回滚次数
- 磁盘空间使用（`/srv/dashcam/releases/`）

## 参考资料

- [GitHub Actions 文档](https://docs.github.com/en/actions)
- [SSH 密钥管理最佳实践](https://docs.github.com/en/authentication/connecting-to-github-with-ssh)
- [Rsync 使用指南](https://linux.die.net/man/1/rsync)
- [Caddy 文档](https://caddyserver.com/docs/)

## 支持

如有问题，请查看：

1. GitHub Actions 运行日志（Actions 标签 → 选择运行记录）
2. 部署脚本日志（在 Actions 日志中的 `Deploy to production` 步骤）
3. 服务器日志（SSH 连接服务器查看）

---

**最后更新**：2024-11-08  
**维护者**：[项目团队]
