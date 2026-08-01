# Markdown 文档工作台与系统文件关联计划

> 日期：2026-08-01  
> 状态：待评审  
> 范围：Windows `.md` 文件关联、独立 Markdown 文档入口、最近打开历史、查看与编辑体验  
> 本轮仅输出方案，不实施代码、不执行 build

## 0. 结论先行

新增一个项目无关的“Markdown 文档”工作台，路由建议为 `/markdown`。它不是 Code 页的简化复制，也不把任意外部文件伪装成项目文件，而是复用两套现有体验：

1. 阅读与渲染复用 Code 页的 `MarkdownPreviewSurface`、`createMarkdownComponents`、GFM、代码块、Mermaid、表格和主题样式。
2. 编辑交互借用学习中心的 Edit / Split / Preview、滚动同步、列表续写、缩进与撤销历史体验。
3. 左侧提供最近打开文件，可搜索、重新打开、从历史移除；默认“删除”只删除历史记录，不删除磁盘原文件。
4. 主页工具栏和路由目录增加显式入口；系统双击 `.md` 时直接打开或聚焦该工作台。
5. 外部绝对路径使用独立的 `markdown-document` domain，不扩宽现有 `project-file` 的项目根目录安全边界。

首版以 Windows 为目标平台，支持冷启动和应用已运行时的二次启动。建议首版同时支持 `.md`、`.markdown`，`.mdc` 可作为后续兼容项；`.mdx` 暂不关联，因为当前渲染器不会执行 MDX 组件语义。

## 1. 用户场景

### 1.1 系统双击打开

1. 用户在 Windows 文件资源管理器中双击 `.md` 文件。
2. 如果应用未运行，应用启动并进入 `/markdown`，展示目标文件。
3. 如果应用已运行，单实例 `second-instance` 接收新参数，恢复并聚焦主窗口，然后切换到目标文件。
4. 文件成功读取后加入最近打开历史；同一路径只保留一条并更新时间。

### 1.2 应用内打开

1. 用户从主页“Markdown 文档”入口进入工作台。
2. 用户可通过“打开文件”按钮选择 Markdown 文件，或从最近历史继续阅读。
3. 无历史时显示克制的空态，主行动为“打开 Markdown 文件”。

### 1.3 查看、编辑与保存

1. 默认使用 Preview 阅读模式，延续 Code 页的 Markdown 视觉与能力。
2. 用户可切换 Edit、Split、Preview，模式切换延续学习中心的控件形态。
3. 编辑后显示未保存状态；保存时使用磁盘 `mtimeMs` 做乐观并发检查。
4. 文件被外部程序修改时，不静默覆盖，提示“重新加载”或“确认覆盖”。
5. 切换文件、移除当前历史、离开页面或关闭窗口前，如有未保存内容，必须弹出统一确认对话框。

### 1.4 历史管理

1. 历史按最近打开时间倒序展示，建议上限 50 条。
2. 支持按文件名和完整路径搜索。
3. 单条“移除历史”只移除记录，不修改磁盘文件。
4. 支持“清空历史”，需要确认；当前打开且有未保存内容的文档不应被静默关闭。
5. 原文件不存在时保留记录并显示“文件已移动或删除”，用户可以定位新文件或移除记录。

## 2. 产品与布局方案

### 2.1 页面入口

新增独立路由 `/markdown`，不挂在 `/project/:projectId` 下，原因是外部 Markdown 文件不一定属于已登记项目。

入口建议：

1. 主页 `HomeToolbar` 在学习中心旁新增 Markdown 图标按钮。
2. `RouteCatalogDialog` 新增“Markdown 文档”基础路由。
3. 工作台内提供“打开文件”按钮和空态主行动。
4. 后续可补全局快捷键，但首版不与现有快捷键争用。

窗口标题建议：

```text
文件名.md - Markdown - IDE Electron
```

没有活动文件时为：

```text
Markdown - IDE Electron
```

### 2.2 桌面布局

```text
┌──────────────────────────────────────────────────────────────┐
│ app-chrome：Markdown 文档 | 打开文件 | Edit Split Preview | 保存 │
├──────────────────┬───────────────────────────────────────────┤
│ 最近打开          │ 当前文档                                  │
│ 搜索              │ 面包屑/完整路径、保存状态、文件状态         │
│ 文件名 + 路径      │                                           │
│ 缺失状态          │ Preview：Code 页阅读体验                   │
│ 移除历史          │ Split：学习中心编辑 + Code 页预览           │
│                  │ Edit：Markdown 编辑器                       │
└──────────────────┴───────────────────────────────────────────┘
```

