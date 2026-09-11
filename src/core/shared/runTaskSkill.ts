/**
 * Prompt shown to AI agents so they can author a valid
 * `.yworkbench/run-tasks.json` for the current project. Single source used by
 * both the "copy prompt" button and the "?" preview dialog in the Run Tasks
 * dialog, so the copied text always matches what the user previewed.
 * Localized like agentSkillPrompt.ts: renderer picks the variant by locale.
 *
 * Keep the schema description in sync with shared/runTasks.ts and the
 * normalization rules in run-task-config-store.ts.
 */
export type RunTaskSkillPromptLocale = 'en-US' | 'zh-CN'

export const RUN_TASK_SKILL_PROMPT_EN = `# Workbench Run Tasks configuration skill

Configure runnable tasks for this project so the Workbench desktop app can start the project with one click ("Start All" runs every enabled task as a dependency DAG).

## Steps

1. Inspect the project: root package.json scripts, workspace manifests (pnpm-workspace.yaml / package.json "workspaces"), docker-compose files, and sub-project directories (server/, backend/, apps/*, etc.). Detect package managers from lockfiles (pnpm-lock.yaml / yarn.lock / package-lock.json).
2. Choose the commands needed to run the project during development: dev servers, API services, and dependency startup (e.g. databases via docker compose). Skip one-off scripts such as build or test unless the user asked for them.
3. Read \`.yworkbench/run-tasks.json\` at the project root if it already exists, preserve existing tasks unless they are wrong, and write the updated file (create the \`.yworkbench\` directory if needed).
4. Validate before finishing: the JSON parses; every task has a unique id; every dependsOn target exists; the dependency graph has no cycles; there are between 1 and 32 tasks.
5. Report one line per task: id, command, cwd, readiness.

## File schema

\`\`\`json
{
  "version": 1,
  "updatedAt": 1730000000000,
  "scanDirectories": ["services/api"],
  "tasks": [
    {
      "id": "docker",
      "name": "Docker",
      "command": "docker compose up -d",
      "stopCommand": "docker compose down",
      "readiness": { "strategy": "exit" }
    },
    {
      "id": "backend",
      "name": "Backend",
      "command": "pnpm run dev",
      "cwd": "server",
      "dependsOn": ["docker"],
      "readiness": { "strategy": "port", "port": 8080 },
      "enabled": true
    },
    {
      "id": "frontend",
      "name": "Frontend",
      "command": "pnpm run dev",
      "dependsOn": ["backend"],
      "readiness": { "strategy": "url" },
      "primaryUrl": true
    }
  ]
}
\`\`\`

## Task fields

- id: required, unique within the file, kebab-case (e.g. "backend").
- name: required, display name.
- command: required, shell command executed from the task cwd.
- cwd: optional, project-relative POSIX directory ("server"); omit for project root. Must stay inside the project.
- stopCommand: optional; executed when the user stops this task and its process has already exited (one-shot tasks), e.g. "docker compose down" for a task running "docker compose up -d".
- dependsOn: optional array of task ids; forms the startup DAG (dependencies start first, downstream tasks wait until dependencies are ready).
- readiness: optional; how downstream tasks know this task is ready:
  - { "strategy": "url" } — first http(s) URL found in the task output (default choice for dev servers). Optional "urlPattern" for a custom regex. Optional "primaryUrlPattern" selects the primary link when several URLs are collected from the output (fallback: the first detected URL).
  - { "strategy": "http", "httpUrl": "http://127.0.0.1:8080/health" } — poll until 2xx.
  - { "strategy": "port", "port": 8080 } — wait until the TCP port listens.
  - { "strategy": "delay", "delayMs": 3000 } — fixed delay.
  - { "strategy": "exit" } — process must exit with code 0 (use for one-shot commands like docker compose up -d).
  - Optional "timeoutMs" (default 60000) on all strategies.
- enabled: optional boolean, default true. Disabled tasks are listed but skipped by Start All (they can still be started manually).
- isDefault: optional, at most one task; marks the task migrated from the legacy single run command.
- useWsl: optional boolean; omit to let Workbench infer Windows vs WSL from the cwd path.
- startupMode: optional "silent" (captured background process, default) or "terminal" (opens an external terminal window; readiness is not awaited).
- primaryUrl: optional boolean; at most one task should set it. Its URL becomes the primary link opened by the app's start-and-open action (pick the user-facing dev server, e.g. the frontend).

## Rules

- Use "scanDirectories" only for sub-projects living outside conventional directories (server/, apps/*, packages/*); paths must be project-relative and must not escape the project root.
- Dev servers should use the exact package-manager command (pnpm run dev / yarn dev / npm run dev) derived from the lockfile in or above the task cwd.
- Do not chain unrelated services with "&&"; model them as separate tasks with dependsOn.
- Windows quoting: commands run through PowerShell, which splits any bareword containing "=" at its first dot — even without spaces, -Dkey=127.0.0.1 shatters into -Dkey=127 and .0.0.1, and Maven fails with a misleading "No plugin found for prefix" error. Single-quote every -D / system-property argument: mvn '-Dspring-boot.run.jvmArguments=-Xms256m -Xmx512m'. Prefer single quotes — double quotes get stripped when a "terminal" task opens an external terminal window.
- Quoting-free alternative on Windows: pass JVM options through the environment instead, e.g. $env:JAVA_TOOL_OPTIONS='-Xms256m -Xmx512m'; mvn -pl service/app spring-boot:run — no -D arguments on the command line, immune to shell tokenization.
- Keep the file human-editable JSON with 2-space indentation and a trailing newline.
`

