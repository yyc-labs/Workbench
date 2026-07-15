# Markdown 预览性能优化方案（评审稿）

> 日期：2026-07-15  
> 状态：待评审  
> 范围：Code 页面 Markdown/MDC 预览，以及会受预览阻塞影响的文件树交互

## 0. 结论先行

这个问题可以解决，但“继续把 Markdown 切成更多段”不是完整方案。当前分段主要减少了部分业务数据范围，并没有改变以下事实：

1. `react-markdown` 仍然需要对当前文档建立完整的 Markdown AST 和完整 React 子树。
2. 所有段落、列表、表格、链接、图片占位、代码块和结构化图形仍会进入 DOM。
3. 代码块的 `IntersectionObserver` 只延迟语法高亮，不延迟 Markdown 解析和普通 DOM 创建。
4. Code 页面文件树和编辑/预览区域由同一个 `CodeWorkspacePanel` 编排，树状态变化会让编辑器区域重新参与 React render。
5. Split 模式下，编辑器每次输入都会改变 `editorValue`，进而触发预览重新解析；这类更新没有防抖。

建议采用以下顺序：

1. 先测量，区分文件读取、Markdown 解析、React commit、布局绘制和长任务。
2. 先做低风险隔离：预览组件 `memo`、稳定 props、预览更新防抖、共享可见性调度。
3. 对大文档引入按顶层块的虚拟渲染，只挂载视口附近的块。
4. 如果仍有明显长任务，再把 Markdown 解析移入 Worker，或把预览改为独立的 DOM/Webview 宿主。

这条路线能先改善“点击文件树但界面迟迟没有反馈”，再解决“超长文档滚动和首次预览仍卡顿”，不需要第一步就替换现有 Markdown 特性。

## 1. 当前链路与问题定位

### 1.1 Code 页面

当前关键链路如下：

```text
CodeWorkspacePanel
  ├─ useCodeWorkspaceExplorerState       文件树、搜索、目录刷新
  ├─ useCodeFileState                    读取 active file，更新 editorValue
  ├─ useMarkdownPreviewModeState         frontmatter 解析、Markdown 组件工厂
  └─ CodeWorkspaceEditorPane
       └─ ReactMarkdown(markdownPreviewContent)
```

关键文件：

| 文件 | 当前行为 | 性能含义 |
| --- | --- | --- |
| `src/core/renderer/pages/code/useMarkdownPreviewModeState.ts` | 对 `editorValue` 做 frontmatter 解析，并产生 `markdownPreviewContent` | 每次内容变化都可能重新计算文档元数据和预览输入 |
| `src/core/renderer/pages/code/CodeWorkspaceEditorPane.tsx` | Preview/Split 直接挂载 `ReactMarkdown` | 预览不是独立 memo 边界，父组件更新时会重新参与 render |
| `src/core/renderer/pages/code/code.markdown.tsx` | 代码块仅按视口延迟语法高亮 | 仍会先创建所有代码块 wrapper 和 plain `<pre>` |
| `src/core/renderer/pages/code/code.markdownMermaid.tsx` | Mermaid 在块挂载后异步渲染 | 全文挂载时，多个 Mermaid 块会同时启动渲染任务 |
| `src/core/renderer/pages/code/useCodeFileState.ts` | 读取文件后依次更新 active file、active path、editor value | 新文件进入预览时会触发完整预览替换 |
| `src/core/renderer/pages/code/useCodeWorkspaceExplorerState.ts` | 文件树已经是 lazy load，并有 root/directory TTL | 文件树 I/O 已有优化，当前卡顿不能简单归因于递归扫描 |
| `src/core/renderer/pages/code/CodeFileTree.tsx` | 使用 `react-arborist` | 文件树本身已有虚拟化基础，但父层 render 仍可能阻塞交互 |

### 1.2 为什么点击文件树会感觉很慢

文件树点击路径目前是：

```text
点击文件
  -> handleSelectTreeFile
  -> openFile
  -> readProjectFile
  -> setActiveRelativePath / setEditorValue
  -> CodeWorkspacePanel render
  -> ReactMarkdown 解析完整文档并创建完整 React/DOM 树
  -> 浏览器布局、绘制、图片读取、Mermaid/高亮副作用
```

所以需要区分两个时间：

1. 文件读取时间：主进程 IPC 和磁盘读取。
2. 读取完成后的主线程阻塞时间：Markdown 解析、React reconciliation、DOM commit、布局和图形渲染。

