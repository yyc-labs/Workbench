# Monaco 代码编辑器实施计划（2026-05-24）

## 1. 目标

### 1.1 总体目标
- 在当前 Electron 应用中新增一个项目内代码编辑能力，基于 Monaco Editor。
- 保持现有 Home、Detail、Runtime、Settings 工作流稳定，不把代码编辑能力硬塞进已有拥挤布局。
- 文件系统能力必须通过主进程 IPC 受控暴露，renderer 不直接访问 Node `fs`。
- 首版优先交付可用的轻量代码编辑器，而不是一次性实现完整 IDE。

### 1.2 MVP 交付范围
- 新增独立代码编辑页面：`/project/:projectId/code`。
- 从项目详情页或项目卡片进入代码页。
- 左侧展示项目文件树。
- 中间使用 Monaco Editor 打开和编辑文件。
- 支持保存当前文件。
- 支持 `Ctrl+S` / `Cmd+S` 保存。
- 显示 dirty 状态、当前文件路径、加载/保存错误。
- 跟随应用主题切换 Monaco 明暗主题。
- 默认排除大型目录和构建产物。
- 限制可打开文件大小，避免 renderer 卡死。

### 1.3 非首版范围
- 不做完整 VS Code 级别的项目级 TypeScript 语言服务。
- 不做 Git diff、冲突解决、历史回滚。
- 不做多标签页复杂会话恢复。
- 不做搜索全项目内容。
- 不做 AI 代码生成/编辑闭环。
- 不做 LSP、调试器、插件系统。
- 不允许 renderer 直接调用 Node 文件系统。

---

## 2. 当前项目判断

### 2.1 技术栈
- Electron 42
- React 18
- electron-vite
- Tailwind v4
- Zustand
- React Router MemoryRouter
- xterm.js
- ReactFlow

### 2.2 当前关键文件
| 文件 | 当前作用 | Monaco 改造关系 |
|------|----------|----------------|
| `package.json` | 依赖和脚本 | 增加 `monaco-editor` 依赖 |
| `electron.vite.config.ts` | Electron/Vite 构建配置 | 可能需要配置 Monaco worker 或 chunk |
| `src/core/electron/main/ipc.ts` | IPC channel 常量 | 增加项目文件相关 IPC |
| `src/core/electron/main/index.ts` | 主进程 IPC handler 集中注册 | 增加文件列表/读取/写入 handler |
| `src/core/electron/preload/index.ts` | 安全桥接 API | 暴露受控文件 API |
| `src/core/shared/types.ts` | shared 类型 | 增加文件树、文件内容、保存结果类型 |
| `src/core/renderer/App.tsx` | 路由入口 | 增加 `/project/:projectId/code` |
| `src/core/renderer/pages/Detail.tsx` | 项目详情页 | 增加 Code 入口，不重构主体布局 |
| `src/core/renderer/styles/global.css` | 全局主题/CSS 变量 | 增加 Monaco 容器补充样式 |

### 2.3 当前布局风险
- `Detail.tsx` 当前主体是两栏布局，最小宽度约 `1060px`。
- 左侧是 AI Commit 流程，右侧是 Workspace/Documentation。
- 如果直接把 Monaco 放进详情页，会产生三个问题：
  - Monaco 编辑区高度和宽度不足。
  - 现有 AI Commit 和文档区域会被挤压。
  - 后续扩展文件树、状态栏、快捷键会让详情页复杂度失控。

### 2.4 推荐布局结论
- 新增独立 `CodePage`。
- 详情页只增加一个轻量入口按钮。
- 后续如果体验稳定，再考虑在详情页做右侧 tab 或 split view。

---

## 3. 依赖准备

### 3.1 用户提前安装
在项目根目录执行：

```bash
cd /mnt/d/tools/ide-electron
npm i monaco-editor
```

### 3.2 暂不安装的依赖
- 暂不安装 `@monaco-editor/react`。
- 原因：
  - 当前项目是 Electron + Vite，直接控制 `monaco-editor` 的 worker 更稳。
  - 首版组件不复杂，直接封装成本低。
  - 避免 wrapper 抽象影响后续 Electron worker/debug 定位。

### 3.3 分支建议
建议新建分支：

