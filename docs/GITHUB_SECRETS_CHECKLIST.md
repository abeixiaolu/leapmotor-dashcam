# GitHub Secrets 和 Variables 配置清单

在启用 CI/CD 自动部署之前，请按此清单配置 GitHub 仓库。

## 配置位置

GitHub 仓库 → Settings → Secrets and variables → Actions

## 📋 配置清单

### Secrets（敏感信息，加密存储）

#### ✅ `DEPLOY_SSH_KEY`

- **类型**：Repository secret
- **用途**：SSH 私钥，用于连接生产服务器
- **格式**：完整的 Ed25519 私钥（包括 `-----BEGIN` 和 `-----END` 标记）
- **生成命令**：
  ```bash
  ssh-keygen -t ed25519 -C "github-actions-deploy" -f ~/.ssh/github_deploy_ed25519 -N ""
  cat ~/.ssh/github_deploy_ed25519
  ```
- **注意事项**：
  - 不要使用个人电脑的主 SSH 密钥
  - 将对应的公钥添加到服务器 `/home/deploy/.ssh/authorized_keys`
  - 私钥内容直接粘贴，包含所有换行符

**示例值**（仅格式参考，实际值不同）：
```
-----BEGIN OPENSSH PRIVATE KEY-----
b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW
QyNTUxOQAAACBExampleKeyDataHere1234567890ABCDEFGHIJ==
...（省略）
-----END OPENSSH PRIVATE KEY-----
```

---

#### ✅ `DEPLOY_SSH_KNOWN_HOSTS`

- **类型**：Repository secret
- **用途**：服务器 SSH 主机密钥，防止中间人攻击
- **格式**：哈希化的 known_hosts 条目
- **生成命令**：
  ```bash
  ssh-keyscan -H 124.223.96.15
  ```
- **注意事项**：
  - 使用 `-H` 选项生成哈希化的主机名
  - 确保扫描的是真实服务器（避免 DNS 劫持或中间人攻击）
  - 当服务器重装或密钥更新时需要更新此值

**示例值**（仅格式参考）：
```
|1|YWJjZGVmZ2hpams=|YWJjZGVmZ2hpams= ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIExampleHostKeyHere
```

---

### Variables（非敏感配置，明文存储）

#### ✅ `DEPLOY_USER`

- **类型**：Repository variable
- **值**：`deploy`
- **说明**：部署时使用的 SSH 用户名
- **注意**：需要在服务器上创建此用户

---

#### ✅ `DEPLOY_HOST`

- **类型**：Repository variable
- **值**：`124.223.96.15`
- **说明**：生产服务器的 IP 地址
- **注意**：可以是 IP 地址或域名

---

#### ✅ `DEPLOY_PATH`

- **类型**：Repository variable
- **值**：`/srv/dashcam`
- **说明**：服务器上的部署根目录
- **注意**：确保部署用户对此目录有读写权限

---

## 🔐 安全检查

配置完成后，请确认：

- [ ] `DEPLOY_SSH_KEY` 是专用密钥，不是个人常用密钥
- [ ] `DEPLOY_SSH_KEY` 对应的公钥已添加到服务器
- [ ] `DEPLOY_SSH_KNOWN_HOSTS` 是从真实服务器获取的
- [ ] 所有 Secret 值已复制完整（包括首尾空白符和换行符）
- [ ] Variables 值与服务器实际配置一致
- [ ] 已测试 SSH 连接可用：`ssh deploy@124.223.96.15`

## 🧪 验证配置

在推送到 `master` 分支之前，建议：

1. **创建 PR 测试**：创建一个 Pull Request，触发 `test-and-build` job
2. **检查 Actions 日志**：确认测试和构建成功
3. **验证不会触发部署**：确认 PR 不会执行 `deploy-production` job
4. **合并后观察**：合并到 `master` 后观察完整部署流程

## 📝 配置记录

建议记录配置时间和操作者（用于审计）：

| 配置项 | 配置时间 | 配置者 | 备注 |
|--------|---------|--------|------|
| DEPLOY_SSH_KEY | | | |
| DEPLOY_SSH_KNOWN_HOSTS | | | |
| DEPLOY_USER | | | |
| DEPLOY_HOST | | | |
| DEPLOY_PATH | | | |

## 🔄 定期维护

- **每季度**：轮换 `DEPLOY_SSH_KEY`（生成新密钥对，更新服务器和 GitHub）
- **服务器变更时**：更新 `DEPLOY_SSH_KNOWN_HOSTS`
- **目录迁移时**：更新 `DEPLOY_PATH`

## 📚 参考文档

详细说明请参阅：[docs/DEPLOYMENT.md](./DEPLOYMENT.md)
