# Build 后 AI 环境选择与脚本自包含改造计划（2026-06-10）

## 背景

当前要解决的问题不是单纯“把脚本打进去”，而是应用现在默认把 AI 运行环境等同于 WSL 和开发机已有脚本。用户未必想用 WSL，目标机器也未必支持 WSL，所以安装期或首启期必须让用户选择 AI 运行环境，应用内部要有统一的环境调控层，根据选择决定 Runtime 和 AI Commit 怎么启动。

这里的“外部资源”重点仍然是：

- 开发机已有脚本，如 `$HOME/tools/...`。
- 项目源码目录中的 `.ps1` / `.sh`。
- 目标机器上是否具备 WSL、pwsh、tmux、Claude/Codex CLI 等系统能力。

## 当前实现快照

### 1. Runtime 目前本质上是 WSL-only

当前默认配置：

- `src/core/electron/main/config.ts`
- `runtimeLauncherScript: '$HOME/tools/claude-code-script/start-claude-with-env.sh'`

当前 Runtime 启动链路：

- `src/core/electron/main/runtime/runtime-service.ts`
- 只认 WSL 路径脚本
- 通过 `wsl.exe -d <distro> -- bash -ilc ...` 启动
- 依赖 `tmux`

结论：

- 当前分支的 Runtime 并没有 Windows native 启动器。
- 用户如果不想用 WSL，现状没有正式选项。
- 用户如果机器没有 WSL，Runtime 只能报错，不能引导选择别的环境。

### 2. AI Commit 比 Runtime 更宽松，但仍依赖外部脚本

当前 AI Commit 链路：

- `src/core/electron/main/ai-commit/ai-commit-service.ts`
- 脚本路径来自 `../../script/auto-git-commit/auto_commit.ps1`
- WSL 项目优先走 WSL `pwsh`
- 非 WSL 项目走 Windows `pwsh`，失败后 fallback `powershell.exe`

结论：

- AI Commit 已经部分支持 Windows 和 WSL 两套执行环境。
- 但脚本资产仍然绑定源码目录，build 后不自包含。
- 也没有统一的“环境选择”配置，只有零散的路径和 fallback。

### 3. 现在缺的是“环境选择层”，不是单一脚本复制

当前代码里缺少一个统一能力：

- 安装时或首启时探测可选环境。
- 让用户明确选择 AI 启动环境。
- 根据选择决定 Runtime 和 AI Commit 的脚本来源、shell、能力要求和诊断策略。
- 在不支持当前环境时，提供降级方案，比如导出/下载脚本包给用户做一体化注入。

## 当前支持矩阵

以当前分支代码为准，现状大致如下：

| 模式 | Runtime | AI Commit | 当前分支状态 |
|------|---------|-----------|--------------|
| `wsl-managed` | WSL + bash + tmux + 外部 `.sh` | WSL `pwsh` + `.ps1` | 部分支持，但不自包含 |
| `windows-managed` | Windows native launcher | Windows `pwsh` / `powershell.exe` + `.ps1` | 只支持 AI Commit，Runtime 不支持 |
| `custom-script` | 用户自定义脚本 | 用户自定义脚本 | 只有零散路径输入，不成体系 |
| `disabled` | 不启用 Runtime | 不启用 AI Commit | 没有正式的产品配置入口 |

这意味着：

- 当前分支不能把 “WSL” 写成唯一正确路径。
- 当前分支也不能承诺“Windows managed Runtime 已支持”。
- 需要先把环境选择能力建起来，再逐步补每种模式。

## 改造目标

目标调整为“环境可选 + 脚本自包含 + 不支持时可导出注入包”：

- 安装期或首启期让用户选择 AI 运行环境，而不是默认强塞 WSL。
- 应用内部有统一环境控制器，决定 Runtime 和 AI Commit 用什么环境启动。
- build / package 后，应用能找到自己附带的脚本资产。
- 当前模式不支持时，UI 要明确告知“不支持 / 可安装 / 需导出脚本包”，而不是直接失败。
- 对没有 WSL 或不想用 WSL 的用户，提供 `custom-script` 路径，支持导出一体化脚本包。
- 所有脚本资产有版本号，避免旧机器残留脚本不可控。

