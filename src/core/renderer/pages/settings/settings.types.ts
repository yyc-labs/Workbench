export const SETTINGS_SECTIONS = ['general', 'shortcuts', 'data', 'runtime', 'processes', 'agents', 'gateway', 'browser-ai', 'ai-connection', 'transcripts', 'hooks', 'agent-logs', 'logs', 'ai', 'rules', 'about'] as const

export type Section = (typeof SETTINGS_SECTIONS)[number]

export type SettingsSectionAlias = 'ai-runtime' | 'codex'

export const DEFAULT_SETTINGS_SECTION: Section = 'general'

export function isSettingsSection(value: string | undefined): value is Section {
  return typeof value === 'string' && SETTINGS_SECTIONS.includes(value as Section)
}

export function isSettingsSectionAlias(value: string | undefined): value is SettingsSectionAlias {
  return value === 'ai-runtime' || value === 'codex'
}

export type ThemeMode = 'system' | 'light' | 'dark'
