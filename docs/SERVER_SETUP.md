# 服务器端配置指南

本文档说明如何在生产服务器（124.223.96.15）上配置受限部署接口。

## 设计原则

**受限部署接口**：
- 专用部署用户，仅有固定命令权限
- 通过 sudo 执行受限的部署包装脚本
- 不给 CI 通用 ubuntu/sudo/docker 权限
- 不允许交互式 shell 或任意命令执行

**目标**：
- GitHub Actions 仅能调用固定的部署命令
- 部署操作由 root 权限的包装脚本执行（保持现有 root:root 所有权）
- 完全隔离，无法访问其他系统资源

## 当前部署状态

根据最新信息：

```
当前版本: /srv/dashcam/current -> /srv/dashcam/releases/a908dc84-bce468170e3b
旧版本: /srv/dashcam/releases/c71e8a06-93991269ecea
目录所有权: root:root 755
```

## 配置步骤

### 1. 创建部署用户

在服务器上以 root 执行：

```bash
# 创建专用部署用户（无登录 shell，无家目录）
useradd -r -s /usr/sbin/nologin -M dashcam-deploy

# 验证用户创建
id dashcam-deploy
# 应输出: uid=XXX(dashcam-deploy) gid=XXX(dashcam-deploy) groups=XXX(dashcam-deploy)
```

### 2. 安装服务器端部署包装脚本

```bash
# 下载部署包装脚本（从项目仓库或直接复制）
# 假设已通过 Mac SSH 或其他方式获取到 deploy-wrapper.sh

# 安装到系统路径
sudo cp scripts/server-side/deploy-wrapper.sh /usr/local/bin/dashcam-deploy
sudo chmod 755 /usr/local/bin/dashcam-deploy
sudo chown root:root /usr/local/bin/dashcam-deploy

# 验证脚本可执行
ls -l /usr/local/bin/dashcam-deploy
# 应输出: -rwxr-xr-x 1 root root ... /usr/local/bin/dashcam-deploy
```

### 3. 配置 sudo 权限

创建 sudo 规则，允许 dashcam-deploy 用户仅执行部署命令：

```bash
# 创建 sudo 规则文件
sudo visudo -f /etc/sudoers.d/dashcam-deploy
```

在打开的编辑器中添加以下内容：

```
# dashcam-deploy 用户仅允许执行部署包装脚本
# NOPASSWD: 无需密码
# NOSETENV: 不允许设置环境变量
# 仅限固定命令，不允许传递参数（参数由脚本从 stdin 接收）

dashcam-deploy ALL=(root) NOPASSWD:NOSETENV: /usr/local/bin/dashcam-deploy
```

保存并退出（visudo 会自动验证语法）。

验证 sudo 规则：

```bash
sudo -l -U dashcam-deploy
# 应输出:
# User dashcam-deploy may run the following commands on this host:
#     (root) NOPASSWD: NOSETENV: /usr/local/bin/dashcam-deploy
```

### 4. 创建上传临时目录

```bash
# 确保 /srv/dashcam/.upload 目录存在（脚本会自动创建，但可预先创建）
sudo mkdir -p /srv/dashcam/.upload
sudo chmod 700 /srv/dashcam/.upload
sudo chown root:root /srv/dashcam/.upload
```

### 5. 配置 SSH 授权密钥

为 dashcam-deploy 用户配置 SSH 密钥，限制仅能执行部署命令：

```bash
# 创建 .ssh 目录
sudo mkdir -p /home/dashcam-deploy/.ssh
sudo chmod 700 /home/dashcam-deploy/.ssh
sudo chown dashcam-deploy:dashcam-deploy /home/dashcam-deploy/.ssh

# 创建 authorized_keys（将在下一步添加公钥）
sudo touch /home/dashcam-deploy/.ssh/authorized_keys
sudo chmod 600 /home/dashcam-deploy/.ssh/authorized_keys
sudo chown dashcam-deploy:dashcam-deploy /home/dashcam-deploy/.ssh/authorized_keys
```

**注意**：authorized_keys 的内容将在主会话生成 SSH 密钥后添加。

格式如下（添加受限命令选项）：

```
command="sudo /usr/local/bin/dashcam-deploy",no-port-forwarding,no-X11-forwarding,no-agent-forwarding,no-pty ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIExamplePublicKeyHere github-actions-deploy
```

关键选项说明：
- `command="sudo /usr/local/bin/dashcam-deploy"` - 强制执行固定命令
- `no-port-forwarding` - 禁止端口转发
- `no-X11-forwarding` - 禁止 X11 转发
- `no-agent-forwarding` - 禁止 agent 转发
- `no-pty` - 禁止分配伪终端（无交互式 shell）

### 6. 测试配置

在本地 Mac 测试 SSH 连接（需要先生成密钥并添加到服务器）：

```bash
# 测试 SSH 连接（应该立即执行部署脚本，而不是进入 shell）
ssh -i ~/.ssh/github_deploy_ed25519 dashcam-deploy@124.223.96.15 < /dev/null

# 预期：因为没有输入构建包，脚本会报错退出，但这验证了 SSH 和 sudo 配置正确
```

## 安全验证

### 验证受限访问

尝试以下操作应该**全部失败**：

