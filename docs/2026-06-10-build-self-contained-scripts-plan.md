# Build 后脚本依赖自包含改造计划（2026-06-10）

## 背景

当前分支目标是解决应用 build / 后续打包后不能直接使用的问题。这里的“外部资源”重点不是网络 API 或字体资源，而是当前开发机上已经存在的外部脚本和工具路径。现状里部分运行时能力依赖 `$HOME/tools/...`、固定 WSL 路径、项目源码目录中的脚本相对位置；这些假设在 build 输出目录或安装包环境中不稳定。

## 当前问题定位

### 1. Runtime 启动脚本依赖开发机路径

当前默认配置写死为：

- `src/core/electron/main/config.ts`
- `runtimeLauncherScript: '$HOME/tools/claude-code-script/start-claude-with-env.sh'`

实际启动链路在：

- `src/core/electron/main/runtime/runtime-service.ts`
- 读取 `loadConfig().runtimeLauncherScript`
- 展开 `$HOME`
- 在 WSL 内检查脚本是否存在且可执行
- 通过 `wsl.exe -d <distro> -- bash -ilc '<launcher> --cli <claude|codex> <projectPath>'` 启动

风险：

- 新机器没有 `$HOME/tools/claude-code-script/start-claude-with-env.sh`。
- build 后应用本身没有提供这个脚本。
- 用户配置一旦保留旧路径，打包版仍然继续找开发机路径。
- 诊断只能提示缺失，不能修复或初始化。

### 2. AI Commit 脚本路径依赖源码布局

当前执行链路在：

- `src/core/electron/main/ai-commit/ai-commit-service.ts`
- `scriptPs1Path = join(__dirname, '../../script/auto-git-commit/auto_commit.ps1')`
- Windows 项目走 `pwsh -File <scriptPs1Path>`
- WSL 项目把该路径转换成 WSL 路径后走 WSL 内的 `pwsh`

风险：

- `electron-vite build` 只输出 `out/main`、`out/preload`、`out/renderer`，不会天然复制 `script/auto-git-commit/*.ps1`。
- 后续如果启用 asar，`spawn` 不能可靠执行 asar 内脚本，脚本必须放在 unpacked 或 extraResources。
- WSL 内固定优先 `/snap/bin/pwsh`，新机器可能没有，虽然会 fallback 到 `pwsh`，但缺少明确诊断。

### 3. 系统能力和应用脚本边界混在一起

必须区分两类依赖：

- 目标机器必须安装的系统能力：WSL、目标 distro、bash/sh、tmux、Windows Terminal、PowerShell/pwsh、git、Claude/Codex CLI。
- 应用应该自带或初始化的脚本资产：runtime launcher、AI Commit PowerShell 脚本、未来可能增加的 hook / bootstrap 脚本。

当前代码对系统能力有部分探测，但对“应用脚本资产”没有统一资源目录、版本、安装、迁移和修复机制。

## 改造目标

目标不是把 WSL、tmux、Claude/Codex CLI 全部打进应用，而是让应用自带自己的启动脚本，并能在新机器上完成初始化：

- build / package 后，应用能找到自身附带的脚本资产。
- 首次启动时能把需要在 WSL 内执行的脚本安装到稳定位置。
- 用户旧配置指向开发机路径时，能自动迁移到应用托管路径或明确提示。
- 设置页诊断能区分“系统能力缺失”和“应用脚本缺失”。
- 任何脚本升级都有版本号，避免用户机器残留旧脚本导致行为不可控。

## 推荐架构

### 1. 新增应用脚本资源目录

建议在源码中新增：

```text
resources/
  scripts/
    runtime/
      start-runtime.sh
      runtime-script.version
    ai-commit/
      auto_commit.ps1
      ai_split_plan.ps1
      apply_split_plan.ps1
      ai-commit-script.version
```

说明：

- `resources/scripts/runtime/start-runtime.sh` 替代 `$HOME/tools/claude-code-script/start-claude-with-env.sh` 作为应用内置 runtime launcher。
- `resources/scripts/ai-commit/*.ps1` 替代运行时从源码 `script/auto-git-commit` 查找。
- `script/auto-git-commit` 可以保留为开发期入口，但发布链路只认 `resources/scripts/...`。

### 2. 新增脚本资源解析层

建议新增主进程模块：

```text
src/core/electron/main/app-resources/
  script-resources.ts
```

职责：

