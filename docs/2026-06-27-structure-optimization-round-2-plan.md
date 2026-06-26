# 2026-06-27 结构优化第二轮执行计划

## 背景

第一轮优化已经完成分享服务回退、Runtime 刷新收敛、主题同步 IPC 清理、公共主题 hook 抽取和部分主进程辅助逻辑拆分，当前剩余问题主要集中在热点文件仍然偏大、职责边界仍不够清晰：

1. `src/core/electron/main/ipc/registerIpcHandlers.ts` 仍然集中注册多类 IPC，扩展成本高。
2. `src/core/electron/preload/index.ts` 仍然同时承接 invoke API、事件订阅和 AI Commit 订阅扇出逻辑。
3. `src/core/electron/main/index.ts` 已较首轮明显收敛，但仍可继续下沉少量启动编排细节。

本轮目标不是引入新功能，而是在保持行为不变的前提下完成第二轮结构治理，并通过类型检查和测试回归验证。

## 本轮范围

### P0 必须完成

1. 拆分主进程 IPC 注册：
   - 抽出共享依赖类型。
   - 按领域拆分注册模块。
   - 保留 `registerIpcHandlers` 作为唯一总入口。

2. 拆分 preload 暴露层：
   - 将 invoke API 与事件订阅拆成可组合模块。
   - 保留 `window.electronAPI` 暴露形态不变。
   - 保留现有 API 名称、参数和返回结构。

3. 对 `main/index.ts` 做低风险瘦身：
   - 仅抽取稳定的启动辅助逻辑。
   - 不修改 app 生命周期语义。

4. 完成回归验证：
   - 运行 `npm run typecheck`
   - 运行 `npm test`

### P1 本轮尽量完成

1. 让新增模块命名与职责边界可持续扩展。
2. 避免重复定义 preload 订阅样板逻辑。
3. 为后续继续拆 `TranscriptPage`、`App.tsx` 等渲染层大文件保留清晰接口边界。

## 非目标

1. 本轮不重写 `TranscriptPage.tsx`、`App.tsx` 的业务结构。
2. 本轮不替换 `package.json` 中现存的 `pwsh` 脚本。
3. 本轮不新增 ESLint、CI 或工程规范体系。
4. 本轮不改动 Electron 与 renderer 的现有交互协议。

## 实施顺序

### 阶段 1：文档与边界确认

1. 记录第二轮结构优化范围、非目标和验收标准。
2. 基于现有代码确认安全拆分边界，避免与上一轮功能修复交叉冲突。

### 阶段 2：主进程 IPC 拆分

1. 提取 IPC 注册共享类型和辅助函数。
2. 将 handler 按以下领域拆分：
   - core
   - git
   - project-file
   - transcript
   - learning
   - runtime
3. 在总入口中保持单次注册保护和统一装配顺序。

### 阶段 3：preload 拆分

1. 提取 invoke API 模块：
   - core
   - git
   - project-file
   - transcript
   - learning
   - runtime
2. 提取事件订阅模块：
   - 普通 `ipcRenderer.on` 订阅
   - AI Commit 多订阅者扇出
3. 在 `index.ts` 中合并暴露统一 API，并保留 `ElectronAPI` 类型导出。

### 阶段 4：main 入口轻量瘦身

1. 抽取稳定的全局快捷键注册辅助逻辑。
2. 抽取转录导入项目列表映射辅助逻辑。
3. 保持 `index.ts` 继续作为启动编排层，不做深度重写。

### 阶段 5：验证

1. 运行 `npm run typecheck`
2. 运行 `npm test`
3. 若发现回归，直接补齐结构调整带来的类型或行为问题。

## 验收标准

1. `registerIpcHandlers.ts` 不再直接承载全部 handler 细节。
2. `preload/index.ts` 不再直接定义全部 invoke 与订阅逻辑。
3. `main/index.ts` 进一步收敛，保留启动编排职责。
4. `window.electronAPI` 的调用方式保持兼容。
5. `npm run typecheck` 通过。
6. `npm test` 通过，或结果具备明确可解释性。
