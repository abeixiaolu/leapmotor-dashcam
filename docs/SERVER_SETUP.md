# 服务器端配置指南

## 概述

配置受限部署接口，允许 GitHub Actions 通过 SSH 调用固定的部署命令。

## 前提条件

- 生产服务器：124.223.96.15
- root 访问权限
- 已有部署：`/srv/dashcam/releases/a908dc84-bce468170e3b`

## 配置步骤

### 1. 创建部署用户

```bash
# 以 root 执行
useradd -r -s /bin/bash -d /home/dashcam-deploy -m dashcam-deploy
```

**注意**：使用 `/bin/bash` 以支持 SSH forced command，但不提供交互式登录。

### 2. 创建暂存目录

```bash
mkdir -p /var/tmp/dashcam-staging
chmod 1777 /var/tmp/dashcam-staging
```

### 3. 安装部署脚本

从 PR 分支获取 `scripts/server-side/deploy-wrapper.sh`：

```bash
# 复制脚本到服务器（使用 scp 或其他方式）
# 然后安装
cp deploy-wrapper.sh /usr/local/bin/dashcam-deploy
chmod 755 /usr/local/bin/dashcam-deploy
chown root:root /usr/local/bin/dashcam-deploy
```

### 4. 配置 sudo 权限

```bash
visudo -f /etc/sudoers.d/dashcam-deploy
```

添加以下内容：

```
dashcam-deploy ALL=(root) NOPASSWD:NOSETENV: /usr/local/bin/dashcam-deploy
```

保存并验证：

```bash
sudo visudo -c -f /etc/sudoers.d/dashcam-deploy
```

### 5. 配置 SSH authorized_keys

```bash
mkdir -p /home/dashcam-deploy/.ssh
chmod 700 /home/dashcam-deploy/.ssh
```

创建 `/home/dashcam-deploy/.ssh/authorized_keys`，添加：

```
command="sudo /usr/local/bin/dashcam-deploy",no-port-forwarding,no-X11-forwarding,no-agent-forwarding,no-pty ssh-ed25519 <公钥内容> github-actions-deploy
```

**重要**：
- `<公钥内容>` 替换为步骤 6 生成的公钥
- `command=` 强制执行固定命令
- `no-pty` 禁止交互式终端

设置权限：

```bash
chmod 600 /home/dashcam-deploy/.ssh/authorized_keys
chown -R dashcam-deploy:dashcam-deploy /home/dashcam-deploy/.ssh
```

### 6. 生成 SSH 密钥（本地 Mac）

```bash
ssh-keygen -t ed25519 -C "github-actions-deploy" \
    -f ~/.ssh/github_deploy_ed25519 -N ""
```

查看公钥（添加到步骤 5）：

```bash
cat ~/.ssh/github_deploy_ed25519.pub
```

查看私钥（添加到 GitHub Secret）：

```bash
cat ~/.ssh/github_deploy_ed25519
```

## 验证配置

### 测试 SSH 连接

```bash
# 应该立即执行部署脚本并等待输入
ssh -i ~/.ssh/github_deploy_ed25519 dashcam-deploy@124.223.96.15 < /dev/null
```

预期：脚本开始执行，因缺少输入而报错（这是正常的）。

### 验证受限访问

以下命令应该**全部失败**：

```bash
# 尝试获取 shell
ssh -i ~/.ssh/github_deploy_ed25519 dashcam-deploy@124.223.96.15 /bin/bash

# 尝试执行其他命令
ssh -i ~/.ssh/github_deploy_ed25519 dashcam-deploy@124.223.96.15 ls /
```

如果以上命令失败，说明 forced command 配置正确。

## GitHub 配置

### GitHub Secrets

在 GitHub 仓库设置中添加（Settings → Secrets and variables → Actions → Secrets）：

| Secret 名称 | 值 |
|------------|---|
| `DEPLOY_SSH_KEY` | 步骤 6 中 `cat ~/.ssh/github_deploy_ed25519` 的完整输出 |
| `DEPLOY_SSH_KNOWN_HOSTS` | `124.223.96.15 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOrUXRIcEVO3c0bjADU8/LzpqNt/CrebxbCp+PWq5H08` |

### GitHub Variables

在 GitHub 仓库设置中添加（Settings → Secrets and variables → Actions → Variables）：

| Variable 名称 | 值 |
|--------------|---|
| `DEPLOY_USER` | `dashcam-deploy` |
| `DEPLOY_HOST` | `124.223.96.15` |

## 安全特性

### 已实现

- ✅ Forced command（仅能执行部署脚本）
- ✅ 无端口转发、X11 转发、agent 转发
- ✅ 无交互式终端（no-pty）
- ✅ sudo 仅限固定命令
- ✅ 最小特权暂存（nobody 解压）
- ✅ 严格 SHA256 验证
- ✅ 路径安全检查
- ✅ 资源限额
- ✅ Release 不可变

### 限制

- ⚠️ dashcam-deploy 用户可以通过 sudo 以 root 权限执行部署脚本
- ⚠️ 脚本需要仔细审计，避免命令注入
- ⚠️ 依赖 authorized_keys forced command 正确配置

## 回滚

手动回滚（以 root 执行）：

```bash
# 查看历史版本
ls -lt /srv/dashcam/releases/

# 切换到指定版本
ln -snf /srv/dashcam/releases/<version-name> /srv/dashcam/current.tmp
mv -Tf /srv/dashcam/current.tmp /srv/dashcam/current
```

## 故障排查

### SSH 连接失败

检查：
1. 公钥是否添加到 `/home/dashcam-deploy/.ssh/authorized_keys`
2. `.ssh` 目录权限：`700`
3. `authorized_keys` 权限：`600`
4. 所有者：`dashcam-deploy:dashcam-deploy`

### sudo 失败

检查：
1. `/etc/sudoers.d/dashcam-deploy` 存在
2. 文件权限：`440` 或 `400`
3. 使用 `visudo -c -f /etc/sudoers.d/dashcam-deploy` 验证语法

### 部署失败

检查：
1. `/usr/local/bin/dashcam-deploy` 存在且可执行
2. `/var/tmp/dashcam-staging` 存在且权限正确（`1777`）
3. 磁盘空间充足

---

**配置完成后，合并 PR 并观察自动部署。**
