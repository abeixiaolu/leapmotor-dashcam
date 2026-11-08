# 审阅问题修复总结

## 审阅反馈

独立审阅 HEAD 7a5270a 发现 9 个真实阻塞问题，已全部修复。

## 修复清单

### 1. ✅ stdout 日志污染

**问题**：日志输出污染 command substitution，导致路径解析失败

**修复**：
- 所有日志函数输出重定向到 stderr（`>&2`）
- command substitution 仅返回数据（如路径、版本号）
- 避免 `echo 'SSH 连接成功'` 等测试命令污染 stdout
- 使用 `printf '%s\n'` 格式化输出，避免解释转义

**验证**：
```bash
# deploy-via-wrapper.sh
log_info() { echo "[INFO] $*" >&2; }
package_file=$(package_build)  # 仅返回路径
```

### 2. ✅ root 归档不可信

**问题**：
- root 先解压未验证的归档
- 仅检查文件存在，不验证 SHA256
- REVISION 可以是任意值（如 `../../xx`）
- 接受软链接、硬链接、特殊文件
- 未检查额外文件

**修复**：
- 最小特权暂存：以 `nobody` 用户解压归档
- 严格验证 REVISION 格式（必须是 40 字符十六进制 SHA）
- 逐文件验证 SHA256
- 拒绝软链接（`-f` 检查）、硬链接、特殊文件
- 拒绝绝对路径和路径上跳（`validate_path_safety`）
- 检查额外文件（不在清单中的文件）
- 资源限额：归档 200MB，单文件 50MB，最多 10000 文件

**验证**：
```bash
# 创建测试包验证
./scripts/test-deployment.sh
# 测试路径注入、软链接、SHA 不匹配、额外文件等攻击
```

### 3. ✅ nologin shell 与 forced command 冲突

**问题**：`/usr/sbin/nologin` 会阻止 SSH forced command 执行

**修复**：
- 改用 `/bin/bash`（支持 forced command）
- 通过 `authorized_keys` 的 `command=` 和 `no-pty` 限制
- 不提供交互式登录（forced command 强制执行部署脚本）

**验证**：
```bash
# authorized_keys 配置
command="sudo /usr/local/bin/dashcam-deploy",no-pty,...
```

### 4. ✅ rollback 相对路径问题

**问题**：`readlink` 返回相对路径，在 cwd 不同时失效

**修复**：
- 使用 `readlink -f` 获取绝对路径
- 验证旧目标在 `${RELEASES_DIR}/` 内
- 保存绝对路径到 `.previous-release`

**验证**：
```bash
previous_release=$(readlink -f "${CURRENT_LINK}")
if [[ "$previous_release" != "${RELEASES_DIR}/"* ]]; then
    log_error "上一版本路径不在 releases 目录内"
    return 1
fi
```

### 5. ✅ 同名 release 覆盖风险

**问题**：`rm -rf ${release_dir}` 可能删除正在使用的 release

**修复**：
- Release 不可变：同名 release 必须内容相同
- 使用 `diff -r` 验证内容一致性
- 冲突时拒绝，不删除现有 release
- 幂等部署：相同内容可多次部署

**验证**：
```bash
if [[ -d "${release_dir}" ]]; then
    if ! diff -r "${extract_dir}" "${release_dir}" > /dev/null 2>&1; then
        log_error "Release 已存在但内容不同，拒绝覆盖"
        return 1
    fi
    log_info "Release 内容一致，跳过安装"
fi
```

### 6. ✅ health.json 常量无法识别版本

**问题**：`health.json` 固定内容，无法验证部署版本

**修复**：
- 健康检查验证 current 路径包含 REVISION 前 8 位
- 检查关键文件存在（`index.html`）
- 验证符号链接指向有效目标

**验证**：
```bash
if [[ ! "$current_path" == *"${expected_revision:0:8}"* ]]; then
    log_error "版本不匹配"
    return 1
fi
```

### 7. ✅ concurrency 组冲突

**问题**：PR 和 master 使用同一 concurrency 组，PR 可能替换 pending master

**修复**：
- 测试 job：`build-${{ github.ref }}`（PR 和 master 分开）
- 生产 job：`deploy-production`（仅 master）
- PR 可取消（`cancel-in-progress: true`）
- 生产不可取消（`cancel-in-progress: false`）

