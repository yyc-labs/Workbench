# 2026-06-29 Code 页面文件树折叠 / 刷新优化计划

## 背景

当前 `Code` 页面里，“目录节点展开/收起”和“整个左侧文件树侧栏展开/收起”走的是两套成本明显不同的路径：

1. 目录节点展开/收起主要是 renderer 内存态切换。
2. 左侧侧栏从折叠态重新展开时，会走 `handleReloadTree()`，进而触发 `loadTree()`。
3. `loadTree()` 当前会先清空 `tree.nodes`、`expandedDirectories` 和部分派生状态，再重新读取根目录。

这带来两个直接问题：

1. 用户短时间来回折叠左侧栏时，会重复触发根目录刷新，存在额外 I/O 和重渲染。
2. 之前已经懒加载出来的子树会在 root reload 前被清空，无法复用 `replaceDirectoryNodes()` / `mergeLoadedDirectoryChildren()` 已具备的合并能力。

同时，当前实现并没有文件树级别的 watcher：

1. 代码里只有打开文件的 `mtime` 轮询检测。
2. 文件树新鲜度目前只能依赖首次加载、手动刷新，或者展开时主动 reload。

因此，这轮优化不能简单做成“展开永不刷新”，而应改成：

1. 优先立即显示已有树。
2. 把刷新从阻塞式前台 reload 改成按需后台刷新。
3. 把“根目录 freshness”和“目录节点 freshness”分开处理。

## 现状定位

### 当前关键路径

1. `src/core/renderer/pages/code/CodeWorkspacePanel.tsx`
   - 侧栏展开按钮走 `handleExpandSidebar()`。
   - 当前 `handleExpandSidebar()` 会先取消折叠，再直接触发 `handleReloadTree()`。
   - `focusSearchInputByMode()` 在另一条路径里只会展开侧栏，不会显式 reload，当前行为不一致。

2. `src/core/renderer/pages/code/useCodeWorkspaceExplorerState.ts`
   - `loadTree()` 会先重置 `tree` 和 `expandedDirectories`，再读取 root。
   - `loadDirectory()` 对已加载目录会直接返回，不会刷新已加载目录。
   - `treeAutoLoadPaused` 会在桌面端侧栏折叠时阻止 idle 树自动加载。

3. `src/core/renderer/pages/code/code.tree.ts`
   - `replaceDirectoryNodes()` 已经支持“root 结果后到达时保留先前已加载子树”。
   - `mergeLoadedDirectoryChildren()` 已经支持“合并新 root 节点与旧 lazy 目录内容”。
   - 当前这些能力在 root reload 前被 `nodes: []` 抵消掉了一部分价值。

4. `src/core/electron/main/project-file/tree-service.ts`
   - root 和目录读取都保持 lazy，不会在 root load 时递归探测整棵树。
   - 目录节点默认 `hasChildren: true`、`isLoaded: false`，避免额外 `readdir` 探测。
   - 这条 lazy 策略需要保留，不能因为 freshness 改造而退化成 eager 扫描。

### 当前问题不是“全量扫描整仓库”

需要明确：

1. 现在展开侧栏触发的 `loadTree()`，不是每次都递归扫描整个项目。
2. 它主要是重新读取根目录一层，再由目录节点维持懒加载。
3. 真正浪费的点在于“重复 root 读取 + 清空旧树 + 丢失已加载子树 + 重建 UI 状态”。

因此，本轮目标不是“把一个灾难性热点救火”，而是把当前可接受但不优的策略，收敛成更稳、更一致的加载模型。

## 目标

### 阶段 1 目标

1. 侧栏展开时不再无条件触发 root reload。
2. 已有文件树在侧栏重新展开时可以立即显示。
3. 手动刷新仍然可用，但刷新过程不再清空已有树。
4. 已加载子树和 `expandedDirectories` 在 root refresh 过程中保留。
5. 不引入文件系统 watcher。

### 阶段 2 目标

1. 在不引入 watcher 的前提下，为文件树补足可控的新鲜度策略。
2. root 级刷新与目录级刷新都支持 TTL / force refresh。
3. 已加载目录再次展开时，可以只刷新该目录，而不是整棵树重载。
4. 手动刷新仍然具备最高优先级，并可绕过 TTL。

## 非目标

1. 这两阶段都不引入 `chokidar`、`fs.watch` 或长期驻留的文件树 watcher。
2. 不重写 `project-file` 的 IPC 协议模型，只做增量扩展。
3. 不把 root lazy 树改成递归全量扫描。
4. 不改动内容搜索、文件读取保存、Monaco 编辑器链路。
5. 不修改大项目 `autoLoadBlocked` 的总体策略。

