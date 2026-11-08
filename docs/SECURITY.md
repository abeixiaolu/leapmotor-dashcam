# 安全最佳实践

本文档说明 CI/CD 流水线的安全设计和最佳实践。

## 设计原则

### 1. 最小权限原则（Principle of Least Privilege）

**GitHub Actions 权限**：
- 工作流仅授予 `contents: read` 权限
- 不授予 `contents: write`（防止未授权修改代码）
- 不授予 `packages: write`（防止未授权发布包）
- 使用 `persist-credentials: false` 防止后续步骤误用 Git 凭据

**部署用户权限**：
- 无 sudo 权限
- 仅有 `/srv/dashcam/` 目录的读写权限
- 无法访问其他用户的文件
- 无法修改系统配置

**SSH 密钥范围**：
- 专用于部署的独立密钥对
- 不复用个人或系统管理员密钥
- 可选：通过 `authorized_keys` 的 `command=` 选项限制可执行命令

### 2. 纵深防御（Defense in Depth）

**多层验证**：
1. SSH 主机密钥验证（防止中间人攻击）
2. 构建产物完整性验证（SHA256 校验和）
3. 远程部署后文件验证
4. 健康检查验证部署成功
5. 失败自动回滚

**敏感数据保护**：
- 私钥存储在 GitHub Secrets（加密）
- 仅在运行时注入环境变量
- 工作流结束后自动清理密钥文件
- 日志输出会自动脱敏（GitHub Actions 特性）

### 3. 可追溯性（Auditability）

**部署可追溯**：
- 每次部署生成唯一标识符（Git SHA + 内容指纹）
- 构建清单记录所有文件的 SHA256
- 版本目录包含部署时间、Git commit、GitHub Run ID
- GitHub Actions 保留完整的部署日志（90 天）

**版本管理**：
- 保留最近 5 个版本用于快速回滚
- 版本目录命名：`<revision>-<fingerprint>`
- 符号链接记录当前版本和上一版本

## 威胁模型与缓解措施

### 威胁 1: 未授权访问生产服务器

**攻击场景**：攻击者获取 SSH 私钥

**缓解措施**：
1. ✅ SSH 私钥存储在 GitHub Secrets（加密，仅授权仓库可访问）
2. ✅ 私钥在工作流中仅临时存在，使用后立即删除
3. ✅ 部署用户权限受限，无法破坏系统其他部分
4. ✅ 定期轮换 SSH 密钥（建议每季度）
5. 🔧 可选：IP 白名单限制 SSH 访问（GitHub Actions IP 范围）

**检测与响应**：
- 监控部署日志中的异常部署
- 监控服务器 SSH 登录日志（`/var/log/auth.log`）
- 定期审计 `/srv/dashcam/releases/` 中的版本

### 威胁 2: 供应链攻击

**攻击场景**：恶意代码通过依赖注入

**缓解措施**：
1. ✅ 使用 `pnpm-lock.yaml` 锁定依赖版本
2. ✅ `pnpm install --frozen-lockfile` 确保依赖不变
3. ✅ 仅在 PR 合并后部署（要求代码审查）
4. ✅ GitHub Actions 使用固定版本的 actions（如 `@v4`）
5. 🔧 建议：启用 Dependabot 自动更新依赖
6. 🔧 建议：定期运行 `npm audit` / `pnpm audit`

**检测与响应**：
- 监控 GitHub Security Advisories
- 在 PR 中审查依赖变更（`pnpm-lock.yaml` 的 diff）

### 威胁 3: 中间人攻击（MITM）

**攻击场景**：攻击者劫持 SSH 连接

**缓解措施**：
1. ✅ 使用 `ssh-keyscan` 生成的 known_hosts 验证服务器身份
2. ✅ 不禁用 `StrictHostKeyChecking`
3. ✅ 使用哈希化的 known_hosts（`-H` 选项）
4. ✅ HTTPS 连接到 GitHub（自动）
5. 🔧 建议：使用专用网络或 VPN 连接服务器

**检测与响应**：
- 如果 SSH 主机密钥验证失败，工作流会立即终止
- 定期更新 `DEPLOY_SSH_KNOWN_HOSTS`（服务器密钥变更时）

### 威胁 4: 恶意 PR 注入

**攻击场景**：恶意 PR 修改工作流或脚本窃取密钥

**缓解措施**：
1. ✅ PR 触发的工作流不执行部署（无法访问生产环境）
2. ✅ 仅 `master` 分支推送触发部署
3. ✅ 要求 PR 审查后才能合并（建议启用分支保护）
4. ✅ 部署脚本在仓库中可审计
5. 🔧 建议：启用 CODEOWNERS 要求指定审查者
6. 🔧 建议：限制可推送到 `master` 的人员

**检测与响应**：
- 审查修改 `.github/workflows/` 或 `scripts/` 的 PR
- 审查环境变量和 Secrets 的使用

### 威胁 5: 部署失败导致服务不可用

