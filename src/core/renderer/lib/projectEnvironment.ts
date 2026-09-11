import type { ResolvedLocale } from '../i18n/messages'
import type { ProjectEnvironment } from '../../shared/projectEnvironment'

export type { ProjectEnvironment } from '../../shared/projectEnvironment'
export { detectProjectEnvironment } from '../../shared/projectEnvironment'

export function projectEnvironmentLabel(env: ProjectEnvironment, locale: ResolvedLocale = 'en-US'): string {
  if (env === 'windows') return 'Windows'
  if (env === 'ubuntu') return 'Ubuntu'
  return locale === 'zh-CN' ? '未知' : 'Unknown'
}
