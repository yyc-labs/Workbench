# Transcript Viewer 最终架构实施方案（2026-06-09）

## 1. 设计原则

### 1.1 核心产品判断

- `tmux` 只是输入适配器，不是产品对象。
- 真正的产品对象是 `TranscriptSession`：可持久化、可解析、可查看、可回放、可跳转引用。
- Transcript 查看页应该优先保持 AI 上下文，因此引用点击的第一落点是 `Reference Drawer`，不是直接跳离当前页面。

### 1.2 实施约束

- 可以分阶段交付。
- 但每个阶段都必须直接落在最终架构上。
- 不接受“先做低配可用版本，后续整体整改”的路线。
- 不接受第一阶段故意省掉正式持久化、正式 adapter 边界、正式 parser 位置，再在后续迁移。

### 1.3 第一批交付目标

- 新增全屏路由页：`/project/:projectId/transcript`
- 引入正式 `TranscriptSession` 数据模型
- 引入正式 `Transcript Adapter -> Import Service -> Parser -> Repository -> Renderer Store` 链路
- 支持三种查看模式：
  - `preview`
  - `editor`
  - `split`
- 支持识别 `path:line[:column]` 文件引用
- 点击引用后在右侧打开 `Reference Drawer`
- Drawer 内用只读 Monaco 预览目标文件并滚到指定位置
- Drawer 顶部提供“在 Code Workspace 打开”
- Transcript 导入后立即正式持久化，应用重启后仍可恢复

### 1.4 非目标

- 第一批不做独立第二窗口
- 第一批不做 Transcript 编辑
- 第一批不做跨项目引用跳转
- 第一批不做 Transcript 分享、导出、标签系统
- 第一批不强行接所有数据来源，只先接第一种 adapter

## 2. 当前代码基础与约束

### 2.1 已有可复用能力

| 位置 | 现状 | 可复用方式 |
|------|------|------------|
| `src/core/renderer/App.tsx` | renderer 路由入口集中，当前使用 `MemoryRouter` | 可新增 `/project/:projectId/transcript` |
| `src/core/renderer/stores/appStore.processSlice.ts` | `terminalOutputs[projectId]` 持续接收输出 | 可作为第一种 adapter 的输入源 |
| `src/core/renderer/pages/code/code.markdown.tsx` | 已有 Markdown 渲染扩展点和链接拦截 | 可扩展内部 transcript 引用点击 |
| `src/core/renderer/components/MonacoTextViewer.tsx` | 已有只读 Monaco 查看器 | 可复用给 Transcript editor 和 Drawer 预览 |
| `src/core/renderer/pages/code/useCodeWorkspaceRestoreState.ts` | 已有文件打开后滚动到目标位置的恢复能力 | 可复用给“在 Code Workspace 打开” |
| `src/core/renderer/pages/code/CodeFileQuickDrawer.tsx` | 已有 Drawer 动画和交互模式 | 可借鉴 Reference Drawer 结构 |
| `src/core/renderer/pages/code/MonacoCodeEditor.tsx` | 已有 `revealPosition` 一类 imperative 控制模式 | 可作为 `MonacoTextViewer` 补能力的参考 |

### 2.2 已知约束

- 当前 `App.tsx` 使用 `MemoryRouter`，第二窗口不能直接依赖 URL 深链进入 Transcript 页面。
- `terminalOutputs` 只是传输缓冲：
  - 会被 `trimTerminalBuffer(...)` 裁剪
  - 会被 `clearOutput(projectId)` 清空
- `ProjectInfo` 与 `AppConfig` 目前承载的是项目配置与轻量会话信息，不适合直接存放大体积 Transcript 正文。

### 2.3 设计结论

- 第一种 adapter 可以来自 `terminalOutputs[projectId]` 快照。
- 但 `TranscriptSession` 必须从一开始就与 `terminalOutputs` 解耦。
- Transcript 正文从第一阶段开始就必须走正式 repository。
- 不允许第一阶段只放 renderer 内存态，后面再整体迁移到 main 存储。

## 3. 最终架构

```text
tmux / process-output / agent-hook / imported markdown
  -> Transcript Adapter
  -> Transcript Import Service
  -> Shared Transcript Parser
  -> Transcript Repository
  -> preload / IPC
  -> renderer Transcript Store
  -> /project/:projectId/transcript
  -> preview | editor | split
  -> click transcript reference
  -> Reference Drawer
  -> MonacoTextViewer readonly reveal
  -> optional open in Code Workspace
```

### 3.1 分层职责