## 推荐架构

### 1. 新增 AI 环境配置模型

建议新增统一环境配置，而不是继续只保存单个脚本路径：

```ts
export type AiEnvironmentMode =
  | 'wsl-managed'
  | 'windows-managed'
  | 'custom-script'
  | 'disabled'

export interface AiEnvironmentConfig {
  mode: AiEnvironmentMode
  runtimeScriptPath?: string
  aiCommitScriptPath?: string
  wslDistro?: string
  wslPwshPath?: string
  scriptSource?: 'bundled' | 'exported' | 'custom'
}
```

建议挂在 `AppConfig` 下，而不是把 Runtime 和 AI Commit 完全拆散：

```ts
aiEnvironment?: AiEnvironmentConfig
```

原因：

- 用户选的是“AI 启动环境”，不是单独选一条脚本路径。
- Runtime 和 AI Commit 最终都属于 AI 运行体系，应该复用同一份环境选择结果。
- 后续支持更多模式时，不需要继续往 `config.ts` 塞零散字段。

### 2. 安装期 / 首启期环境选择器

当前项目还没有正式 installer 配置，所以建议分两层：

- 有 installer 时：安装期询问用户环境偏好。
- 没有 installer 时：应用首启 Setup Wizard 完成同样流程。

首屏逻辑建议：

1. 探测当前机器能力。
2. 列出可选环境。
3. 标注每个环境的状态：`已支持`、`可安装`、`当前分支不支持`、`需自定义脚本`。
4. 用户确认后，执行 bootstrap 或导出脚本包。

建议选项：

- `WSL 托管`
- `Windows 托管`
- `自定义脚本注入`
- `暂不启用 AI Runtime`

其中：

- 如果检测到 WSL + tmux，就允许选择 `WSL 托管`。
- 如果当前分支还没有 Windows Runtime launcher，就把 `Windows 托管` 标成“AI Commit 可用，Runtime 暂不支持”。
- 如果两者都不适合，允许选择 `自定义脚本注入`。
- 对企业机或受限机器，`自定义脚本注入` 是必须保留的兜底路径。

### 3. 新增环境控制器

建议新增主进程模块：

```text
src/core/electron/main/ai-environment/
  environment-controller.ts
  environment-diagnostics.ts
  environment-installer.ts
```

职责：

- 探测当前机器支持哪些模式。
- 根据用户配置生成 Runtime 和 AI Commit 的实际启动方案。
- 判断当前模式是否可运行。
- 负责安装托管脚本、修复托管脚本、导出脚本包。
- 给设置页和首启向导提供统一诊断结果。

建议接口：

```ts
getEnvironmentSupport(): EnvironmentSupportMatrix
prepareEnvironment(mode: AiEnvironmentMode): Promise<PrepareResult>
resolveRuntimeLaunch(): RuntimeLaunchPlan
resolveAiCommitLaunch(): AiCommitLaunchPlan
exportIntegrationScripts(targetDir: string): Promise<ExportResult>
```

### 4. 脚本资源目录要按环境拆分

建议资源目录改成按环境组织：

```text
resources/
  scripts/
    wsl/
      start-runtime.sh
      runtime.version
    windows/
      auto_commit.ps1
      ai_split_plan.ps1
      apply_split_plan.ps1
      ai-commit.version
    packages/
      manifest.json
```

说明：

- `wsl/` 放 WSL 托管模式所需脚本。
- `windows/` 放 Windows PowerShell 侧脚本。
- `packages/manifest.json` 描述版本、目标路径、导出清单。
- 如果后续要提供“一键下载脚本注入包”，这个包应从 `resources/scripts` 生成，而不是再单独维护一套外链资源。

### 5. 各模式的目标行为

#### `wsl-managed`

适用条件：