```bash
git checkout -b feat/monaco-code-editor
```

---

## 4. 总体架构

### 4.1 模块分层
```text
renderer CodePage
  -> preload electronAPI
    -> main IPC handlers
      -> main project-file-service
        -> fs/path
```

### 4.2 设计原则
- renderer 只知道 `projectId`、相对路径、文件内容。
- main 进程负责把相对路径解析为真实磁盘路径。
- main 进程必须校验目标路径在项目根目录内。
- main 进程必须限制目录遍历、文件大小、二进制文件打开。
- shared types 统一声明返回结构，避免 renderer 里到处写 `unknown as`。
- Monaco 只在进入代码页时加载，避免影响首页首屏性能。

### 4.3 新增页面结构
```text
CodePage
├─ Header
│  ├─ Back
│  ├─ Project name/path
│  ├─ Current file relative path
│  ├─ Dirty indicator
│  └─ Save button
├─ Body
│  ├─ CodeFileTree
│  └─ MonacoCodeEditor
└─ StatusBar
   ├─ Language
   ├─ Encoding
   ├─ Size
   └─ Error/status message
```

---

## 5. 数据结构设计

### 5.1 新增 shared 类型
目标文件：`src/core/shared/types.ts`

建议新增：

```typescript
export type ProjectFileNodeKind = 'file' | 'directory'

export interface ProjectFileNode {
  name: string
  relativePath: string
  kind: ProjectFileNodeKind
  children?: ProjectFileNode[]
}

export interface ProjectFileTreeResult {
  rootPath: string
  nodes: ProjectFileNode[]
  skipped: {
    directories: number
    files: number
  }
}

export interface ProjectFileReadResult {
  relativePath: string
  content: string
  size: number
  mtimeMs: number
  language: string
  encoding: 'utf-8'
}

export interface ProjectFileWriteResult {
  relativePath: string
  size: number
  mtimeMs: number
}
```

### 5.2 API 输入约束
- `projectPath`: 只从已登记项目对象中取得，不允许用户随意输入。
- `relativePath`: renderer 只能传相对路径。
- 禁止绝对路径作为 `relativePath`。
- 禁止空路径读取文件。
- 禁止 `..` 越权。
- 禁止路径解析后离开项目根目录。

---

## 6. IPC 设计

### 6.1 新增 IPC channel
目标文件：`src/core/electron/main/ipc.ts`

建议新增：

```typescript
PROJECT_FILE_TREE: 'project-file:tree',
PROJECT_FILE_READ: 'project-file:read',
PROJECT_FILE_WRITE: 'project-file:write',
```

### 6.2 preload API
目标文件：`src/core/electron/preload/index.ts`

建议新增：

```typescript
listProjectFiles: (projectPath: string) =>
  ipcRenderer.invoke(IPC.PROJECT_FILE_TREE, projectPath),

readProjectFile: (projectPath: string, relativePath: string) =>
  ipcRenderer.invoke(IPC.PROJECT_FILE_READ, projectPath, relativePath),

writeProjectFile: (projectPath: string, relativePath: string, content: string, expectedMtimeMs?: number) =>
  ipcRenderer.invoke(IPC.PROJECT_FILE_WRITE, projectPath, relativePath, content, expectedMtimeMs),
```

### 6.3 renderer 类型声明
目标文件：`src/core/renderer/stores/appStore.types.ts`

需要给 `Window.electronAPI` 增加类型，避免页面里使用临时 `unknown as`。

### 6.4 主进程 handler
目标文件：`src/core/electron/main/index.ts`

建议保持 `index.ts` handler 注册薄一些，文件操作逻辑放到单独 service：

新增文件：
`src/core/electron/main/project-file-service.ts`

`index.ts` 只做：

```typescript
ipcMain.handle(IPC.PROJECT_FILE_TREE, (_event, projectPath: string) => {
  return listProjectFiles(projectPath)
})
```

---

## 7. 文件系统安全策略

### 7.1 路径边界
必须使用 `resolve` 和 `realpath` 双重校验：
- `projectRoot = realpath(projectPath)`
- `target = realpath(resolve(projectRoot, relativePath))`
- 允许：
  - `target === projectRoot`
  - `target.startsWith(projectRoot + path.sep)`
