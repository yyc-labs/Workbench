# 学习中心 Skill 独立管理计划（2026-07-14）

## 文档状态

- 状态：已实现，已完成 P0-P4 的第一阶段落地。
- 目标：将 Skill 从学习笔记中独立出来，提供 Skill 的 CRUD 管理、默认 Skill 配置和发送 AI 时的临时 Skill 选择/新增能力。
- 本计划同时作为实现边界和验收清单；本轮已完成对应功能代码、文案和定向测试。按仓库规则未执行 build。
- 相关现状方案：
  - `docs/2026-07-14-learning-browser-ai-dispatch-plan.md`
  - `docs/2026-07-14-learning-browser-ai-ux-improvement-plan.md`

## 一、背景与问题

当前学习中心的“Skill”只是浏览器 AI 发送弹窗中的一段临时文本：

- 用户每次发送时需要手动填写 Skill 内容。
- 默认配置只支持默认学习笔记，不支持默认 Skill。
- Skill 没有独立的标题、ID、标签、更新时间和编辑入口。
- Skill 和学习笔记虽然都可以作为 AI 上下文，但职责不同：学习笔记是知识/资料，Skill 是告诉 AI 如何工作、如何输出的可复用指令。
- 当前 `BrowserAiContextSource.kind` 已有 `skill`，但该 source 没有对应的持久化 domain；浏览器 AI 任务记录中的 `skill` 也只是发送时快照。

如果继续把 Skill 当作学习笔记使用，会导致笔记列表混入操作指令，用户无法快速判断哪些内容是“要学习的资料”，哪些内容是“要让 AI 遵守的规则”。

## 二、目标和非目标

### 目标

1. 在学习中心提供独立的 Skill 管理视图，支持创建、查看、编辑、删除和搜索。
2. Skill 具有独立的标题、正文、标签、启用状态和更新时间，可作为可复用 AI 指令。
3. 浏览器 AI 发送时支持：
   - 自动带入配置的默认 Skill。
   - 在当前对话中临时追加或移除 Skill。
   - 在发送弹窗中快速新建一个 Skill，并选择是否只用于本次对话或保存后继续复用。
4. 默认 Skill 和当前对话的 Skill 选择互不污染：修改当前对话不会修改默认配置。
5. Skill 与学习笔记在存储、IPC、renderer 状态和 UI 语义上保持独立，但都可以作为浏览器 AI 的上下文来源。
6. 保持 Windows/WSL 行为不变。Skill 是本地用户数据，不进入项目运行目录，也不参与 Runtime 启动。

### 非目标

- 本计划不把 Skill 自动注入所有 Runtime、终端或 AI Commit 请求；第一阶段只接入现有学习中心的浏览器 AI 发送链路。
- 不把 Skill 复制成学习笔记，也不让删除 Skill 删除任何学习笔记或浏览器任务记录。
- 不实现 Skill 的版本控制、多人共享、云同步或第三方市场。
- 不在本计划中改变 Edge/CDP、网页 AI adapter 或浏览器任务记录的生命周期。
- 不允许 Skill 直接触发文件写入、命令执行或其他主进程能力；Skill 只是发送给网页 AI 的上下文文本。

## 三、核心概念和数据关系

建议明确区分三类对象：

| 对象 | 作用 | 是否可复用 | 典型内容 |
| --- | --- | --- | --- |
| Skill | 约束 AI 的角色、工作方式、输出格式和检查规则 | 是 | “你是一个严格的代码审查员，按风险等级输出问题” |
| 学习笔记 | 保存知识、资料、经验和研究结果 | 是 | API 笔记、技术摘要、排查记录 |
| 当前任务 | 描述本次要 AI 完成的问题 | 否，默认只属于本次发送 | “检查这段代码的并发安全问题” |

发送时的上下文关系：

