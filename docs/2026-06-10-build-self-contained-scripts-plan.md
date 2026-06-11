# AI Runtime 跨平台适配与内置运行资产计划（2026-06-10，2026-06-11 修订）

## 背景

这轮方向需要调整。

当前问题不该先定义成“把脚本打包进去”，而应该先定义成“把 AI Runtime 和 AI Commit 做成明确的跨平台能力”。

正确的一层抽象应该是：

- 先区分宿主平台：`Windows`、`Linux`、`macOS`。
- 再区分执行后端：例如 Windows 下可以选 `WSL` 或 `Windows Native`。
- 最后才决定是否需要脚本、脚本以什么形式随应用内置。

如果顺序反过来，先做“脚本自包含”，就会把现在的 WSL 假设继续固化到产品结构里，后面再补 Linux/macOS 和 Windows Native 时会更难拆。

## 这次修订后的核心判断

### 1. 先做平台适配，再做脚本内置

优先级应改成：

1. 建立跨平台运行模型。
2. 让 Windows / Linux / macOS 都有明确运行路径。
3. 让 Windows 用户可以在 `WSL` 和 `Windows Native` 间选择。
4. 再把运行所需资产内置到应用产物里。

### 2. “不依赖外部脚本”不等于“完全零脚本”

这里真正要禁止的是：

- 依赖开发机私有目录，如 `$HOME/tools/...`
- 依赖源码目录外链脚本
- 依赖用户手动把脚本提前放到某个固定位置

允许存在两类脚本：

- 随应用一起发布的内置脚本资产
- 应用按需生成的极薄启动包装层

但脚本职责必须收缩：

- 业务编排、参数拼装、状态机、诊断逻辑，尽量回收到 `TypeScript / Node`。
- 脚本只负责平台桥接和最薄的一层启动。

### 3. `custom-script` 不应再是主路径

`custom-script` 仍然可以保留，但它应该降级为高级兜底，而不是无 WSL 用户的主要使用方式。

主路径应该是：

- `Windows + WSL`
- `Windows + Native`
- `Linux + Native`
- `macOS + Native`

## 当前代码事实

### 1. Runtime 目前是产品层的 WSL-only

当前默认配置：

- `src/core/electron/main/config.ts`
- `runtimeLauncherScript: '$HOME/tools/claude-code-script/start-claude-with-env.sh'`

当前 Runtime 启动链路：

- `src/core/electron/main/runtime/runtime-service.ts`
- 直接依赖 WSL 路径脚本
- 直接调用 `wsl.exe -d <distro> -- bash -ilc ...`
- 会话能力直接依赖 `tmux`

这说明：

- Runtime 产品能力目前并不是“跨平台但先跑在 WSL 上”，而是“设计上就写死 WSL”。
- 即使底层某些地方已有跨平台基础，Runtime 这一层也还没有正确接上。

### 2. AI Commit 目前只覆盖 Windows / WSL，不覆盖 Linux / macOS

当前 AI Commit 链路：

- `src/core/electron/main/ai-commit/ai-commit-service.ts`
- 入口脚本来自 `../../script/auto-git-commit/auto_commit.ps1`
- WSL 项目优先走 WSL `pwsh`
- 非 WSL 项目走 Windows `pwsh`，失败后 fallback `powershell.exe`

这说明：

- AI Commit 对 Windows 比 Runtime 更宽松。
- 但它依然强依赖 PowerShell 脚本体系。
- 对 Linux / macOS 没有正式的 native 方案。

### 3. 底层 runner 已经有一部分跨平台基础，但没有上升成 Runtime 架构

从 `src/core/electron/main/runner.ts` 看，当前已经存在几类底层能力：

- `host-native`：Windows 下可走 `cmd.exe`
- `wsl-pty`：Windows 下可经由 `wsl.exe`
- `direct-pty`：Linux / macOS 可直接走本地 shell

这说明当前真正缺的不是“完全从零做跨平台”，而是：

- 没有统一的平台 / 后端模型
- Runtime 服务没有基于 provider 抽象重写
- AI Commit 没有从 PowerShell 专属方案演进为多后端方案

## 为什么原方向不对

如果继续按“先做脚本自包含，再补别的平台”推进，会有几个直接问题：

- 会继续把 `WSL + tmux + bash 脚本` 当成默认产品模型。
- Windows Native、Linux Native、macOS Native 都会变成后补例外分支。
- AI Commit 仍然会被 PowerShell 脚本结构绑住。
- 设置页、诊断逻辑、首启流程都会继续围绕“有没有 WSL”组织，而不是围绕“当前平台该怎么运行”组织。

所以这份计划要改成：

- 先把“平台适配 + 后端选择”立住。
- 再做“内置运行资产”。
- 最后才处理导出包、兼容脚本、自定义路径这种附加能力。

