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
  return [
    '<transcript-import-config>',
    `<base_url>${baseUrl}</base_url>`,
    `<transcript_import_token>${token}</transcript_import_token>`,
    '<project_lookup_endpoint>/transcripts/project-id?path={cwd}</project_lookup_endpoint>',
    '<import_endpoint>/transcripts/import</import_endpoint>',
    '</transcript-import-config>',
  ].join('\n')
}

// skill 文件缺失时的兜底指令（与 SKILL.md 保持同义）。
function buildFallbackSkillMarkdown({ token }: TranscriptImportSkillConfig): string {
  const tokenHint = token ? '请求必须携带鉴权头 -H "x-ide-electron-transcript-token: <transcript_import_token> 里的值"' : '未配置专用 token，无需携带鉴权头'
  const methodHint = `写入用 POST。Windows 下避免用 curl（防本地安全沙箱拦截），改用 PowerShell：
    $body = Get-Content -Raw payload.json
    Invoke-RestMethod -Uri "{base_url}/transcripts/import" -Method Post -ContentType "application/json; charset=utf-8" -Body $body
  其它环境（WSL/macOS/Linux）用 curl -X POST "{base_url}/transcripts/import" -d @payload.json`

  return `# 转录导入任务（transcript-import）

## 任务

把「本次会话」的内容总结成一份 Markdown 转录，写入 IDE 的转录库。

## 步骤

1. 解析 projectId：curl -s "{base_url}/transcripts/project-id?path={urlencoded(cwd)}"。查不到时立即暂停任务并向用户确认，严禁猜测 projectId。
2. 撰写 Markdown 总结（title 一句话主题 + rawText 正文）。rawText 提到项目文件时，用「相对项目根目录 + 行号」格式（如 src/components/App.tsx:42）或「以项目根为前缀的绝对路径 + 行号」；相对路径一律以项目根为基准（当前目录在子目录也要写全），顶层根文件需带行号（package.json:1），禁止用 ..。解析器会按项目根拼接校验真实文件后转成可点击引用。
3. 写入：请求体写 payload.json（含 projectId、title、sourceType:"agent-hook"、rawText、openViewer:false；openViewer 默认 false 不打开转录页，用户要求查看时才改 true），发送方式见下。鉴权：${tokenHint}。
   发送：${methodHint}
4. 成功向用户报告 title 与 sessionId；失败原样报告 error，最多重试一次。
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
