# IDE Electron Agent 协作规则

本文件用于约束 AI Agent 在本仓库中的改动方式。目标是：尊重当前架构边界、避免跨层乱改、保持 Windows/WSL 行为一致，并延续现有 Apple-like 视觉体系。
默认在完成需求修改后不要执行 build；该项目 build 性能开销较大，仅在用户明确要求时再执行。
## 0. 优先级与适用范围

- 本规则适用于仓库内所有代码、文档、脚本和配置改动。
- 若与系统指令、用户当次明确要求冲突，以更高优先级指令为准。
- 若与 `CLAUDE.md`、`.claude/rules/`、`.codex/` 中的规则冲突，先遵守更具体、更接近目标文件的规则。
- 修改前先识别改动属于 UI、renderer 状态、IPC、主进程能力、运行环境、脚本还是文档，不要先动手再补架构理由。

## 1. 当前架构地图

### 1.1 Electron 与共享层（高风险）

- `src/core/electron/main/index.ts`：应用启动和生命周期编排入口，只保留装配职责。
- `src/core/electron/main/ipc/`：IPC 注册层；`registerIpcHandlers.ts` 只做总入口，具体 handler 按 domain 拆分。
- `src/core/electron/main/<domain>/`：主进程能力实现，现有 domain 包括 `ai-commit`、`ai-environment`、`git`、`hooks`、`learning`、`project-file`、`runtime`、`shell`、`transcript`、`window`。
- `src/core/electron/main/runner.ts`、`wsl-bridge.ts`、`tmux-manager.ts`：进程执行、WSL、tmux 等底层运行能力，改动前必须确认 Windows/WSL 影响。
- `src/core/electron/preload/`：contextBridge 暴露层；`index.ts` 负责组装，`invokeApi.*.ts` 和 `subscriptions.ts` 承接具体 API。
- `src/core/shared/`：跨 main/preload/renderer 的类型、规则、runtime profile、Codex scope 等共享模型。

### 1.2 Renderer 应用层（中高风险）

- `src/core/renderer/App.tsx`：应用壳层与路由编排入口，不应重新堆回全局监听器或大段页面 UI。
- `src/core/renderer/app/`：全局 effect、窗口标题栏、路由辅助等应用级模块。
- `src/core/renderer/stores/`：Zustand 单一状态入口；新全局状态优先新增或扩展 `appStore.<feature>Slice.ts`。
- `src/core/renderer/runtime/`：renderer 侧 Runtime 编排，不承接主进程执行细节。
- `src/core/renderer/pages/<feature>/`：页面 domain 模块。入口页负责跨区域编排，复杂 UI、hook、helper 应下沉到同目录。

### 1.3 Renderer 复用层（中低风险）

- `src/core/renderer/components/`：跨页面复用组件；通用 UI 放 `components/ui/`。
- `src/core/renderer/hooks/`：跨页面复用 hook；页面私有 hook 优先放回对应 `pages/<feature>/`。
- `src/core/renderer/lib/`：纯函数、展示转换、轻量工具，不持有全局状态。
- `src/core/renderer/i18n/`：用户可见文案入口；新增文案必须接入 messages，不要在页面里散落硬编码文本。
- `src/core/renderer/styles/`：全局 token、页面样式分片和主题规则。
- `src/core/renderer/types/`、`public/`：renderer 专用类型和静态资产。

### 1.4 文档、脚本与产物层（低到中风险）

- `docs/`：计划、架构说明、流程约束。行为或架构规则变化时必须同步。
- `script/`：自动化脚本。修改时说明输入、输出、失败行为和回滚方式。
- `test/`：Node test 测试。新增复杂纯逻辑优先补测试。
- `logs/`、`build/`、`out/`、`release/`、临时目录：通常不作为手工功能改动入口。

## 2. 改动落点规则

### 2.1 UI 与页面改动

- 纯视觉或交互微调：优先改 `pages/<feature>/`、`components/`、`styles/`，不要碰 `main/preload/shared`。
- 页面入口文件只保留页面级状态选择、跨区域 handler 和区域装配；大段 JSX 下沉到同目录组件。
- 页面私有 helper/hook 放在对应页面目录；跨页面复用后再提升到 `hooks/` 或 `lib/`。
- 新页面走 `src/core/renderer/pages/<feature>/`，并在路由入口集中接入。

### 2.2 状态与数据流改动