视觉要求：

1. 顶部使用 `app-chrome`，历史与编辑区域使用现有 `surface-card` / `quiet-control`。
2. 主色蓝只用于“打开文件”“保存”和当前激活态。
3. 历史列表保持低对比，完整路径作为次级信息；缺失和冲突状态使用现有语义 token。
4. 深浅色主题共用现有 token，不新增裸色值。
5. 窄窗口下历史区变为抽屉，复用项目已有的侧栏折叠与手势习惯。

### 2.3 阅读与编辑体验边界

建议把通用 Markdown 能力提取到 renderer 复用层，而不是让新页面跨 domain 直接长期依赖 `pages/code/`：

```text
src/core/renderer/components/markdown/
  MarkdownPreviewSurface.tsx
  markdownComponents.tsx
  markdownUrls.ts
  markdownVisibility.tsx

src/core/renderer/lib/markdown/
  editorCommands.ts
  editorHistory.ts
```

迁移必须保持小步：先抽取无项目专属语义的渲染表面和编辑纯函数，Code 页与学习中心改为复用；transcript 引用、项目内文件跳转、图片粘贴等项目特有能力仍通过可选回调注入。不要为了新页面一次性重构全部 Code Markdown 文件。

首版编辑器建议复用学习中心的文本编辑体验，而不是立即引入第二套 Monaco 装配。后续若需要大文件编辑、语法高亮和查找替换，再评估把 `MonacoCodeEditor` 抽成通用组件。

## 3. 数据模型与契约

### 3.1 Shared 类型

建议在 `src/core/shared/types/markdownDocument.ts` 定义：

```ts
type MarkdownDocumentHistoryEntry = {
  path: string
  normalizedPath: string
  displayName: string
  lastOpenedAt: number
  lastKnownMtimeMs?: number
  missing?: boolean
}

type MarkdownDocumentReadResult = {
  path: string
  content: string
  size: number
  mtimeMs: number
  encoding: 'utf-8'
}

type MarkdownDocumentWriteResult = {
  path: string
  size: number
  mtimeMs: number
}
```

IPC API 建议：

```text
selectMarkdownDocument()
readMarkdownDocument(path)
writeMarkdownDocument(path, content, expectedMtimeMs)
listMarkdownDocumentHistory()
removeMarkdownDocumentHistory(path)
clearMarkdownDocumentHistory()
consumePendingMarkdownDocumentOpen()
onMarkdownDocumentOpenRequested(callback)
```

`consume + subscription` 必须同时存在：consume 处理 renderer 订阅前收到的冷启动参数，subscription 处理应用运行期间的二次启动，避免事件丢失。

### 3.2 历史持久化

历史属于应用级数据，不属于任何项目，不放进 `SavedProject` 或 renderer `localStorage`。建议由主进程 repository 持久化到：

```text
app.getPath('userData')/markdown-documents/history.json
```

选择独立文件而不是继续扩大 `project-launcher-config.json`，原因是：

1. 历史更新频率高于设置项，避免每次打开文档都重写主配置。
2. 可以独立做损坏恢复、数量裁剪和原子写入。
3. 不需要提升当前 config schema version。

持久化规则：

1. Windows 路径使用 `path.resolve` 后的规范路径，并按不区分大小写的 key 去重。
2. 保存原始可显示路径，不把绝对路径写进 URL query 或 renderer 日志。
3. 每次成功读取后再写历史；读取失败不制造新的有效历史项。
4. repository 采用临时文件 + rename 的原子写入方式，损坏时回退为空列表并保留可诊断日志。
5. 最多保留 50 条；超过上限淘汰最旧记录。

### 3.3 Renderer 状态

这是跨入口、需响应 IPC 且需要页面共享的状态，建议新增：

```text
src/core/renderer/stores/appStore.markdownDocumentSlice.ts
```

并同步 `appStore.types.ts`。核心状态包括：

```text
history
historyStatus
activePath
activeDocument
editorValue
displayMode
loadStatus / loadError
saveStatus / saveError
hasUnsavedChanges
externalChangeState
pendingOpenPath
```

`displayMode` 可以作为应用级偏好持久化，默认 `preview`；编辑器撤销栈、光标和侧栏开关属于页面会话状态，首版无需跨重启持久化。

## 4. 主进程与 IPC 架构

### 4.1 新 domain

建议结构：