- 判断当前是 dev / build / packaged。
- 返回应用脚本资源根目录。
- dev 模式可指向项目根下 `resources/scripts`。
- packaged 模式指向 `process.resourcesPath/scripts` 或 electron-builder `extraResources` 目标目录。
- 禁止业务代码直接用 `__dirname ../../script/...` 拼路径。

建议提供接口：

```ts
resolveBundledScriptPath(kind: 'runtime' | 'ai-commit', fileName: string): string
resolveUserDataScriptPath(kind: 'runtime' | 'ai-commit', fileName: string): string
getBundledScriptVersion(kind: 'runtime' | 'ai-commit'): string
```

### 3. Runtime 脚本采用“内置资源 + WSL 安装”模式

Runtime launcher 最终需要在 WSL 内执行，因此不能只依赖 Windows 侧资源路径。建议启动时执行 bootstrap：

```text
Windows resources/scripts/runtime/start-runtime.sh
  -> copy/install to WSL:
     ~/.ide-electron/scripts/runtime/start-runtime.sh
     ~/.ide-electron/scripts/runtime/runtime-script.version
  -> chmod +x
  -> runtime-service 使用该 WSL 路径启动
```

默认配置建议改为应用托管语义，而不是物理路径：

```ts
runtimeLauncherScript: 'managed'
```

或者新增字段，兼容旧配置：

```ts
runtimeLauncherMode?: 'managed' | 'custom'
runtimeLauncherScript?: string
```

迁移策略：

- 新用户默认 `managed`。
- 旧用户如果 `runtimeLauncherScript` 等于 `$HOME/tools/claude-code-script/start-claude-with-env.sh`，自动迁移到 `managed`。
- 旧用户如果配置了自定义路径，保留为 `custom`，但诊断页明确提示“自定义脚本不随应用打包”。

### 4. AI Commit 脚本采用“extraResources / unpacked 可执行文件”模式

AI Commit PowerShell 脚本不应该从 `out/main` 反推源码目录。建议：

- dev 模式读取 `resources/scripts/ai-commit/auto_commit.ps1`。
- packaged 模式读取 `process.resourcesPath/scripts/ai-commit/auto_commit.ps1`。
- 如果启用 asar，必须保证脚本在 asar 外。

后续打包配置应包含：

```json
{
  "extraResources": [
    {
      "from": "resources/scripts",
      "to": "scripts"
    }
  ]
}
```

如果暂时只做 `electron-vite build`，也要增加复制步骤，把 `resources/scripts` 同步到 `out/resources/scripts` 或统一的 build 产物资源目录。否则 build 输出仍然不包含脚本。

### 5. 增加脚本诊断和修复入口

设置页 Runtime Diagnostics 应拆成两组：

- 系统能力：WSL、distro、bash/sh、tmux、wt.exe、pwsh、git、Claude/Codex CLI。
- 应用脚本：bundled script 是否存在、版本是否匹配、WSL installed script 是否存在、是否 executable、是否需要重装。

建议新增 IPC：

```text
scripts:diagnose
scripts:install-runtime
scripts:repair
```

诊断结果示例：

```ts
interface ManagedScriptDiagnostics {
  checkedAt: number
  runtime: {
    bundledExists: boolean
    bundledVersion: string
    installedWslPath: string
    installedExists: boolean
    installedExecutable: boolean
    installedVersion: string
    needsInstall: boolean
  }
  aiCommit: {
    bundledExists: boolean
    bundledVersion: string
    pwshAvailable: boolean
  }
}
```

## 分阶段执行计划

### P0：冻结现状并补资源清单

目标：先把“不自包含”的点写清楚，避免边改边漏。

任务：

- 建立 `resources/scripts` 目录。
- 把当前 `script/auto-git-commit/*.ps1` 复制到 `resources/scripts/ai-commit/`。
- 根据现有 `$HOME/tools/claude-code-script/start-claude-with-env.sh` 的真实内容，整理出 `resources/scripts/runtime/start-runtime.sh`。
- 给 runtime 和 ai-commit 脚本各加一个 version 文件。
- 明确目标机器仍需用户安装的系统能力清单。

验收：

- 文档列出的应用脚本都能在仓库内找到。
- 不再只有开发机 `$HOME/tools/...` 才有 runtime launcher 源码。

### P1：主进程统一资源解析

目标：业务代码不再手写 `__dirname ../../script/...`。

任务：

- 新增 `script-resources.ts`。
- AI Commit 改为通过 `resolveBundledScriptPath('ai-commit', 'auto_commit.ps1')` 获取脚本。
- Runtime 改为通过托管路径获取 WSL installed script。
- 保留 dev fallback，但 fallback 只能指向仓库内 `resources/scripts`，不能指向个人 `$HOME/tools`。