- 全局状态以 `appStore` 为权威来源，禁止在多个页面重复维护同类状态。
- 新状态切片使用 `src/core/renderer/stores/appStore.<feature>Slice.ts`，类型同步进 `appStore.types.ts`。
- 页面局部 UI 状态可留在页面或 hook 内；跨页面、需持久化、需响应 IPC 的状态应进入 store。
- store action 可以调用 preload API，但不应直接依赖主进程实现细节。

### 2.3 IPC 与主进程能力改动

- 涉及系统能力、文件系统、进程、Git、Runtime、AI Commit、Transcript、Learning 等能力时，按链路修改：
  `shared types/constants -> main domain service -> main/ipc/register<X>IpcHandlers.ts -> preload/invokeApi.<domain>.ts -> renderer store/hook/page`。
- `registerIpcHandlers.ts` 只做装配，不直接新增具体业务 handler。
- `preload/index.ts` 只做 contextBridge 组装，不直接写业务逻辑。
- 事件订阅优先放 `preload/subscriptions.ts`；避免在多个文件重复写订阅扇出逻辑。
- IPC 参数、返回类型、错误语义必须在 shared/preload/renderer 三侧保持一致。

### 2.4 Runtime、AI 环境与进程执行

- 普通项目运行遵循项目环境：Windows 项目路径使用 Windows native，WSL/Ubuntu 项目路径使用 WSL。
- 涉及运行环境时必须显式评估 `useWsl`，禁止依赖“默认后端猜测”。
- AI Runtime / AI Commit 的环境选择优先走 `ai-environment`、`runtime`、`runtimeEntrypoint`、`aiRuntimeProfiles` 相关模型，不要新增硬编码启动路径。
- `tmux` 是某些 provider/backend 的实现细节，不是所有 Runtime 模式的产品前提。
- 进程状态 key 规则必须兼容现状：普通 dev 进程使用 `projectId`，工具箱进程使用 `${projectId}::toolbox`。

## 3. 架构边界红线

- `renderer` 不得直接依赖 `electron/main` 实现。
- `shared` 不得反向依赖 `main`、`preload`、`renderer`。
- 主进程 domain 之间不要通过页面需求互相偷调内部函数；需要共享时提取明确的 shared helper 或注入依赖。
- 不要把已拆出的 IPC、preload、App、Transcript/Page 区域逻辑重新合并成“大文件”。
- 不要仅为“代码好看”重构 L0/L1 文件；结构性重构必须能说明降低了耦合、重复或风险。
- 遇到跨层大改（主进程 + IPC + preload + store + 多页面联动），必须先给出变更清单再动手。

## 4. 主题与视觉规则

- 视觉方向：克制、温润、留白、低对比、内容优先。
- 优先使用 `src/core/renderer/styles/global.css` 和 `styles/parts/` 中已有 token。
- 卡片优先复用 `surface-card` / `surface-card-hover`，控件优先复用 `quiet-control`，顶部区域优先复用 `app-chrome`。
- 主色蓝只用于主行动或激活态，不要把蓝色当背景主视觉。
- 禁止新增随意硬编码颜色，尤其是裸 `#fff`、`#000` 和随机 Tailwind 原色。
- 保证深浅色主题都可用，禁止只调一种主题。
- 新增用户可见文案必须接入现有 i18n messages。

## 5. 命令与环境红线

- `node.exe`、`node`、`npm`、`npx`、`electron-rebuild`、`node-gyp` 相关命令需要提权使用。
- 不得在 WSL 的 `/mnt/d/...` 路径下执行依赖安装或重建，包括 `npm install`、`pnpm install`、`yarn install`、`electron-rebuild`、`node-gyp`。
- 未经确认，不新增第三方依赖、不升级大版本基础库。
- 未经明确要求，不得执行破坏性命令，例如 `git reset --hard`、批量删除、强制覆盖。
- 不得覆盖、回滚或清理他人已存在改动；工作区已脏时以当前内容为基准。
- Git 提交、暂存、改 refs 等操作按用户要求执行；不要主动 amend。

## 6. 交付前检查

- 改动是否落在正确层级和 domain？
- 是否保持 `renderer -> preload -> main -> service/runner` 的边界清晰？
- 是否同步了 shared 类型、preload API、renderer 调用三侧契约？
- 是否复用了现有 token、组件、store、hook，而不是重复实现？
- 是否保持 Windows/WSL 行为一致，特别是 `useWsl` 和 Runtime provider 选择？
- 是否处理了 i18n、深浅色主题、错误态和空态？
- 行为或架构规则变化时，是否补充了必要文档？
- 如未运行验证，是否明确说明原因；如需运行 Node/npm 命令，是否已按规则提权。