```text
src/core/electron/main/markdown-document/
  markdownDocumentPath.ts
  markdownDocumentService.ts
  markdownDocumentRepository.ts
  markdownDocumentOpenRequest.ts

src/core/electron/main/ipc/registerMarkdownDocumentIpcHandlers.ts
src/core/electron/preload/invokeApi.markdownDocument.ts
```

链路遵循：

```text
shared types/constants
  -> main markdown-document service/repository
  -> registerMarkdownDocumentIpcHandlers
  -> preload invokeApi + subscriptions
  -> renderer store/page
```

`registerIpcHandlers.ts`、`preload/index.ts` 只负责装配。

### 4.2 任意绝对路径的安全规则

现有 `project-file` 强制文件位于项目根目录内，不能直接复用其 API。新 service 仅开放最小能力：

1. 只接受绝对路径，拒绝空路径和目录。
2. `realpath` 后确认目标是普通文件。
3. 只允许 `.md`、`.markdown`；如后续支持 `.mdc`，显式加入 allowlist。
4. 沿用现有 1 MiB 文本文件上限与 NUL 字节探测；超限给出明确错误，不让 renderer 卡死。
5. 读取编码首版固定 UTF-8；检测到 UTF-8 BOM 时可剥离，其他编码提示暂不支持。
6. 写入前重新解析真实路径，并验证目标未被替换为目录或其他异常对象。
7. 写入携带 `expectedMtimeMs`，与磁盘不一致时返回结构化 conflict，不覆盖外部修改。
8. renderer 不获取通用文件系统能力，只能调用 Markdown 专用 IPC。

相对图片和相对 Markdown 链接以当前文档所在目录为基准解析。图片读取继续走受控的 `readLocalImageAsDataUrl`；点击同目录 Markdown 链接时先解析并校验扩展名，再在当前工作台打开，不交给 Chromium 直接导航。

## 5. Windows 文件关联与启动链路

### 5.1 打包配置

在 `electron-builder.yml` 增加文件关联，概念配置如下，实施时以当前 electron-builder 版本实际 schema 为准：

```yaml
fileAssociations:
  - ext:
      - md
      - markdown
    name: Markdown Document
    description: Markdown document
    role: Editor
    icon: icon/Y.ico
```

注意：

1. 安装器只能声明应用具备打开能力；现代 Windows 是否成为默认应用仍由用户或系统选择决定，产品文案不能承诺静默抢占默认关联。
2. 关联验证必须使用安装后的 NSIS 包，开发模式不能代表注册表关联行为。
3. 卸载后应由安装器移除自己注册的关联信息，不手写额外注册表脚本，除非 electron-builder 行为无法满足验收。

### 5.2 参数解析

新增纯函数解析启动参数，建议放在 `markdownDocumentOpenRequest.ts` 并补 Node test：

1. 扫描 `process.argv` 或 `second-instance` 的 `argv`，忽略 executable、Electron 开发入口、静默自启动参数和未知 flags。
2. 仅接受存在的 Markdown 候选；路径可能包含空格、中文和大小写混合扩展名。
3. 多个候选首版取最后一个有效文件，并记录其余被忽略；后续可扩展多标签页。
4. 不把 argv 原文发送给 renderer，只发送校验后的规范绝对路径。

### 5.3 冷启动与二次启动时序

```text
冷启动 argv
  -> 主进程解析并缓存 pending open request
  -> app.whenReady / createMainWindow
  -> renderer 初始化并 consume pending request
  -> navigate('/markdown') + read + 写入历史

已运行时双击
  -> requestSingleInstanceLock 保持现有实例
  -> second-instance(argv)
  -> 解析并更新 pending request
  -> showMainWindowFromTray / focus
  -> webContents.send(MARKDOWN_DOCUMENT_OPEN_REQUESTED)
  -> renderer navigate('/markdown') + 处理未保存切换确认
```

现有 `onSecondInstance` 只恢复窗口，需要扩展为“先识别 Markdown 请求，再恢复窗口并派发”；静默自启动参数仍保持不唤醒窗口的原行为。

事件投递需要等待主窗口可用。窗口尚未创建、页面尚未完成加载或被关闭到托盘时，都先写入 pending request，renderer consume 后清空；同一路径重复投递应幂等。

## 6. 文件状态、保存与删除语义

### 6.1 保存冲突

保存流程：

```text
打开文件 -> 记录 mtimeMs
编辑 -> dirty
保存(content, expectedMtimeMs)
  ├─ mtime 一致：写入，返回新 mtimeMs，清除 dirty
  └─ mtime 不一致：进入 conflict，不自动覆盖
```