```text
默认 Skill ─┐
本次追加 Skill ─┼─> Skill 来源
个人上下文 ────┤
学习笔记 ──────┼─> BrowserAiContextSource[] ─> contextComposer ─> 网页 AI
当前任务 ──────┘
```

Skill 和学习笔记都可以有分类，但分类空间建议独立。这样用户可以分别维护“代码审查”“写作”“学习计划”等 Skill 分类，不会和“前端”“Electron”“数据库”等笔记分类混在一起。

## 四、推荐交互方案

### 1. 学习中心主布局：统一入口，分视图管理

学习中心顶部增加轻量的视图切换：

```text
学习中心                         [笔记] [Skills] [浏览器任务]
```

- 默认仍进入“笔记”视图，保留现有学习中心行为和入口路径 `/learning`。
- “Skills”使用和笔记相同的三栏工作区骨架：列表/搜索、编辑器、详情或属性区域。
- “浏览器任务”继续使用现有任务记录入口，不与 Skill 列表混排。
- 不新增一个独立一级路由，避免导航和窗口空间继续膨胀；视图状态可以通过 query/hash 或页面内部状态表达，具体方式在实现阶段按当前路由习惯决定。
- 左侧分类栏、笔记编辑器和 Skill 编辑器不得共用同一份 CRUD 状态；可以复用纯 UI 组件和编辑器能力。

Skill 列表项建议显示：

- Skill 标题。
- 一行正文摘要。
- 标签。
- 启用/停用状态。
- 最近更新时间。

Skill 编辑器建议提供：

- 标题输入框。
- Markdown/纯文本正文编辑区。第一阶段沿用现有 Markdown 编辑器能力，但 Skill 发送时使用正文原文，不把 frontmatter 发送给 AI。
- 标签输入。
- 分类选择。
- “启用”切换。停用的 Skill 保留在管理页面，但不能进入默认选择和快速选择结果。
- 保存和删除操作。

这里的“启用”表示 Skill 是否可以被选择，不等同于“默认使用”。默认 Skill 仍由单独的默认配置控制。

### 2. 浏览器 AI 发送弹窗：紧凑的 Skill 选择器

现有发送弹窗空间有限，不建议把所有 Skill 正文直接展开。建议把来源区域调整为：

```text
上下文来源

Skill       [3 个已选]                          [管理]
[默认 Skill A] [本次 Skill B] [+ 添加]

个人上下文   [开关]
学习笔记     [搜索、分类筛选、已选数量]
```

点击 Skill 区域或“添加”打开 `SkillPickerDialog`，弹窗内提供：

- 搜索标题、摘要和标签。
- 已选 Skill 区域，默认 Skill 显示“默认”标记。
- 当前对话新增的 Skill 显示“本次”标记。
- 点击行切换选择状态；已选项不会因为搜索或筛选变化而丢失。
- “仅查看默认 Skill”“仅查看已启用 Skill”的筛选。
- “新建 Skill”按钮。
- “应用”按钮，将选择结果写回当前发送弹窗。

Skill 正文预览放在选择器右侧或底部的详情区域，只展示当前高亮项的内容摘要，避免弹窗变成第二个编辑器。

### 3. 当前对话新增 Skill

在 `SkillPickerDialog` 中点击“新建 Skill”后打开一个更小的 `CreateSkillDialog`：

- 标题和正文是必填项。
- 默认勾选“保存到 Skills”，保存后该 Skill 出现在管理页和当前选择中。
- 允许取消勾选“保存到 Skills”，此时生成一个只存在于当前发送草稿的临时 Skill。
- 临时 Skill 只能影响当前对话，不进入默认配置，也不写入任务记录的可复用 Skill 列表。
- 保存后的 Skill 可以在当前发送中直接选中，但不能因为创建动作自动成为默认 Skill。

这比在发送弹窗中直接展开一个长文本输入框更适合当前空间约束：普通用户只看到已选摘要，只有需要调整 Skill 时才打开选择器；同时仍然覆盖“本次对话临时增加规则”的场景。