- 禁止：
  - `relativePath` 是绝对路径
  - `relativePath` 包含越权段
  - symlink 指向项目根目录外

### 7.2 排除目录
首版默认排除：
- `.git`
- `node_modules`
- `dist`
- `build`
- `out`
- `.next`
- `.nuxt`
- `.turbo`
- `.cache`
- `coverage`
- `.venv`
- `venv`
- `__pycache__`

### 7.3 排除文件
默认排除：
- `.DS_Store`
- `Thumbs.db`
- lock 文件可以展示但不建议默认打开大 lock 文件
- 大于限制的文件不允许打开
- 二进制文件不允许打开

### 7.4 文件大小限制
建议首版：
- 文件树扫描单文件 metadata 不读内容。
- 打开文件上限：`1MB`。
- 可配置常量：`MAX_TEXT_FILE_SIZE = 1024 * 1024`。
- 如果后续需要编辑大文件，再加只读模式或分块读取。

### 7.5 二进制判断
首版简单判断：
- 读取前按扩展名过滤明显二进制。
- 读取前检查前 `8KB` 是否包含 `\0`。
- 命中二进制则返回明确错误。

### 7.6 写入冲突检测
建议 `writeProjectFile` 支持 `expectedMtimeMs`：
- renderer 读取文件时记录 `mtimeMs`。
- 保存时传回 `expectedMtimeMs`。
- main 进程保存前检查当前文件 `mtimeMs` 是否变化。
- 如果变化，拒绝保存并提示“文件已被外部修改”。

首版如果为了速度可以先实现检测但不做复杂 merge。

### 7.7 写入方式
建议：
- 首版使用 `writeFile` 写 UTF-8 文本。
- 保存后重新 `stat` 返回新 `mtimeMs`。
- 后续如果需要更强一致性，再改成 temp file + rename。

---

## 8. Monaco 集成方案

### 8.1 组件拆分
新增目录：
`src/core/renderer/pages/code/`

建议文件：
| 文件 | 作用 |
|------|------|
| `CodePage.tsx` | 页面容器，状态协调 |
| `CodeFileTree.tsx` | 文件树展示与选择 |
| `MonacoCodeEditor.tsx` | Monaco 封装 |
| `code.helpers.ts` | 语言推断、树排序、快捷键辅助 |
| `code.types.ts` | renderer 局部 UI 类型 |

### 8.2 Monaco 加载方式
在 `MonacoCodeEditor.tsx` 里动态 import：

```typescript
const monaco = await import('monaco-editor')
```

优势：
- 首页不加载 Monaco。
- Runtime/Settings/Detail 不被 Monaco bundle 影响。
- CodePage 首次进入时再付出加载成本。

### 8.3 Worker 配置
Vite 下通常需要显式配置 Monaco workers。

建议在 renderer 入口或 Monaco 组件初始化前配置：

```typescript
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import JsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker'
import CssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker'
import HtmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker'
import TsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker'
```

然后设置：

```typescript
self.MonacoEnvironment = {
  getWorker(_workerId, label) {
    if (label === 'json') return new JsonWorker()
    if (label === 'css' || label === 'scss' || label === 'less') return new CssWorker()
    if (label === 'html' || label === 'handlebars' || label === 'razor') return new HtmlWorker()
    if (label === 'typescript' || label === 'javascript') return new TsWorker()
    return new EditorWorker()
  },
}
```

注意：
- 类型上可能需要给 `self.MonacoEnvironment` 补声明。
- 如果 electron-vite 对 worker 打包有特殊行为，优先在最小 demo 下验证。

### 8.4 主题适配
根据 `document.documentElement.getAttribute('data-theme')`：
- light -> `vs`
- dark -> `vs-dark`

首版可以用 Monaco 内置主题。
后续可以用 `monaco.editor.defineTheme` 映射当前 CSS 变量。

### 8.5 编辑器配置建议
```typescript
{
  automaticLayout: true,
  minimap: { enabled: false },
  fontFamily: "'JetBrains Mono', 'SFMono-Regular', Menlo, Monaco, Consolas, monospace",
  fontSize: 13,
  lineHeight: 20,
  tabSize: 2,
  scrollBeyondLastLine: false,
  smoothScrolling: true,
  renderWhitespace: 'selection',
  bracketPairColorization: { enabled: true },
  padding: { top: 14, bottom: 14 },
}
```