验收：

- 搜索 `../../script/auto-git-commit` 无结果。
- 搜索 `$HOME/tools/claude-code-script` 只允许出现在迁移兼容或文档中。

### P2：Runtime 托管脚本安装器

目标：新机器首次运行时可自动准备 WSL 侧 launcher。

任务：

- 新增 runtime script installer。
- 安装路径固定为 `~/.ide-electron/scripts/runtime/start-runtime.sh`。
- 安装过程使用 WSL 执行 `mkdir -p`、写入文件、`chmod +x`、写入 version。
- 启动 Runtime 前，如果诊断发现缺失或版本不一致，提示用户一键修复；也可以在首次启动时自动安装。
- 旧默认路径自动迁移到 managed。

验收：

- 删除 WSL 内 `~/.ide-electron/scripts/runtime` 后，点击修复能恢复。
- Runtime 启动不再依赖 `$HOME/tools/claude-code-script/start-claude-with-env.sh`。
- 自定义脚本路径仍可使用，但 UI 明确显示这是 advanced/custom。

### P3：打包链路接入资源

目标：build / package 输出包含脚本资产。

任务：

- 决定正式打包工具。当前 `package.json` 只有 `electron-vite build`，还没有 electron-builder / forge 配置。
- 如果引入 electron-builder，配置 `extraResources` 复制 `resources/scripts -> scripts`。
- 如果短期仍只做 build，新增一个 build 后复制脚本的命令，例如 `build:scripts`，保证产物目录包含资源。
- 明确 asar 策略：脚本必须在 asar 外，不能只放进 JS bundle。

验收：

- 清理 `out/` 后重新 build，产物中能找到 `scripts/runtime/start-runtime.sh` 和 `scripts/ai-commit/auto_commit.ps1`。
- 从产物目录启动应用时，AI Commit 脚本路径指向产物资源，不指向源码 `script/`。

### P4：诊断、错误提示和迁移收口

目标：用户看到的是可操作问题，而不是底层 spawn 失败。

任务：

- 设置页增加“应用脚本”诊断块。
- Runtime 诊断里区分：
  - WSL 缺失
  - tmux 缺失
  - managed runtime script 未安装
  - managed runtime script 版本过旧
  - custom runtime script 不存在
- AI Commit 诊断里区分：
  - bundled ps1 缺失
  - pwsh 缺失
  - WSL pwsh 缺失但 Windows pwsh 可用
- 对旧配置执行一次迁移，并保留用户可回滚的 custom 选项。

验收：

- 新机器首次运行时，设置页能明确告诉用户缺什么。
- 点击修复后，应用脚本类问题可以被应用自己解决。
- 系统能力缺失只提示安装指引，不伪装成应用可自动修复。

## 实施顺序建议

建议按下面顺序推进，不要先做 UI：

1. 先把 `resources/scripts` 和资源解析层落地。
2. 再改 AI Commit 脚本路径，因为它最容易验证。
3. 再做 Runtime WSL 安装器，因为它涉及跨 Windows / WSL 文件写入和权限。
4. 最后补设置页诊断和迁移 UI。
5. 打包配置在资源解析稳定后接入，避免先写死错误目录。

## 风险和决策点

- 是否要引入 electron-builder：如果目标是安装包，必须尽快确定；只跑 `electron-vite build` 不是完整桌面应用打包。
- runtime launcher 的真实内容需要从当前机器外部脚本回收进仓库，否则无法做到自包含。
- WSL 里的 Claude/Codex CLI 不建议随应用打包，应该作为系统能力诊断和安装指引处理。
- `pwsh` 不建议由应用静默安装，应该诊断缺失并给出用户可执行的安装说明。
- 如果未来支持非 Windows，资源解析和 Runtime installer 要先抽象平台分支，避免把 WSL 假设扩散到业务层。

## 完成标准

满足下面条件后，可以认为“脚本依赖自包含”这一阶段完成：

- 仓库内包含 runtime launcher 和 AI Commit 脚本的发布源。
- build / package 产物包含脚本资产。
- 运行时代码通过统一资源解析层获取脚本路径。
- Runtime 默认使用应用托管的 WSL 脚本路径。
- 删除开发机 `$HOME/tools/claude-code-script` 后，打包版仍能完成 Runtime 初始化或给出一键修复。
- 删除源码目录 `script/auto-git-commit` 后，打包版 AI Commit 不受影响。
- 设置页能明确区分系统能力缺失和应用脚本缺失。