在大 Markdown 文件已打开且处于 Preview 时，第二项更可能是主要瓶颈。文件树使用了 `react-arborist`，而 `CodeWorkspaceEditorPane` 当前没有 `memo`，因此“树点击慢”很可能是预览更新阻塞了 renderer 主线程，而不是文件树组件没有虚拟化。

## 2. 为什么 VS Code 通常不这么卡

VS Code 不是完全不重新渲染 Markdown，它采用的是一套不同的更新模型：

1. Markdown 预览运行在独立的 Webview 宿主中，编辑器和预览的 UI 更新相互隔离。
2. Markdown engine 使用 `markdown-it`，并提供按文档版本和配置匹配的 token cache。
3. 预览更新有 300ms 的节流/防抖窗口，连续编辑不会每个字符都立即触发完整预览更新。
4. Webview 初次加载 HTML，后续更新使用 `DOMParser` 加载新内容，再通过 `morphdom` 做 `childrenOnly` 的 DOM 增量更新，而不是让 React 重新协调整个组件树。
5. 预览宿主把滚动同步、图片加载和 diff 标记作为独立机制处理，避免全部逻辑绑在编辑器页面的 React render 上。

这并不代表 VS Code 对无限大的 Markdown 没有上限，也不等于它一定做了完整的 Markdown 虚拟列表。对本项目最值得借鉴的是：

1. 预览更新要和编辑/文件树交互隔离。
2. 连续变化要合并更新。
3. 已有 DOM 尽量增量更新。
4. 解析结果和昂贵渲染结果要缓存。

## 3. 目标与非目标

### 3.1 目标

以基准数据为准调整具体数字，初始建议目标如下：

1. 文件树点击后，树选中态或轻量 loading 反馈在 100ms 内可见。
2. 文件树点击不因旧 Markdown 预览的 reconciliation 阻塞超过一个明显长任务。
3. Split 模式输入时，编辑器输入保持即时响应，预览在停止输入约 200～300ms 后更新。
4. 大文档滚动时，常规滚动帧尽量保持在 16～20ms 内，避免连续掉帧。
5. 预览只挂载视口附近的昂贵块，文档总长度不再线性决定初始 DOM 数量。
6. 保留现有 Markdown/MDC 能力：GFM、代码复制/展开、Mermaid、箱线图、表格、内部 transcript 引用、图片、源码行定位、预览搜索、滚动同步和截图/分享。

### 3.2 非目标

1. 第一阶段不替换 Monaco。
2. 第一阶段不修改 main/preload/IPC 协议。
3. 不为了性能删除 Mermaid、表格或源码定位能力。
4. 不仅靠全局关闭语法高亮来掩盖问题。
5. 不在没有基准数据的情况下直接引入新的大型虚拟列表依赖。
6. 不把文件树改成递归 eager scan；当前 lazy 和 TTL 策略继续保留。

## 4. 阶段 0：建立可重复的性能基准

### 4.1 基准样本

准备固定 Markdown fixture，至少覆盖：

1. 1,000 / 3,500 / 10,000 / 30,000 行的普通文本和标题。
2. 多段长代码块，包含启用和禁用语法高亮的边界。
3. 大型 GFM 表格和当前项目的 box drawing table。
4. Mermaid、box-flow、vertical-flow、architecture diagram 混合文档。
5. 图片较多、内部 transcript 引用较多的文档。
6. 同一大文件的 edit、preview、split 三种模式。

### 4.2 需要记录的时间点

建议只在开发模式或显式 debug 开关下记录，不直接增加生产 telemetry：

```text
tree pointerdown
file read start/end
active file state update
markdown input received
frontmatter parse start/end
markdown render start/end
React commit start/end
preview first paint
preview scroll frame
```

重点输出：

1. `readProjectFile` 延迟。
2. Markdown 解析耗时。
3. React render/commit 耗时。
4. Preview 容器 DOM 节点数。
5. 一次更新产生的 long task 数量和最长时长。
6. 文件树点击到首次可见反馈、点击到新文件预览完成的 P50/P95。

可以使用 `performance.mark/measure` 和 React `<Profiler>`；不需要运行 build。阶段 0 的产物必须是优化前基线表，否则后续只能凭体感判断。

## 5. 阶段 1：低风险止血，先恢复交互响应

### 5.1 拆出并 memo 化预览表面

新增页面私有组件，建议放在 `src/core/renderer/pages/code/`：

```text
MarkdownPreviewSurface.tsx
  ├─ PreviewToolbar / find bar
  ├─ MarkdownPreviewContent
  └─ StructuredPreview / CodePreview modal 装配
```

实施要求：

