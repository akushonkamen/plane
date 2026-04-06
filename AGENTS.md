# Agent Development Guide - Tracktor 项目

## Commands

- `pnpm dev` - Start all dev servers (web:3000, admin:3001)
- `pnpm build` - Build all packages and apps
- `pnpm check` - Run all checks (format, lint, types)
- `pnpm check:lint` - OxLint across all packages
- `pnpm check:types` - TypeScript type checking
- `pnpm fix` - Auto-fix format and lint issues
- `pnpm fix:format` - Fix format issues
- `pnpm fix:lint` - Fix lint issues
- `pnpm turbo run <command> --filter=<package>` - Target specific package/app
- `pnpm --filter=@tracktor/ui storybook` - Start Storybook on port 6006

## Code Style

- **Imports**: Use `workspace:*` for internal packages, `catalog:` for external deps
- **TypeScript**: Strict mode enabled, all files must be typed
- **Formatting**: oxfmt, run `pnpm fix:format`
- **Linting**: OxLint with shared `.oxlintrc.json` config
- **Naming**: camelCase for variables/functions, PascalCase for components/types
- **Error Handling**: Use try-catch with proper error types, log errors appropriately
- **State Management**: MobX stores in `packages/shared-state`, use reactive patterns
- **Testing**: All features require unit tests, use existing test framework per package
- **Components**: Build in `@tracktor/ui` with Storybook for isolated development

## 项目信息

Tracktor 是 makeplane/plane 的 fork，重命名为 Tracktor。 原始许可证为 AGPL-3.0-only。

- **仓库**: akushonkamen/tracktor
- **原项目**: [makeplane/plane](https://github.com/makeplane/plane)
