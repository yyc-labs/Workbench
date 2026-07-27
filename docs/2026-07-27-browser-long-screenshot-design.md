# 浏览器网页长截图实现设计

## 1. 目标

为项目控制的 Chromium/Edge 浏览器标签页提供网页长截图能力，生成一张连续的 PNG 图片，并支持在截图过程中展示进度、取消任务和在失败时恢复网页状态。

本功能的第一阶段目标是覆盖普通网页的整页截图，不承诺一次解决无限滚动、复杂虚拟列表、跨域 iframe 和所有嵌套滚动容器。

## 2. 能力边界

### 2.1 支持范围

- 项目能够通过 CDP 连接的 Chromium/Edge 页面。
- 用户选择的目标标签页。
- 普通以 `window` 或 `document.documentElement` 为主要滚动容器的网页。
- PNG 输出。
- 原生整页截图和分段滚动截图两种策略。
- 用户取消、超时、页面导航和 CDP 断开时的清理与恢复。

### 2.2 暂不承诺

- 任意用户自行启动、且没有 CDP 或扩展权限的浏览器标签页。
- 无限滚动页面的无限采集。
- 所有 iframe、Shadow DOM 和嵌套滚动容器的完整拼接。
- 对视频、实时图表、动态广告等内容提供严格时间一致性。
- 超过浏览器或图像库尺寸上限的单张无限高度图片。

如果未来需要支持用户任意启动的 Chrome/Edge，需要增加浏览器扩展或明确的远程调试启动流程，不能仅依赖 Electron 主进程访问浏览器页面。

## 3. 方案选择

当前项目已有浏览器 AI 的 Playwright/CDP 连接能力，因此截图功能复用现有浏览器连接和目标页面发现机制。

不使用主窗口的 `webContents.capturePage` 作为浏览器网页截图方案。该 API 只能截取 Electron 自己的 `webContents`，不能直接截取外部 Edge/Chrome 页面。

截图策略按以下顺序执行：

```text
选择目标 Page
    ↓
检查页面状态和滚动信息
    ↓
尝试 Playwright fullPage 截图
    ↓ 失败或页面声明需要滚动处理
执行分段滚动截图
    ↓
拼接、裁剪、编码
    ↓
恢复页面并返回结果
```

## 4. 总体架构

```text
renderer 截图按钮/标签页选择/进度
        ↓ IPC
main screenshot service
        ├── target page resolver
        ├── page analyzer
        ├── page preprocessor
        ├── full-page capture strategy
        ├── segmented capture strategy
        ├── image composer
        └── restore and cancellation guard
        ↓
PNG Buffer / 文件路径 / 剪贴板
```

建议新增以下模块：

- `src/core/shared/screenshot.ts`：截图配置、进度、结果和错误类型。
- `src/core/electron/main/screenshot/screenshotService.ts`：任务生命周期和策略编排。
- `src/core/electron/main/screenshot/pageAnalyzer.ts`：页面尺寸、DPR、滚动容器和能力分析。
- `src/core/electron/main/screenshot/pagePreprocessor.ts`：动画、视频和悬浮元素处理及恢复。
- `src/core/electron/main/screenshot/segmentedCapture.ts`：滚动、等待、截图和分段结果管理。
- `src/core/electron/main/screenshot/imageComposer.ts`：裁剪、拼接和编码。
- `src/core/electron/main/ipc/registerScreenshotIpcHandlers.ts`：IPC 装配层。
- `src/core/electron/preload/invokeApi.screenshot.ts`：renderer 调用 API。

具体文件名可根据现有 domain 组织方式调整，但截图业务不应直接堆入浏览器 AI service。

## 5. 页面选择

截图开始前，主进程需要从 CDP BrowserContext 获取可用 Page，并返回最少信息给 renderer：

```ts
interface BrowserScreenshotTarget {
  id: string
  title: string
  url: string
  isClosed: boolean
  isActiveCandidate: boolean
}
```

不能无条件使用 `context.pages()[0]`。浏览器可能同时存在多个标签页，renderer 应允许用户选择目标页面；默认选择最近活动或当前浏览器 AI 使用的页面。

任务开始后应记录目标 Page 的唯一标识，并在截图过程中确认页面没有被关闭或替换。

## 6. 页面分析

进入截图任务后，先在目标 Page 中读取：

- `window.innerWidth`、`window.innerHeight`；
- `document.documentElement.scrollHeight`；
- `document.body.scrollHeight`；
- 当前 `scrollX`、`scrollY`；
- `devicePixelRatio`；
- 页面是否存在明显的内部滚动容器；
- 页面是否存在懒加载图片、视频、canvas 和固定/粘性元素。

