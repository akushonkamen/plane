# Claude Code 配置指南 - Tracktor 项目

> 这是 Plane (makeplane/plane) 的 fork， 重命名为 Tracktor。

## 项目信息

- **名称**: Tracktor
- **仓库**: akushonkamen/tracktor
- **许可证**: AGPL-3.0-only
- **原项目**: [makeplane/plane](https://github.com/makeplane/plane)

## 工作模式 (Work Modes)

### 默认模式 (Default Mode)

- **可执行交付**: 默认工作模式，可以直接执行并交付任务结果
- **Level 1 直接执行**: 对于仅限于当前任务作用域、本地环境、低风险且可逆的修改，可以直接执行，无需额外确认
- **示例**: 当前任务的代码编辑、本地开发服务器启动 (`pnpm dev`)、暂存和提交更改

### 仅方案模式 (Solution-Only Mode)

- **触发条件**: 当用户明确说 "只要方案"、"不执行"、"不动代码" 时进入此模式
- **行为**: 仅提供解决方案、技术方案或实施计划，不执行任何代码修改

### "一路畅行"模式

- **触发条件**: 当用户明确说 "一路畅行" 时进入此模式
- **行为**: 对于合理的操作，可以更高自主性地执行，但仍需遵守核心行为准则
- **限制**: 仍需遵守 Level 2 和 Level 3 门禁规则,对高风险操作保持谨慎

## Skills (技能)

在开始任务前，先扫描可用的技能 (Skills):

- 使用 `Skill` 工具查看当前可用的技能列表
- 根据任务需求选择合适的技能进行辅助
- 对于重复性工作流程,考虑创建自定义技能

## 核心行为准则 (Core Behavior)

### 2.1 深度推理 (Deep Reasoning)

- 在执行任何操作前,先进行深度思考
- 理解任务的完整上下文和潜在影响
- 考虑边缘情况和可能的副作用
- 评估不同方案的优劣

### 2.2 主动探索 (Proactive Exploration)

- 不局限于用户明确提到的文件或功能
- 主动搜索相关的依赖文件、配置和文档
- 理解代码的调用链和数据流
- 查找可能受影响的下游代码

### 2.3 执行门禁 (Execution Gates) - 核心章节

#### Level 1: 直接执行 (Direct Execution)

- **特征**: 任务作用域内、本地环境、低风险、可逆
- **行为**: 解释操作目的,然后直接执行
- **示例**:
  - 当前任务的的新代码编辑和重构
  - 运行开发服务器 (`pnpm dev`)
  - Git 暂存和提交 (`git add`, `git commit`)
  - 运行测试 (`pnpm test`)
  - 修复 lint 错误 (`pnpm fix`)

#### Level 2: 等待确认 (Wait for Confirmation)

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

#### Level 3: 高度谨慎 (Extra Caution)

- **特征**: 删除操作、凭证、远程/生产环境、强制推送、硬重置
- **行为**: 先备份,详细说明风险，双重确认后再执行
- **示例**:
  - 删除文件或目录 (非临时文件)
  - 修改或删除凭证文件 (`.env`, `.env.production`)
  - 推送到远程仓库 (`git push`)
  - 强制推送 (`git push --force`)
  - 硬重置 (`git reset --hard`)
  - 删除分支 (`git branch -D`)
  - 修改生产环境配置
  - 执行数据库迁移或数据修改

### 2.4 危险操作 (Dangerous Operations)

以下操作属于危险操作,需要特别谨慎:

- 删除数据库或数据
- 修改生产环境配置或数据
- 强制推送到受保护的分支
- 修改安全相关的配置
- 执行不可逆的系统级操作

### 2.5 结果验证 (Result Verification)

- **验证优先**: 在任务完成前进行结果验证
- **主动验证**: 不等用户发现问题,主动验证实现是否正确
- **验证方法**:
  - 运行相关测试
  - 检查构建是否成功
  - 遇见 lint 是否通过
  - 手动测试关键功能 (如适用)
  - 检查日志或错误输出

### 2.6 Multi-Agent 规则

- 当使用多 agent 协作时:
  - 明确分工和责任边界
  - 使用统一的任务跟踪系统
  - 定期同步进度和状态
  - 避免重复工作和冲突
  - 通过适当的通信机制协调工作

### 2.7 尝试上限 (Retry Limits)

- 对于任何操作,最多尝试 3 次
- 如果 3 次尝试后仍未成功,停止并:
  - 分析失败原因
  - 向用户报告详细的错误信息
  - 提供替代方案或需要手动干预的建议
  - 避免无限重试或陷入循环

### 2.8 夯盘沉淀 (Post-task Review)

- 任务完成后,进行简要复盘:
  - 总结完成的工作
  - 记录遇到的问题和解决方案
  - 识别可改进的地方
  - 更新相关文档或知识库 (如适用)

## 工程标准 (Engineering Standards)

### 决策优先级 (Decision Priority)

1. **可测试性** (Testability)
2. **可读性** (Readability)
3. **一致性** (Consistency)
4. **简洁性** (Simplicity)
5. **可逆性** (Reversibility)

### 失败快速 (Fail Fast)

- 使用有上下文的错误消息
- 尽早捕获和报告错误
- 避免静默失败或吞掉错误

### 最小化更改 (Minimal Changes)

- 只进行直接请求的更改
- 只做明显必要的修改
- 避免重构未触及的代码
- 不添加未要求的文档或注释 (除非逻辑不显而易见)

### 测试驱动开发 (TDD)

- 在测试基础设施存在的地方使用 TDD
- 先写测试,再实现功能
- 确保测试覆盖关键路径

## Tracktor 项目特定上下文

### 项目结构

Tracktor 是一个 pnpm monorepo (Turborepo),包含以下结构:

#### 应用 (apps/)

- `web/` - 主前端应用 (React 18, Vite, React Router v7)
- `admin/` - 管理后台
- `space/` - 空间管理应用
- `live/` - 实时协作功能
- `api/` - API 网关/代理
- `proxy/` - 代理服务

#### 包 (packages/)

- `i18n/` - 国际化
- `ui/` - UI 组件库 (带 Storybook)
- `editor/` - 编辑器组件
- `types/` - 共享类型定义
- `shared-state/` - MobX 状态管理
- `hooks/` - React Hooks
- `utils/` - 工具函数
- `constants/` - 常量定义
- `services/` - API 服务
- `logger/` - 日志工具
- `propel/` - 性能监控
- `typescript-config/` - TypeScript 配置
- `tailwind-config/` - Tailwind 配置
- `codemods/` - 代码转换工具
- `decorators/` - 装饰器

### 技术栈

- **包管理器**: pnpm (工作区模式)
- **构建工具**: Turborepo
- **前端框架**: React 18
- **路由**: React Router v7
- **构建**: Vite
- **状态管理**: MobX (在 `packages/shared-state`)
- **样式**: Tailwind CSS
- **后端**: Django 4.2 + Django REST Framework
- **任务队列**: Celery
- **数据库**: PostgreSQL

### 常用命令

```bash
# 开发
pnpm dev              # 启动所有开发服务器 (web:3000, admin:3001)
pnpm turbo run dev --filter=@tracktor/ui  # 启动特定包的开发服务器
# 构建
pnpm build            # 构建所有包和应用
pnpm turbo run build --filter=@tracktor/ui  # 构建特定包
# 检查
pnpm check            # 运行所有检查 (格式、lint、类型)
pnpm check:lint       # OxLint 检查
pnpm check:types      # TypeScript 类型检查
# 修复
pnpm fix              # 自动修复格式和 lint 问题
pnpm fix:format       # 修复格式问题
pnpm fix:lint         # 修复 lint 问题

# Storybook
pnpm --filter=@tracktor/ui storybook  # 在端口 6006 启动 Storybook
# 清理
pnpm clean            # 清理构建产物和依赖
```

### 代码规范

- **导入**: 内部包使用 `workspace:*`,外部依赖使用 `catalog:`
- **TypeScript**: 启用严格模式,所有文件必须类型化
- **格式化**: 使用 oxfmt (不是 Prettier),运行 `pnpm fix:format`
- **Linting**: 使用 OxLint (不是 ESLint),共享 `.oxlintrc.json` 配置
- **命名**: 变量/函数使用 camelCase,组件/类型使用 PascalCase
- **错误处理**: 使用 try-catch 和适当的错误类型,正确记录错误
- **状态管理**: MobX stores 在 `packages/shared-state`,使用响应式模式
- **测试**: 所有功能都需要单元测试,使用各包现有的测试框架
- **组件**: 在 `@tracktor/ui` 中构建,使用 Storybook 进行隔离开发

### 关键配置文件

- `package.json` - 根包配置和工作区设置
- `turbo.json` - Turborepo 构建配置
- `.oxlintrc.json` - OxLint 配置 (不是 ESLint)
- `.oxfmtrc.json` - oxfmt 格式化配置
- `.npmrc` - pnpm 配置
- `pnpm-workspace.yaml` - 工作区配置
- `.env.example` - 环境变量示例

### Hooks

项目使用 Husky 和 lint-staged 进行 Git hooks:

- `pre-commit`: 自动格式化和 lint 暂存的文件
- `prepare`: 安装 Husky hooks

### 依赖管理

- 使用 pnpm catalog 管理共享依赖
- 在 `package.json` 中使用 `catalog:` 引用
- 覆盖依赖在 `pnpm.overrides` 中配置

### 注意事项

- 不要使用 ESLint 或 Prettier,项目使用 OxLint 和 oxfmt
- 遵循现有的代码模式和约定
- 在修改全局配置前,先了解其影响范围
- 对于跨包的更改,考虑构建依赖关系
- 使用 Turborepo 的 `--filter` 选项来针对特定包
