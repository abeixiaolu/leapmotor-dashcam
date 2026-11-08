# GitHub Actions CI/CD

本目录包含项目的 GitHub Actions 工作流配置。

## 工作流

### `ci.yml` - 持续集成和部署

**触发条件**：
- Pull Request 到 `master` 分支
- 推送到 `master` 分支
- 手动触发（workflow_dispatch）

**执行任务**：

#### 1. test-and-build（所有触发条件）
- 安装依赖（pnpm 12.18.0）
- 运行测试（Vitest）
- 类型检查和构建
- 生成构建清单（仅 master 推送）
- 上传构建产物（仅 master 推送）

#### 2. deploy-production（仅 master 推送）
- 下载构建产物
- 配置 SSH 连接
- 执行部署脚本
- 原子切换版本
- 健康检查和回滚保护

**安全特性**：
- 最小权限（contents: read）
- 串行部署（concurrency control）
- SSH 密钥加密存储
- 可靠的主机密钥验证
- 仅部署生产静态文件

## 配置要求

详细的配置说明请参阅 [docs/DEPLOYMENT.md](../../docs/DEPLOYMENT.md)

**必需的 GitHub Secrets**：
- `DEPLOY_SSH_KEY` - SSH 私钥
- `DEPLOY_SSH_KNOWN_HOSTS` - SSH 已知主机密钥

**必需的 GitHub Variables**：
- `DEPLOY_USER` - 部署用户名
- `DEPLOY_HOST` - 服务器地址
- `DEPLOY_PATH` - 部署根目录

## 快速开始

1. 按照 [docs/DEPLOYMENT.md](../../docs/DEPLOYMENT.md) 配置服务器和 GitHub
2. 推送代码到 `master` 分支
3. 在 Actions 标签查看部署进度
4. 访问 https://dashcam.abei.me 验证部署

## 故障排查

如遇到问题，请查看：
1. GitHub Actions 运行日志
2. [docs/DEPLOYMENT.md](../../docs/DEPLOYMENT.md) 中的故障排查章节
3. 服务器上的部署日志