## 设计原则

1. 先保证“展开立即可见”，再处理“刷新是否需要发生”。
2. 区分“首次加载”和“后台刷新”，不要共用一套 destructive loading 状态。
3. root refresh 保留旧树，目录 refresh 只更新目标目录。
4. freshness 以 TTL 和显式操作为主，不在本轮引入复杂外部事件源。
5. 避免把 `LoadStatus` 扩展成更多枚举值，优先增加独立布尔态，减少对 `useCodeWorkspaceRestoreState.ts`、`useProjectCodeSessionState.ts` 的联动改动。

## 阶段 1：去掉展开必 reload，保留旧树并支持非破坏性 root refresh

### 交付目标

1. 左侧栏 rail 按钮展开时，不再直接调用 `handleReloadTree()`。
2. 如果树已经加载过，展开侧栏后立即展示现有树。
3. 如果树还是 `idle`，展开后仍允许按现有 auto-load 逻辑首次加载。
4. 点击“刷新文件树”时，树保持可见，只显示轻量刷新反馈。

### 需要修改的模块

1. `src/core/renderer/pages/code/CodeWorkspacePanel.tsx`
2. `src/core/renderer/pages/code/useCodeWorkspaceExplorerState.ts`
3. `src/core/renderer/pages/code/code.types.ts`
4. `src/core/renderer/pages/code/CodeWorkspaceSidebar.tsx`
5. `test/renderer/code.tree.test.mjs`
6. 如需要，可新增 `test/renderer` 下的 explorer state 纯逻辑测试

### 具体方案

#### 1. 统一侧栏展开语义

当前存在两条行为不一致的路径：

1. rail 按钮展开会 reload。
2. `focusSearchInputByMode()` 展开不会 reload。

阶段 1 统一为：

1. 展开侧栏默认只做 UI 展开。
2. 首次可见且 `tree.status === 'idle'` 时，由 `treeAutoLoadPaused -> false` 后的既有 effect 触发首次加载。
3. 只有显式“手动刷新”才触发 root refresh。

#### 2. 把 root refresh 从 destructive load 改成非破坏性刷新

当前 `loadTree()` 的问题不在“请求 root”，而在“请求前先清空旧树”。

阶段 1 调整为：

1. 保留“首次加载”语义：
   - 当当前没有任何树数据时，允许 `status: 'loading'` 并展示空态 loading。

2. 新增“后台 root refresh”语义：
   - 当已有树数据时，刷新 root 不清空 `nodes`。
   - 不重置 `expandedDirectories`。
   - 不重置 `knownFilePaths`。
   - 请求完成后使用 `replaceDirectoryNodes(prev.nodes, null, sortedNodes)` 合并 root 结果。

3. 在状态模型里新增轻量标记，建议使用：
   - `isRefreshingRoot: boolean`
   - `lastRootLoadedAtMs: number | null`

不建议在阶段 1 直接把 `LoadStatus` 扩成 `refreshing`，因为：

1. `tree.status` 已被恢复链路、session 持久化链路和 sidebar UI 复用。
2. 新增状态会扩大判断分支，容易引入页面恢复回归。
3. 单独布尔态更适合表达“ready 树上的后台刷新”。

#### 3. 手动刷新行为改造

阶段 1 的手动刷新继续保留，但语义改成：

1. 如果当前树为空：
   - 走首次加载型 `loadTree()`。

2. 如果当前树已存在：
   - 走后台 root refresh。
   - 期间保留文件树展示。
   - 头部刷新按钮显示旋转态或禁用态。

3. `pendingLocateAfterTreeReloadRef` 只保留给显式刷新使用：
   - 刷新完成后继续尝试定位当前活动文件。
   - 侧栏单纯展开不再走这条逻辑。

#### 4. 保留已加载子树

阶段 1 的关键验收点之一，是 root refresh 不能丢掉已经懒加载出来的子树。

具体要求：

1. root refresh 结果回到 renderer 时，继续使用 `replaceDirectoryNodes()` 合并。
2. 不在 root refresh 开始前把 `prev.nodes` 置空。
3. `expandedDirectories` 保持不变。
4. 目录节点已加载内容仍以旧数据先展示，直到更细粒度刷新策略在阶段 2 补齐。

### 阶段 1 测试与验证

#### 手工验证

1. 首次进入 `Code` 页，树正常加载。
2. 桌面端折叠左栏，再立即展开，文件树应立刻出现，不进入全空 loading 态。
3. 快速连续折叠/展开 5 到 10 次，不应重复闪烁整个树面板。
4. 手动点击刷新时，树保持可见，刷新按钮出现轻量忙碌反馈。
5. 已展开的目录在手动 root refresh 后仍保持展开。
6. 已加载过的子目录内容在 root refresh 后不丢失。
7. 大项目 `autoLoadBlocked` 路径仍然展示手动加载空态，不被本次改造破坏。

