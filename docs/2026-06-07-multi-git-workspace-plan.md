# 多 Git 工作区管理方案（2026-06-07）

## 1. 目标与边界

### 1.1 目标

- 支持一个工作区内存在多个 Git 仓库，例如主项目、前端、后端分别有自己的 `.git`。
- Git 面板先轻量展示仓库列表，用户切换到某个仓库后再刷新该仓库详情。
- 每个仓库独立展示分支、变更、提交记录、diff、stash 等信息，避免状态混在一起。
- Git 操作始终绑定到明确的 `repoRoot`，不依赖当前终端目录或 UI 隐式状态。

### 1.2 非目标

- 不在首版强制支持 `git submodule` 管理流程，例如 init、update、sync、deinit。
- 不在首版做多个仓库的一键提交、一键推送、一键切分支。
- 不让主仓和子仓同时管理同一批源码文件。
- 不在启动时计算所有仓库的完整状态、diff、log。

## 2. 推荐项目形态

推荐支持这种结构：

```text
project/
  .git/              # 主仓，可选
  frontend/
    .git/            # 前端仓
  backend/
    .git/            # 后端仓
```

也支持没有主仓的并列多仓：

```text
workspace/
  frontend/
    .git/
  backend/
    .git/
  docs/
    .git/
```

关键规则：

- 一个文件的 Git 归属以“离它最近的 Git 根目录”为准。
- 如果存在嵌套仓库，子仓源码默认由子仓管理。
- 主仓可以管理公共文档、脚本、配置，也可以把子仓目录作为 submodule，但不建议把子仓源码再次纳入主仓普通文件跟踪。

## 3. 总体设计

Git 能力拆成两层：

1. 仓库列表层：启动时轻量发现仓库，只显示名称、路径、是否嵌套、加载状态。
2. 仓库详情层：用户选中仓库后，才加载分支、变更、提交、diff 等重信息。

首屏只做仓库发现：

```text
Git 仓库
  project      未加载
  frontend     未加载
  backend      未加载
```

用户点击 `frontend` 后：

```text
Git 仓库
  project      未加载
> frontend     main · 3 changes
  backend      未加载
```

## 4. 数据模型草案

### 4.1 仓库摘要

```ts
export type GitRepoSummary = {
  id: string
  name: string
  rootPath: string
  relativePath: string
  isNested: boolean
  parentRepoId?: string
  gitDirPath?: string
  loadState: 'unloaded' | 'loading' | 'loaded' | 'dirty' | 'error'
  errorMessage?: string
}
```

用途：

- 仓库列表渲染。
- 仓库切换。
- 文件路径归属判断。
- 文件变更时标记仓库为 `dirty`。

### 4.2 仓库详情

```ts
export type GitRepoDetail = {
  repoId: string
  rootPath: string
  branch: string
  upstream?: string
  ahead?: number
  behind?: number
  changes: GitChangeItem[]
  remotes: GitRemote[]
  lastCommit?: GitCommitSummary
  refreshedAt: number
}
```

用途：

- 当前仓库 Git 面板展示。
- 当前仓库变更列表。
- 当前仓库提交记录入口。

### 4.3 变更项

```ts
export type GitChangeItem = {
  filePath: string
  relativePath: string
  status: string
  staged: boolean
  unstaged: boolean
}
```

首版可以基于 `git status --porcelain=v1 -b` 解析，后续再扩展 rename、conflict、submodule 状态。

## 5. 仓库发现策略

### 5.1 扫描范围

启动时从当前 workspace root 开始递归扫描 `.git`：

- 识别 `.git/` 目录。
- 识别 `.git` 文件，兼容 worktree 和 submodule 的 gitdir 指针。
- 默认限制扫描深度，例如 `6` 层。
- 默认限制最大仓库数，例如 `50` 个，超过后提示用户缩小工作区或手动添加。

### 5.2 跳过目录

扫描时必须跳过：

```text
.git
node_modules
dist
build
out
coverage
.next
.nuxt
.vite
.cache
.venv
venv
target
vendor
__pycache__
```

后续可以把跳过规则做成设置项。

### 5.3 排序规则

仓库列表按路径层级和路径名排序：

