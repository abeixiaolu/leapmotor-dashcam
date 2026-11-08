# 部署文档

## 概述

本项目使用 GitHub Actions 自动部署到生产环境。

## 部署流程

1. **PR 检查**：Pull Request 触发测试和构建，但不部署
2. **Master 部署**：推送到 master 分支或手动触发时自动部署
3. **串行部署**：使用 concurrency 控制防止并发冲突

## 部署架构

```
GitHub Actions
  ↓ 构建 dist/
  ↓ 生成 manifest（SHA256 + metadata）
  ↓ 注入 version 到 health.json
  ↓ 打包 tar.gz
  ↓
  SSH (forced command)
  ↓
服务器端脚本（root 权限）
  ↓ 验证归档（拒绝链接/特殊文件）
  ↓ 以 nobody 解压
  ↓ 逐文件 SHA256 验证
  ↓ 安装到 releases/<version>
  ↓ 原子切换 current
  ↓ 健康检查（验证 metadata）
  ↓ 失败自动回滚
```

## 配置

详细配置步骤请参考：

- **[SERVER_SETUP.md](SERVER_SETUP.md)** - 服务器端配置
- **[SETUP_REQUIRED.md](SETUP_REQUIRED.md)** - GitHub 配置

## 安全特性

- ✅ SSH forced command（仅能执行部署）
- ✅ 最小特权暂存（nobody 解压）
- ✅ 提取前验证（拒绝链接/特殊文件）
- ✅ 逐文件 SHA256 验证
- ✅ 路径安全检查
- ✅ 资源限额
- ✅ Release 不可变
- ✅ 健康检查（验证 metadata）
- ✅ 事务性回滚

## 版本结构

```
/srv/dashcam/
├── current -> releases/a908dc84-bce46817/
├── releases/
│   ├── a908dc84-bce46817/
│   ├── c71e8a06-93991269/
│   └── ...
└── .previous-release
```

## 手动回滚

以 root 在服务器执行：

```bash
# 查看历史版本
ls -lt /srv/dashcam/releases/

# 切换到指定版本
ln -snf /srv/dashcam/releases/<version> /srv/dashcam/current.tmp
mv -Tf /srv/dashcam/current.tmp /srv/dashcam/current
```

## 故障排查

### SSH 连接失败

检查：
1. 公钥在 `/home/dashcam-deploy/.ssh/authorized_keys`
2. forced command 配置正确
3. 文件权限正确（700 for .ssh, 600 for authorized_keys）

### 部署失败

检查 GitHub Actions 日志：
1. 构建是否成功
2. SSH 连接是否成功
3. 服务器端脚本输出

### 健康检查失败

检查：
1. health.json 是否包含正确的 revision 和 version
2. 关键文件是否存在
3. 文件权限是否正确

## 监控

建议监控：
- GitHub Actions 部署成功率
- 部署耗时
- 回滚次数
- 磁盘空间使用

## 限制

- 部署需要完整 40 字符 SHA commit
- PR 不执行部署（仅测试和构建）
- 手动触发仅限 master 分支

---

**详细安全说明请参考 [SECURITY.md](SECURITY.md)**