1. `MarkdownPreviewContent` 使用 `memo`，只接受稳定的、与预览真正相关的 props。
2. `CodeWorkspaceEditorPane` 增加明确的 memo 边界，或把编辑器和预览拆成两个独立子树。
3. 对当前 JSX 内联创建的 callback 做 `useCallback` 稳定化，避免父组件每次 render 都使 memo 失效。
4. 文件树状态变化时，预览组件不应重新 render；文件内容、主题、预览模式、预览搜索状态变化时才更新。
5. `CodeWorkspaceSidebar` 也可以增加 memo，但要先稳定 `Set`、数组和 callback props，不能只包一层 `memo`。

这一步主要解决“点击文件树后，已有预览不应因为树状态变化而重复 render”。它不能解决切换到一个全新大 Markdown 文件时的首次解析成本，因此必须和下一项配合。

### 5.2 预览更新防抖和低优先级调度

把编辑器内容和预览内容拆成两个时间语义：

1. `editorValue` 继续即时更新，保证 Monaco 输入正确。
2. `markdownPreviewContent` 在 200～300ms 无新输入后更新。
3. Split 模式显示预览旧内容期间，增加轻量 stale 状态，不阻塞编辑器。
4. 文件切换时可以立即更新文件名/选中态，预览内容异步切换；不能让旧文件的源码定位事件作用到新文件。
5. `useDeferredValue` 或 `startTransition` 可以作为调度补充，但不能替代防抖。它们只能改变优先级，不能减少 Markdown 解析工作量。

参考 VS Code 的 300ms 更新窗口，先采用 220ms 左右的默认值，再根据基准调整。预览模式下没有编辑输入时，不需要人为增加文件切换的固定延迟。

### 5.3 统一可见性调度

当前每个代码块都会创建一个 `IntersectionObserver`，而且 observer 的 root 是默认 viewport。建议新增预览级可见性调度器：

1. 以 `previewScrollRef` 作为 observer root。
2. 一个 observer 管理多个代码块、图片和结构化图形。
3. 使用统一 overscan，例如视口上下 320～640px。
4. 代码块只有接近视口才执行 `SyntaxHighlighter`。
5. Mermaid、box diagram、architecture diagram 和大型表格只有接近视口才执行昂贵的结构化渲染。
6. 本地图片的 `readLocalImageAsDataUrl` 也应延迟到接近视口，而不是所有已挂载图片都立即触发 IPC。
7. 截图、分享和结构化预览导出时显式开启 `forceRenderAllBlocks`，保持现有完整捕获语义。

占位元素必须有稳定的最小高度或 `contain-intrinsic-size`，否则块进入视口时会造成滚动条跳动。

### 5.4 使用 `content-visibility` 作为浏览器侧补充

对已经挂载但处于视口外的顶层块使用：

```css
.code-markdown-block {
  content-visibility: auto;
  contain-intrinsic-size: auto 240px;
}
```

注意：这只能减少离屏块的 layout/paint 成本，不能减少 `react-markdown` 的解析、React element 创建和 DOM 初次挂载。所以它必须建立在顶层块 wrapper 或阶段 2 block model 之上，不能单独作为主优化。

### 5.5 阶段 1 对文件树的处理

当前文件树已经具备 lazy load、root refresh TTL、directory refresh 和非破坏性刷新能力，相关逻辑继续沿用。针对本次卡顿只增加 renderer 隔离：

1. 不在点击文件树时主动刷新 Markdown 预览以外的内容。
2. 树的 loading/selected 状态与编辑器内容状态分离。
3. 文件读取开始时先提供选中态或轻量读取反馈，旧预览可以暂留但必须标记为 stale。
4. 树节点点击不触发父级中与 transcript preload、preview search、structured preview 无关的计算。
5. 保持 `autoLoadBlocked`、lazy directory 和现有 TTL 行为不变。

## 6. 阶段 2：大文档按块虚拟渲染

如果阶段 1 后 10,000 行以上文档仍有明显卡顿，进入块级虚拟化。推荐目标结构：

```text
MarkdownDocumentModel
  ├─ documentVersion / contentHash
  ├─ topLevelBlocks[]
  │    ├─ blockId
  │    ├─ sourceStartLine / sourceEndLine
  │    ├─ startOffset / endOffset
  │    ├─ kind
  │    ├─ estimatedHeight
  │    └─ render payload/cache key
  └─ block cache

MarkdownVirtualViewport
  ├─ top spacer
  ├─ visible blocks + overscan blocks
  └─ bottom spacer
```