export const RUN_TASK_SKILL_PROMPT_ZH = `# Workbench 运行任务配置 skill

为本项目配置可运行任务，让 Workbench 桌面端可以一键启动项目（「全部启动」会按依赖 DAG 运行所有启用状态的任务）。

## 步骤

1. 检查项目结构：根 package.json scripts、workspace 清单（pnpm-workspace.yaml / package.json 的 "workspaces"）、docker-compose 文件，以及子项目目录（server/、backend/、apps/* 等）。通过 lockfile（pnpm-lock.yaml / yarn.lock / package-lock.json）判断包管理器。
2. 挑选开发阶段需要运行的命令：开发服务器、API 服务、依赖启动（例如通过 docker compose 启动数据库）。跳过 build、test 等一次性脚本，除非用户明确要求。
3. 如果项目根目录已存在 \`.yworkbench/run-tasks.json\`，先读取并保留其中仍然正确的任务，再写入更新后的文件（必要时创建 \`.yworkbench\` 目录）。
4. 完成前自检：JSON 可解析；每个任务 id 唯一；每个 dependsOn 目标都存在；依赖图无环；任务数量在 1 到 32 之间。
5. 按每个任务一行汇报：id、command、cwd、readiness。

## 文件结构

\`\`\`json
{
  "version": 1,
  "updatedAt": 1730000000000,
  "scanDirectories": ["services/api"],
  "tasks": [
    {
      "id": "docker",
      "name": "Docker",
      "command": "docker compose up -d",
      "stopCommand": "docker compose down",
      "readiness": { "strategy": "exit" }
    },
    {
      "id": "backend",
      "name": "Backend",
      "command": "pnpm run dev",
      "cwd": "server",
      "dependsOn": ["docker"],
      "readiness": { "strategy": "port", "port": 8080 },
      "enabled": true
    },
    {
      "id": "frontend",
      "name": "Frontend",
      "command": "pnpm run dev",
      "dependsOn": ["backend"],
      "readiness": { "strategy": "url" },
      "primaryUrl": true
    }
  ]
}
\`\`\`

## 任务字段

- id：必填，文件内唯一，kebab-case（如 "backend"）。
- name：必填，展示名称。
- command：必填，在该任务 cwd 下执行的 shell 命令。
- cwd：可选，项目相对的 POSIX 目录（如 "server"）；省略表示项目根目录。必须位于项目内部。
- stopCommand：可选；当用户停止本任务且其进程已退出时执行（一次性任务适用），例如运行 "docker compose up -d" 的任务可配置 "docker compose down"。
- dependsOn：可选，任务 id 数组；构成启动 DAG（依赖先启动，下游任务等待依赖就绪后再启动）。
- readiness：可选；下游任务判断本任务已就绪的方式：
  - { "strategy": "url" } —— 从任务输出中提取第一个 http(s) URL（开发服务器的默认选择）。可用 "urlPattern" 指定自定义正则。可选 "primaryUrlPattern" 在收集到多个 URL 时指定主链接（缺省取第一个检测到的 URL）。
  - { "strategy": "http", "httpUrl": "http://127.0.0.1:8080/health" } —— 轮询直到返回 2xx。
  - { "strategy": "port", "port": 8080 } —— 等待 TCP 端口开始监听。
  - { "strategy": "delay", "delayMs": 3000 } —— 固定延迟。
  - { "strategy": "exit" } —— 进程必须以 0 退出（适合 docker compose up -d 这类一次性命令）。
  - 所有策略都支持可选 "timeoutMs"（默认 60000）。
- enabled：可选布尔值，默认 true。禁用的任务仍会出现在列表中，但「全部启动」会跳过（仍可手动单独启动）。
- isDefault：可选，最多一个任务；标记由旧版单条运行命令迁移而来的任务。
- useWsl：可选布尔值；省略时 Workbench 按 cwd 路径自动判断 Windows / WSL。
- startupMode：可选 "silent"（后台捕获输出的进程，默认）或 "terminal"（打开外部终端窗口运行，不等待就绪）。
- primaryUrl：可选布尔值；最多一个任务设置。该任务的 URL 将作为应用「启动并打开」动作打开的主链接（选择面向用户的开发服务器，例如前端）。

## 规则

- 只有当子项目不在常规目录（server/、apps/*、packages/* 等）中时才使用 "scanDirectories"；路径必须相对项目根目录，且不能逃逸出项目根。
- 开发服务器应使用由任务 cwd 处或其上层 lockfile 推导出的包管理器命令（pnpm run dev / yarn dev / npm run dev）。
- 不要用 "&&" 把无关服务串在一条命令里；应拆成多个任务并用 dependsOn 表达先后关系。
- Windows 引号：命令会经过 PowerShell 执行，而 PowerShell 会把含 "=" 的裸词在第一个点处拆开——即使没有空格，-Dkey=127.0.0.1 也会碎成 -Dkey=127 和 .0.0.1，Maven 会报出误导性的 "No plugin found for prefix" 错误。所有 -D / 系统属性参数必须加单引号：mvn '-Dspring-boot.run.jvmArguments=-Xms256m -Xmx512m'。优先单引号——"terminal" 任务把命令交给外部终端窗口时双引号会被吞掉。
- Windows 免引号写法：改用环境变量传递 JVM 参数，例如 $env:JAVA_TOOL_OPTIONS='-Xms256m -Xmx512m'; mvn -pl service/app spring-boot:run——命令行上不含任何 -D 参数，天然不受 shell 分词影响。
- 保持文件为便于人工编辑的 JSON：2 空格缩进，文件末尾带换行。
`

export function buildRunTaskSkillPrompt(locale: RunTaskSkillPromptLocale): string {
  return locale === 'zh-CN' ? RUN_TASK_SKILL_PROMPT_ZH : RUN_TASK_SKILL_PROMPT_EN
}