### 4. 默认 Skill 配置

现有浏览器 AI 偏好设置弹窗增加“默认 Skills”区域，与“默认学习笔记”并列：

- 支持选择多个默认 Skill。
- 只展示启用的 Skill。
- 显示默认 Skill 的标题和标签，不在配置页展开完整正文。
- 默认 Skill 的顺序可调整；发送时按用户配置顺序组装。
- 保存默认配置后只影响新打开的发送弹窗，不修改已经打开的对话草稿。
- 如果已删除或停用某个默认 Skill，加载偏好时自动清理其 ID，并给出一次非阻塞提示或在配置页显示失效项。

默认配置建议先继续复用当前 renderer 偏好存储方式，以缩小本次 IPC 改动范围；但 Skill 内容本身必须由 main 的 Skill repository 持久化，发送弹窗只保存 Skill ID，不把正文长期写进 localStorage。

## 五、建议数据模型

### 1. Shared 类型

建议在 `src/core/shared/types.ts` 增加独立类型：

```ts
export interface SkillSummary {
  id: string
  title: string
  categoryId?: string
  tags: string[]
  enabled: boolean
  createdAt: number
  updatedAt: number
  excerpt: string
}

export interface Skill extends SkillSummary {
  contentMd: string
}

export interface SkillCreatePayload {
  title?: string
  categoryId?: string
  tags?: string[]
  enabled?: boolean
  contentMd?: string
}

export interface SkillUpdatePayload {
  skillId: string
  title: string
  categoryId?: string
  tags: string[]
  enabled: boolean
  contentMd: string
}
```

默认配置不保存 Skill 正文，只保存排序后的 ID：

```ts
export interface BrowserAiPreferences {
  defaultSkillIds: string[]
  defaultNoteIds: string[]
  savePromptByDefault: boolean
}
```

当前发送 payload 中的 Skill source 应携带 `referenceId`：

```ts
{
  kind: 'skill',
  referenceId: skill.id,
  label: skill.title,
  content: skill.contentMd,
  included: true,
}
```

这样浏览器任务记录可以保留 Skill 标题和 ID；是否保存完整正文继续由现有 `savePrompt` 隐私开关决定。

### 2. 持久化目录

建议在用户数据目录下独立保存：

```text
<userData>/
  learning-center/
    notes/
    index.json
    categories.json
  skills/
    items/
      <skill-id>.md
    index.json
    categories.json
```

- Skill 不放进 `learning-center/notes`，避免文件层面继续混淆。
- Markdown frontmatter 保存 `id`、`title`、`categoryId`、`tags`、`enabled`、时间字段。
- `index.json` 只保存列表摘要，正文按 ID 单独读取，沿用 `LearningRepository` 的性能和容错模式。
- Skill ID 使用独立前缀，例如 `sk-...`，不要复用学习笔记的 `ln-...`。

### 3. Skill domain

新增独立 main domain：

```text
src/core/electron/main/skill/
  skillRepository.ts
  skillService.ts
```

`SkillService` 负责：

- 列表和详情。
- 创建、更新、删除。
- 启用状态和标题/标签规范化。
- 分类 CRUD 或注入独立的 Skill category repository。
- 删除分类时清理 Skill 的分类引用。

`LearningService` 继续只负责学习笔记和学习笔记分类，不通过页面需求调用 Skill 内部函数。

## 六、IPC 和 renderer 链路

按仓库现有 domain 边界接入：

```text
shared types
  -> main/skill/skillRepository.ts
  -> main/skill/skillService.ts
  -> main/ipc/registerSkillIpcHandlers.ts
  -> preload/invokeApi.skill.ts
  -> shared/electronApi.ts
  -> renderer skill store/page
  -> LearningBrowserAiDialog / SkillPickerDialog
```

建议第一阶段 IPC：