- Windows 主机
- 已安装 WSL
- 已有可用 distro
- 有 bash/sh
- 有 tmux

目标行为：

- 应用把内置 WSL runtime 脚本安装到 WSL 用户目录。
- Runtime 通过 WSL + tmux 启动。
- AI Commit 根据项目路径决定走 WSL `pwsh` 或 Windows `pwsh`。

建议托管路径：

```text
~/.ide-electron/scripts/runtime/start-runtime.sh
~/.ide-electron/scripts/runtime/runtime.version
```

#### `windows-managed`

当前分支现状：

- AI Commit 基本具备 Windows PowerShell 执行能力。
- Runtime 没有 Windows native launcher。

因此本阶段策略：

- 可以把该模式纳入环境模型。
- 但在 UI 中明确标成“当前分支仅支持 AI Commit，Runtime 暂不可用”。
- 只有在 Windows Runtime launcher 实现后，才允许把它作为完整模式开放。

这一步很重要，因为它能避免后续继续把 WSL 假设写死在配置结构里。

#### `custom-script`

这是非 WSL 用户和受限机器的关键兜底模式。

目标行为：

- 应用允许用户指定自定义 Runtime 脚本和 AI Commit 脚本路径。
- 应用提供“导出一体化脚本包”按钮，把 bundled scripts 导出到用户指定目录。
- 用户可以手动注入到自己的环境中，再把路径回填给应用。

建议支持两种动作：

- `导出脚本包到本地目录`
- `复制脚本注入说明`

这比单纯要求用户自己去仓库翻 `.ps1` / `.sh` 更可控。

#### `disabled`

目标行为：

- 不启用 Runtime。
- 不启用 AI Commit。
- 其余项目管理能力照常使用。

这个模式应该正式存在，而不是靠用户什么都不填来“间接禁用”。

### 6. 统一诊断结果

诊断不应再只围绕 “WSL 是否存在”，而应先围绕“当前选中的环境模式”。

建议结果结构：

```ts
interface EnvironmentSupportMatrix {
  checkedAt: number
  availableModes: Array<{
    mode: AiEnvironmentMode
    status: 'supported' | 'installable' | 'unsupported' | 'partial'
    message: string
  }>
  currentMode: AiEnvironmentMode
}

interface ManagedScriptDiagnostics {
  checkedAt: number
  currentMode: AiEnvironmentMode
  runtime: {
    supported: boolean
    bundledExists: boolean
    installedPath?: string
    installedExists?: boolean
    installedExecutable?: boolean
    version?: string
  }
  aiCommit: {
    supported: boolean
    bundledExists: boolean
    pwshAvailable?: boolean
    scriptPath?: string
  }
}
```

设置页展示逻辑：

- 先显示当前模式。
- 再显示当前模式的能力缺口。
- 最后给出动作：安装、修复、切换模式、导出脚本包。

## 分阶段执行计划

### P0：先补“环境选择”设计，不先写死 WSL

目标：把产品层面的环境模型先立住。

任务：

- 明确 `wsl-managed`、`windows-managed`、`custom-script`、`disabled` 四种模式。
- 补当前分支支持矩阵。
- 确认首启向导替代 installer 的方案。
- 明确“当前分支 Runtime 仅支持 WSL”的限制文案。

验收：

- 文档不再把 WSL 当成唯一默认方案。
- 团队对“先做环境选择层，再补各模式实现”达成一致。

### P1：引入环境配置和控制器

目标：先把配置模型和分发逻辑统一。

任务：

- 在 `AppConfig` 中新增 `aiEnvironment`。
- 新增 `environment-controller.ts`。
- Runtime 和 AI Commit 不再各自直接拼脚本路径，而是从环境控制器取 launch plan。
- 旧配置迁移到新结构。

验收：

- 启动链路不再直接依赖 `$HOME/tools/...` 或 `../../script/...`。
- 当前模式切换后，Runtime / AI Commit 的路径和 shell 解析来自同一个地方。

### P2：脚本资源内置化

目标：先让应用自带脚本资产。

任务：