### 8.6 快捷键
必须支持：
- `Ctrl+S` Windows/Linux 保存。
- `Cmd+S` macOS 保存。

建议在 Monaco 内注册：

```typescript
editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
  onSave()
})
```

同时在页面级别拦截浏览器默认保存行为作为兜底。

---

## 9. CodePage 状态设计

### 9.1 页面状态
```typescript
type LoadStatus = 'idle' | 'loading' | 'ready' | 'error'
type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'
```

建议状态：
- `treeStatus`
- `treeError`
- `fileTree`
- `activeRelativePath`
- `activeFile`
- `editorValue`
- `lastSavedValue`
- `isDirty`
- `readError`
- `saveStatus`
- `saveError`

### 9.2 dirty 判断
```typescript
const isDirty = editorValue !== lastSavedValue
```

### 9.3 切换文件策略
首版建议：
- 如果当前文件 dirty，切换文件前弹 `window.confirm`。
- 选择“取消”则留在当前文件。
- 选择“继续”则丢弃未保存改动。

后续可以做自定义弹窗和多标签缓存。

### 9.4 保存策略
保存成功后：
- `lastSavedValue = editorValue`
- 更新 `mtimeMs`
- `saveStatus = saved`
- 短暂显示 “Saved”

保存失败：
- 保留 dirty 内容。
- 显示错误。
- 不覆盖 `lastSavedValue`。

---

## 10. 文件树设计

### 10.1 排序规则
- 目录在前，文件在后。
- 同类按 `name.localeCompare` 排序。
- 隐藏目录不特殊置顶。

### 10.2 展开策略
首版：
- 根目录默认展开。
- 一级目录默认展开可以视项目规模决定。
- 点击目录展开/收起。
- 点击文件打开。

### 10.3 样式
遵循现有 UI：
- 使用 `surface-card`。
- 使用 CSS 变量，不硬编码大面积颜色。
- 文件树窄栏建议宽度 `280px` 到 `340px`。
- 编辑器区域用圆角卡片包住。

### 10.4 图标
使用现有 `lucide-react`：
- `Folder`
- `FolderOpen`
- `FileText`
- `ChevronRight`
- `ChevronDown`
- `Save`
- `Code2`

不新增图标依赖。

---

## 11. 路由和入口

### 11.1 新增路由
目标文件：`src/core/renderer/App.tsx`

```tsx
<Route path="/project/:projectId/code" element={<CodePage />} />
```

### 11.2 Detail 入口
目标文件：`src/core/renderer/pages/Detail.tsx`

在 header action 区增加：
- `Code` 按钮
- 点击 `navigate(`/project/${projectId}/code`)`

按钮位置建议：
- 放在 `Run` 和 `AI Auto Commit` 左侧或右侧。
- 不改变现有主布局。

### 11.3 项目卡片入口
首版可选。

如果加：
- 目标文件：`src/core/renderer/components/ProjectCard.tsx`
- 在上下文菜单中增加 `Open Code Editor`。
- 不建议直接在卡片主按钮增加，避免卡片操作拥挤。

---

## 12. 实施任务拆分

## M0：准备工作

### Task 0.1 新建分支
```bash
git status --short
git checkout -b feat/monaco-code-editor
```

验收：
- `git branch --show-current` 输出 `feat/monaco-code-editor`。
- 无未确认的不相关变更。

### Task 0.2 安装依赖
```bash
npm i monaco-editor
```

验收：
- `package.json` 出现 `monaco-editor`。
- `package-lock.json` 更新。
- `npm run typecheck` 至少不因为依赖缺失失败。

---

## M1：主进程文件服务

### Task 1.1 增加 shared 类型
文件：
- `src/core/shared/types.ts`

动作：
- 增加 `ProjectFileNode` 等类型。

验收：
- TypeScript 能引用这些类型。

### Task 1.2 增加 IPC 常量
文件：
- `src/core/electron/main/ipc.ts`