| 层 | 建议位置 | 职责 |
|----|----------|------|
| Transcript Adapter | main 或 renderer 入口层 | 接收不同来源的 AI 输出，统一产出导入载荷 |
| Transcript Import Service | main | 生成 session id、补齐元数据、调用 parser、写 repository |
| Shared Transcript Parser | `src/core/shared/transcript` | ANSI 清洗、换行标准化、Markdown 规范化、引用抽取 |
| Transcript Repository | main | 持久化 session，提供 list/get/delete 能力 |
| preload / IPC | preload + main IPC | 暴露 transcript API 给 renderer |
| Renderer Transcript Store | `appStore.transcriptSlice.ts` | 管理当前页面状态、列表索引、活动 session、活动引用 |
| Transcript Page | `renderer/pages/TranscriptPage.tsx` | 全屏查看 Transcript，承载模式切换 |
| Reference Drawer | `renderer/pages/transcript/TranscriptReferenceDrawer.tsx` | 只读展示引用文件片段并桥接 Code Workspace |
| Code Workspace Bridge | 复用现有 code 链路 | 从 Drawer 跳去完整代码页 |

### 3.2 关键决策

- Parser 在导入时运行，不在 render 时临时解析。
- Parser 放共享层，不放 renderer 页面目录。
- Session 导入后立即落盘，renderer 不是正文唯一存储源。
- Adapter、Parser、Repository 从第一阶段就按最终边界落地。
- 后续阶段只增加来源和 UI，不迁移存储边界。

## 4. 数据模型

### 4.1 Shared 类型建议

目标文件：`src/core/shared/types.ts`

```ts
export type TranscriptSourceType =
  | 'process-output'
  | 'tmux-capture'
  | 'agent-hook'
  | 'manual-markdown'
  | 'imported-file'

export type TranscriptViewerMode = 'preview' | 'editor' | 'split'

export interface TranscriptMessageRange {
  startOffset: number
  endOffset: number
  startLine: number
  endLine: number
}

export interface TranscriptReference {
  id: string
  sessionId: string
  relativePath: string
  lineNumber?: number
  column?: number
  label: string
  rawText: string
  href: string
  messageRange: TranscriptMessageRange
}

export interface TranscriptSession {
  id: string
  projectId: string
  sourceType: TranscriptSourceType
  title: string
  rawText: string
  markdownText: string
  references: TranscriptReference[]
  createdAt: number
  updatedAt: number
}

export interface TranscriptImportPayload {
  projectId: string
  sourceType: TranscriptSourceType
  rawText: string
  title?: string
  sourceLabel?: string
  processId?: string
  capturedAt?: number
}

export interface TranscriptViewerRequest {
  projectId: string
  transcriptId: string
  initialMode?: TranscriptViewerMode
  host?: 'main-window' | 'secondary-window'
}

export interface TranscriptSessionSummary {
  id: string
  projectId: string
  sourceType: TranscriptSourceType
  title: string
  createdAt: number
  updatedAt: number
  referenceCount: number
}
```

### 4.2 为什么正文不能进入 `ProjectInfo`

- `ProjectInfo` 当前会被 `persistWorkspace(...)` 高频序列化。
- Transcript 正文体积大、增长快，不属于项目配置。
- 如果先放进 `ProjectInfo`，后面再拆出去就是明确返工。

允许的边界：

- `ProjectInfo` 最多保存轻量指针，例如未来的 `lastTranscriptSessionId`
- 正文和引用索引由 transcript repository 独立管理

### 4.3 Renderer Store 状态建议

目标文件：`src/core/renderer/stores/appStore.types.ts`

```ts
export interface AppState {
  transcriptSummariesByProjectId: Record<string, TranscriptSessionSummary[]>
  transcriptSessions: Record<string, TranscriptSession>
  activeTranscriptIdByProjectId: Record<string, string | undefined>
  transcriptModeBySessionId: Record<string, TranscriptViewerMode | undefined>
  activeTranscriptReferenceIdBySessionId: Record<string, string | undefined>
  transcriptListStatusByProjectId: Record<string, 'idle' | 'loading' | 'ready' | 'error'>

  importTranscript: (payload: TranscriptImportPayload) => Promise<TranscriptSession | null>
  loadProjectTranscripts: (projectId: string) => Promise<void>
  loadTranscriptSession: (projectId: string, transcriptId: string) => Promise<TranscriptSession | null>
  openTranscript: (request: TranscriptViewerRequest) => Promise<void>
  openTranscriptReference: (sessionId: string, referenceId: string) => void
  closeTranscriptReference: (sessionId: string) => void
  setTranscriptMode: (sessionId: string, mode: TranscriptViewerMode) => void
  removeTranscriptSession: (projectId: string, transcriptId: string) => Promise<void>
}
```

