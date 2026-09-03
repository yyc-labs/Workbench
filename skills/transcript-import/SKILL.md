# 转录导入任务（transcript-import）

> 文首的 `<transcript-import-config>` 由 IDE Hook Gateway 下发时注入，包含 base_url、token 与接口路径。

## 任务

把「本次会话」的内容总结成一份 Markdown 转录，写入 IDE 的转录库。

## 步骤

### 1. 解析 projectId（必须最先执行）

对当前工作目录（cwd）执行（注意对路径做 URL 编码，正斜杠可用）：

    curl -s "{base_url}/transcripts/project-id?path={urlencoded(cwd)}"

- HTTP 200 且 ok:true：从返回 JSON 读取 projectId，继续步骤 2。
- HTTP 404、连接失败或其它错误：**立即暂停任务**。把失败原因和当前 cwd 展示给用户，请用户确认正确的项目路径，或让用户直接提供 projectId。拿到用户明确确认之前不要继续，严禁猜测或编造 projectId。

### 2. 撰写总结

- title：一句话概括本次会话主题。
- rawText：Markdown 正文，建议包含：任务目标、关键决策、重要改动（文件/命令）、遗留问题与下一步。
- 语言与本次会话语言保持一致。

### 2.1 文件路径写法（关系到能否解析成可点击引用）

转录解析器只会把**项目内真实存在**的文件识别为引用（会用文件系统校验并转成点击链接）。

> **重要：文件引用必须写成正文里的纯文本，不要用 Markdown 反引号（`）包裹，也不要用代码块**。反引号或代码块里的路径会被当作普通行内代码，解析器识别不到，无法转成可点击引用。

提到文件时请按下列格式写：

- 相对路径 + 行号（推荐）：src/components/App.tsx:42
- 绝对路径 + 行号：/home/u/proj/src/main.ts:10 或 C:\repo\src\main.ts:10
- 相对路径独立成行（无行号时按第 1 行）：一行只写 src/components/App.tsx

要求：
- **相对路径一律以「项目根目录」为基准**来写，而不是当前所在目录：解析器会把路径直接拼到项目根上做文件校验。即使当前在 src/components/ 里，也要写全 src/components/App.tsx，不能只写 App.tsx 或 components/App.tsx。
- 绝对路径必须以项目根路径为前缀（路径在项目内）；超出项目范围不会被识别。
- 至少包含一层目录，且带扩展名。例外：**项目根下的顶层文件**只有用「路径+行号」形式才能识别（package.json:1 可以），单独一行 package.json 不行。
- 相对路径不要用 .. 上跳目录；\ / 分隔符均可（解析后统一为正斜杠）。

示例：

    - 改动 src/core/electron/main/hooks/agent-hook-gateway.ts:332，新增 skill 下发端点
    - 调整 package.json:1 的 scripts
    - 新增文件 src/core/renderer/pages/transcript/TranscriptTreeContextMenu.tsx

### 3. 写入转录库

建议先把请求体写成临时 JSON 文件再提交，避免 shell 转义问题。POST 请求按当前环境选择发送工具（Windows 下避免用 curl，防止本地安全沙箱拦截）：

- **Windows / PowerShell 可用**：
      $body = Get-Content -Raw payload.json
      Invoke-RestMethod -Uri "{base_url}/transcripts/import" -Method Post -ContentType "application/json; charset=utf-8" -Body $body
- **其它环境（WSL / macOS / Linux）**：
      curl -s -X POST "{base_url}/transcripts/import" \
        -H "content-type: application/json; charset=utf-8" \
        [-H "x-ide-electron-transcript-token: {transcript_import_token}"] \
        -d @payload.json

payload.json 结构：

    {
      "projectId": "<步骤 1 获得的 id>",
      "title": "<总结标题>",
      "sourceType": "agent-hook",
      "rawText": "<Markdown 总结，必须是合法 JSON 字符串>",
      "openViewer": false
    }

`openViewer` 默认用 `false`（不自动打开转录页）；只有用户明确要求“打开查看”时才改为 `true`。

鉴权：若 `<transcript_import_token>` 有值，请求必须携带上面的 token 头；为空则无需鉴权头。

### 4. 汇报结果

- 成功（ok:true）：向用户报告写入的 title 和 sessionId。
- 失败：原样向用户报告返回的 error 字段；最多重试一次，仍然失败就停止并说明原因。