动作：
- 增加 `PROJECT_FILE_TREE`
- 增加 `PROJECT_FILE_READ`
- 增加 `PROJECT_FILE_WRITE`

验收：
- preload/main 都能从同一处引用常量。

### Task 1.3 新建 project-file-service
文件：
- `src/core/electron/main/project-file-service.ts`

动作：
- 实现 `listProjectFiles(projectPath)`
- 实现 `readProjectFile(projectPath, relativePath)`
- 实现 `writeProjectFile(projectPath, relativePath, content, expectedMtimeMs?)`
- 实现路径安全校验。
- 实现排除目录。
- 实现文件大小限制。
- 实现二进制检测。

验收：
- 能读取普通文本文件。
- 不能读取项目外文件。
- 不能打开大文件。
- 不能打开二进制文件。
- 不能通过 symlink 跳出项目根目录。

### Task 1.4 注册 IPC handler
文件：
- `src/core/electron/main/index.ts`

动作：
- 导入 service 方法。
- 注册三个 handler。
- handler 中捕获错误并返回合理错误，或让 invoke reject 由 renderer 捕获。

验收：
- preload 调用能到达 main。
- 失败时 renderer 能拿到错误消息。

---

## M2：preload 和 renderer API 类型

### Task 2.1 增加 preload 方法
文件：
- `src/core/electron/preload/index.ts`

动作：
- 暴露 `listProjectFiles`
- 暴露 `readProjectFile`
- 暴露 `writeProjectFile`

验收：
- `window.electronAPI.listProjectFiles` 存在。

### Task 2.2 增加 renderer Window 类型
文件：
- `src/core/renderer/stores/appStore.types.ts`

动作：
- 增加三项 API 类型。
- 引入 shared 返回类型。

验收：
- CodePage 不需要写 `unknown as`。

---

## M3：Monaco 基础组件

### Task 3.1 新建 code 目录
文件：
- `src/core/renderer/pages/code/CodePage.tsx`
- `src/core/renderer/pages/code/CodeFileTree.tsx`
- `src/core/renderer/pages/code/MonacoCodeEditor.tsx`
- `src/core/renderer/pages/code/code.helpers.ts`
- `src/core/renderer/pages/code/code.types.ts`

验收：
- 文件结构清晰，页面逻辑和 Monaco 初始化分离。

### Task 3.2 实现 Monaco worker 配置
文件：
- `src/core/renderer/pages/code/MonacoCodeEditor.tsx`
- 或 `src/core/renderer/pages/code/monacoEnvironment.ts`

动作：
- 引入 worker。
- 设置 `self.MonacoEnvironment`。

验收：
- 打开 TS/JS/JSON/CSS/HTML 文件没有 worker 报错。

### Task 3.3 实现 MonacoCodeEditor
动作：
- 创建 editor。
- 接收 `value`、`language`、`theme`、`onChange`、`onSave`。
- 在 unmount 时 dispose editor 和 model。
- 文件变化时更新 model。

验收：
- 打开文件显示内容。
- 编辑内容触发 dirty。
- 切换文件不会泄漏旧 model。
- `Ctrl+S` 调用保存。

### Task 3.4 语言推断
文件：
- `code.helpers.ts`

建议映射：
| 扩展名 | Monaco language |
|--------|------------------|
| `.ts` | `typescript` |
| `.tsx` | `typescript` |
| `.js` | `javascript` |
| `.jsx` | `javascript` |
| `.json` | `json` |
| `.css` | `css` |
| `.scss` | `scss` |
| `.html` | `html` |
| `.md` | `markdown` |
| `.py` | `python` |
| `.go` | `go` |
| `.rs` | `rust` |
| `.java` | `java` |
| `.kt` | `kotlin` |
| `.yml` / `.yaml` | `yaml` |
| default | `plaintext` |

验收：
- 常见项目文件有基础语法高亮。

---

## M4：CodePage 页面实现

### Task 4.1 页面骨架
文件：
- `src/core/renderer/pages/code/CodePage.tsx`

动作：
- 读取 `projectId`。
- 从 store 查找项目。
- 不存在时显示错误并可返回 Home。
- 顶部显示项目名和路径。

验收：
- `/project/:projectId/code` 可打开。
- 不存在项目时不崩溃。

