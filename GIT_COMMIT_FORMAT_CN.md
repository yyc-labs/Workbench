# Git 提交信息格式（中文）

## 目标
统一本项目的提交信息风格，便于快速检索和追踪问题。

## 推荐格式
`<type>(可选scope):<中文简述>`

说明：
- `type`：提交类型，必填
- `scope`：影响范围，可选（如 `ui`、`runtime`、`theme`）
- `中文简述`：一句话说明本次变更，建议 8~30 字

## type 约定
- `feat`：新功能
- `fix`：问题修复
- `style`：样式/UI 调整（不改变业务逻辑）
- `refactor`：重构（功能不变）
- `chore`：工程性变更（构建、脚本、依赖、配置）
- `debug`：调试相关临时改动（日志、排查辅助）

## 项目内常见示例
- `fix:修复启动白闪并同步窗口主题背景`
- `fix:保存主题更改`
- `fix(ui):浮层点击阻止事件冒泡，防止触发卡片跳转`
- `feat(ui):卡片右键菜单增加启动/停止 Runtime`
- `style:修改终端UI样式`
- `chore:更新构建配置`

## 编写建议
- 一个提交只做一件事，避免“大杂烩”。
- 优先用 `fix/feat`，不要滥用 `chore`。
- `style` 仅用于视觉/样式改动；逻辑修复请用 `fix`。
- 提交信息不加句号，不写“update”“修改一些问题”这类模糊描述。

## 可直接复制的模板
```bash
git commit -m "fix:修复xxx问题"
git commit -m "feat(ui):新增xxx功能"
git commit -m "style:优化xxx页面视觉表现"
git commit -m "chore:调整xxx工程配置"
```

## 详细提交内容示例（用 `-` 列表）
提交标题示例：
`feat(ui):完善多链接展示与交互`

提交说明示例：
- appStore: `processUrls` 从单个字符串改为数组，正则全局匹配捕获全部 URL
- 新增 `UrlPopover` 组件：hover 时弹出浮层列出所有链接，每个链接可点击打开浏览器或复制
- `Detail`、`ProjectCard`、`RuntimePage` 的链接展示区域接入 `UrlPopover`

可复制到命令行（多行 message）：
```bash
git commit -m "feat(ui):完善多链接展示与交互" \
  -m "- appStore: processUrls 从单个字符串改为数组，正则全局匹配捕获全部URL" \
  -m "- 新增 UrlPopover 组件：hover 时弹出浮层列出所有链接，每个链接可点击打开浏览器或复制" \
  -m "- Detail、ProjectCard、RuntimePage 的链接展示区域接入 UrlPopover"
```