#### 自动化验证

1. 扩展 `test/renderer/code.tree.test.mjs`
   - 覆盖 root refresh 合并后保留已加载子树。
   - 覆盖 root refresh 合并后目录展开路径不被破坏。

2. 如果为 staleness / refresh reason 抽出纯 helper：
   - 单独补 renderer 纯逻辑测试。

3. 回归运行：
   - `npm run typecheck`
   - `npm test`

### 阶段 1 验收标准

1. 左侧栏重新展开时不再无条件 root reload。
2. 已加载树在展开时立即可见。
3. 手动刷新不再清空树。
4. root refresh 后保留 `expandedDirectories` 和已加载子树。
5. 不影响大项目阻断、定位当前文件、恢复 code session 的现有行为。

## 阶段 2：补齐 freshness，支持 root TTL 与目录级 force refresh

### 交付目标

1. 长时间未刷新的 root 树，在再次展开侧栏时可后台刷新。
2. 已加载目录在再次展开时，允许按 TTL 单独刷新该目录。
3. 显式手动刷新始终绕过 TTL。
4. 目录刷新不应升级成整棵树 reload。

### 需要新增或调整的状态 / API

#### 1. root freshness

建议在 explorer state 里新增：

1. `lastRootLoadedAtMs: number | null`
2. `lastRootRefreshStartedAtMs: number | null`
3. `isRefreshingRoot: boolean`

并抽出统一判断 helper，例如：

```ts
shouldRefreshRootOnSidebarReveal(...)
```

这样可以避免把 TTL 和节流条件散落在 `CodeWorkspacePanel.tsx` 与 hook 内。

#### 2. 目录 freshness

`loadDirectory()` 需要从：

```ts
loadDirectory(directoryRelativePath: string | null): Promise<boolean>
```

扩成类似：

```ts
loadDirectory(
  directoryRelativePath: string | null,
  options?: {
    force?: boolean
    reason?: 'initial-open' | 'locate-path' | 'directory-refresh' | 'manual-refresh'
  }
): Promise<boolean>
```

并为目录层维护 renderer 侧 metadata，建议使用 ref/map：

1. `directoryLoadedAtMsRef: Map<string, number>`
2. `directoryRefreshInFlightRef: Map<string, Promise<boolean>>`

不建议把目录 freshness 时间戳直接塞进 shared `ProjectFileNode`：

1. 这类信息只在 renderer 交互层使用。
2. 不属于跨进程共享数据模型。
3. 放进共享类型会扩大不必要的协议面。

### TTL 策略

阶段 2 建议采用保守 TTL，而不是每次展开都刷新。

建议默认值：

1. `ROOT_REFRESH_TTL_MS = 15_000`
2. `DIRECTORY_REFRESH_TTL_MS = 15_000`

选择理由：

1. 能明显减少短时间来回折叠带来的重复刷新。
2. 对文件树这种非强实时视图来说，15 秒足够保守。
3. 与当前 `project-file` 文件列表缓存 TTL 在量级上保持一致，便于理解。

如后续真实使用中认为 15 秒偏长，可再下调到 5 到 10 秒；但本轮先保持保守值，避免把“避免浪费”又改成“频繁刷新”。

### 具体方案

#### 1. 侧栏展开后的 root freshness

阶段 2 把侧栏展开拆成两段：

1. 立即显示旧树。
2. 如果满足以下条件，则后台 root refresh：
   - 当前已有树。
   - `Date.now() - lastRootLoadedAtMs > ROOT_REFRESH_TTL_MS`
   - 当前没有 root refresh in flight。
   - 当前不是 `autoLoadBlocked`。

注意：

1. 这条刷新只在“侧栏从折叠到展开”时触发。
2. 不要在每次 React re-render 时重复检查并触发。
3. 需要额外节流，避免 TTL 刚过时用户连点展开按钮导致重复请求。

#### 2. 已加载目录再次展开时的单目录刷新

当前 `loadDirectory()` 对 `isLoaded` 目录会直接返回。

阶段 2 改成：

1. 目录首次展开：
   - 保持现有 lazy load 行为。

2. 目录已加载但再次展开：
   - 若未超过 `DIRECTORY_REFRESH_TTL_MS`，直接复用现有 children。
   - 若已超过 TTL，发起该目录的后台 refresh。

3. 手动刷新：
   - 可选择仅 root refresh，或 root + 已展开目录 refresh。
   - 本轮建议先保守做 root refresh + 目录按需后续刷新，不做“一次手动刷新递归刷新所有展开目录”，避免成本飙升。

