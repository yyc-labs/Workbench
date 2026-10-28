export type AgentHistoryRenderMode = 'image' | 'collapsible' | 'inline' | 'hidden'

export type AgentHistoryRenderCategory = 'attachment' | 'context' | 'command' | 'metadata' | 'custom'

export interface AgentHistoryTagRule {
  id: string
  tagNames: string[]
  category: AgentHistoryRenderCategory
  mode: AgentHistoryRenderMode
  enabled: boolean
}

export interface AgentHistoryRenderingConfig {
  customRules: AgentHistoryTagRule[]
}

export const DEFAULT_AGENT_HISTORY_TAG_RULES: readonly AgentHistoryTagRule[] = [
  { id: 'image', tagNames: ['image'], category: 'attachment', mode: 'image', enabled: true },
  {
    id: 'context',
    tagNames: ['environment_context', 'filesystem', 'permissions', 'INSTRUCTIONS', 'skills_instructions', 'plugins_instructions', 'collaboration_mode', 'system-reminder', 'user_instructions', 'personality_spec', 'app-context', 'transcript-import-config'],
    category: 'context',
    mode: 'collapsible',
    enabled: true,
  },
  {
    id: 'command',
    tagNames: ['command-name', 'command-message', 'command-args', 'local-command-stdout', 'local-command-caveat', 'task-notification', 'persisted-output', 'tool_use_error', 'retrieval_status', 'task_id', 'task_type', 'exit_code', 'status', 'output', 'output-file', 'output-stderr-file'],
    category: 'command',
    mode: 'collapsible',
    enabled: true,
  },
  { id: 'history', tagNames: ['user_query', 'previous_user_message', 'previous_assistant_message', 'previous_tool_call', 'cb_summary'], category: 'context', mode: 'collapsible', enabled: true },
  { id: 'metadata', tagNames: ['turn_aborted', 'truncated', 'guardian_truncated', 'proposed_plan'], category: 'metadata', mode: 'inline', enabled: true },
]

export const DEFAULT_AGENT_HISTORY_RENDERING_CONFIG: AgentHistoryRenderingConfig = { customRules: [] }