1. 工作区根仓优先。
2. 浅层仓库优先。
3. 同层按 `relativePath` 字典序。

示例：

```text
project
frontend
backend
packages/ui
packages/server
```

## 6. 切换与刷新策略

### 6.1 启动阶段

只执行：

- 扫描仓库。
- 生成 `GitRepoSummary[]`。
- 渲染仓库列表。

禁止执行：

- `git status`
- `git log`
- `git diff`
- `git stash list`
- 对所有仓库读取 remote 详情

### 6.2 切换仓库

用户选中仓库后才执行：

```bash
git -C <repoRoot> branch --show-current
git -C <repoRoot> status --porcelain=v1 -b
```

按需再执行：

```bash
git -C <repoRoot> remote -v
git -C <repoRoot> log --oneline --decorate -n 50
git -C <repoRoot> diff -- <file>
git -C <repoRoot> diff --cached -- <file>
```

### 6.3 防止旧请求覆盖新状态

每次刷新生成一个 `requestId`：

- 当前选中仓库变化后，旧请求结果直接丢弃。
- 同一仓库连续刷新时，只接受最后一次请求结果。
- Git 命令失败只影响当前仓库，不影响仓库列表和其他仓库。

## 7. 文件监听策略

文件变化时不立即刷新所有仓库。

流程：

1. 根据变化文件路径找到最近的 `repoRoot`。
2. 将该仓库标记为 `dirty`。
3. 如果该仓库是当前选中仓库，等待 `500-1000ms` debounce 后刷新。
4. 如果该仓库不是当前选中仓库，只在列表上显示“可能有变更”，等用户切换过去再刷新。

监听时跳过：

```text
.git/objects
.git/logs
node_modules
dist
build
coverage
```

## 8. Git 命令执行边界

所有 Git 命令都应在主进程执行，渲染层只发 IPC 请求。

建议 IPC 能力：

```ts
git:listRepositories(workspaceRoot): Promise<GitRepoSummary[]>
git:getRepositoryDetail(repoRoot): Promise<GitRepoDetail>
git:getRepositoryLog(repoRoot, limit): Promise<GitCommitSummary[]>
git:getFileDiff(repoRoot, filePath, options): Promise<string>
git:stageFiles(repoRoot, filePaths): Promise<void>
git:unstageFiles(repoRoot, filePaths): Promise<void>
git:discardFiles(repoRoot, filePaths): Promise<void>
```

约束：

- 所有接口必须校验 `repoRoot` 位于当前 workspace 内。
- 所有文件路径必须校验位于对应 `repoRoot` 内。
- 禁止渲染层拼接任意 Git 命令。
- Git 操作错误要携带 `repoRoot`、命令类型、简短错误信息，方便 UI 定位。

## 9. UI 交互方案

### 9.1 仓库选择器

Git 面板顶部提供仓库选择器：

```text
[ project ▼ ]  main · 2 changes
```

展开后：

```text
project        根仓库    main · 2 changes
frontend       子仓库    未加载
backend        子仓库    dirty
```

### 9.2 状态标签

建议使用这些状态：

- `未加载`：已发现仓库，但还没读取详情。
- `加载中`：正在执行该仓库 Git 命令。
- `dirty`：文件监听发现可能变化，但尚未刷新。
- `错误`：该仓库 Git 命令失败。
- `N changes`：已加载详情后的变更数量。

### 9.3 文件级 Git 操作

在文件树或编辑器中执行 Git 操作时：

- 优先用文件路径查找最近 `repoRoot`。
- 如果文件不属于任何仓库，禁用 Git 操作。
- 如果当前 Git 面板选中仓库和文件所属仓库不同，操作前显示明确提示。

示例：

```text
当前文件属于 frontend 仓库，Git 面板当前选中 project。
是否切换到 frontend 后继续操作？
```

## 10. 性能预算

### 10.1 首屏预算

目标：

- 10 个仓库：仓库列表发现应在 `300ms-1000ms` 内完成。
- 不因某个仓库 Git 状态慢而拖慢首屏。
- Git 面板打开时先显示仓库列表，再异步加载选中仓库详情。

### 10.2 并发限制

建议：