### 6.1 分块规则

1. 不用简单的 `split('\n\n')` 或正则切 Markdown；必须识别 fenced code、列表、blockquote、表格、HTML block 和自定义 box drawing 结构。
2. 以 Markdown AST 的顶层 children 作为初始 block 边界，保留原始 offset 和 source line。
3. 继续复用 `remarkGfm`、`remarkBoxDrawingTables` 和现有源码行映射逻辑。
4. 一个 block 内部保持完整语义，不能把 fenced code 或表格切断。
5. block id 由文档版本、源范围和内容 hash 组成，支持同一文档编辑后复用未变化 block。

### 6.2 虚拟视口

1. 视口外只保留 spacer，不挂载完整 React/DOM 内容。
2. 视口内挂载可见块和上下 overscan 块。
3. 每个 block 用 `ResizeObserver` 回填真实高度，修正 spacer。
4. 首屏默认渲染前几个块，避免等待全部文档解析完成。
5. 源码行定位时，根据 block line range 找到 block；如果尚未挂载，先加入目标 block 的 overscan 范围，再滚动到 block 内部。
6. 预览搜索需要搜索 document model 或缓存文本，不能依赖“所有 DOM 都已存在”。
7. 截图/分享执行临时全量挂载，并等待图片、代码高亮和 Mermaid 完成后再捕获。

### 6.3 依赖选择

第一版先做一个小型 spike，不立即锁定新依赖：

1. 如果现有项目结构足够，使用页面私有 virtual range helper。
2. 如果变高 block、滚动定位和测量复杂，评估 `react-window` 或 `@tanstack/react-virtual`。
3. 新依赖必须先确认 bundle 体积、React 18 兼容性、Electron 构建行为和截图/滚动同步兼容性。
4. 不要把 `react-arborist` 直接当成 Markdown 虚拟列表方案；它解决的是文件树，不解决 Markdown block 的高度、源码定位和 HTML 语义。

## 7. 阶段 3：解析和 DOM 宿主升级（按基准决定）

如果阶段 2 仍被“单次全文解析”限制，再考虑下列两条路线之一。

### 路线 A：Worker 解析

1. Worker 接收 `documentId + version + source + render options`。
2. Worker 只返回可序列化的 block model、source range 和必要的 render payload。
3. 主线程只渲染可见 block，旧版本结果到达时直接丢弃。
4. Worker 不直接访问 `window.electronAPI`，图片、外部链接和文件路径解析仍由 renderer 处理。
5. Mermaid、React component 和 DOM 操作留在主线程，并继续受可见性调度控制。

### 路线 B：独立预览宿主

借鉴 VS Code，将 Markdown 预览放到独立 Webview 或受控 iframe，使用消息传递同步：

1. 主页面负责文件树、编辑器、模式和定位请求。
2. 预览宿主负责 HTML/DOM 渲染、滚动和局部更新。
3. 内容更新使用版本号和增量消息，避免旧结果覆盖新文档。
4. 必须重新审查 CSP、XSS、文件 URL、图片读取、Mermaid SVG、复制和截图能力。

这条路线隔离效果最好，但跨宿主通信和截图复杂度最高，不建议作为第一轮修复。

## 8. 缓存策略

缓存必须按内容版本和渲染选项隔离，不能用“当前文件路径”作为唯一 key。

建议分层：

1. Frontmatter cache：`path + contentHash`。
2. Markdown block model cache：`path + contentHash + parserOptions`。
3. Block render cache：`blockId + theme + featureFlags`。
4. Mermaid cache：`diagramHash + theme`，并复用 in-flight Promise。
5. Image data URL cache：`absolutePath + mtimeMs`，设置 LRU 上限。
6. 预览搜索索引：按 `documentVersion` 失效，不扫描 DOM。

缓存要求：

1. 有容量上限和淘汰策略，不能无限保留大字符串和 SVG。
2. 文件切换、主题切换、MDC/普通 Markdown 模式切换要有明确失效规则。
3. 异步结果必须验证版本，避免快速切换文件时旧 Mermaid、图片或解析结果回写新文件。

## 9. 测试与验收

### 9.1 自动化测试

新增或扩展 `test/renderer` 下的纯逻辑测试：

1. 顶层 block 分割不会切断 fenced code、表格、列表和自定义结构。
2. block 的 source line、offset 和 frontmatter line offset 正确。
3. virtual range 在滚动、overscan、未知高度和目标定位下稳定。
4. 文档版本变化时旧解析结果不会提交。
5. 相同内容和渲染选项命中缓存，主题或内容变化正确失效。
6. 搜索结果不依赖未挂载 DOM。
7. 现有 Markdown URL、Mermaid sanitize、box table 测试继续通过。