## 5. 持久化与 Repository

### 5.1 第一阶段就做正式持久化

- 导入完成后立即写入 repository
- 应用重启后仍然可以恢复 Transcript
- renderer 只缓存当前使用中的 session 和列表索引

### 5.2 存储形态建议

```text
userData/
  transcripts/
    <projectId>/
      index.json
      <sessionId>.json
```

建议：

- `<sessionId>.json` 保存完整 `TranscriptSession`
- `index.json` 保存 `TranscriptSessionSummary[]`
- 删除 session 时同步更新 `index.json`

### 5.3 Repository 接口建议

目标位置：`src/core/electron/main/transcript/transcriptRepository.ts`

```ts
export interface TranscriptRepository {
  saveSession(session: TranscriptSession): Promise<void>
  getSession(projectId: string, sessionId: string): Promise<TranscriptSession | null>
  listSessions(projectId: string): Promise<TranscriptSessionSummary[]>
  deleteSession(projectId: string, sessionId: string): Promise<boolean>
}
```

### 5.4 为什么这一层不能后补

- 如果第一阶段不做 repository，后面接入持久化时一定会重做导入链路和恢复逻辑。
- 那不是简单增强，而是架构迁移。
- 这与本方案“每一步都直接落最终结构”的要求冲突。

## 6. Adapter 与 Import Service

### 6.1 Adapter 目标

Adapter 只负责把来源差异抹平，不负责持久化，也不负责 UI。

统一输出：

```ts
TranscriptImportPayload
```

### 6.2 第一种 Adapter

第一阶段先做：

- `process-output` adapter

输入：

- `terminalOutputs[projectId]` 的一次性快照

输出：

- `TranscriptImportPayload`

注意：

- 这只是第一种 adapter，不是正式数据模型本身
- UI 和 repository 不能直接依赖 `terminalOutputs`

### 6.3 Import Service 接口建议

目标位置：`src/core/electron/main/transcript/transcriptService.ts`

```ts
export interface TranscriptImportService {
  importTranscript(payload: TranscriptImportPayload): Promise<TranscriptSession>
  listProjectTranscripts(projectId: string): Promise<TranscriptSessionSummary[]>
  getTranscript(projectId: string, transcriptId: string): Promise<TranscriptSession | null>
  deleteTranscript(projectId: string, transcriptId: string): Promise<boolean>
}
```

Import Service 职责：

- 生成 `sessionId`
- 计算标题和时间戳
- 调用 shared parser
- 写入 repository
- 返回完整 session

## 7. Parser 设计

### 7.1 位置

建议位置：

- `src/core/shared/transcript/transcript.parser.ts`

不建议：

- `src/core/renderer/pages/transcript/transcript.parser.ts`

原因：

- Import Service 在 main 侧也要使用
- 后续其他 adapter 也要复用
- 放页面目录会把领域逻辑和视图层绑定死

### 7.2 接口建议

```ts
export function buildTranscriptSession(
  payload: TranscriptImportPayload,
  options: {
    sessionId: string
    projectPath: string
    createdAt: number
    title: string
  }
): TranscriptSession
```

### 7.3 解析流水线

1. 标准化换行
2. 清除 ANSI escape sequences
3. 保持可读 Markdown 结构
4. 抽取文件引用
5. 给引用生成稳定 `referenceId`
6. 把可点击引用转换为内部链接
7. 产出 `markdownText` 与 `references[]`

### 7.4 第一阶段支持的引用格式

- `src/foo.ts:12`
- `src/foo.ts:12:4`
- `./src/foo.ts:12`
- `/mnt/d/tools/ide-electron/src/foo.ts:12`

规则：

- 只支持可归一化到当前项目内相对路径的引用
- 项目外路径先不支持点击
- Windows 盘符路径后续再补

### 7.5 内部引用协议

建议 parser 注入：

```text
[src/core/renderer/App.tsx:498](transcript-ref://<referenceId>)
```

收益：

- 引用点击不再依赖临时正则
- `referenceId` 可稳定关联 Drawer 状态
- 未来做引用列表、埋点、跳转历史都更稳

## 8. 路由与页面结构

### 8.1 路由

目标文件：`src/core/renderer/App.tsx`

新增：