第一阶段默认使用页面主滚动容器。如果发现主文档高度很小但存在明显的内部滚动容器，应暂时返回“页面使用复杂滚动容器”的可理解错误，或在后续版本进入专门处理路径，不应盲目截出一张空白图。

截图过程中页面高度可能增长，因此每完成一段后需要重新读取高度，并同时限制：

- 最大总高度；
- 最大截图段数；
- 最大任务持续时间。

## 7. 页面预处理

预处理必须返回可恢复的清理句柄。无论成功、失败、取消还是 CDP 断开，都应在 finally 路径中执行恢复。

### 7.1 动画和视频

可以注入一次性的样式，暂停 CSS 动画和过渡效果，并暂停页面中的视频。不要永久修改页面源码，也不要依赖页面自身的 class 名称。

应记录以下风险：

- 实时页面在截图过程中仍可能发生变化；
- canvas 只能保留截图时的当前帧；
- GIF 和动态广告不保证各段画面一致；
- 暂停视频可能改变用户正在观看的状态，因此默认应在结束时恢复播放状态。

### 7.2 fixed 和 sticky 元素

不能简单隐藏全部 `fixed` 和 `sticky` 元素，因为其中可能包含页面正文、导航栏或播放器。

建议提供策略：

```ts
type FixedElementPolicy = 'keep' | 'hide' | 'keep-once'
```

第一阶段默认只处理明显的悬浮按钮、客服按钮和广告控件；导航栏、正文工具栏等元素默认保留。`sticky` 元素不能直接按照 `fixed` 元素处理，必要时应通过分段重叠和裁剪减少重复。

预处理还应考虑页面动态新增元素。截图期间如果页面持续创建悬浮节点，只扫描一次可能不足；可以在每段截图前重新检查，但必须限制扫描成本。

## 8. 原生整页截图

对普通页面优先调用 Playwright 的整页截图：

```ts
await page.screenshot({
  type: 'png',
  fullPage: true,
})
```

原生方案成功且输出尺寸在限制范围内时，直接返回结果。以下情况进入分段方案：

- 页面有懒加载内容，整页结果存在空白；
- 页面使用特殊滚动容器；
- 原生截图失败；
- 图片尺寸或内存接近上限；
- 用户明确选择兼容模式。

## 9. 分段滚动截图

分段方案的单段流程如下：

```text
计算目标 scrollTop
    ↓
scrollTo
    ↓
等待页面布局稳定
    ↓
等待可见图片和字体
    ↓
等待 requestAnimationFrame × 2
    ↓
截图当前 viewport
    ↓
记录实际 scrollTop、截图尺寸和页面高度
```

不能只使用固定 `sleep(500)`。建议使用有上限的组合等待：

- 页面滚动后等待一小段稳定时间；
- 检查 `document.fonts.ready`；
- 对可见图片调用 `decode()`，每张图片设置超时；
- 等待两帧；
- 达到最大等待时间后继续截图并记录 warning。

分段位置应保留 overlap，不建议使用严格无重叠的 `0~viewportHeight`、`viewportHeight~2*viewportHeight`。最终拼接时根据预设 overlap 或像素匹配裁掉重复区域，避免 DPR、滚动条和亚像素布局产生接缝。

最后一段应按剩余页面高度裁剪，不能直接把完整 viewport 拼接进去，否则会重复页面底部内容。

## 10. 懒加载和动态内容

截图滚动本身会触发 `loading="lazy"` 和 `IntersectionObserver`，但触发后页面可能还需要异步请求和 React/Vue 重新渲染。

处理原则：

- 每段滚动后等待可见资源；
- 不默认把所有图片改成 eager，避免一次性请求大量资源；
- 图片加载失败时保留原页面结果，并在进度或结果中记录 warning；
- 页面高度持续增长时重新计算段数；
- 达到最大高度、最大段数或最大时间后停止，并明确提示结果可能不完整。

无限滚动页面不能以“直到 `scrollTop >= scrollHeight`”作为唯一结束条件。还需要检测连续多次滚动后高度无变化，或者使用用户配置的最大高度。

## 11. 图片拼接和内存策略

第一阶段可以将各段 PNG 保留为 Buffer，完成后统一拼接；同时应设置尺寸保护，避免大图导致 renderer 或主进程崩溃。

建议限制：

- 最大宽度；
- 最大高度；
- 最大段数；
- 最大原始像素数；
- 最大任务内存估算。

当页面接近上限时，后续版本支持：

- 分片 PNG 输出；
- 树状合并；
- 临时文件流式拼接；
- JPEG/WebP 压缩；
- 用户选择“完整图片”或“分片导出”。