- 仓库详情刷新并发：`1`。
- diff/log 并发：最多 `2`。
- 同一仓库同类请求只保留最后一次。

原因：

- 多个 `git status` 同时执行容易打满磁盘 IO。
- Electron 主进程需要避免被大量 Git 子进程拖慢。
- 用户通常只关注当前选中的一个仓库。

### 10.3 缓存策略

- `GitRepoSummary[]`：workspace 未变化时长期缓存。
- `GitRepoDetail`：按 `repoRoot` 缓存，用户切走再切回时先显示旧数据，再后台刷新。
- `Git log`：按 `repoRoot + limit` 缓存，打开提交记录面板后再刷新。
- `Diff`：不长期缓存，按文件打开时加载。

## 11. 风险与处理

### 11.1 嵌套仓库状态误解

风险：用户以为主仓能直接看到子仓内部所有文件变更。

处理：

- UI 明确标注子仓库。
- 主仓视角下对子仓目录显示“子仓库”状态。
- 子仓内部变更只在子仓视角展示。

### 11.2 仓库数量过多

风险：扫描和监听成本上升。

处理：

- 默认最大仓库数限制。
- 超过阈值后只展示前 N 个，并提示配置 include/exclude。
- 支持手动添加或隐藏仓库。

### 11.3 Git 命令卡住

风险：某个仓库异常导致 Git 命令长时间不返回。

处理：

- 给 Git 命令设置超时，例如 `10s`。
- 单仓库失败不影响其他仓库。
- UI 显示错误状态和重试入口。

### 11.4 文件归属判断错误

风险：嵌套仓库、worktree、submodule 导致文件归属判断不准。

处理：

- 仓库发现时同时记录 `.git` 文件和实际 gitdir。
- 文件归属以最近的 `rootPath` 为准。
- 如果 Git 命令返回路径不属于该仓库，丢弃并记录错误。

## 12. 分阶段落地

### Phase 1：仓库发现与切换

- 扫描工作区内 Git 仓库。
- Git 面板展示仓库列表。
- 支持切换当前仓库。
- 切换后加载当前仓库 branch 和 status。
- 只支持当前仓库的变更列表展示。

验收：

- 一个工作区内存在主仓、前端仓、后端仓时，能识别 3 个仓库。
- 启动时不执行所有仓库 `git status`。
- 切换仓库后只刷新被选中的仓库。

### Phase 2：文件归属与 dirty 标记

- 根据文件路径查找最近仓库。
- 文件变化时只标记对应仓库 `dirty`。
- 当前仓库 dirty 后 debounce 刷新。
- 非当前仓库 dirty 只在列表标记，不主动刷新。

验收：

- 修改 `frontend/src/App.tsx` 只影响 `frontend` 仓库状态。
- 修改 `backend/main.go` 只影响 `backend` 仓库状态。
- 当前选中 `project` 时，子仓变化不会触发 `project` 全量刷新。

### Phase 3：详情能力补齐

- 当前仓库提交记录。
- 当前仓库文件 diff。
- 当前仓库 stage / unstage。
- 当前仓库 discard。
- 当前仓库 remote 展示。

验收：

- Git 操作全部带明确 `repoRoot`。
- 切换仓库时不会把旧仓库 diff 或 status 显示到新仓库。
- 某个仓库 Git 命令失败时，其他仓库仍可使用。

### Phase 4：高级能力

- 手动隐藏仓库。
- 手动添加仓库。
- 仓库 include/exclude 配置。
- submodule 状态增强展示。
- 多仓库汇总视图。

首版不建议做多仓库批量操作，等基础模型稳定后再评估。

## 13. 推荐首版实现范围

首版只做最小闭环：

1. 发现多个 Git 仓库。
2. 列表展示仓库。
3. 用户切换仓库。
4. 切换后刷新当前仓库状态。
5. 当前仓库展示变更文件。

暂不做：

- 多仓库统一提交。
- 多仓库统一 push/pull。
- 子模块完整生命周期管理。
- 全局 Git 状态汇总。

这样实现成本低、性能风险小，也符合“切换仓库才刷新，最开始只轻量显示有哪些仓库”的核心思路。