### Task 4.2 加载文件树
动作：
- 页面 mount 后调用 `window.electronAPI.listProjectFiles(project.path)`。
- loading/error/empty 状态完整。

验收：
- 能看到项目文件树。
- 排除目录不展示。
- 错误信息可读。

### Task 4.3 打开文件
动作：
- 点击文件调用 `readProjectFile`。
- 设置 active file。
- 设置 editor value。
- 设置 `lastSavedValue`。

验收：
- 点击文件后 Monaco 显示内容。
- 当前文件高亮。
- 顶部显示相对路径。

### Task 4.4 保存文件
动作：
- 保存按钮调用 `writeProjectFile`。
- Monaco 快捷键保存。
- 保存成功更新 `mtimeMs`。
- 保存失败显示错误。

验收：
- 修改文件后 dirty 状态出现。
- 保存后 dirty 状态消失。
- 磁盘文件实际更新。

### Task 4.5 切换 dirty 文件
动作：
- dirty 时切换文件弹确认。
- 取消后保持当前文件。
- 继续后丢弃未保存内容。

验收：
- 不会无声丢失编辑内容。

---

## M5：路由和入口

### Task 5.1 增加路由
文件：
- `src/core/renderer/App.tsx`

动作：
- import `CodePage`
- 添加 route

验收：
- 直接导航到 `/project/:projectId/code` 正常。

### Task 5.2 Detail 增加 Code 按钮
文件：
- `src/core/renderer/pages/Detail.tsx`

动作：
- 引入 `Code2` 图标。
- header action 区增加按钮。
- 点击进入 CodePage。

验收：
- 详情页可进入代码编辑器。
- 返回按钮可回到详情页或首页。

### Task 5.3 可选：ProjectCard 上下文菜单入口
文件：
- `src/core/renderer/components/ProjectCard.tsx`
- `src/core/renderer/components/CardContextMenu.tsx`

动作：
- 增加 `Open Code Editor` 菜单项。

验收：
- 不影响现有打开文件夹、打开 VS Code、运行等操作。

---

## M6：样式和体验打磨

### Task 6.1 CodePage 视觉样式
目标：
- 与现有 Apple-like `surface-card` 风格一致。
- 不大面积使用硬编码颜色。
- 编辑器外层使用圆角容器。
- 文件树和编辑器之间间距清晰。

验收：
- Light/Dark 都可读。
- Monaco 区域高度随窗口变化。
- 小屏至少不崩，必要时横向滚动。

### Task 6.2 状态栏
展示：
- 当前语言
- 文件大小
- 保存状态
- 错误信息

验收：
- 用户能判断当前是否已保存。

### Task 6.3 主题同步
动作：
- 监听 `data-theme` 或从 store 读取 `config.theme`。
- 切换时调用 `monaco.editor.setTheme`。

验收：
- 设置页切换主题后 Monaco 主题同步。

---

## M7：验证

### Task 7.1 Typecheck
```bash
npm run typecheck
```

验收：
- 无 TypeScript 错误。

### Task 7.2 Build
```bash
npm run build
```

验收：
- electron-vite 构建成功。
- Monaco worker 没有构建错误。

### Task 7.3 手动 smoke test
测试项目：
- 当前项目 `/mnt/d/tools/ide-electron`
- 一个小型 Vite/React 项目
- 一个 Python 项目

检查项：
- 能进入 CodePage。
- 文件树能加载。
- `.git`、`node_modules`、`out` 不出现。
- 能打开 `.ts`、`.tsx`、`.json`、`.css`、`.md`。
- 大文件被拒绝且提示明确。
- 二进制文件被拒绝且提示明确。
- 修改并保存文件成功。
- dirty 切换文件有确认。
- 主题切换后 Monaco 跟随。
- 回到 Detail 后原有 Run / AI Commit 不受影响。

### Task 7.4 安全回归
需要验证的攻击路径：
- `../package.json`
- `/etc/passwd`
- Windows 绝对路径，如 `C:\Windows\win.ini`
- WSL/Linux 绝对路径，如 `/etc/passwd`
- symlink 指向项目外文件

验收：
- 全部被拒绝。

---

## 13. 风险清单