冲突对话框提供：

1. 重新加载磁盘版本：丢弃本地未保存内容，必须二次确认。
2. 另存为：后续阶段加入；首版如不实现，应明确不可用。
3. 强制覆盖：高风险动作，首版建议不提供；若提供必须二次确认并重新 stat。

### 6.2 “删除”的明确含义

用户提出“历史文件可以删除”，首版统一命名为“从历史移除”：

1. 删除的是 `history.json` 中的记录。
2. 原始 `.md` 文件不被删除，也不移入回收站。
3. 当前打开文件被移除历史后可以继续查看；下次成功打开会再次进入历史。
4. 清空历史不关闭当前文档。

真正“删除磁盘文件”不纳入首版。若后续要做，必须独立设计回收站能力、路径复核、确认对话框、恢复语义和 Windows/WSL 行为，不能复用“移除历史”的按钮。

## 7. i18n、错误态与可访问性

新增 `src/core/renderer/i18n/messages/markdownDocument.ts`，至少覆盖中英文：

1. 页面标题、打开文件、最近打开、搜索、Edit / Split / Preview、保存。
2. 从历史移除、清空历史及确认文案，明确“不会删除磁盘文件”。
3. 文件不存在、无权限、扩展名不支持、文件过大、编码不支持、读取失败。
4. 文件已被外部修改、未保存离开确认、保存成功和保存失败。
5. 空历史、未选择文档、历史无搜索结果。

所有 icon-only 按钮提供 `aria-label` 和 `title`；历史项支持键盘选择，移除按钮不能因事件冒泡同时打开文件；确认对话框使用项目现有 `ModalShell` / Dialog 封装。

## 8. 建议改动清单

### 8.1 Shared

1. `src/core/shared/types/markdownDocument.ts`：文档、历史、错误与打开请求类型。
2. `src/core/shared/electronApi.ts`：Markdown invoke 与 subscription 契约。

### 8.2 Main

1. `src/core/electron/main/markdown-document/`：绝对路径校验、读写、历史 repository、argv 解析和 pending request。
2. `src/core/electron/main/ipc/registerMarkdownDocumentIpcHandlers.ts`：具体 handlers。
3. `src/core/electron/main/ipc/registerIpcHandlers.ts`：只装配新 handlers。
4. `src/core/electron/main/ipc.ts`：新增 Markdown channels。
5. `src/core/electron/main/index.ts`：接入冷启动 argv、`second-instance`、窗口恢复和事件派发。
6. `electron-builder.yml`：Windows 文件关联声明。

### 8.3 Preload

1. `src/core/electron/preload/invokeApi.markdownDocument.ts`：invoke API。
2. `src/core/electron/preload/subscriptions.ts`：打开请求订阅。
3. `src/core/electron/preload/index.ts`：只组装 API。

### 8.4 Renderer

1. `src/core/renderer/pages/markdown-document/`：页面入口、历史侧栏、编辑区、hooks 和页面私有 helper。
2. `src/core/renderer/stores/appStore.markdownDocumentSlice.ts` 与 `appStore.types.ts`：全局状态和 actions。
3. `src/core/renderer/App.tsx`：懒加载 `/markdown` 路由。
4. `src/core/renderer/app/AppGlobalEffects.tsx`：全局消费打开请求并导航。
5. `src/core/renderer/app/windowTitle.ts`：Markdown 标题。
6. `src/core/renderer/app/RouteCatalogDialog.tsx`：路由入口。
7. `src/core/renderer/pages/home/HomeToolbar.tsx` 与 `Home.tsx`：主页入口。
8. `src/core/renderer/i18n/messages/markdownDocument.ts`：中英文文案。
9. `src/core/renderer/styles/parts/markdown-document.css`：只放工作台布局；预览正文继续复用现有 Markdown 样式。
10. `src/core/renderer/components/markdown/`、`src/core/renderer/lib/markdown/`：按实际复用需要小步抽取通用能力。

## 9. 实施阶段

### P0：契约与路径安全

1. 定义 shared 类型、IPC channels 和 Electron API。
2. 实现绝对路径规范化、扩展名 allowlist、大小与二进制探测。
3. 实现读取、带 `mtimeMs` 的安全写入与结构化错误。
4. 实现独立历史 repository 与 50 条裁剪。
5. 为路径、argv、历史和冲突逻辑补纯 Node test。

### P1：应用内 Markdown 工作台