| IPC | 用途 |
| --- | --- |
| `skill:list` | 读取 Skill 摘要列表 |
| `skill:get` | 读取单个 Skill 正文 |
| `skill:create` | 创建 Skill |
| `skill:update` | 更新 Skill |
| `skill:delete` | 删除 Skill |
| `skill:list-categories` | 读取 Skill 分类 |
| `skill:create-category` | 创建 Skill 分类 |
| `skill:update-category` | 更新 Skill 分类 |
| `skill:delete-category` | 删除 Skill 分类并清理引用 |

`registerIpcHandlers.ts` 只负责调用 `registerSkillIpcHandlers(deps)`；`preload/index.ts` 只合并 `createSkillInvokeApi()`。Skill CRUD 错误不要复用学习笔记错误字符串，至少区分 Skill 不存在、标题为空、正文为空、标题重复和分类不存在。

renderer 侧可以新增：

- `appStore.skillSlice.ts`：跨 Skill 管理页、默认配置和发送弹窗复用的列表/详情状态。
- `appStore.types.ts`：同步类型。
- `SkillPickerDialog` 私有状态：当前搜索、筛选和临时选择不必全部进入全局 store。
- 默认 Skill ID 的偏好读写 helper：复用现有 `learningBrowserAiPreferences`，但建议更名为 `browserAiPreferences`，避免继续把浏览器 AI 偏好绑定在学习笔记上。

## 七、浏览器 AI 上下文调整

### 1. Source 构造

`LearningBrowserAiDialog` 打开时：

1. 读取默认 Skill ID 和默认学习笔记 ID。
2. 通过 Skill summary 校验仍存在且 `enabled === true` 的 ID。
3. 获取已选 Skill 正文，构造 `kind: 'skill'` 且带 `referenceId` 的 source。
4. 将当前对话中新增的临时 Skill source 追加到默认 Skill 后面。
5. 学习笔记仍然按现有选择器独立选择。

建议上下文排序固定为：

```text
默认 Skill -> 本次追加 Skill -> 个人上下文 -> 学习笔记 -> 当前任务 -> 输出格式
```

### 2. 重复和覆盖规则

- 同一个 Skill 被默认配置和本次选择同时选中时，只发送一次，以 Skill ID 去重。
- 用户在当前对话中取消默认 Skill，只影响本次发送，不修改默认配置。
- 默认 Skill 和本次 Skill 之间存在互相矛盾的指令时，预览中明确按顺序展示，并在选择器中显示来源标记；第一阶段不自动解析或合并正文。
- 禁用或删除的 Skill 不应被新发送选中；历史浏览器任务记录仍保留当时的来源快照和标题。
- 没有 Skill 但有学习笔记或任务时仍然允许发送；现有“任务或至少一个来源”的校验保持不变。

### 3. 任务记录和隐私

- `BrowserAiTaskRecordSource.kind === 'skill'` 继续保留，但 `referenceId` 指向独立 Skill。
- 默认只保存 Skill 标题、ID、字符数和敏感标记，不保存正文。
- 用户开启“保存完整发送内容”时，才在任务记录中保存当次 Skill 正文快照。
- 后续编辑或删除 Skill 不修改已完成任务记录，确保历史记录可读。

## 八、分阶段实施计划

### P0：模型和持久化边界

改动范围：

- 增加 `Skill`、`SkillSummary`、CRUD payload 和错误类型。
- 新增 `main/skill/skillRepository.ts` 和 `skillService.ts`。
- 增加 Skill 独立目录、索引和 Markdown frontmatter 读写。
- 处理坏文件、空标题、空正文、重复标题、路径片段和时间字段规范化。
- 不改变现有学习笔记文件和浏览器 AI 行为。

验收标准：

- 应用可以独立创建、读取、更新和删除 Skill。
- 重启应用后 Skill 列表和正文仍然存在。
- 删除 Skill 不影响学习笔记和浏览器任务记录。

### P1：IPC 和 Skill 管理页面