## 改造目标

目标重定义为“跨平台优先，内置资产其次”：

- Windows、Linux、macOS 都有明确的 AI Runtime / AI Commit 设计入口。
- Windows 用户可以明确选择 `WSL` 或 `Windows Native`。
- Runtime 和 AI Commit 共享同一个环境配置模型，而不是各自硬编码路径。
- 默认发布形态不再依赖开发机私有脚本目录。
- 能回收进主进程 / Node 的逻辑优先回收，不再把业务逻辑留在平台脚本里。
- 打包后应用能解析自己内置的运行资产。

## 当前支持矩阵

以当前分支代码为准，现状大致如下：

| 宿主平台 | 后端模式 | Runtime 当前状态 | AI Commit 当前状态 | 问题 |
|----------|----------|------------------|--------------------|------|
| `Windows` | `windows-wsl` | 可运行，但写死外部 WSL 脚本与 `tmux` | 可运行，依赖 `.ps1` | WSL 被写成默认答案 |
| `Windows` | `windows-native` | 未实现正式 Runtime | 基本可用 | 只有 AI Commit 有路径 |
| `Linux` | `linux-native` | runner 有 `direct-pty` 基础，但 Runtime 未产品化 | 未实现 | 缺少 provider 与诊断 |
| `macOS` | `macos-native` | runner 有 `direct-pty` 基础，但 Runtime 未产品化 | 未实现 | 缺少 provider 与诊断 |
| `Any` | `custom-script` | 只有零散脚本路径配置 | 只有零散脚本路径配置 | 不应作为主路径 |
| `Any` | `disabled` | 没有正式产品入口 | 没有正式产品入口 | 需要明确化 |

这意味着：

- 当前不能再把 WSL 写成唯一默认方案。
- 当前也不能把“脚本打包”当成本轮的主目标。
- 真正优先项是 Runtime / AI Commit 的跨平台 provider 化。

## 目标支持矩阵

这轮设计完成后，产品层应该对外呈现下面这套模式：

| 宿主平台 | 可选模式 | Runtime | AI Commit | 备注 |
|----------|----------|---------|-----------|------|
| `Windows` | `windows-wsl` | 支持 | 支持 | 保留现有 WSL 路径，但不再依赖外部脚本 |
| `Windows` | `windows-native` | 支持 | 支持 | 用户可不装 WSL |
| `Linux` | `linux-native` | 支持 | 支持 | 不出现任何 WSL 文案 |
| `macOS` | `macos-native` | 支持 | 支持 | 不出现任何 WSL 文案 |
| `Any` | `custom-script` | 高级兜底 | 高级兜底 | 仅用于受限环境或调试 |
| `Any` | `disabled` | 不启用托管 Runtime，但保留普通终端 | 可单独配置 | 不是禁用 AI 命令 |

## 推荐架构

### 1. 先把配置模型改成“平台 + 后端”而不是“脚本路径”

建议新增统一环境配置：

```ts
export type AiExecutionMode =
  | 'windows-wsl'
  | 'windows-native'
  | 'linux-native'
  | 'macos-native'
  | 'custom-script'
  | 'disabled'

export interface AiEnvironmentConfig {
  mode: AiExecutionMode
  runtimeSource: 'bundled' | 'custom'
  aiCommitSource: 'bundled' | 'custom'
  wslDistro?: string
  shell?: 'bash' | 'zsh' | 'pwsh'
  runtimeEntrypoint?: string
  aiCommitEntrypoint?: string
}
```

建议挂到 `AppConfig`：

```ts
aiEnvironment?: AiEnvironmentConfig
```

原因：

- 用户选的是运行模式，不是某个私有脚本路径。
- Windows 下的核心选择其实是 `WSL` 还是 `Native`。
- Linux / macOS 不该背着一套 WSL 专属配置字段。

### 2. 引入 provider 层，替代当前写死的 WSL Runtime 服务

建议新增：

```text
src/core/electron/main/ai-environment/
  environment-controller.ts
  platform-detector.ts
  provider-types.ts
  providers/
    windows-wsl-provider.ts
    windows-native-provider.ts
    linux-native-provider.ts
    macos-native-provider.ts
    custom-script-provider.ts
```

建议接口：

```ts
interface AiExecutionProvider {
  mode: AiExecutionMode
  detectSupport(): Promise<ModeSupport>
  resolveRuntimeLaunch(projectPath: string, cli: 'claude' | 'codex'): Promise<RuntimeLaunchPlan>
  resolveAiCommitLaunch(projectPath: string): Promise<AiCommitLaunchPlan>
  installBundledAssets?(): Promise<InstallResult>
  diagnose?(): Promise<ModeDiagnostics>
}
```

