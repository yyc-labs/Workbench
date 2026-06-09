export const SETTINGS_SECTION_LABELS = {
  general: 'General',
  runtime: 'Runtime',
  transcripts: 'Transcripts',
  hooks: 'Agent Hooks',
  logs: 'Startup Logs',
  ai: 'AI Commit',
  rules: 'Rules',
  about: 'About',
} as const

export type Section = keyof typeof SETTINGS_SECTION_LABELS

export const DEFAULT_SETTINGS_SECTION: Section = 'general'

export const SETTINGS_SECTIONS = Object.keys(SETTINGS_SECTION_LABELS) as Section[]

export function isSettingsSection(value: string | undefined): value is Section {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(SETTINGS_SECTION_LABELS, value)
}

export function getSettingsSectionLabel(section: Section): string {
  return SETTINGS_SECTION_LABELS[section]
}

export type ThemeMode = 'system' | 'light' | 'dark'
