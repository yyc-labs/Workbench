export type AgentSkillPromptLocale = 'en-US' | 'zh-CN'

// Agent Skill 提示词模板：同时被 renderer「设置页复制按钮」(i18n messages/settings.ts 引用)
// 与 main「Ctrl+Shift+L 全局粘贴」使用，保证两处文案单点一致。保留 {command} 占位符。
// 只负责「任务 + 获取 skill + 按 skill 执行」的入口引导；文件路径写法、发送方式等细节规则
// 统一收敛在 skill 正文（skills/transcript-import/SKILL.md 及网关兜底指令），此处不再重复。
export const AGENT_SKILL_PROMPT_EN_TEMPLATE =
  'Summarize this session and save it into the Workbench transcript library. First run {command} to fetch the skill, then strictly follow the returned JSON `skill` field (Markdown instructions, including the <transcript-import-config> base_url / token) to complete the import, and finally report the result.'

export const AGENT_SKILL_PROMPT_ZH_TEMPLATE = '请把本次会话总结保存到 Workbench 转录库。先执行 {command} 获取 skill，然后严格按返回 JSON 的 skill 字段（Markdown 指令，含 <transcript-import-config> 的 base_url / token）完成导入，最后汇报结果。'

export function buildAgentSkillPrompt(locale: AgentSkillPromptLocale, command: string): string {
  const template = locale === 'zh-CN' ? AGENT_SKILL_PROMPT_ZH_TEMPLATE : AGENT_SKILL_PROMPT_EN_TEMPLATE
  // 用函数式替换，避免 $& / $1 等特殊替换序列破坏插入内容。
  return template.replace(/\{command\}/g, () => command)
}