职责：

- 判断当前宿主平台允许哪些模式。
- 为 Runtime 和 AI Commit 统一生成 launch plan。
- 对每个模式输出独立诊断。
- 负责需要的内置资产安装或同步。

### 3. `tmux` 必须降级为某个 provider 的实现细节

这一点很关键。

当前 Runtime 设计把 `tmux` 直接当成产品前提，这会阻塞 Windows Native 和 macOS。

应该改成：

- Runtime 产品层只定义 `start`、`attach`、`list`、`stop` 这类抽象能力。
- `windows-wsl` provider 可以继续用 `tmux`。
- `linux-native` provider 可以选择 `tmux` 或 `direct-pty`，由 provider 自己决定。
- `windows-native` provider 不能被迫复用 `tmux` 假设。
- `macos-native` provider 也不应为了统一而强塞 WSL 风格会话模型。

换句话说：

- `tmux` 是某些模式的 backend，不是产品模型本身。

### 4. AI Commit 要从 PowerShell 脚本主导，改成主进程主导

如果 AI Commit 继续以 `.ps1` 为中心，就很难干净支持 Linux / macOS。

建议边界改成：

- Prompt 组装、文件分析、批次拆分、结果解析、状态持久化，放到 `TypeScript`。
- 真正与平台壳层相关的部分，才保留最薄脚本包装。

目标状态：

- Windows Native 允许 `pwsh` 包装层。
- Windows WSL 允许 `bash` / `pwsh` 桥接。
- Linux / macOS 走本地 shell 包装层，或直接由 Node 进程执行。

### 5. 运行资产目录按平台 / 模式组织

建议资源目录改成：

```text
resources/
  ai/
    manifests/
      windows-wsl.json
      windows-native.json
      linux-native.json
      macos-native.json
    windows/
      wsl/
        start-runtime.sh
      native/
        start-runtime.ps1
        ai-commit.ps1
    posix/
      start-runtime.sh
      ai-commit.sh
```

说明：

- 可以按需共享 `posix/` 资源，但配置模型里仍然区分 `linux-native` 和 `macos-native`。
- 不再依赖 `$HOME/tools/...` 或源码外脚本。
- 业务逻辑尽量不再塞进这些脚本里。

## 首启与设置页流程

首启和设置页都应该先问“当前平台怎么运行”，而不是先问“脚本路径在哪”。

### Windows

建议选项：

- `WSL 托管 Runtime`
- `Windows Native 托管 Runtime`
- `仅使用普通终端`
- `高级：自定义脚本`

展示规则：

- 检测到 WSL 时，展示 `WSL 托管 Runtime`。
- 检测到 Windows Native 依赖满足时，展示 `Windows Native 托管 Runtime`。
- 两者都可用时，让用户明确选一种，不再默认写死 WSL。
- `仅使用普通终端` 的语义应当是“不启用托管 Runtime，但用户仍可自己在终端里运行 `claude` / `codex`”。

### Linux

建议选项：

- `Linux Native 托管 Runtime`
- `仅使用普通终端`
- `高级：自定义脚本`

### macOS

建议选项：

- `macOS Native 托管 Runtime`
- `仅使用普通终端`
- `高级：自定义脚本`

这里要明确区分两件事：

- `托管 Runtime`：应用负责启动、附着、列会话、诊断、恢复。
- `普通终端`：应用只提供普通终端能力，用户自己执行 `claude`、`codex` 或其他命令。

所以“不启用托管 Runtime”不应该等于“不能用 AI”。

设置页诊断也要改成：

- 先显示当前模式
- 再显示该模式缺什么依赖
- 最后显示可执行动作：修复、切换模式、重新安装内置资产

而不是默认显示一套 WSL 诊断字段。

## 分阶段执行计划

### P0：先改文档和模型，确认“平台优先”

目标：团队先统一抽象，不再围绕 WSL 组织方案。

任务：

- 明确 `windows-wsl`、`windows-native`、`linux-native`、`macos-native`、`custom-script`、`disabled` 六种模式。
- 明确 Windows 下 `WSL / Native` 是同级选择，不是主从关系。
- 把 `custom-script` 从主路径降为高级兜底。
- 把“脚本自包含”改成第二阶段目标。

验收：

- 文档不再把 WSL 当成默认产品模型。
- 团队对“先平台适配，再内置资产”达成一致。

### P1：引入环境控制器和 provider 抽象

目标：把 Runtime / AI Commit 的分发逻辑从硬编码路径里抽出来。

任务：

- 在 `AppConfig` 中新增 `aiEnvironment`。
- 新增 `environment-controller.ts` 和 provider 接口。
- Runtime 和 AI Commit 从控制器拿 launch plan，不再各自直接拼路径。
- 增加模式级诊断结构。