改动范围：

- 接入 shared/preload/main IPC 链路。
- 在学习中心增加 `笔记 / Skills / 浏览器任务` 视图切换。
- 新增 Skill 列表、搜索、分类筛选、编辑、新建、删除和启用切换。
- 复用现有编辑器、ModalShell、Button、Input、Textarea、Select 和主题 token。
- 新增中英文 i18n 文案。

验收标准：

- 用户不需要打开浏览器 AI 弹窗，也可以完整管理 Skill。
- Skill 页面在浅色和深色主题下可读，窄窗口下不出现编辑器和操作按钮重叠。
- Skill 页面状态不会污染学习笔记页面的当前分类、选中笔记和未保存编辑。

### P2：默认 Skill 配置

改动范围：

- 将浏览器 AI 偏好 helper 从“学习笔记默认项”扩展为“Skill + 学习笔记默认项”。
- 在偏好弹窗增加默认 Skill 选择器和排序。
- 加载时清理已删除/禁用的 Skill ID。
- 新打开发送弹窗时自动带入默认 Skill；已打开弹窗不被后台配置变化强制覆盖。

验收标准：

- 用户可以配置多个默认 Skill，并在下一次发送时看到已选项。
- 当前对话移除某个默认 Skill 后，重新打开新的对话仍会恢复默认配置。
- 删除或禁用默认 Skill 后，发送不会提交失效 ID。

### P3：发送时的 Skill 选择和临时新增

改动范围：

- 从 `LearningBrowserAiDialog` 移除直接编辑 Skill 长文本的主流程。
- 新增 `SkillPickerDialog`、`CreateSkillDialog` 和对应选择/预览组件。
- 支持默认、本次、已保存、临时四种来源标记。
- 当前对话临时新增 Skill 支持“不保存”和“保存到 Skills”两种路径。
- 将 Skill ID 作为 `referenceId` 传入 `BrowserAiContextSource`。

验收标准：

- 发送弹窗空间有限时，Skill 仍能被快速查看和选择，不需要展开多个大文本框。
- 当前对话可以追加 Skill、移除默认 Skill、预览正文并发送。
- 临时 Skill 不会写入默认配置；保存 Skill 后可以立即在当前对话使用。
- 相同 Skill 不会重复进入最终 prompt。

### P4：迁移、兼容和测试收尾

迁移建议：

- 现有浏览器 AI 偏好中没有持久 Skill ID，只有弹窗运行时的临时 `skill` 文本，因此不需要做文件级自动迁移。
- 如果历史任务记录包含 `kind: 'skill'` 但没有 `referenceId`，继续按快照来源展示，不尝试猜测并绑定到新 Skill。
- 可以提供一次性“从当前 Skill 文本创建 Skill”的入口，默认标题使用“Imported Skill”，但不应在升级时静默创建大量 Skill。
- 已有学习笔记不自动识别或转换为 Skill；如需要转换，提供用户主动触发的“另存为 Skill”动作，并复制正文而不是移动原笔记。

测试范围：

- Skill repository：索引、正文、frontmatter、排序、坏文件、删除和路径安全。
- Skill service：标题/正文规范化、重复标题、启用状态和分类引用清理。
- 偏好 helper：默认 Skill ID 去重、失效 ID 清理和顺序保持。
- context composer：Skill 排序、重复去重、空 Skill、正文限制和 `referenceId` 传递。
- renderer：Skill CRUD、默认配置、选择器搜索/筛选、当前对话取消默认、临时新增和保存新增。
- 浏览器任务记录：Skill source 的历史快照和 `savePrompt` 隐私行为不回归。

按仓库规则执行定向类型检查和测试；默认不执行 build。

## 九、建议涉及文件

### 新增