如果引入 Sharp，需要额外验证 Windows 原生模块、Electron 打包、开发环境和发布环境的架构兼容性。未确认前不新增依赖。

## 12. IPC 契约建议

截图任务适合采用“开始任务 + 进度事件 + 取消任务”的形式，而不是一个没有进度的长时间 invoke。

建议接口：

```ts
listBrowserScreenshotTargets(): Promise<BrowserScreenshotTarget[]>

startBrowserScreenshot(payload: BrowserScreenshotRequest): Promise<BrowserScreenshotResult>

cancelBrowserScreenshot(taskId: string): Promise<boolean>

onBrowserScreenshotProgress(listener: (event: BrowserScreenshotProgress) => void): () => void
```

进度至少包含：

```ts
type BrowserScreenshotStage =
  | 'analyzing'
  | 'preparing'
  | 'capturing'
  | 'composing'
  | 'saving'
  | 'completed'
  | 'failed'
  | 'cancelled'
```

每个阶段应带有 `taskId`、当前段数、总段数（如果已知）、百分比、warning 和可展示的错误信息。

主进程需要保证同一浏览器连接同一时间只有一个截图任务，避免两个任务互相滚动和覆盖恢复状态。

## 13. 错误处理

错误应区分用户可理解的类别，而不是直接把底层异常字符串显示给用户：

- `BROWSER_NOT_CONNECTED`：浏览器未连接；
- `TARGET_NOT_FOUND`：目标标签页已关闭；
- `PAGE_NOT_SUPPORTED`：页面滚动结构暂不支持；
- `CAPTURE_TIMEOUT`：截图超时；
- `IMAGE_TOO_LARGE`：图片超过尺寸或内存限制；
- `CAPTURE_CANCELLED`：用户取消；
- `COMPOSE_FAILED`：图片拼接失败；
- `RESTORE_WARNING`：截图成功但页面恢复存在风险。

任务失败时应尽可能恢复原始 scroll position、视频播放状态、动画样式和悬浮元素。恢复失败不能覆盖原始截图错误，但应作为 warning 返回。

## 14. 用户体验

第一阶段建议入口提供：

- 截取当前网页；
- 选择标签页；
- 开始/取消；
- 当前阶段和进度；
- 完成后预览、保存和复制到剪贴板；
- 超长页面或结果不完整时的明确提示。

后续再增加：

- 当前视口截图；
- 选定区域截图；
- 指定元素截图；
- 隐藏悬浮元素开关；
- 固定导航保留策略；
- PDF、WebP 和分片导出。

## 15. 测试矩阵

至少需要验证以下页面类型：

1. 普通静态长页面。
2. 带固定顶部导航的页面。
3. 带 sticky 表头的表格。
4. 使用 `loading="lazy"` 图片的页面。
5. 图片加载慢或加载失败的页面。
6. 页面存在持续网络请求的页面。
7. 页面高度超过单图限制的页面。
8. 无限滚动页面。
9. 使用内部滚动容器的页面。
10. 截图中途关闭标签页、断开 CDP 或点击取消。

验证重点不是只有图片是否生成，还包括：

- 接缝是否重复或缺失；
- 页面是否恢复原始滚动位置；
- 动画和视频是否恢复；
- 任务是否最终结束；
- 大图是否导致内存异常；
- 错误提示是否可理解。

## 16. 分阶段实施计划

### Phase 1：最小可用版本

- 复用现有 CDP/Playwright 连接。
- 列出并选择目标标签页。
- 支持普通网页的 `fullPage` PNG 截图。
- 增加任务锁、取消、超时和进度。
- 完成基础页面恢复。

### Phase 2：兼容模式

- 增加分段滚动截图。
- 增加字体、图片和布局稳定等待。
- 增加 overlap 裁剪。
- 增加动态高度和懒加载处理。
- 增加 fixed 元素策略。

### Phase 3：大图和复杂页面

- 内部滚动容器识别和处理。
- 更可靠的 sticky 元素去重。
- 超长页面分片导出。
- 选定区域、指定元素和 PDF/WebP 输出。

## 17. 待确认决策

- 第一阶段是否只支持项目启动的 Edge，还是同时支持外部 CDP 浏览器。
- 截图结果默认保存文件、复制剪贴板，还是二者都提供。
- 默认是否隐藏悬浮按钮和广告。
- 最大截图高度、宽度和任务时长。
- 是否允许引入 Sharp，还是先实现无新增依赖版本。
- 用户是否需要在浏览器中看到滚动过程，还是使用后台/不可见页面完成截图。