#### 3. 目录 refresh 的合并要求

目录刷新完成后，应继续复用现有的合并思路：

1. 仅替换目标目录节点。
2. 若目录内子目录此前已经加载过，仍通过 `replaceDirectoryNodes()` / `mergeLoadedDirectoryChildren()` 保住可复用的更深层子树。
3. 若某些文件或子目录已被删除，refresh 后应能从该目录节点里移除。

#### 4. 手动刷新优先级

阶段 2 继续保留手动刷新最高优先级：

1. 点击刷新按钮时绕过 root TTL。
2. 如后续增加“刷新当前目录”入口，该入口也应绕过目录 TTL。
3. TTL 只服务于自动刷新决策，不影响显式用户操作。

### 阶段 2 测试与验证

#### 手工验证

1. 折叠侧栏超过 root TTL 后再展开：
   - 旧树立即出现。
   - 随后后台 root refresh 生效。

2. 在 root 目录新建/删除文件后，等待 TTL 再展开侧栏：
   - root 层变更应在后台 refresh 后反映出来。

3. 展开某已加载目录，修改其内容后等待目录 TTL，再重新收起/展开该目录：
   - 该目录内容应刷新。
   - 不应触发整棵树清空或全树 reload。

4. 快速连续展开同一目录：
   - 不应并发创建多个同目录 refresh 请求。

5. 点击手动刷新：
   - 无论 TTL 是否到期，都应执行 root refresh。

#### 自动化验证

建议优先补纯逻辑层测试，而不是直接为 hook 引入重量级 UI 测试：

1. root refresh 判定 helper 测试：
   - TTL 未到期不刷新
   - TTL 到期刷新
   - in-flight 时不重复刷新

2. directory refresh 判定 helper 测试：
   - 首次展开加载
   - 已加载但未过期不刷新
   - 已加载且过期触发 refresh
   - `force: true` 始终刷新

3. `code.tree.ts` 合并测试继续扩展：
   - 目录 refresh 后保留更深层已加载子树
   - 删除后的节点被正确移除

4. 回归运行：
   - `npm run typecheck`
   - `npm test`

### 阶段 2 验收标准

1. root freshness 通过 TTL 后台刷新补足，不再依赖“展开必 reload”。
2. 目录 freshness 通过目录级 refresh 补足，不再只能整树刷新。
3. 手动刷新始终可绕过 TTL。
4. 快速来回折叠/展开、快速重复展开目录时，不会产生明显重复请求浪费。

## 实施顺序

### 阶段 1

1. 改掉 `handleExpandSidebar()` 的无条件 reload。
2. 为 explorer state 增加非破坏性 root refresh 状态。
3. 改造手动刷新逻辑，保留旧树并显示轻量刷新反馈。
4. 补 root 合并与状态保留测试。

### 阶段 2

1. 为 root 增加 `lastRootLoadedAtMs` 与 TTL 判定 helper。
2. 为 `loadDirectory()` 增加 `force` / `reason` 能力。
3. 增加目录 freshness metadata 和单目录 refresh。
4. 补 root/directory staleness helper 测试与目录刷新合并测试。

### 收尾验证

1. 手工验证桌面端折叠/展开体验。
2. 手工验证 root 与目录变更可见性。
3. 运行 `npm run typecheck`
4. 运行 `npm test`

## 风险与注意事项

1. 不要在阶段 1 就引入新的 `tree.status = 'refreshing'`，这会扩大恢复链路和 session 依赖面的修改范围。
2. root refresh 不清空树后，UI 上必须有轻量反馈，否则用户会误以为刷新按钮无效。
3. 目录 TTL 刷新不能退化成“所有已展开目录递归刷新”，否则会重新引入性能浪费。
4. 需要注意 `pendingLocateAfterTreeReloadRef` 与活动文件定位逻辑，避免背景 refresh 干扰当前滚动位置。
5. 大项目 `autoLoadBlocked` 路径必须保留原行为，不应被 TTL 机制偷偷绕过。

## 最终验收结论

本计划的目标不是把文件树做成强实时 watcher，而是把当前“展开即重载”的粗粒度策略，收敛成：

1. 展开立即可见。
2. root 刷新非破坏性。
3. freshness 按 TTL 和显式刷新补足。
4. 目录变化尽量在目录级处理，而不是升级成整棵树重建。

按这两阶段落地后，当前 `Code` 页面文件树的体验和性能会明显更平衡：

1. 短时间来回折叠不再浪费 root reload。
2. 树新鲜度不会长期失控。
3. 已加载子树可以真正复用，而不是在每次展开时被丢掉。
