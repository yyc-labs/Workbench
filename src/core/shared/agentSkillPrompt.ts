export type AgentSkillPromptLocale = 'en-US' | 'zh-CN'

// Agent Skill 提示词模板：同时被 renderer「设置页复制按钮」(i18n messages/settings.ts 引用)
// 与 main「Ctrl+Shift+L 全局粘贴」使用，保证两处文案单点一致。保留 {command} 占位符。
export const AGENT_SKILL_PROMPT_EN_TEMPLATE =
  'Summarize this session and save it into the IDE transcript library. First run {command} to fetch the skill, then strictly follow the returned JSON `skill` field (Markdown instructions including the <transcript-import-config> base_url / token): resolve the projectId for the current working directory (pause and ask me if not found), summarize this session into Markdown, then POST it to /transcripts/import. Requirements: mention files using "project-root-relative path + line number" (e.g. src/x.ts:12 — the parser joins the path onto the project root and checks it is a real file; write the full path from the root even when inside a subdirectory); on Windows send the POST with PowerShell Invoke-RestMethod instead of curl, on other environments (WSL/macOS/Linux) curl is fine. Finally report the result.'

export const AGENT_SKILL_PROMPT_ZH_TEMPLATE =
  '请把本次会话总结保存到 IDE 转录库。先执行 {command} 获取 skill，然后严格按返回 JSON 的 skill 字段（Markdown 指令，含 <transcript-import-config> 的 base_url / token）执行：解析当前工作目录对应的 projectId，查不到就先暂停询问我；再把本次会话总结成 Markdown 通过 POST /transcripts/import 写入。要求：提到文件时用「相对项目根目录 + 行号」格式（如 src/x.ts:12，解析器按项目根拼接校验、需项目内真实文件，当前在子目录也要从根写全）；POST 在 Windows 下用 PowerShell 的 Invoke-RestMethod，其它环境（WSL/macOS/Linux）用 curl。最后汇报结果。'

export function buildAgentSkillPrompt(locale: AgentSkillPromptLocale, command: string): string {
  const template = locale === 'zh-CN' ? AGENT_SKILL_PROMPT_ZH_TEMPLATE : AGENT_SKILL_PROMPT_EN_TEMPLATE
  // 用函数式替换，避免 $& / $1 等特殊替换序列破坏插入内容。
  return template.replace(/\{command\}/g, () => command)
}
