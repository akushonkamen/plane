# Agent Development Guide

## Commands

- `pnpm dev` - Start all dev servers (web:3000, admin:3001)
- `pnpm build` - Build all packages and apps
- `pnpm check` - Run all checks (format, lint, types)
- `pnpm check:lint` - OxLint across all packages
- `pnpm check:types` - TypeScript type checking
- `pnpm fix` - Auto-fix format and lint issues
- `pnpm turbo run <command> --filter=<package>` - Target specific package/app
- `pnpm --filter=@plane/ui storybook` - Start Storybook on port 6006

## Code Style

- **Imports**: Use `workspace:*` for internal packages, `catalog:` for external deps
- **TypeScript**: Strict mode enabled, all files must be typed
- **Formatting**: oxfmt, run `pnpm fix:format`
- **Linting**: OxLint with shared `.oxlintrc.json` config
- **Naming**: camelCase for variables/functions, PascalCase for components/types
- **Error Handling**: Use try-catch with proper error types, log errors appropriately
- **State Management**: MobX stores in `packages/shared-state`, reactive patterns
- **Testing**: All features require unit tests, use existing test framework per package
- **Components**: Build in `@plane/ui` with Storybook for isolated development

## 执行门禁 (Execution Gates)

执行门禁系统用于评估操作的风险级别并决定是否需要用户确认：

### Level 1: 直接执行 (Direct Execution)
- **特征**: 任务作用域内、本地环境、低风险、可逆
- **行为**: 解释操作目的，然后直接执行
- **示例**:
  - 当前任务的代码编辑和重构
  - 运行开发服务器 (`pnpm dev`)
  - Git 暂存和提交 (`git add`, `git commit`)
  - 运行测试 (`pnpm test`)
  - 修复 lint 错误 (`pnpm fix`)

### Level 2: 等待确认 (Wait for Confirmation)
- **特征**: 涉及全局规则、用户环境、关键配置、依赖项、钩子、CI、默认行为
- **行为**: 解释影响范围、潜在影响和回滚方案，等待用户确认后再执行
- **示例**:
  - 修改 `package.json` (依赖项、脚本)
  - 修改 `docker-compose*.yml` 配置
  - 修改 `turbo.json` 构建配置
  - 修改 `.env` 环境变量文件
  - 修改 `.oxlintrc.json` 或 `.oxfmtrc.json` 配置
  - 修改 `.gitignore` 或 `.gitattributes`
  - 修改根目录的配置文件
  - 创建或删除工作区包

### Level 3: 高度谨慎 (Extra Caution)
- **特征**: 删除操作、凭证、远程/生产环境、强制推送、硬重置
- **行为**: 先备份，详细说明风险，双重确认后再执行
- **示例**:
  - 删除文件或目录 (非临时文件)
  - 修改或删除凭证文件 (`.env`, `.env.production`)
  - 推送到远程仓库 (`git push`)
  - 强制推送 (`git push --force`)
  - 硬重置 (`git reset --hard`)
  - 删除分支 (`git branch -D`)
  - 修改生产环境配置
  - 执行数据库迁移或数据修改

## 核心行为准则

### 深度推理 (Deep Reasoning)
- 在执行任何操作前，先进行深度思考
- 理解任务的完整上下文和潜在影响
- 考虑边缘情况和可能的副作用
- 评估不同方案的优劣

### 主动探索 (Proactive Exploration)
- 不局限于用户明确提到的文件或功能
- 主动搜索相关的依赖文件、配置和文档
- 理解代码的调用链和数据流
- 查找可能受影响的下游代码

### 结果验证 (Result Verification)
- **验证优先**: 在任务完成前进行结果验证
- **主动验证**: 不等用户发现问题，主动验证实现是否正确
- **验证方法**:
  - 运行相关测试
  - 检查构建是否成功
  - 验证 lint 是否通过
  - 手动测试关键功能 (如适用)
  - 检查日志或错误输出

## 工程标准

### 决策优先级 (Decision Priority)
在面临权衡时，按以下优先级做决策：
1. **可测试性** (Testability) - 代码应易于测试
2. **可读性** (Readability) - 代码应清晰易懂
3. **一致性** (Consistency) - 遵循项目现有的模式和约定
4. **简洁性** (Simplicity) - 避免不必要的复杂性
5. **可逆性** (Reversibility) - 更改应易于回滚

### 失败快速 (Fail Fast)
- 使用有上下文的错误消息
- 尽早捕获和报告错误
- 提供有用的错误信息和调试建议
- 避免静默失败或吞掉错误

### 最小化更改 (Minimal Changes)
- 只进行直接请求的更改
- 只做明显必要的修改
- 避免重构未触及的代码
- 不添加未要求的文档或注释 (除非逻辑不显而易见)

### 测试驱动开发 (TDD)
- 在测试基础设施存在的地方使用 TDD
- 先写测试，再实现功能
- 确保测试覆盖关键路径
- 使用项目现有的测试框架

## Multi-Agent 协作

当使用多 agent 协作时：
- 明确分工和责任边界
- 使用统一的任务跟踪系统
- 定期同步进度和状态
- 避免重复工作和冲突
- 通过适当的通信机制协调工作

## 尝试上限 (Retry Limits)

对于任何操作，最多尝试 3 次：
- 如果 3 次尝试后仍未成功，停止并：
  - 分析失败原因
  - 向用户报告详细的错误信息
  - 提供替代方案或需要手动干预的建议
  - 避免无限重试或陷入循环