```bash
# 1. 尝试获取 shell（应失败）
ssh -i ~/.ssh/github_deploy_ed25519 dashcam-deploy@124.223.96.15 /bin/bash

# 2. 尝试执行其他命令（应失败）
ssh -i ~/.ssh/github_deploy_ed25519 dashcam-deploy@124.223.96.15 ls /

# 3. 尝试端口转发（应失败）
ssh -i ~/.ssh/github_deploy_ed25519 -L 8080:localhost:80 dashcam-deploy@124.223.96.15
```

如果以上命令都失败（无法执行），说明受限配置正确。

### 验证部署功能

创建一个测试构建包：

```bash
# 在本地创建测试包
mkdir -p /tmp/test-deploy
echo '<h1>Test</h1>' > /tmp/test-deploy/index.html
echo 'REVISION=test123456' > /tmp/test-deploy/build-manifest.txt
echo 'BUILD_TIME=20241108' >> /tmp/test-deploy/build-manifest.txt
echo 'GITHUB_RUN_ID=000' >> /tmp/test-deploy/build-manifest.txt

cd /tmp/test-deploy
tar -czf test-package.tar.gz *
cd -

# 通过 SSH 管道传输测试包
cat /tmp/test-deploy/test-package.tar.gz | \
    ssh -i ~/.ssh/github_deploy_ed25519 dashcam-deploy@124.223.96.15

# 预期：部署脚本执行，显示部署日志
```

在服务器上验证：

```bash
# 检查是否创建了新版本
ls -la /srv/dashcam/releases/

# 检查 current 是否指向新版本（可能需要，取决于测试是否成功）
readlink /srv/dashcam/current
```

## 工作流程

完整部署流程：

```
GitHub Actions (ubuntu 容器)
    ↓ 打包构建产物为 tar.gz
    ↓ SSH 连接（使用专用密钥）
    ↓
dashcam-deploy@124.223.96.15
    ↓ authorized_keys 强制执行命令
    ↓
sudo /usr/local/bin/dashcam-deploy
    ↓ 以 root 权限运行
    ↓ 接收 stdin 的 tar.gz
    ↓ 解压并验证
    ↓ 安装到 /srv/dashcam/releases/<version>/
    ↓ 原子切换 /srv/dashcam/current
    ↓ 健康检查
    ↓ 清理旧版本
    ↓
部署完成
```

## 回滚机制

### 自动回滚

健康检查失败时，部署脚本会自动回滚到上一版本。

### 手动回滚

如需手动回滚，以 root 在服务器上执行：

```bash
# 查看历史版本
ls -lt /srv/dashcam/releases/

# 切换到指定版本
ln -snf /srv/dashcam/releases/<version-name> /srv/dashcam/current.tmp
mv -Tf /srv/dashcam/current.tmp /srv/dashcam/current

# 验证
readlink /srv/dashcam/current
```

## 维护

### 监控部署日志

GitHub Actions 日志包含完整的部署输出。

服务器端不单独记录日志（所有输出通过 SSH 返回到 GitHub Actions）。

### 清理旧版本

部署脚本会自动保留最近 5 个版本，并删除更旧的版本。

手动清理（如需）：

```bash
# 以 root 执行
cd /srv/dashcam/releases/
ls -t | tail -n +6 | xargs rm -rf
```

### 更新部署脚本

如需更新部署包装脚本：

```bash
# 1. 从仓库获取新版本的 deploy-wrapper.sh
# 2. 安装到系统路径
sudo cp scripts/server-side/deploy-wrapper.sh /usr/local/bin/dashcam-deploy
sudo chmod 755 /usr/local/bin/dashcam-deploy
sudo chown root:root /usr/local/bin/dashcam-deploy
```

### 删除部署用户

如需移除部署配置（谨慎操作）：

```bash
# 删除 sudo 规则
sudo rm /etc/sudoers.d/dashcam-deploy

# 删除部署脚本
sudo rm /usr/local/bin/dashcam-deploy

# 删除部署用户
sudo userdel dashcam-deploy
sudo rm -rf /home/dashcam-deploy
```

## 故障排查

### SSH 连接失败

**错误**: `Permission denied (publickey)`

**检查**:
1. 公钥是否已添加到 `/home/dashcam-deploy/.ssh/authorized_keys`
2. `.ssh` 目录权限：`700`，所有者 `dashcam-deploy:dashcam-deploy`
3. `authorized_keys` 权限：`600`，所有者 `dashcam-deploy:dashcam-deploy`
4. SSH 密钥格式正确（Ed25519）

### sudo 权限失败

**错误**: `Sorry, user dashcam-deploy is not allowed to execute...`

**检查**:
1. `/etc/sudoers.d/dashcam-deploy` 文件是否存在
2. 文件权限：`440` 或 `400`
3. 文件内容正确（使用 `sudo visudo -c` 验证语法）

### 部署脚本失败

**错误**: 部署过程中各种错误

**检查**:
1. `/usr/local/bin/dashcam-deploy` 存在且可执行
2. `/srv/dashcam/` 目录存在
3. 磁盘空间充足
4. 构建包格式正确

## 参考

- 原始部署脚本：`scripts/deploy.sh`（保留用于本地测试）
- 服务器端包装脚本：`scripts/server-side/deploy-wrapper.sh`
- GitHub Actions 部署脚本：`scripts/deploy-via-wrapper.sh`
- CI 工作流：`.github/workflows/ci.yml`

---

**配置完成后，请验证所有安全限制都生效，确保 CI 仅能执行部署操作。**