```ts
<Route path="/project/:projectId/transcript" element={<TranscriptPage />} />
```

### 8.2 页面职责

目标文件：`src/core/renderer/pages/TranscriptPage.tsx`

职责：

- 读取 `projectId`
- 加载项目 transcript 列表
- 打开活动 session
- 维护 `preview` / `editor` / `split`
- 渲染 Markdown preview 与只读 Monaco
- 处理内部引用点击
- 挂载 `Reference Drawer`

### 8.3 页面布局建议

```text
TranscriptPage
├─ Header
│  ├─ Back to project
│  ├─ Session selector / title
│  ├─ Source badge
│  ├─ Updated time
│  └─ Mode switch
├─ Main
│  ├─ Preview panel
│  ├─ Editor panel
│  └─ Split layout
└─ Reference Drawer
```

## 9. Markdown 渲染扩展

目标文件：`src/core/renderer/pages/code/code.markdown.tsx`

建议给 `createMarkdownComponents(...)` 增加：

```ts
onInternalLinkClick?: (href: string) => boolean
```

规则：

- 外链继续走现有 `openExternal(...)`
- 如果 `href` 被 `onInternalLinkClick(...)` 消费，则阻止默认跳转

这样可以直接复用现有 Markdown 渲染器，不需要 fork Transcript 专用版本。

## 10. Reference Drawer

### 10.1 组件职责

目标文件：`src/core/renderer/pages/transcript/TranscriptReferenceDrawer.tsx`

- 根据 `referenceId` 找到 `TranscriptReference`
- 读取项目文件
- 用 `MonacoTextViewer` 只读展示
- 文件加载完成后滚到目标 `lineNumber` / `column`
- 提供关闭按钮
- 提供“在 Code Workspace 打开”

### 10.2 状态机建议

- `idle`
- `loading`
- `ready`
- `not-found`
- `error`

### 10.3 与 Code Workspace 的桥接

不要新造跳转协议，直接复用现有 Code session 恢复链路。

桥接动作：

1. `setProjectLastCodeFile(projectId, relativePath)`
2. `setProjectCodeSession(projectId, { ... })`
3. 把目标文件写入 `tabs`
4. 把目标文件写入 `activePath`
5. 把目标位置写入 `cursorPositions[relativePath]`
6. 跳转到 `/project/:projectId/code`

这样可以直接复用：

- `ProjectInfo.lastCodeFile`
- `ProjectInfo.codeSession`
- `useCodeWorkspaceRestoreState.ts`

## 11. MonacoTextViewer 需要补的正式能力

目标文件：`src/core/renderer/components/MonacoTextViewer.tsx`

建议改成 `forwardRef`，暴露：

```ts
export interface MonacoTextViewerHandle {
  revealPosition: (lineNumber: number, column?: number) => void
  highlightLine: (lineNumber: number) => void
}
```

实现建议：

- `revealPosition(...)` 参考 `MonacoCodeEditor`
- `highlightLine(...)` 用 Monaco decorations 做整行高亮
- Drawer 在文件加载完成后调用一次即可

这不是 Transcript 临时定制能力，而是只读 Monaco 查看器应有的正式控制接口。

## 12. IPC 与 preload 建议

### 12.1 IPC 能力

目标文件：

- `src/core/electron/main/ipc.ts`
- `src/core/electron/main/index.ts`

建议增加：

```ts
TRANSCRIPT_IMPORT
TRANSCRIPT_LIST
TRANSCRIPT_GET
TRANSCRIPT_DELETE
```

### 12.2 preload API

目标文件：`src/core/electron/preload/index.ts`

建议增加：

```ts
importTranscript: (payload: TranscriptImportPayload) => Promise<TranscriptSession>
listProjectTranscripts: (projectId: string) => Promise<TranscriptSessionSummary[]>
getTranscript: (projectId: string, transcriptId: string) => Promise<TranscriptSession | null>
deleteTranscript: (projectId: string, transcriptId: string) => Promise<boolean>
```

## 13. 分阶段施工顺序

### 13.1 Phase A：领域层和存储层一次到位

目标：

- `TranscriptSession` 类型
- shared parser
- transcript repository
- import service
- preload / IPC 合同
- renderer transcript slice
- 第一个 adapter：`process-output`

建议改动文件：

