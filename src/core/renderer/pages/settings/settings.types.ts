export const SETTINGS_SECTIONS = [
  'general',
  'runtime',
  'ai-runtime',
  'transcripts',
  'hooks',
  'logs',
  'ai',
  'rules',
  'about',
] as const

export type Section = (typeof SETTINGS_SECTIONS)[number]

export const DEFAULT_SETTINGS_SECTION: Section = 'general'

export function isSettingsSection(value: string | undefined): value is Section {
  return typeof value === 'string' && SETTINGS_SECTIONS.includes(value as Section)
}

export type ThemeMode = 'system' | 'light' | 'dark'
