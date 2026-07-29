# 浏览器精准长截图元素标记计划

## 1. 背景与目标

当前网页长截图支持保留页面悬浮元素，或统一隐藏所有 `fixed` / `sticky` 元素。但在精准模式的分段截图中，悬浮元素可能在每个分段都出现，拼接后产生重复内容；统一隐藏又可能误伤用户希望保留的导航、工具栏或正文元素。

本次增强的目标是：在用户选择精准截图的滚动容器后，进入元素标记阶段，允许用户连续标记多个页面元素，并分别指定处理策略。用户在网页中按 Enter 确认全部标记后开始截图。

本次功能只针对用户明确标记的元素，不改变未标记元素的默认行为。

## 2. 已确认的交互

### 2.1 操作流程

```text
选择目标标签页
    ↓
选择“精准模式”
    ↓
在网页中点击选择滚动容器
    ↓
进入“标记元素”阶段
    ↓
鼠标移动时高亮候选元素
    ↓
点击元素后打开策略菜单并保留标记样式
    ↓
继续点击并标记其他元素
    ↓
在网页中按 Enter
    ↓
开始精准分段截图
```

- 元素标记阶段不会触发网页原本的点击行为。
- 已标记元素必须有明显的特殊样式，例如彩色 outline、半透明背景和策略标签。
- 点击已标记元素时，应打开或重新打开该元素的策略菜单，允许修改策略。
- 用户可以标记多个元素；同一元素重复点击不应产生重复记录。
- Enter 结束标记阶段并触发截图。
- Esc 取消当前截图任务并清理标记样式。
- 元素标记阶段不应依赖截图悬浮控制条的位置；控制条本身仍需在真正截图时隐藏。

### 2.2 元素策略

每个被标记元素单独选择以下策略之一：

| 策略 | 行为 |
| --- | --- |
| 最后出现 | 除最后一个实际截图分段外均隐藏，在最后一段显示 |
| 始终隐藏 | 所有截图分段均隐藏 |

默认策略建议为“最后出现”，因为它最符合处理悬浮按钮、客服入口和浮动广告的主要场景；具体默认值应与现有截图控制条和窗口内 UI 保持一致。

## 3. 当前实现基础

现有代码已经具备以下能力：

- `screenshotService.ts` 支持精准滚动容器选择和分段截图。
- 精准滚动容器使用 `framePath + selector` 定位，能够覆盖主页面和 iframe。
- `preparePage` / `restorePage` 已有页面状态注入与清理机制。
- 页面已有捕获控制条，并通过 Playwright binding 触发截图。
- `BrowserScreenshotFixedElementPolicy` 已包含 `keep-once` 类型，但当前仅实现了 `keep` 和 `hide`，也没有元素级配置。
- Enter 和 Esc 的事件拦截可以复用现有页面选择器的捕获阶段处理方式。

本次不应把元素选择逻辑放进浏览器 AI service，也不应通过截图完成后再编辑 PNG 的方式解决重复问题；元素应在网页 DOM 层临时隐藏或恢复。

## 4. 数据模型调整

### 4.1 共享类型

在 `src/core/shared/types.ts` 中增加元素标记配置，例如：

```ts
export type BrowserScreenshotMarkedElementPolicy = 'hide' | 'keep-once'

export interface BrowserScreenshotMarkedElement {
  framePath: number[]
  selector: string
  policy: BrowserScreenshotMarkedElementPolicy
}
```

`BrowserScreenshotRequest` 增加可选的标记元素集合：

```ts
markedElements?: BrowserScreenshotMarkedElement[]
```

现有的 `fixedElementPolicy` 继续服务于标准模式和未进入元素标记流程的兼容路径。精准模式使用 `markedElements` 时，元素级策略优先于全局 fixed 策略。

需要明确以下约束：

- `framePath` 表示从页面主 frame 到目标 frame 的索引路径。
- `selector` 必须是可在对应 frame 内重新解析的稳定选择器。
- 主页面使用空数组 `framePath: []`。
- 同一 `framePath + selector` 只允许出现一次。
- 找不到目标元素时不应静默影响其他元素；应记录 warning，并继续截图或按产品决定终止任务。

## 5. 主进程实现计划

### 5.1 `screenshotService.ts`

在现有精准容器选择之后增加元素标记阶段：

1. 暂时隐藏截图控制条，避免被用户选中。
2. 在主页面和 iframe 中安装元素拾取器。
3. 监听鼠标移动，计算候选元素的 `framePath`、稳定 selector 和屏幕坐标。
4. 监听点击，阻止原网页事件并返回元素定位信息。
5. 由主进程或页面内标记控制器展示策略菜单。
6. 保存多个标记元素，并在网页上持续绘制标记样式。
7. 监听 Enter，结束标记阶段并将集合交给截图任务。
8. 监听 Esc，返回取消结果并清理所有临时节点、属性和事件监听器。

元素选择器应尽量复用当前滚动容器选择器的生成规则，但需要额外考虑：

- `id`、稳定的 `data-*` 属性和语义属性优先；
- 不应只依赖容易变化的 class 名称；
- `nth-child` 路径应作为必要时的 fallback；
- 选择器必须限定在正确的 frame 内，不能跨 frame 查询。

### 5.2 标记元素的页面状态

元素拾取器建议使用独立的内部标识，例如：

- 页面内部控制器 key：`__ide_browser_screenshot_element_marker__`；
- 标记元素属性：`data-ide-screenshot-marked`；
- 策略属性：`data-ide-screenshot-marked-policy`；
- 页面注入的标记样式使用独立 style 节点。

标记样式必须：