| 文件 | 改动 |
|------|------|
| `src/core/shared/types.ts` | 增加 Transcript 类型 |
| `src/core/shared/transcript/transcript.parser.ts` | 新建共享 parser |
| `src/core/electron/main/ipc.ts` | 增加 transcript IPC channel |
| `src/core/electron/main/index.ts` | 注册 transcript handler |
| `src/core/electron/main/transcript/transcriptRepository.ts` | 新建 repository |
| `src/core/electron/main/transcript/transcriptService.ts` | 新建 import/query service |
| `src/core/electron/preload/index.ts` | 暴露 transcript API |
| `src/core/renderer/stores/appStore.types.ts` | 增加 transcript state 和 action |
| `src/core/renderer/stores/appStore.transcriptSlice.ts` | 新建 slice |
| `src/core/renderer/stores/appStore.ts` | 挂载 slice |

本阶段完成标准：

- 可以导入一份 AI 输出
- session 已正式落盘
- 可以列出、读取、删除 transcript
- 应用重启后 session 仍存在

### 13.2 Phase B：Viewer 页面

目标：

- 新路由页
- `preview` / `editor` / `split`
- Transcript 列表和活动 session 展示
- 内部引用点击协议

建议改动文件：

| 文件 | 改动 |
|------|------|
| `src/core/renderer/App.tsx` | 新增 transcript 路由 |
| `src/core/renderer/pages/TranscriptPage.tsx` | 新建页面 |
| `src/core/renderer/pages/code/code.markdown.tsx` | 增加内部链接处理 |
| `src/core/renderer/pages/Detail.tsx` | 增加 Transcript 入口 |

### 13.3 Phase C：Reference Drawer 和 Code Bridge

目标：

- Drawer 预览
- Monaco 定位
- Code Workspace 跳转桥接

建议改动文件：

| 文件 | 改动 |
|------|------|
| `src/core/renderer/pages/transcript/TranscriptReferenceDrawer.tsx` | 新建 Drawer |
| `src/core/renderer/components/MonacoTextViewer.tsx` | 增加 reveal/highlight |
| `src/core/renderer/pages/TranscriptPage.tsx` | 集成 Drawer 状态 |

### 13.4 Phase D：增加更多 Adapter

后续增加：

- `tmux capture-pane`
- agent hook push
- 手动导入 Markdown 文件
- 历史 transcript 回放

这些阶段的目标是“增加来源”，不是调整既有架构。

### 13.5 Phase E：评估第二窗口

只有在主窗口 Transcript 体验稳定后，再评估：

- 独立 `BrowserWindow`
- 第二窗口如何拿到 `TranscriptViewerRequest`
- 是否继续使用 `MemoryRouter`，还是补 window-level state bridge

## 14. 风险与规避

### 14.1 路由风险

- `MemoryRouter` 让第二窗口深链能力受限
- 规避：第一批只做当前窗口，全程按可升级到多窗口的边界设计

### 14.2 数据源风险

- `terminalOutputs` 会裁剪、会清空、会夹杂 ANSI
- 规避：只把它作为第一种 adapter 输入，导入后立即进入正式 import service

### 14.3 配置膨胀风险

- 如果把 Transcript 正文塞进 `ProjectInfo` 或 `AppConfig`，后续必然膨胀
- 规避：正文与项目配置彻底分离

### 14.4 误识别引用风险

- AI 输出中代码块、普通文本、日志都可能长得像路径
- 规避：第一阶段只支持高置信度路径格式，不强行覆盖全部变体

## 15. 验收标准

- 可以把当前项目的一份 AI 输出导入为正式 `TranscriptSession`
- 导入后 session 已落盘，应用重启后仍能恢复
- `/project/:projectId/transcript` 可以正常打开活动 transcript
- `preview` / `editor` / `split` 三种模式都可用
- 点击 `path:line[:column]` 后，留在 TranscriptPage 内并打开右侧 Drawer
- Drawer 能正确读取项目文件并滚到目标位置
- 点击“在 Code Workspace 打开”后，Code page 能恢复到同一文件与行列
- 没有引用、文件不存在、文件读取失败时，UI 都有明确空态或错误态

## 16. 结论

推荐按下面顺序实施：

1. 先确定 domain model
2. 第一阶段直接落共享 parser、main repository、import service、IPC
3. 在正式存储链路上接 `process-output` adapter
4. 再做 TranscriptPage
5. 再做 Reference Drawer 和 Code bridge
6. 最后增加更多 adapter 与第二窗口能力

这条路径的意义是：

- 每个阶段都直接建设最终结构
- 不会出现“先 renderer 内存顶着，后面再整体迁移”的返工
- 后续新增能力只是在既有结构上扩展，不是推翻前一阶段