验收：

- 配置层不再默认暴露 `$HOME/tools/...` 这类路径。
- Runtime / AI Commit 至少共享同一套模式解析入口。

### P2：先补 Windows 平台完整适配

目标：把当前最接近真实用户场景的 Windows 平台先做完整。

任务：

- 完成 `windows-wsl` provider，替代 Runtime 里直接写死 `wsl.exe` + 外部脚本。
- 设计并实现 `windows-native` provider。
- 让 Windows 首启时可以明确选择 `WSL` 或 `Native`。
- 设置页补充模式切换和依赖诊断。

验收：

- Windows 用户不装 WSL 也有正式路径。
- Windows 用户装了 WSL 时不再被默认强制走 WSL。
- Runtime 产品层不再直接耦合外部 WSL 启动脚本。

### P3：补 Linux / macOS Native 适配

目标：跨平台设计不是口头存在，而是真正把 Linux / macOS 路径接上。

任务：

- 完成 `linux-native` provider。
- 完成 `macos-native` provider。
- 清理设置页、诊断页、报错文案中的 WSL 默认假设。
- 验证 Runtime 与 AI Commit 在非 Windows 宿主上的基本闭环。

验收：

- Linux 上不出现 WSL 专属配置要求。
- macOS 上不出现 WSL 专属配置要求。
- Runtime / AI Commit 都能走各自平台的 native 模式。

### P4：收缩脚本职责，并把运行资产内置化

目标：在平台模型稳定后，再消除对外部脚本的依赖。

任务：

- 把能回收到 `TypeScript / Node` 的 AI Commit 逻辑迁回主进程。
- 建立 `resources/ai` 资产目录。
- 为各模式准备最薄的 bundled wrapper。
- packaged 模式从 `process.resourcesPath` 解析内置资产。

验收：

- 默认发布形态不再依赖开发机私有脚本目录。
- 关键业务逻辑不再绑在 `.ps1` / `.sh` 中。
- 构建产物可以独立找到所需运行资产。

### P5：补首启向导、修复动作和模式迁移

目标：把设计落到真实用户交互里。

任务：

- 增加首启模式选择向导。
- 增加模式切换后的迁移逻辑。
- 增加内置资产修复 / 重装。
- 对旧配置做迁移：把旧的 `runtimeLauncherScript`、`aiCommit` 路径转换成新模式。

验收：

- 新用户首次启动就能选对平台模式。
- 老用户升级后不会因为旧脚本路径失效而直接报错。

### P6：最后才保留 `custom-script` 高级兜底

目标：保留受限环境能力，但不让它污染主设计。

任务：

- 提供高级设置入口，而不是主设置入口。
- 增加路径校验、版本校验、兼容提示。
- 仅在托管模式不可用时，引导用户进入该路径。

验收：

- `custom-script` 可用，但不再成为默认建议。
- 主流程不依赖用户手动管理脚本。

## 实施顺序建议

建议按下面顺序推进：

1. 先改配置模型和文档，把平台 / 后端抽象立住。
2. 再把 Runtime 和 AI Commit 接到 provider 层。
3. 先补完整 Windows 平台，包括 `WSL` 和 `Native` 两条路径。
4. 接着补 Linux / macOS Native。
5. 平台模型稳定后，再做脚本职责收缩和内置运行资产。
6. 最后补首启向导、迁移、`custom-script` 高级兜底。

## 风险和决策点

- `windows-native Runtime` 的会话管理不能简单照抄 `tmux` 模型。
- Linux / macOS 是否需要 `tmux`，应该由 provider 决定，而不是全局硬性要求。
- 如果 AI Commit 继续以 PowerShell 为中心，实现 Linux / macOS 支持会持续别扭。
- “不依赖外部脚本”最好通过“业务逻辑回收进 TS + bundled wrapper”完成，而不是把更多复杂逻辑塞进内置脚本。
- 首启向导和设置页文案需要同步改造，否则 UI 还会继续暗示 WSL 是默认答案。

## 完成标准

满足下面条件后，可以认为这一阶段完成：

- Windows、Linux、macOS 都有正式的 AI Runtime / AI Commit 模式。
- Windows 用户可以在 `WSL` 和 `Windows Native` 间明确选择。
- Runtime 和 AI Commit 不再各自维护一套硬编码路径假设。
- 默认发布形态不再依赖开发机私有脚本目录或源码外部脚本。
- Linux / macOS 用户不再看到 WSL 作为产品前提。
- `custom-script` 仅作为高级兜底存在，而不是主路径。
- 不启用托管 Runtime 时，用户仍可在普通终端中手动运行 `claude` / `codex`。
- packaged 产物能正确解析并使用自己的内置运行资产。