- 建立 `resources/scripts`。
- 把现有 `script/auto-git-commit/*.ps1` 收进 `resources/scripts/windows/`。
- 把当前外部 WSL runtime 脚本回收到 `resources/scripts/wsl/`。
- 给各类脚本增加版本文件和 manifest。

验收：

- 仓库内可找到所有发布所需脚本源。
- build / package 不再依赖开发机私有目录才能找到脚本。

### P3：先完成 `wsl-managed`

目标：在当前分支已有基础上，把 WSL 模式做完整。

任务：

- 托管安装 WSL runtime 脚本到 `~/.ide-electron/...`。
- 增加 WSL 模式诊断、修复、重装。
- 旧默认路径自动迁移到 `wsl-managed`。

验收：

- 删除开发机 `$HOME/tools/claude-code-script` 后，WSL 模式仍能初始化。
- WSL 脚本缺失时，应用可以自修复。

### P4：完成 `custom-script` 导出 / 注入闭环

目标：没有 WSL 或不想用 WSL 的用户也能继续走下去。

任务：

- 增加“导出一体化脚本包”功能。
- 增加自定义脚本路径保存和验证。
- 给出脚本注入说明。
- 环境不支持时自动推荐切到 `custom-script`。

验收：

- 无 WSL 机器上，用户可以选择 `custom-script`，而不是只能失败。
- 应用能校验用户填入的脚本是否存在、是否可执行、版本是否匹配。

### P5：补打包链路和首启向导

目标：把设计真正落到 build / package 产物。

任务：

- 决定正式打包工具。当前只有 `electron-vite build`，没有 installer。
- build 阶段复制 `resources/scripts` 到产物资源目录。
- packaged 模式从 `process.resourcesPath/scripts` 解析脚本。
- 加入首启向导 UI。

验收：

- 清理 `out/` 后重新 build，产物内可找到脚本资源。
- 新机器首次启动时能先进入环境选择，而不是直接撞到 Runtime 错误。

### P6：再决定是否做 `windows-managed Runtime`

目标：把 Windows managed 作为后续增强，而不是当前阶段硬承诺。

任务：

- 评估是否真的需要 Windows native Runtime launcher。
- 如果需要，再设计对应 launcher、会话管理和诊断体系。

验收：

- 在实现前，UI 和文档都明确它是“未完成能力”。
- 不再出现“配置里好像支持，实际运行不了”的假支持状态。

## 实施顺序建议

建议按下面顺序推进：

1. 先改文档和配置模型，把环境选择层定下来。
2. 再做资源内置和环境控制器。
3. 然后把 `wsl-managed` 做完整，因为它是当前分支唯一真正可运行的 Runtime 模式。
4. 接着补 `custom-script` 导出 / 注入闭环，解决无 WSL 用户。
5. 最后再接打包和首启向导。
6. `windows-managed Runtime` 放到后续能力阶段，不和本轮自包含混在一起。

## 风险和决策点

- 当前没有 installer，安装期选择很可能需要先由首启向导承担。
- Runtime 外部 WSL 脚本的真实内容必须回收到仓库，否则无法做到自包含。
- `custom-script` 如果只给路径输入、不提供导出包和说明，实际可用性仍然很差。
- `windows-managed Runtime` 当前没有实现，不能在产品文案里暗示已经支持。
- WSL、tmux、pwsh、Claude/Codex CLI 这类系统能力不建议由应用静默安装，应做诊断和安装引导。

## 完成标准

满足下面条件后，可以认为这一阶段完成：

- 用户首次进入应用时可以明确选择 AI 运行环境。
- 当前模式的支持状态、缺失能力和修复动作在 UI 中清晰可见。
- 应用内置 Runtime / AI Commit 所需脚本资产。
- 当前分支的 `wsl-managed` 模式不再依赖开发机私有脚本路径。
- 无 WSL 或不想用 WSL 的用户可以切到 `custom-script`，并导出一体化脚本包。
- build / package 产物能包含脚本资源，并在 packaged 模式下被正确解析。