**攻击场景**：部署过程中出错导致服务中断

**缓解措施**：
1. ✅ 原子性符号链接切换（`mv -Tf`）
2. ✅ 健康检查失败自动回滚
3. ✅ 保留上一版本用于回滚
4. ✅ 串行部署防止并发冲突（`concurrency` 控制）
5. ✅ 部署前测试和构建验证
6. 🔧 建议：生产环境使用蓝绿部署或金丝雀发布

**检测与响应**：
- GitHub Actions 日志记录部署过程
- 健康检查失败会触发自动回滚
- 监控生产环境可用性

### 威胁 6: 敏感数据泄露

**攻击场景**：源码、环境变量、录像文件被上传到生产环境

**缓解措施**：
1. ✅ 仅上传 `dist/` 构建产物
2. ✅ `rsync` 排除录像文件（`.mp4`, `.webm`, `recordings/`）
3. ✅ 排除环境变量文件（`.env`, `.env.*`）
4. ✅ 不上传源码（仅编译后的静态文件）
5. ✅ 静态文件托管，无后端 API 暴露
6. 🔧 建议：定期审计生产环境文件

**检测与响应**：
- 审查部署脚本中的 `rsync` 排除规则
- 定期检查生产环境是否包含不应存在的文件

## 合规与审计

### 访问控制审计

定期审计以下内容：

- [ ] GitHub 仓库的协作者列表
- [ ] 有权限批准/合并 PR 的人员
- [ ] GitHub Secrets 的最后更新时间
- [ ] 服务器 `authorized_keys` 的内容
- [ ] 部署用户的权限范围

### 密钥轮换计划

| 密钥类型 | 轮换频率 | 责任人 | 操作 |
|---------|---------|--------|------|
| SSH 密钥对 | 每 3 个月 | DevOps | 生成新密钥，更新服务器和 GitHub |
| SSH Known Hosts | 服务器变更时 | DevOps | 重新扫描并更新 GitHub Secret |
| 部署用户密码 | N/A（无密码登录） | - | - |

### 安全事件响应

如果怀疑密钥泄露：

1. **立即撤销**：从服务器删除对应的 `authorized_keys` 条目
2. **生成新密钥**：生成新的 SSH 密钥对
3. **更新 GitHub**：更新 `DEPLOY_SSH_KEY` Secret
4. **审计日志**：检查服务器登录日志和部署历史
5. **通知团队**：通知所有相关人员
6. **事后分析**：确定泄露原因并改进流程

## 推荐的额外安全措施

### 1. GitHub 仓库安全

- ✅ 启用分支保护规则（要求 PR 审查）
- ✅ 要求状态检查通过后才能合并
- 🔧 启用 Dependabot 安全更新
- 🔧 启用 Code scanning（GitHub Advanced Security）
- 🔧 启用 Secret scanning

### 2. 服务器加固

- ✅ 禁用密码登录（仅 SSH 密钥）
- ✅ 使用非标准 SSH 端口（可选）
- 🔧 配置 fail2ban 防止暴力破解
- 🔧 配置防火墙（ufw/iptables）
- 🔧 启用系统自动安全更新
- 🔧 配置入侵检测系统（IDS）

### 3. 监控与告警

- 🔧 配置 GitHub Actions 失败告警（邮件/Slack）
- 🔧 监控生产环境可用性（Uptime 监控）
- 🔧 监控服务器资源使用（CPU/内存/磁盘）
- 🔧 监控异常 SSH 登录（日志分析）

### 4. 网络安全

- ✅ 生产环境使用 HTTPS
- ✅ 配置反向代理（Caddy）
- 🔧 启用 HTTP Strict Transport Security (HSTS)
- 🔧 配置 Content Security Policy (CSP)
- 🔧 限制 SSH 访问到特定 IP（GitHub Actions IP 范围）

## 安全检查清单

部署前：

- [ ] 已审查所有代码变更
- [ ] PR 已通过测试
- [ ] 依赖版本已锁定
- [ ] 构建产物不包含敏感数据

部署后：

- [ ] 健康检查通过
- [ ] 新版本已上线
- [ ] 旧版本可回滚
- [ ] 无异常日志

定期审计：

- [ ] 每月审查部署日志
- [ ] 每季度轮换 SSH 密钥
- [ ] 每季度审计协作者权限
- [ ] 每半年更新依赖版本

## 参考资料

- [GitHub Actions Security Hardening](https://docs.github.com/en/actions/security-guides/security-hardening-for-github-actions)
- [OWASP Secure Coding Practices](https://owasp.org/www-project-secure-coding-practices-quick-reference-guide/)
- [CIS Benchmark for Ubuntu](https://www.cisecurity.org/benchmark/ubuntu_linux)
- [SSH Security Best Practices](https://infosec.mozilla.org/guidelines/openssh)

---

**最后审查**：2024-11-08  
**下次审查**：2025-02-08  
**责任人**：DevOps 团队
