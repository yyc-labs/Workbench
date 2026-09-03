import { readFileSync } from 'fs'

export type TranscriptImportSkillConfig = {
  baseUrl: string
  token: string
}

// 仓库内的 skill 正文文件（与 auto-git-commit 等技能放在一起）。
// 传入的是经 resolveAppResourcePath 解析后的绝对路径：
// dev 为仓库根 skills/...，packaged 为 resources/skills/...（随 extraResources 打包）。
export function readTranscriptImportSkillFile(candidatePaths: string[]): string | undefined {
  for (const candidate of candidatePaths) {
    try {
      const content = readFileSync(candidate, 'utf8')
      if (content.trim()) return content
    } catch {
      // 尝试下一个候选路径
    }
  }
  return undefined
}

function buildConfigBlock({ baseUrl, token }: TranscriptImportSkillConfig): string {
  return ['<transcript-import-config>', `<base_url>${baseUrl}</base_url>`, `<transcript_import_token>${token}</transcript_import_token>`, '<import_endpoint>/transcripts/import</import_endpoint>', '</transcript-import-config>'].join('\n')
}

// skill 文件缺失时的兜底指令（与 SKILL.md 保持同义）。
function buildFallbackSkillMarkdown({ token }: TranscriptImportSkillConfig): string {
  const tokenHint = token ? '请求必须携带鉴权头 -H "x-workbench-transcript-token: <transcript_import_token> 里的值"' : '未配置专用 token，无需携带鉴权头'
  const methodHint = `写入用 POST。Windows 下避免用 curl（防本地安全沙箱拦截），改用 PowerShell：
    $body = Get-Content -Raw payload.json
    Invoke-RestMethod -Uri "{base_url}/transcripts/import" -Method Post -ContentType "application/json; charset=utf-8" -Body $body
  其它环境（WSL/macOS/Linux）用 curl -X POST "{base_url}/transcripts/import" -d @payload.json`

  return `# 转录导入任务（transcript-import）

## 任务

把「本次会话」的内容总结成一份 Markdown 转录，写入 Workbench 转录库，用绝对路径定位目标项目。

## 步骤

1. 定位目标项目：payload 里写 projectPath（本仓库/项目绝对路径）即可，服务端按路径匹配已注册项目。若报项目未注册，暂停并请用户确认路径。
2. 撰写总结：title 一句话主题 + rawText 正文。rawText 提到项目文件时，一律用「项目根目录的相对路径 + 行号」写成纯文本（不要用反引号或代码块包住）：
   正确示例：src/core/renderer/pages/detail/useGitWorkflowRunner.ts:307
   错误示例（绝对路径）：C:\\repo\\src\\App.tsx:138；错误示例（只写文件名）：App.tsx:138
   路径从项目根写全，不要用 ..；省略行号时路径独立成一行且至少含一层目录，顶层根文件必须带行号（package.json:1）。
3. 写入：请求体写 payload.json（含 projectPath、title、sourceType:"agent-hook"、rawText、openViewer:false；openViewer 默认 false，用户要求查看时才改 true），发送方式见下。鉴权：${tokenHint}。
   发送：${methodHint}
4. 成功向用户报告 title 与 sessionId；失败原样报告 error，最多重试一次，仍失败则停止并说明原因。
`
}

// 下发给外部 agent（Claude Code / Codex CLI）的动态 skill 内容：
// 优先读取随应用分发的 skills/transcript-import/SKILL.md 正文，在文首注入配置块，
// 并把正文里的 {base_url} / {transcript_import_token} 占位符替换为真实值，保证示例可直接复制执行。
export function buildTranscriptImportSkillMarkdown(config: TranscriptImportSkillConfig, skillFileContent?: string): string {
  const instructions = (skillFileContent?.trim() ? skillFileContent : buildFallbackSkillMarkdown(config)).replaceAll('{base_url}', config.baseUrl)
  const withToken = config.token ? instructions.replaceAll('{transcript_import_token}', config.token) : instructions
  return `${buildConfigBlock(config)}\n\n${withToken}`
}
