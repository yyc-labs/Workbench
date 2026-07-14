# 学习中心浏览器 AI 调度体验改进计划（2026-07-14）

## 文档状态

- 状态：待评审，尚未开始实现。
- 前置方案：`docs/2026-07-14-learning-browser-ai-dispatch-plan.md` 已完成浏览器 AI 调度基础能力，本计划只处理交互、任务记录和执行过程可见性。
- 本次不执行 build。实现阶段按改动风险执行定向类型检查和测试。

## 一、背景与问题

当前发送窗口可以选择 skill、个人上下文和学习笔记，并通过 Playwright 将组装后的内容发送到网页 AI。但当前交互仍有几个明显问题：

1. 学习笔记是长列表，缺少搜索、筛选、全选、清空和已选摘要，用户很难确认实际会发送哪些笔记。
2. “当前任务”在 UI、上下文组装器和 main service 中都是必填项。但部分 skill 文档或学习笔记本身已经包含明确的任务指令，不应该强制用户重复填写。
3. 浏览器返回的回答只保存在当前 renderer 状态中，关闭窗口后不容易继续查看，也没有独立的记录、命名和时间排序能力。
4. Playwright 虽然发出了一些阶段状态，但 UI 只显示 spinner 和一行文字。长时间等待回答时，用户无法判断当前卡在连接、打开页面、发送还是等待响应。
5. 当前回答保存流程直接保存为学习笔记或追加当前笔记，浏览器任务本身没有独立的生命周期记录。

## 二、目标和非目标

### 目标

1. 让用户在发送前快速找到并确认学习笔记来源。
2. 允许没有单独任务文本的发送场景，只要存在有效的 skill、学习笔记或个人上下文。
3. 将浏览器 AI 任务保存为独立记录，支持自定义名称、时间排序、搜索、查看和再次使用。
4. 实时显示 Playwright 已执行、正在执行和失败的具体步骤。
5. 保持现有 Learning、Browser AI、IPC 和 Playwright domain 边界，不把浏览器业务塞入 LearningService。

### 非目标

- 不改变 Edge 登录态、Cookie、Token 或 profile 管理方式。
- 不让浏览器 AI 自动修改原学习笔记，仍然由用户确认后保存。
- 不把个人上下文原文默认写入任务记录，避免敏感内容被长期落盘。
- 不在本次计划中增加新的 AI provider 或网页站点适配器。

## 三、总体交互方案

### 1. 发送窗口

将发送窗口调整为“来源选择 + 任务说明 + 预览 + 执行状态 + 回答”的连续流程。

来源选择区域：

- “当前任务”改名为“补充任务说明”，明确标记为可选。
- 学习笔记支持标题、摘要和标签搜索。
- 支持分类筛选。
- 支持“全选当前结果”和“清空选择”。
- 显示已选数量。
- 搜索结果变化后，已选项不能丢失；已选项需要单独显示或保留明确标记。
- 点击整行可以勾选，增大可操作区域。
- 已选内容显示标题和来源标签，便于发送前复核。

任务校验规则：

- 任务文本为空时，如果至少有一个有效来源，允许继续。
- 任务文本和所有来源都为空时，阻止预览和发送。
- 任务为空时，提示用户将按照已选 skill 或学习笔记中的指令执行。
- 组装提示词时不生成空的 `<task>` 区块。
- 回答格式继续保持可选。

### 2. 独立任务记录

在学习中心增加“浏览器任务记录”入口，使用列表和详情布局，不与学习笔记列表混在一起。

记录列表支持：

- 按最近使用时间或创建时间排序，默认倒序。
- 按自定义名称搜索。
- 按成功、失败、取消筛选。
- 查看、重命名和删除。
- 从记录重新载入发送窗口。

记录详情支持：

- 查看任务名称、时间、目标站点和来源摘要。
- 查看回答正文。
- 查看完整执行步骤和失败原因。
- 重新运行相同任务。
- 将回答保存为新学习笔记。
- 将回答追加到已有学习笔记。
- 复制回答。

保存回答时弹出自定义名称输入框，默认名称可以由站点名称和时间生成，但必须允许用户修改。

### 3. Playwright 执行状态

执行面板使用步骤时间线，不再只显示 spinner：

```text
已准备任务
✓ 连接 Edge
✓ 打开网页 AI
✓ 检查登录状态
✓ 填充提示词
✓ 点击发送
● 等待回答
  已等待 12 秒，正在检查页面内容
```

至少显示以下阶段：

- 准备任务
- 连接 Edge
- 打开新对话
- 检查登录状态
- 查找输入框
- 填充提示词
- 点击发送
- 等待回答
- 读取回答
- 已完成、失败或已取消

等待回答期间显示已经等待的时间和最近一次检查信息。超时、登录失效、页面结构变化、浏览器断开和取消操作都要关联到具体步骤。

## 四、分阶段实施计划

### P0：发送窗口和可选任务

改动范围：


- 拆分 `LearningBrowserAiDialog` 的来源选择、任务表单和状态区域，避免继续堆积页面 JSX。
- 新增学习笔记来源选择组件。
- 增加搜索、分类筛选、全选、清空和已选摘要。
- 修改 renderer、shared context composer 和 main service 的任务校验。
- 同步中英文 i18n 文案。

建议涉及文件：

