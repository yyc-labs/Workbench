import type { AppConfig } from '../../shared/types'
import {
  isSettingsSection,
  isSettingsSectionAlias,
  type Section,
  type SettingsSectionAlias,
} from '../pages/settings/settings.types'

export function toTitleCase(value: string): string {
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ')
}

export function resolveWindowTitle(
  pathname: string,
  projects: Array<{ id: string; name: string; customName?: string }>,
  getSettingsSectionLabel: (section: Section) => string,
  appName: string,
  settingsLabel: string
): string {
  const segments = pathname.split('/').filter(Boolean)

  if (segments[0] === 'settings') {
    if (isSettingsSection(segments[1])) {
      return `${settingsLabel} - ${getSettingsSectionLabel(segments[1])} - ${appName}`
    }
    if (isSettingsSectionAlias(segments[1])) {
      const alias = segments[1] as SettingsSectionAlias
      return `${settingsLabel} - ${alias === 'codex' ? 'Codex' : getSettingsSectionLabel('agents')} - ${appName}`
    }
    return `${settingsLabel} - ${appName}`
  }

  if (segments[0] === 'project' && segments[1]) {
    const project = projects.find((item) => item.id === segments[1])
    const projectLabel = project?.customName?.trim() || project?.name || 'Project'
    const paneLabel = segments[2] ? toTitleCase(segments[2]) : null
    return paneLabel
      ? `${projectLabel} - ${paneLabel} - ${appName}`
      : `${projectLabel} - ${appName}`
  }

  if (segments[0] === 'learning') {
    return `Learning Center - ${appName}`
  }

  return appName
}

export function resolveTheme(theme: AppConfig['theme']): 'light' | 'dark' {
  if (theme === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  return theme
}
