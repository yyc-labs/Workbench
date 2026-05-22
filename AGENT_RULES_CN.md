# IDE Electron Agent 项目规则（中文）

本规则用于约束 AI Agent 在本仓库中的改动方式。目标是：不破坏架构、不乱放文件、可持续新增功能，并统一为 Apple 风格界面。

## 1. 文件分级规则（必须遵守）

### L0：核心稳定层（高风险，谨慎修改）
- 目录：
  - `src/core/electron/main/`
  - `src/core/electron/preload/`
  - `src/core/shared/`
- 规则：
  - 只在“确实需要行为变更”时修改。
  - 修改前先确认影响链路：`renderer -> preload -> main -> runner`。
  - 不允许仅为“代码好看”进行重构式大改。

### L1：状态与页面层（中风险）
- 目录：
  - `src/core/renderer/stores/`
  - `src/core/renderer/pages/`
  - `src/core/renderer/runtime/`
- 规则：
  - 涉及流程和状态的改动优先落在 `store`，避免在页面组件里堆业务逻辑。
  - 同一状态只能有一个权威来源，禁止在多个页面重复维护同类状态。

### L2：组件与样式层（低到中风险）
- 目录：
  - `src/core/renderer/components/`
  - `src/core/renderer/styles/`
  - `src/core/renderer/lib/`
- 规则：
  - 优先复用现有组件和样式 token，不重复造轮子。
  - 允许快速迭代，但不得破坏已有交互契约（props 含义、事件行为）。

### L3：文档与脚本层（低风险）
- 目录：
  - `docs/`
  - `logs/`
  - `script/`
- 规则：
  - 新增流程、约束、操作方法时，必须同步文档。
  - 自动化脚本改动必须说明输入、输出和回滚方式。

## 2. 新功能接入规则（标准流程）

### 2.1 先定级再落位
- 仅 UI 变化：优先改 `components/pages/styles`，不要碰 `main/preload`。
- 涉及进程能力、系统调用、IPC：走 `shared types -> preload -> main -> renderer store -> page` 全链路。
- 涉及运行环境（Windows/WSL）：必须显式评估 `useWsl`，禁止依赖“默认后端猜测”。

### 2.2 文件落点约定
- 新页面：`src/core/renderer/pages/<feature>/` 或现有页面子目录。
- 新组件：`src/core/renderer/components/`，通用组件优先放 `components/ui/`。
- 新状态切片：`src/core/renderer/stores/appStore.<feature>Slice.ts`。
- 新共享类型：`src/core/shared/types.ts`（或同层拆分文件并统一导出）。
- 新主进程能力：`src/core/electron/main/` 内按能力命名文件，禁止把多能力混成一个“大文件”。

### 2.3 必做检查
- 不跨层乱引用：`renderer` 不得直接依赖 `electron/main` 实现细节。
- IPC 参数与类型一致：`shared` 定义、`preload` 暴露、`renderer` 调用必须同构。
- 兼容现有 key 规则：开发进程 key 使用 `projectId`；Claude 会话使用 `{projectId}__claude`。
- 变更后至少通过 `npm run typecheck`（依赖已就绪时）。

## 3. 主题与视觉规则（Apple 风格）

### 3.1 视觉方向
- 关键词：克制、温润、留白、低对比、内容优先。
- 不追求花哨，不做高饱和“炫技面板”。

### 3.2 颜色与 token
- 统一使用 `src/core/renderer/styles/global.css` 中的 token。
- 主色蓝仅用于“主行动/激活态”，不要把蓝色当背景主视觉。
- 禁止新增随意硬编码颜色（尤其 `#fff/#000`、随机 Tailwind 原色）。

### 3.3 组件形态
- 卡片：柔和圆角、轻边框、弱阴影（`surface-card` / `surface-card-hover`）。
- 控件：优先胶囊形和安静底色（`quiet-control`）。
- 顶部区域：优先使用 `app-chrome`，保持半透明材质感。
- 字重：以 `400/500/600` 为主，避免大面积粗黑字。

### 3.4 空间与排版
- 页面主区域优先使用 `content-breathe`。
- 结构间距优先 `gap-5/6/8`、`space-y-7/10`。
- 保证深浅色主题都可用，禁止只调一种主题。

## 4. Agent 强限制（红线）

- 未经明确要求，不得执行破坏性命令（如 `git reset --hard`、批量删除）。
- 不得覆盖或回滚他人已存在改动。
- 不得在 WSL 的 `/mnt/d/...` 路径下执行依赖安装/重建（`npm install`、`pnpm install`、`node-gyp` 等）。
- 未经确认，不新增第三方依赖、不升级大版本基础库。
- 遇到跨层大改（主进程 + IPC + 多页面联动），必须先给出变更清单再动手。

## 5. 交付前清单（每次改动都要过）

- 改动是否在正确分级目录？
- 是否复用了现有 token / 组件 / store，而非重复实现？
- 是否保持 Windows 与 WSL 规则一致（特别是 `useWsl`）？
- 是否避免了硬编码颜色和高噪音 UI？
- 是否补充了必要文档（当行为或规则发生变化时）？

---

如果与更高优先级指令冲突（系统指令、用户当次明确要求），以高优先级为准；否则默认严格执行本规则。
