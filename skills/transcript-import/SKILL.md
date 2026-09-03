# 转录导入任务（transcript-import）

## 任务

把「本次会话」的内容总结成一份 Markdown 转录，写入 Workbench 的转录库。

## 步骤

### 1. 解析 projectId（必须最先执行）

对当前工作目录（cwd）执行（对路径做 URL 编码，正斜杠可用）：

    curl -s "{base_url}/transcripts/project-id?path={urlencoded(cwd)}"

返回 ok:true 时从 JSON 读取 projectId，继续步骤 2；404、连接失败或其它错误时**立即暂停任务**，向用户展示失败原因和当前 cwd，请用户确认项目路径或直接提供 projectId，严禁猜测或编造 projectId。

### 2. 撰写总结

- title：一句话概括本次会话主题。
- rawText：Markdown 正文，建议包含任务目标、关键决策、重要改动（文件/命令）、遗留问题与下一步。
- 语言与本次会话语言保持一致。

rawText 提到项目文件时，按下面的写法才能解析成可点击引用（解析器会按项目根拼接并做文件系统校验，只把项目内真实存在的文件转成引用）：

> **重要：文件引用必须写成正文里的纯文本，不要用 Markdown 反引号（`）包裹，也不要用代码块**，否则解析器识别不到。

- 推荐格式「相对项目根目录 + 行号」：src/components/App.tsx:42；绝对路径也可以，但必须以项目根为前缀（如 /home/u/proj/src/main.ts:10 或 C:\repo\src\main.ts:10）。
- 相对路径一律以项目根为基准，即使当前在 src/components/ 里也要写全 src/components/App.tsx，不能只写 App.tsx。
- 不带行号的路径必须独立成一行（按第 1 行处理），且至少包含一层目录。
- 项目根下的顶层文件只有「路径+行号」形式才能识别（package.json:1 可以，单独一行 package.json 不行）。
- 不要用 .. 上跳目录；\ 和 / 分隔符均可（解析后统一为正斜杠）。

### 3. 写入转录库

先把请求体写成临时 payload.json 再提交，避免 shell 转义问题。按环境选择发送方式（Windows 下避免用 curl，防止本地安全沙箱拦截）：

- **Windows / PowerShell 可用**：
      $body = Get-Content -Raw payload.json
      Invoke-RestMethod -Uri "{base_url}/transcripts/import" -Method Post -ContentType "application/json; charset=utf-8" -Body $body
- **其它环境（WSL / macOS / Linux）**：
      curl -s -X POST "{base_url}/transcripts/import" \
        -H "content-type: application/json; charset=utf-8" \
        [-H "x-workbench-transcript-token: {transcript_import_token}"] \
        -d @payload.json

payload.json 字段：

    {
      "projectId": "<步骤 1 获得的 id>",
      "title": "<总结标题>",
      "sourceType": "agent-hook",
      "rawText": "<Markdown 总结，必须是合法 JSON 字符串>",
      "openViewer": false
    }

`openViewer` 默认 `false`（不自动打开转录页），只有用户明确要求「打开查看」时才改 `true`。鉴权：若 `<transcript_import_token>` 有值，请求必须携带上面的 token 头；为空则无需鉴权头。

### 4. 汇报结果

- 成功（ok:true）：向用户报告写入的 title 和 sessionId。
- 失败：原样向用户报告返回的 error 字段；最多重试一次，仍然失败就停止并说明原因。