1. 增加 `/markdown` 懒加载路由、窗口标题、主页与路由目录入口。
2. 完成历史侧栏、空态、打开文件、读取、从历史移除和清空历史。
3. 默认接入 Code 页预览能力，支持相对图片和安全外链。
4. 接入学习中心风格的 Edit / Split / Preview、滚动同步和编辑命令。
5. 完成保存、dirty 状态、离开确认和外部修改冲突。
6. 补齐 i18n、深浅色、窄窗口抽屉和错误态。

### P2：Windows 系统关联

1. 增加 electron-builder 文件关联。
2. 接入冷启动 argv 与 pending request consume。
3. 扩展 `second-instance`，处理运行中再次双击和托盘恢复。
4. 验证空格、中文路径、大小写扩展名、连续双击不同文件。
5. 用户明确需要打包验证时，再执行 Windows 安装包构建；默认开发阶段不 build。

### P3：体验增强（非首版阻塞）

1. 另存为、在资源管理器中显示、复制完整路径。
2. 文件系统 watcher 与更即时的外部变更提示。
3. 多标签页、固定历史、最近阅读位置。
4. 抽取通用 Monaco Markdown 编辑器。
5. 评估 `.mdc`、拖放打开和“用 IDE Electron 打开”的右键菜单。

## 10. 测试计划

### 10.1 自动化测试

新增或扩展 Node test：

1. argv 解析忽略 exe、开发入口、静默启动 flag 和非 Markdown 参数。
2. 带空格、中文、大小写扩展名的路径可正确识别。
3. 相同 Windows 路径不同大小写只生成一条历史。
4. 历史按时间排序、超过 50 条裁剪、单条移除和清空正确。
5. 非绝对路径、目录、软链接异常、错误扩展名、超大文件和 NUL 文件被拒绝。
6. `expectedMtimeMs` 不一致时拒绝覆盖。
7. pending request 在 consume 后清空，重复事件幂等。
8. 编辑命令和撤销历史沿用现有学习中心测试，抽取后保持回归通过。
9. Markdown URL、Mermaid sanitize、box table 等现有预览测试保持通过。

### 10.2 手工验收

1. 从主页进入 Markdown 工作台，无历史时空态正确。
2. 应用内选择 `.md` 后默认预览，历史立即出现且不重复。
3. Edit / Split / Preview、滚动同步、代码块、Mermaid、表格、图片和外链均正常。
4. 修改并保存后磁盘内容正确；外部修改后保存会提示冲突。
5. 从历史移除和清空历史都不删除原文件。
6. 原文件被移动或删除后，历史显示缺失状态且可以移除。
7. 浅色、深色和系统主题均可读；窄窗口历史抽屉可用。
8. 安装版冷启动双击 `.md` 能直接打开。
9. 应用已运行、最小化或隐藏到托盘时双击 `.md`，能恢复窗口并打开目标文件。
10. 连续双击两个不同文件不会被旧异步读取结果覆盖。

### 10.3 实施后的验证命令

代码实施完成后，按仓库规则先对本次修改的代码文件统一执行 Biome，再运行针对性测试和 typecheck。`node`、`npm`、`npx` 相关命令必须提权。默认不执行 build；只有用户明确要求打包或验证安装关联时才执行。

## 11. 验收标准

1. 用户可以从应用入口选择并查看任意受支持的本地 Markdown 文件。
2. 安装版可被 Windows 识别为 Markdown 打开方式，并正确处理冷启动与二次启动。
3. 阅读体验与 Code 页 Markdown 预览能力一致，编辑体验保留学习中心的核心交互。
4. 最近历史跨重启保留、路径去重、可搜索、可单条移除和清空。
5. 所有历史删除操作都不会删除磁盘原文件，文案无歧义。
6. 任意绝对路径没有扩宽为通用文件系统 API，renderer 只能访问受控 Markdown IPC。
7. 保存不会静默覆盖磁盘上的外部修改，未保存切换有确认保护。
8. i18n、深浅色、空态、错误态、缺失文件和窄窗口布局完整。

## 12. 暂不纳入首版

1. 删除磁盘原文件或回收站管理。
2. 多文档标签页和工作区恢复。
3. 非 UTF-8 编码自动转码。
4. 执行 MDX 组件、HTML 脚本或任意嵌入代码。
5. Windows 之外平台的系统文件关联验收。
6. 为该功能新增第三方依赖。
7. 首轮实施中的结构性大重构或 Markdown 渲染器替换。