- `src/core/electron/main/skill/skillRepository.ts`
- `src/core/electron/main/skill/skillService.ts`
- `src/core/electron/main/ipc/registerSkillIpcHandlers.ts`
- `src/core/electron/preload/invokeApi.skill.ts`
- `src/core/renderer/stores/appStore.skillSlice.ts`
- `src/core/renderer/pages/learning/SkillPickerDialog.tsx`
- `src/core/renderer/pages/learning/CreateSkillDialog.tsx`
- `src/core/renderer/pages/learning/SkillManagementView.tsx`
- `src/core/renderer/pages/learning/SkillListSidebar.tsx`
- `src/core/renderer/pages/learning/SkillEditorPanel.tsx`
- `src/core/renderer/pages/learning/skillTypes.ts`

### 修改

- `src/core/shared/types.ts`
- `src/core/shared/electronApi.ts`
- `src/core/electron/main/ipc/registerIpcHandlers.ts`
- `src/core/electron/main/ipc/registerIpcHandlers.shared.ts`
- `src/core/electron/main/index.ts`
- `src/core/electron/preload/index.ts`
- `src/core/renderer/stores/appStore.types.ts`
- `src/core/renderer/stores/appStore.ts`
- `src/core/renderer/pages/LearningCenterPage.tsx`
- `src/core/renderer/pages/learning/LearningBrowserAiDialog.tsx`
- `src/core/renderer/pages/learning/LearningBrowserAiPreferencesDialog.tsx`
- `src/core/renderer/pages/learning/learningBrowserAiPreferences.ts`
- `src/core/renderer/i18n/messages/learning.ts`
- `src/core/electron/main/browser-ai/contextComposer.ts`
- `src/core/electron/main/browser-ai/browserAiService.ts`

具体实现前需要先确认：Skill 分类是否第一阶段就独立维护，以及“视图切换”是使用页面内部状态还是新增 query 参数。两项都不影响本计划的核心数据边界。

## 十、待评审决策

1. 是否接受将 Skill 与学习笔记放在同一个学习中心入口内，但用 `笔记 / Skills / 浏览器任务` 分视图管理？
2. 是否接受 Skill 分类独立于学习笔记分类？推荐独立，避免两套对象的分类语义互相污染。
3. 是否接受默认 Skill 只保存 ID，正文由 Skill repository 管理？推荐接受，避免 localStorage 保存大段内容和旧内容。
4. 当前对话新增 Skill 是否默认保存？推荐默认保存，提供“不保存，仅本次使用”的明确选项，降低重复录入成本同时保留临时规则能力。
5. 是否保留从发送弹窗直接输入 Skill 的兼容入口？推荐保留一次过渡版本，但标记为“临时 Skill”，引导用户保存到 Skills；后续再移除旧文本框。

## 十一、完成定义

- Skill 不再依赖学习笔记才能被管理或复用。
- 用户可以在学习中心独立完成 Skill CRUD。
- 用户可以配置多个默认 Skill，并在新浏览器 AI 对话中自动使用。
- 用户可以在当前对话中追加、移除或临时创建 Skill，且不改变默认配置。
- 学习笔记、Skill、当前任务在最终预览中具有清楚的来源标签和稳定顺序。
- 删除、停用、编辑 Skill 不会破坏历史浏览器任务记录。
- shared、main、preload、renderer 的契约保持一致，深浅主题、错误态、空态和中英文文案完整。

## 十二、实施记录

- 已新增独立 `skills/items` Markdown 存储、索引、分类和 Skill service，Skill ID 使用 `sk-` 前缀。
- 已接入 shared、main IPC、preload、renderer store，并在学习中心增加笔记、Skills 和浏览器任务入口。
- 已接入默认 Skill 配置、Skill picker、保存复用和仅本次使用的临时 Skill；上下文按 Skill、个人上下文、学习笔记、任务顺序组装并按 Skill ID 去重。
- 已覆盖 Skill service 规范化/错误、上下文去重等定向测试；`npm run typecheck` 和 `npm test` 均通过，未执行 build。