**验证**：
```yaml
jobs:
  test-and-build:
    concurrency:
      group: build-${{ github.ref }}
      cancel-in-progress: true
  
  deploy-production:
    concurrency:
      group: deploy-production
      cancel-in-progress: false
```

### 8. ✅ workflow_dispatch 跳过部署

**问题**：`github.event_name == 'push'` 导致手动触发跳过部署

**修复**：
- 修改条件为 `github.event_name == 'push' || github.event_name == 'workflow_dispatch'`
- 仅 master 分支允许手动部署

**验证**：
```yaml
if: github.ref == 'refs/heads/master' && (github.event_name == 'push' || github.event_name == 'workflow_dispatch')
```

### 9. ✅ secrets/vars 预检

**问题**：缺少配置时直接失败，错误信息不清晰

**修复**：
- 添加 `Verify secrets and variables` 步骤
- 使用 `env` 变量写入密钥（避免命令行暴露）
- 配置 SSH 客户端：`StrictHostKeyChecking=yes`, `IdentitiesOnly=yes`

**验证**：
```yaml
- name: Verify secrets and variables
  run: |
    missing=()
    [ -z "${{ secrets.DEPLOY_SSH_KEY }}" ] && missing+=("DEPLOY_SSH_KEY")
    # ... 检查所有必需配置
```

### 10. ✅ 文档精简

**删除**：
- `scripts/deploy.sh`（不使用）
- `scripts/verify-server-setup.sh`（不使用）
- `docs/VALIDATION_REPORT.md`（未经验证）
- `docs/FINAL_SUMMARY.md`（重复）
- `docs/QUICK_START_CICD.md`（重复）
- `docs/GITHUB_SECRETS_CHECKLIST.md`（重复）

**保留**：
- `docs/SERVER_SETUP.md`（精简、准确）
- `docs/SETUP_REQUIRED.md`（配置清单）
- `docs/DEPLOYMENT.md`（完整文档）
- `docs/SECURITY.md`（安全最佳实践）

**移除不安全示例**：
- eval SSH_ORIGINAL_COMMAND
- chown -R 整树
- "移除限制进行调试"建议

## 测试验证

### 合成回归测试

**脚本**：`scripts/test-deployment.sh`

**测试场景**：
1. ✅ 正常部署流程
2. ✅ 路径注入攻击（`../`）
3. ✅ 软链接攻击
4. ✅ SHA256 不匹配
5. ✅ 额外文件攻击
6. ✅ 无效 REVISION
7. ✅ 幂等性

**结果**：
```
通过: 7
失败: 0
✓ 所有测试通过
```

### 项目测试

**命令**：`pnpm exec vp test run`

**结果**：
```
Test Files  11 passed (11)
Tests       88 passed (88)
Duration    708ms
```

## 安全特性总结

### 已实现

- ✅ 最小特权暂存（nobody 用户解压）
- ✅ 严格 SHA256 验证（逐文件）
- ✅ 路径安全检查（拒绝 ../、绝对路径）
- ✅ 文件类型检查（拒绝软链接、硬链接、特殊文件）
- ✅ 资源限额（归档、文件大小、数量）
- ✅ Release 不可变（幂等部署）
- ✅ 事务性回滚（失败自动回滚）
- ✅ Forced command 隔离
- ✅ StrictHostKeyChecking
- ✅ Secrets 预检

### 已知限制

- ⚠️ PR CI 跳过部署步骤（manifest/artifact），这是预期行为
- ⚠️ 部署需要完整 40 字符 SHA commit（不支持短 SHA）
- ⚠️ dashcam-deploy 用户通过 sudo 以 root 执行部署脚本
- ⚠️ 依赖 authorized_keys forced command 正确配置

## 下一步

1. 主会话按照 `docs/SETUP_REQUIRED.md` 配置服务器
2. 配置 GitHub Secrets 和 Variables
3. 观察 PR CI 检查（test-and-build 应成功）
4. 合并 PR 到 master
5. 验证自动部署

## 文档

- **[docs/SERVER_SETUP.md](SERVER_SETUP.md)** - 服务器配置步骤
- **[docs/SETUP_REQUIRED.md](SETUP_REQUIRED.md)** - 主会话配置清单
- [docs/DEPLOYMENT.md](DEPLOYMENT.md) - 完整部署文档
- [docs/SECURITY.md](SECURITY.md) - 安全最佳实践

---

**所有审阅问题已修复，回归测试通过，项目测试通过。**
