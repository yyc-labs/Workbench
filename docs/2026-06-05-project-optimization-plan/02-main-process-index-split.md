# 主进程入口拆分（2026-06-05）

## 1. 当前状态

`src/core/electron/main/index.ts` 当前 121 行，第二轮拆分已经落地，入口文件已经收敛为主进程启动编排层。

已迁出的职责：

- `window/createWindow.ts`
- `shell/openers.ts`
- `git/git-service.ts`
- `runtime/runtime-service.ts`
- `ai-commit/ai-commit-service.ts`
- `ipc/registerIpcHandlers.ts`

当前主进程相关文件规模：

| 文件 | 当前行数 | 说明 |
|------|----------|------|
| `src/core/electron/main/index.ts` | 121 | 启动编排层 |
| `src/core/electron/main/ipc/registerIpcHandlers.ts` | 351 | 汇总 IPC handler 装配 |
| `src/core/electron/main/ai-commit/ai-commit-service.ts` | 341 | AI Commit 执行链路 |
| `src/core/electron/main/project-file-service.ts` | 13 | 兼容出口 |

## 2. 当前问题

- `index.ts` 本身的问题已经基本解决，不再是主进程治理重点。
- `registerIpcHandlers.ts` 虽然比原入口清晰，但仍然同时承接 process、config、AI Commit、Git、shell、window、project-file 等多类 handler。
- `ai-commit-service.ts` 已经独立，但内部仍同时包含配置归并、PowerShell 启动、WSL fallback、输出分发和状态持久化；如果后续继续加能力，仍有继续膨胀的风险。

## 3. 目标

- 保留 `index.ts` 作为启动编排层。
- 把具体能力收口到独立 service 或模块中。
- 把 `index.ts` 压到 400-600 行区间。

理想状态下，`index.ts` 只保留：

- app lifecycle
- 窗口与能力初始化
- service 装配
- 最薄的一层启动顺序控制

当前结果：

- 目标已经超额完成，`index.ts` 已低于原计划区间上限很多。
- 后续主进程优化不应继续围绕 `index.ts` 本身，而应转向 IPC 分域或 service 内部继续收口。

## 4. 当前结构

当前结构已经基本收敛到下面形态：

- `src/core/electron/main/index.ts`
- `src/core/electron/main/ipc/registerIpcHandlers.ts`
- `src/core/electron/main/git/git-service.ts`
- `src/core/electron/main/runtime/runtime-service.ts`
- `src/core/electron/main/ai-commit/ai-commit-service.ts`
- `src/core/electron/main/window/createWindow.ts`
- `src/core/electron/main/shell/openers.ts`

重点不是目录层级本身，而是让每一类能力都只有一个清晰入口。

## 5. 当前已完成项

- AI Commit 已从 `index.ts` 迁到 `ai-commit/ai-commit-service.ts`
- IPC 注册已从 `index.ts` 迁到 `ipc/registerIpcHandlers.ts`
- `index.ts` 当前只保留 capability probe、service 创建、handler 注册、窗口创建和 app lifecycle
- IPC 注册保持启动期单次注册，避免窗口重建时重复挂载
- `project-file-service.ts` 已完成兼容出口收缩

## 6. 这轮不再重复拆的部分

下面这些能力已经完成首轮迁移，本轮不需要再按原方案重复处理：

- `createWindow`
- shell opener
- Git service
- Runtime service

后续如果要继续细化，只需要在对应目录内部继续收敛共享工具，不需要再把职责拉回 `index.ts`。

## 7. 后续可选优化

如果后续还要继续治理主进程，建议优先考虑：

- 按领域再拆 `registerIpcHandlers.ts`
  - 例如拆成 `registerWindowIpcHandlers.ts`、`registerGitIpcHandlers.ts`、`registerProjectFileIpcHandlers.ts`
- 继续压缩 `ai-commit-service.ts`
  - 例如拆出配置整理、子进程启动、输出桥接

这已经不再是当前最高优先级，只适合作为渲染层大组件治理完成后的收尾优化。

## 8. 本次核对结果

- 静态检查已完成：`npm run typecheck` 通过
- 运行回归本次未重新执行
- 因此当前文档只确认“结构状态”和“静态可通过状态”，不把运行结果写成已验证
