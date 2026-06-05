# 主进程入口拆分（2026-06-05）

## 1. 当前状态

`src/core/electron/main/index.ts` 当前约 757 行，已经完成第一轮收缩，但仍然不是纯启动编排层。

已迁出的职责：

- `window/createWindow.ts`
- `shell/openers.ts`
- `git/git-service.ts`
- `runtime/runtime-service.ts`

当前剩余重点：

- AI Commit 执行链路
- IPC handler 注册装配
- 少量仍然黏在入口层的主进程细节

## 2. 当前问题

- `index.ts` 仍然同时承担 app lifecycle、AI Commit、IPC 装配等多类职责。
- 入口文件仍然是主进程改动的默认落点，后续容易重新变胖。
- 如果不把 AI Commit 和 IPC 继续抽出，现有分层会停在“拆了一半”的状态。

## 3. 目标

- 保留 `index.ts` 作为启动编排层。
- 把具体能力收口到独立 service 或模块中。
- 把 `index.ts` 压到 400-600 行区间。

理想状态下，`index.ts` 只保留：

- app lifecycle
- 窗口与能力初始化
- service 装配
- 最薄的一层启动顺序控制

## 4. 目标目录

建议逐步收敛到类似结构：

- `src/core/electron/main/index.ts`
- `src/core/electron/main/ipc/registerIpcHandlers.ts`
- `src/core/electron/main/git/git-service.ts`
- `src/core/electron/main/runtime/runtime-service.ts`
- `src/core/electron/main/ai-commit/ai-commit-service.ts`
- `src/core/electron/main/window/createWindow.ts`
- `src/core/electron/main/shell/openers.ts`

重点不是目录层级本身，而是让每一类能力都只有一个清晰入口。

## 5. 剩余拆分顺序

### 5.1 先拆 AI Commit

优先迁出：

- AI Commit 启动入口
- 执行状态维护
- 结果回传
- 日志或 registry 访问

建议结果：

- `index.ts` 只负责装配 AI Commit 能力
- 真正执行逻辑迁到 `ai-commit-service.ts`

### 5.2 最后拆 IPC

`registerIpcHandlers` 不建议最早拆，原因很简单：

- 如果 AI Commit 还混在 `index.ts` 里
- 那么先抽 IPC 只会把一个偏大的注册函数搬到另一个文件

更合理的顺序是：

1. 先拆业务能力
2. 再让 IPC 注册文件只做 handler 装配

理想状态下，`registerIpcHandlers.ts` 只保留：

- channel 注册
- service 调用转发
- 参数校验或最薄的一层错误包装

### 5.3 第二轮结束标准

这一轮结束时应达到：

- `index.ts` 不再直接承载大段 AI Commit 逻辑
- IPC 注册文件从业务实现里解耦出来
- 主进程新增能力有明确落点，不再默认回到入口文件

## 6. 这轮不再重复拆的部分

下面这些能力已经完成首轮迁移，本轮不需要再按原方案重复处理：

- `createWindow`
- shell opener
- Git service
- Runtime service

后续如果要继续细化，只需要在对应目录内部继续收敛共享工具，不需要再把职责拉回 `index.ts`。

## 7. 主进程验收与回归

验收：

- `index.ts` 控制在 400-600 行以内
- 只保留 app lifecycle、能力初始化、模块装配

主进程相关拆分至少验证：

- 应用可以正常启动
- 窗口可以正常创建
- 常用 IPC 调用没有失效
- AI Commit 相关能力仍然可以启动、回传状态、结束
- Git 和 Runtime 既有调用不因入口重组出现回归
