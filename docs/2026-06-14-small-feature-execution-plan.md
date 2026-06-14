# 小功能增强执行计划

日期：2026-06-14

## 目标

围绕现有 Electron IDE 的项目管理、代码浏览、Transcript、运行命令和 AI Commit 流程，补齐一组轻量但高频的小功能：

1. 首页项目卡片展示 Git 工作区概览。
2. Dev 服务支持“未启动时先启动，捕获 URL 后自动打开”。
3. 代码页空态提供智能文件入口。
4. 代码页展示当前文件被 Transcript 引用的情况。
5. 运行命令配置页读取 `package.json` scripts 作为动态预设。
6. AI Commit 面板展示提交前置检查提示。

## 实施拆分

### 1. 首页 Git 状态小胶囊

- 在项目卡片内异步读取 `getGitRepositorySnapshot(project.path)`。
- 展示变更文件数、冲突数、ahead/behind 信息。
- 避免阻塞首页渲染，失败时静默隐藏。
- 在项目进入运行状态、卡片挂载或间隔刷新时更新状态。

### 2. 启动并自动打开 Dev URL

- 项目卡片对已有 Dev URL 继续直接打开。
- 当没有 URL 且服务未运行时，提供等待打开行为：启动项目后监听 `processUrls`，捕获第一个 URL 后自动 `openExternal`。
- 设置超时与按钮 loading，避免无限等待。

### 3. 代码页空态智能入口

- 复用文件树已知路径，优先候选：`README.md`、`AGENTS.md`、`package.json`、常见入口文件。
- 在编辑器空态显示最多 4 个可点击入口。
- 点击后复用现有 `openFile` 流程。

### 4. Transcript 反向引用

- 在代码页加载当前项目 Transcript 摘要。
- 按需加载 sessions，统计当前文件匹配的 `references.relativePath`。
- 在代码页顶部或编辑器附近显示引用数量和最近引用入口。
- 点击引用跳转到 `/project/:id/transcript` 并激活对应 transcript/reference。

### 5. 运行命令动态脚本预设

- 在 `RunCommandConfigPopover` 打开时读取项目根目录 `package.json`。
- 解析 `scripts` 字段，生成 `npm/pnpm/yarn` 对应命令。
- 将动态脚本置于模板列表顶部，读取失败时不影响原模板。

### 6. AI Commit 前置检查条

- 基于已有 `gitSnapshot` 生成 compact preflight：
  - 无 Git 仓库。
  - 无工作区改动。
  - 存在冲突。
  - 分支落后远端。
  - detached HEAD。
  - 无 upstream。
- 在 AI Commit 操作区展示，不改变现有提交流程。

## 验收项

- `npm run typecheck` 通过。
- `npm test` 通过或记录明确失败原因。
- 新增文案同时覆盖 `en-US` 与 `zh-CN`。
- 不修改无关文件，不回滚已有工作区变更。