- `src/core/renderer/pages/learning/LearningBrowserAiDialog.tsx`
- `src/core/renderer/pages/learning/` 下新增来源选择组件
- `src/core/electron/main/browser-ai/contextComposer.ts`
- `src/core/electron/main/browser-ai/browserAiService.ts`
- `src/core/shared/types.ts`
- `src/core/renderer/i18n/messages/learning.ts`

验收标准：

- 只选择一个或多个学习笔记，不填写任务，也可以生成预览和发送。
- 任务和来源都为空时，提示明确且不会调用 Playwright。
- 搜索、全选、清空和分类筛选不会破坏已有选择。
- 最终预览能够清楚列出实际发送来源。

### P1：浏览器任务记录和再次使用

新增独立的任务记录模型和存储链路：

```text
shared types
  -> browser-ai repository
  -> browserAiService
  -> registerBrowserAiIpcHandlers
  -> preload invoke API
  -> appStore.browserAiSlice
  -> history list/detail UI
```

建议新增类型：

- `BrowserAiTaskRecord`
- `BrowserAiTaskRecordSummary`
- `BrowserAiTaskRecordStatus`
- `BrowserAiTaskStep`
- 列表、详情、重命名、删除和重新载入的 payload 类型

记录至少包含：

- `id`
- `title`
- `createdAt`
- `updatedAt`
- `startedAt`
- `completedAt`
- 目标站点信息
- 来源名称和字符数摘要
- 任务状态
- 回答文本
- 执行步骤
- 错误码和错误信息

持久化建议复用 transcript 的模式：

- `userData/browser-ai/records/index.json` 保存摘要索引。
- 每条记录独立保存为 JSON 详情文件。
- 列表默认按 `updatedAt` 倒序。
- 保存、重命名、删除后同步更新索引。

隐私规则：

- 默认保存回答、来源名称、字符数和执行状态。
- 不默认保存个人上下文原文。
- 如果记录需要包含完整提示词，必须提供明确的“保存完整发送内容”选项。

建议新增或修改：

- `src/core/shared/types.ts`
- `src/core/shared/electronApi.ts`
- `src/core/electron/main/browser-ai/browserAiRepository.ts`
- `src/core/electron/main/browser-ai/browserAiService.ts`
- `src/core/electron/main/ipc/registerBrowserAiIpcHandlers.ts`
- `src/core/electron/preload/invokeApi.browserAi.ts`
- `src/core/renderer/stores/appStore.browserAiSlice.ts`
- `src/core/renderer/pages/learning/` 下的记录列表和详情组件
- `src/core/renderer/i18n/messages/learning.ts`

验收标准：

- 任务完成后可以使用自定义名称保存记录。
- 应用重启后记录仍然存在。
- 可以按名称搜索和按时间排序。
- 可以打开详情、复制回答、重新载入任务和保存为学习笔记。
- 删除记录不会删除已有学习笔记。

### P2：Playwright 步骤实时反馈

扩展当前的进度事件，不再让 renderer 只保留最后一条状态：

- 增加步骤 ID、阶段类型、发生时间和详细消息。
- store 保存当前任务的步骤历史。
- 新任务开始时清空旧步骤，按 `taskId` 隔离事件。
- 当前步骤高亮，完成步骤显示完成状态。
- 失败、取消和超时显示在对应步骤下。
- 等待循环增加进度回调或心跳事件，展示最近一次页面检查结果。
- 记录最终步骤历史到 `BrowserAiTaskRecord`。

建议涉及文件：

- `src/core/shared/types.ts`
- `src/core/electron/main/browser-ai/browserAiService.ts`
- `src/core/electron/main/browser-ai/site-adapters/browserAiSiteAdapter.ts`
- `src/core/electron/main/browser-ai/site-adapters/genericWebAiAdapter.ts`
- `src/core/electron/main/browser-ai/site-adapters/chatgptAdapter.ts`
- `src/core/electron/preload/subscriptions.ts`
- `src/core/renderer/stores/appStore.browserAiSlice.ts`
- `src/core/renderer/pages/learning/` 下新增执行步骤组件

验收标准：

- 用户能知道 Playwright 当前执行到哪一步。
- 等待回答超过几秒时，界面仍然有可解释的状态更新。
- 发生异常时能定位到失败阶段，而不是只看到“任务失败”。
- 取消任务后时间线和记录状态一致。

### P3：测试和体验收尾

测试范围：

- context composer：任务可选、来源为空、来源排序、字符限制。
- 任务记录 repository：保存、读取、索引更新、排序、重命名和删除。
- 进度事件：任务切换、步骤追加、完成、失败、取消和超时。
- renderer：搜索、全选、清空、已选项保留和记录详情主要交互。
- 深色和浅色主题下的弹窗、时间线、列表详情布局。

按仓库规则执行定向验证，不执行完整 build，除非用户另外要求打包或构建。

## 五、待评审决策

实现前需要确认以下默认策略是否接受：

1. 任务为空但存在有效来源时允许发送；任务和来源同时为空时才阻止。
2. 浏览器任务记录独立于学习笔记保存，回答仍可由用户主动保存为学习笔记。
3. 任务记录默认不保存个人上下文原文，只保存来源摘要和执行结果。
4. 记录列表放在学习中心的独立入口中，使用列表加详情布局。
5. Playwright 等待阶段显示步骤时间线和心跳信息，而不是只显示一个持续旋转图标。