### 13.1 Monaco worker 打包风险
风险：
- Vite worker 引入方式不正确导致编辑器能打开但语言服务报错。

缓解：
- 独立封装 `monacoEnvironment.ts`。
- 先验证 `npm run build`。
- 如果 worker 在 Electron file 协议下异常，再调整为 `?worker` 方式或 `vite-plugin-monaco-editor`。

### 13.2 文件读写安全风险
风险：
- 路径越权导致可读取/写入项目外文件。

缓解：
- `realpath` 校验项目根和目标文件。
- renderer 只传相对路径。
- symlink 指向项目外时拒绝。
- 写入同样使用和读取一致的校验。

### 13.3 大项目扫描性能风险
风险：
- 文件树递归扫描大仓库导致主进程阻塞。

缓解：
- 排除大型目录。
- 限制最大扫描文件数量，如 `5000`。
- 达到上限后返回 `skipped` 信息。
- 后续可改懒加载目录。

首版建议常量：
```typescript
const MAX_TREE_FILES = 5000
const MAX_TREE_DEPTH = 8
```

### 13.4 编辑内容丢失风险
风险：
- 切换文件、离开页面、保存失败时丢内容。

缓解：
- dirty 切换确认。
- 保存失败保留 editor value。
- 页面离开前可加确认。

### 13.5 与现有功能耦合风险
风险：
- 修改 `Detail.tsx` 过多影响 AI Commit。

缓解：
- Detail 只加入口按钮。
- CodePage 独立实现。

---

## 14. 回滚策略

如果 Monaco 接入产生构建或运行问题，可以按层回滚：

### 14.1 UI 回滚
- 移除 `App.tsx` 新路由。
- 移除 `Detail.tsx` Code 入口。
- 保留主进程 IPC 不影响现有功能。

### 14.2 Monaco 回滚
- 删除 `src/core/renderer/pages/code/`。
- 移除 `monaco-editor` 依赖。
- 运行 `npm i` 更新 lock。

### 14.3 IPC 回滚
- 移除 `ipc.ts` 新 channel。
- 移除 preload 新 API。
- 移除 main handler 和 `project-file-service.ts`。

---

## 15. 建议提交拆分

建议按以下 commits 拆，方便 review 和回滚：

### Commit 1
```bash
git add package.json package-lock.json
git commit -m "chore: add monaco editor dependency"
```

### Commit 2
```bash
git add src/core/shared/types.ts src/core/electron/main/ipc.ts src/core/electron/main/project-file-service.ts src/core/electron/main/index.ts
git commit -m "feat: add guarded project file IPC"
```

### Commit 3
```bash
git add src/core/electron/preload/index.ts src/core/renderer/stores/appStore.types.ts
git commit -m "feat: expose project file APIs to renderer"
```

### Commit 4
```bash
git add src/core/renderer/pages/code
git commit -m "feat: add monaco code editor page"
```

### Commit 5
```bash
git add src/core/renderer/App.tsx src/core/renderer/pages/Detail.tsx src/core/renderer/styles/global.css
git commit -m "feat: add code editor route and project entry"
```

### Commit 6
```bash
git add .
git commit -m "test: verify monaco editor integration"
```

---

## 16. 最小验收标准

首版完成后必须满足：
- `npm run typecheck` 通过。
- `npm run build` 通过。
- 详情页可以进入代码页。
- 文件树可以加载当前项目。
- Monaco 可以打开并编辑普通文本代码文件。
- `Ctrl+S` / `Cmd+S` 可以保存。
- dirty 状态准确。
- 路径越权被拒绝。
- 大文件/二进制文件被拒绝。
- Light/Dark 主题下可用。
- Home、Detail、Runtime、Settings 原有核心功能不被破坏。

---

## 17. 后续迭代方向

### P1：编辑体验
- 多标签页。
- 最近打开文件。
- 文件搜索。
- 命令面板。
- 自定义 Monaco theme。
- 格式化入口。

### P2：项目级智能能力
- TypeScript project service。
- ESLint/diagnostics。
- LSP 支持。
- 终端和编辑器 split layout。

### P3：AI 工作流
- 选中代码解释。
- 选中代码重写。
- 基于 diff 的 AI 修改确认。
- AI 修改后自动运行 typecheck/test。

