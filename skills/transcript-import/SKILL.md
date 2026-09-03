# 转录导入任务（transcript-import）

## 任务

把「本次会话」的内容总结成一份 Markdown 转录，写入 Workbench 转录库，用绝对路径定位目标项目。

## 步骤

### 1. 定位目标项目

payload 里写 `projectPath`（本仓库/项目绝对路径，例如 D:\tools\ide-electron）即可，服务端会按路径匹配已注册项目。若报项目未注册，暂停并请用户确认路径。

### 2. 撰写总结

- title：一句话概括本次会话主题。
- rawText：Markdown 正文，建议包含任务目标、关键决策、重要改动（文件/命令）、遗留问题与下一步。
- 语言与本次会话保持一致。

rawText 里提到项目文件时，**一律用「项目根目录的相对路径 + 行号」**写成纯文本（不要用反引号或代码块包裹），例如：

- ✅ 正确：src/core/renderer/pages/detail/useGitWorkflowRunner.ts:307
- ✅ 正确（不带行号时须独立成一行且含目录）：src/core/renderer/pages/detail/useGitWorkflowRunner.ts
- ❌ 错误（文件系统绝对路径）：C:\tools\ide-electron\src\core\renderer\App.tsx:138
- ❌ 错误（只写文件名）：App.tsx:138
- ❌ 错误（顶层根文件无行号）：package.json
- ❌ 错误（用反引号/代码块包住）：`src/core/renderer/App.tsx:138`

要点：路径从项目根写全，不要用 .. 上跳；省略行号时路径须独立成一行且至少含一层目录；项目根下的顶层文件必须带行号才能识别（package.json:1 可以，单独一行 package.json 不行）。

### 3. 写入转录库

先写成临时 payload.json 再提交，避免 shell 转义问题。按环境发送（Windows 下避免用 curl，防本地安全沙箱拦截）：

- **Windows / PowerShell**：
      $body = Get-Content -Raw payload.json
      Invoke-RestMethod -Uri "{base_url}/transcripts/import" -Method Post -ContentType "application/json; charset=utf-8" -Body $body
- **其它环境（WSL / macOS / Linux）**：
      curl -s -X POST "{base_url}/transcripts/import" \
        -H "content-type: application/json; charset=utf-8" \
        [-H "x-workbench-transcript-token: {transcript_import_token}"] \
        -d @payload.json

payload.json 字段：

    {
      "projectPath": "<本仓库/项目绝对路径>",
      "title": "<总结标题>",
      "sourceType": "agent-hook",
      "rawText": "<Markdown 总结，必须是合法 JSON 字符串>",
      "openViewer": false
    }

`openViewer` 默认 `false`（不自动打开转录页），用户要求查看时才改 `true`。鉴权：若 `<transcript_import_token>` 有值则携带对应 token 头；为空则无需鉴权头。

### 4. 汇报结果

- 成功（ok:true）：报告 title 与 sessionId。
- 失败：原样报告 error 字段，最多重试一次，仍失败则停止并说明原因。