### 9.2 手工验收

1. 在 10,000 行以上 Markdown Preview 中点击不同目录和文件，文件树选中反馈不应明显延迟。
2. Split 模式连续输入 100 个字符，编辑器输入不掉帧，预览不会每个字符同步重建。
3. 长文档滚动到 Mermaid、长代码块、大表格时，块能在接近视口时正确渲染。
4. 快速切换两个大 Markdown 文件，旧文件的 Mermaid、图片、源码定位不会污染新文件。
5. Preview 搜索、编辑器/预览滚动同步、源码行 reveal 仍正确。
6. 截图、分享、结构化预览仍能拿到完整内容，不受虚拟化影响。
7. 深色/浅色主题、Windows 本地图片和项目相对链接均正常。

### 9.3 回归命令

本需求是方案文档阶段，不执行 build。实施代码后按改动范围执行：

```text
npm run typecheck
npm test
```

若后续修改代码文件，必须只对本次修改的代码文件执行仓库要求的 Biome format；本计划文档本身不需要 Biome。

## 10. 分阶段交付清单

### P0：测量

1. 建立 Markdown fixture 和性能记录格式。
2. 加入开发模式 performance marks / React Profiler。
3. 输出优化前基线。

### P1：交互止血

1. 抽出 `MarkdownPreviewSurface`。
2. 对预览和文件树增加稳定 memo 边界。
3. Split 模式预览更新防抖 200～300ms。
4. 合并 IntersectionObserver，补齐图片和结构化块的可见性门控。
5. 增加 `content-visibility` 和稳定占位高度。

### P2：大文档虚拟化

1. 建立带 source range 的 Markdown block model。
2. 实现可变高度、overscan、源码定位和搜索适配。
3. 大文档按阈值启用虚拟化，小文档保留当前渲染路径。
4. 补齐截图/分享的全量渲染模式。

### P3：按需升级宿主

1. 如果 P2 基准仍不达标，做 Worker 解析 spike。
2. 对比 Worker 与独立 Webview 的复杂度和收益。
3. 只有在主线程全文解析仍是主要长任务时，才进入宿主升级。

## 11. 不建议采用的单点修复

1. 只把文本切得更碎，但每段仍在同一次 React render 中挂载：不会解决主线程总工作量。
2. 只给最外层组件加 `memo`，但 `markdownPreviewContent` 每次都变化：对内容更新几乎没有帮助。
3. 只使用 `startTransition`：可以改善优先级，但不能降低解析和 DOM 数量。
4. 只增加 `content-visibility`：能减少布局绘制，但不能减少完整 AST 和 React 树。
5. 只关闭语法高亮：对超长代码块有帮助，但普通段落、表格、图片、Mermaid 仍然会卡。
6. 每次文件树展开都刷新 root：会把文件树 I/O 和预览主线程问题叠加，当前已有的 TTL/lazy 策略应继续保留。

## 12. 外部依据

以下资料在 2026-07-15 核查，链接指向官方或项目官方文档/源码：

1. VS Code Markdown token cache：
   https://github.com/microsoft/vscode/blob/main/extensions/markdown-language-features/src/markdownEngine.ts
2. VS Code Markdown 预览刷新、防抖和 Webview 更新：
   https://github.com/microsoft/vscode/blob/main/extensions/markdown-language-features/src/preview/preview.ts
3. VS Code 预览侧使用 `DOMParser` 和 `morphdom` 增量更新：
   https://github.com/microsoft/vscode/blob/main/extensions/markdown-language-features/preview-src/index.ts
4. web.dev：`content-visibility` 和 `contain-intrinsic-size`：
   https://web.dev/articles/content-visibility
5. web.dev：React 长列表虚拟化背景：
   https://web.dev/articles/virtualize-long-lists-react-window
6. React `memo`：
   https://react.dev/reference/react/memo
7. React `useDeferredValue`：
   https://react.dev/reference/react/useDeferredValue
8. React `startTransition`：
   https://react.dev/reference/react/startTransition

## 最终建议

先做 P0 + P1，再用同一批 fixture 对比基线。如果文件树点击延迟明显下降但大文档首屏仍慢，继续做 P2；如果 P2 后仍存在单次全文解析长任务，再考虑 P3。这样可以把当前“所有问题都归因于 Markdown 分段不够”的模糊问题，拆成可测量、可回滚、逐阶段验收的工程任务。
