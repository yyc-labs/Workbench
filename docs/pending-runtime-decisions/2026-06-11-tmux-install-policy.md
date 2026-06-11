# Managed Runtime 的 tmux 安装策略

## 当前状态

待定，尚未落地。

这个文件专门用来记录一个还没有做完的产品决策，避免后面忘掉：

- macOS 和 Linux 的受管 Runtime，是否要把 `tmux` 作为必装依赖？
- 还是继续保留 `Managed Runtime` 和 `Direct Open` 两套模式？

## 当前倾向

不建议把 `tmux` 设成整个应用的全局强制依赖。

目前更合理的方向是：

- `Managed Runtime` 依赖 `tmux`
- `Direct Open` 不依赖 `tmux`
- UI 里明确展示当前模式是否为“受管模式”

## 原因

- `Windows Native` 和 `tmux` 模型并不天然匹配。
- 如果所有平台都强制安装 `tmux`，尤其在 macOS 上会明显增加使用门槛。
- 即使没有会话管理能力，应用本身也应该还能正常使用。

## 还没做的事情

- 还没有把独立的 `Direct Open` Runtime 模式正式产品化。
- UI 还没有完整讲清楚“受管 Runtime”和“非受管 Runtime”的区别。
- macOS / Linux 在缺少 `tmux` 时的提示文案还没有最终定稿。
- 安装 / 引导流程还没有按模式区分 `tmux` 是“必需”还是“可选”。

## 需要重新讨论的时机

在下面这些事情开始前，必须回来看这个决策：

- 正式交付 macOS Runtime 支持
- 正式交付 Linux Runtime 支持
- 定稿 Runtime 的安装引导和诊断 UX

## 建议的后续方案

后续可以在下面三种策略里选一种：

1. 只有 `Managed Runtime` 需要 `tmux`
2. 所有非 Windows Runtime 模式都强制要求 `tmux`
3. 默认不要求 `tmux`，受管模式作为高级能力单独开启

当前推荐：`1`