- 使用 `position: fixed` 的 overlay 或 outline，不改变目标元素布局；
- 使用高对比边框和策略颜色区分“最后出现”和“始终隐藏”；
- 不阻挡鼠标拾取目标元素；
- 不被真正截图捕获；
- 在 Enter、Esc、异常和页面关闭路径中都能清理。

### 5.3 分段截图时序

`captureSegmented` 和 `capturePreciseContainer` 需要接收标记元素配置，并在每一段截图前应用策略：

```text
计算当前分段位置
    ↓
滚动并等待页面稳定
    ↓
重新解析标记元素
    ↓
隐藏 hide 元素
隐藏 keep-once 元素（若不是最后一段）
    ↓
等待一帧并截图
    ↓
如果页面高度变化，重新判断下一段和最终段
```

“最后一段”不能仅根据开始截图时的段数判断。应根据当前滚动容器的实际高度、裁剪范围和下一段是否存在来判断；只有确认当前分段是最终实际输出分段后，才显示 `keep-once` 元素。

显示或隐藏标记元素时应使用 `visibility: hidden`，避免布局变化导致滚动高度和元素位置改变。若目标元素在截图前已经不可见，应保持其原始状态，并在必要时记录 warning。

对于 iframe 内元素，应在对应 frame 中执行隐藏/恢复；不能只在主 frame 中通过 selector 查询。

## 6. Renderer 与 IPC 计划

### 6.1 页面与交互

需要检查并调整：

- `src/core/renderer/BrowserScreenshotCaptureApp.tsx`
- `src/core/renderer/pages/learning/browser-screenshot/BrowserScreenshotDialog.tsx`

窗口内截图 UI 需要能够表达精准模式的元素标记状态、当前标记数量和默认策略，但真正的元素拾取发生在目标浏览器页面中。

浏览器页面内的捕获控制条需要增加：

- 当前阶段提示；
- 已标记元素数量；
- 策略菜单；
- Enter 确认提示；
- Esc 取消提示。

如果控制条继续由 `screenshotService.ts` 通过 `addInitScript` 注入，则其 binding 请求类型需要从“直接开始截图”扩展为“进入精准选择、更新策略、确认截图”等操作。具体 IPC 不应绕过 preload 层。

### 6.2 IPC 契约

沿用现有截图请求链路：

```text
shared types
    → main screenshot service
    → main IPC handler
    → preload invoke API
    → renderer capture UI
```

如元素标记完全在目标浏览器页面内完成，优先将最终 `markedElements` 集合一次性作为 `startBrowserScreenshot` 请求的一部分传入，避免为每一次鼠标移动新增 IPC 扇出。进度事件可增加“正在选择元素”的展示阶段或使用现有 `analyzing` 阶段携带提示。

## 7. 主进程装配与文案

需要同步检查以下文件：

- `src/core/electron/main/app-services.ts`：提供元素选择阶段所需的标签文案和事件发送能力。
- `src/core/electron/main/index.ts`：保持窗口创建、服务装配和生命周期职责，不在入口堆积元素选择业务逻辑。
- `src/core/electron/main/mainI18n.ts`：新增中英文文案，包括元素标记提示、策略名称、确认和取消提示、找不到元素 warning。
- `src/core/electron/main/window/createBrowserScreenshotWindow.ts`：仅在元素标记阶段确实需要调整窗口显示/隐藏时修改。
- `src/core/electron/main/window/createBrowserScreenshotViewerWindow.ts`：原则上不需要业务修改；只有结果提示或窗口标题需求变化时才调整。

所有用户可见文案必须接入 main i18n 或 renderer i18n，不在服务逻辑中散落硬编码。

## 8. 状态恢复与异常处理

必须保证以下路径清理元素标记：

- 用户按 Enter 开始截图；
- 用户按 Esc 取消；
- 截图成功；
- 截图失败或超时；
- 浏览器标签页关闭；
- iframe 导航或目标元素消失；
- CDP 连接断开；
- 应用退出。

恢复内容包括：

- 标记 overlay 和 style 节点；
- 标记属性和策略属性；
- 目标元素的隐藏属性；
- 页面滚动位置和容器滚动位置；
- 动画、视频和交互锁；
- 截图控制条可见性。

如果某个目标元素无法恢复，不应阻塞其他恢复步骤；应返回 `RESTORE_WARNING` 或追加 warning，同时保留原始截图错误。

## 9. 验证计划

实现后至少验证：

1. 精准模式不标记元素时行为与当前版本一致。
2. 标记一个 `fixed` 元素并选择“始终隐藏”。
3. 标记一个 `fixed` 元素并选择“最后出现”。
4. 同时标记多个元素，并混用两种策略。
5. 标记 `sticky` 元素，确认不会改变页面布局。
6. 标记主页面元素和 iframe 内元素。
7. 重复点击同一元素，不产生重复标记。
8. Enter 触发截图，点击不会触发原网页行为。
9. Esc 取消后页面没有残留标记、隐藏状态或控制器节点。
10. 截图中途取消、超时、关闭标签页后页面能够恢复。
11. 页面高度动态增长时，最后出现元素只出现在最终输出分段。
12. 标记元素在滚动过程中离开 DOM 时，错误和 warning 可理解。

本项目规则要求代码修改后使用 Biome 格式化实际修改的代码文件；本次仅新增文档，不执行 Biome，也不执行 build。

## 10. 实施边界

本次计划不包含：

- 任意网页元素的永久隐藏配置；
- 修改用户网页源码或持久化标记；
- 截图完成后的图片级对象编辑；
- 多个标签页同时截图；
- 新增第三方依赖；
- 重新设计截图查看器。

实现时应优先复用现有截图服务、精准滚动容器选择、页面恢复和 i18n 机制，保持 `renderer → preload → main → screenshot service` 的边界。
