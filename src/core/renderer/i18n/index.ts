import { useMemo } from 'react'
import { useAppStore } from '../stores/appStore'
import type { AppLocale } from '../../shared/types'
import { FALLBACK_LOCALE, messages, type InterpolationValues, type MessageKey, type ResolvedLocale, type SettingsSectionMessageKey } from './messages'
import type { Section } from '../pages/settings/settings.types'

const settingsSectionKeyBySection: Record<Section, SettingsSectionMessageKey> = {
  general: 'settings.sections.general',
  runtime: 'settings.sections.runtime',
  'ai-runtime': 'settings.sections.aiRuntime',
  transcripts: 'settings.sections.transcripts',
  hooks: 'settings.sections.hooks',
  logs: 'settings.sections.logs',
  ai: 'settings.sections.ai',
  rules: 'settings.sections.rules',
  about: 'settings.sections.about',
}

function readMessage(locale: ResolvedLocale, key: string): string {
  const tree = messages[locale] as Record<string, unknown>
  const segments = key.split('.')
  let current: unknown = tree

  for (const segment of segments) {
    if (!current || typeof current !== 'object' || !(segment in current)) {
      return key
    }
    current = (current as Record<string, unknown>)[segment]
  }

  return typeof current === 'string' ? current : key
}

function interpolate(template: string, values?: InterpolationValues): string {
  if (!values) return template
  return template.replace(/\{(\w+)\}/g, (_, name: string) => {
    const value = values[name]
    return value === undefined ? `{${name}}` : String(value)
  })
}

function selectPluralBranch(template: string, values?: InterpolationValues): string {
  if (!template.includes(' | ')) return template
  const [singular, plural] = template.split(' | ')
  const count = Number(values?.count)
  if (!Number.isFinite(count)) return plural || singular || template
  return count === 1 ? singular : (plural || singular)
}

export function resolveSystemLocale(): ResolvedLocale {
  const language = typeof navigator !== 'undefined' ? navigator.language : ''
  if (language.toLowerCase().startsWith('zh')) return 'zh-CN'
  if (language.toLowerCase().startsWith('en')) return 'en-US'
  return FALLBACK_LOCALE
}

export function resolveAppLocale(locale: AppLocale | undefined): ResolvedLocale {
  if (!locale || locale === 'system') return resolveSystemLocale()
  return locale
}

export function translate(
  locale: ResolvedLocale,
  key: MessageKey | SettingsSectionMessageKey,
  values?: InterpolationValues
): string {
  const raw = readMessage(locale, key)
  const branch = selectPluralBranch(raw, values)
  return interpolate(branch, values)
}

export function useLocale(): ResolvedLocale {
  const locale = useAppStore((s) => s.config.locale)
  return useMemo(() => resolveAppLocale(locale), [locale])
}

export function getCurrentLocale(): ResolvedLocale {
  return resolveAppLocale(useAppStore.getState().config.locale)
}

export function translateCurrent(
  key: MessageKey | SettingsSectionMessageKey,
  values?: InterpolationValues
): string {
  return translate(getCurrentLocale(), key, values)
}

export function translateCurrentHtml(
  key: MessageKey | SettingsSectionMessageKey,
  values?: InterpolationValues
): { __html: string } {
  return { __html: `<span class="i18n-rich">${translate(getCurrentLocale(), key, values)}</span>` }
}

export function useI18n() {
  const locale = useLocale()

  return useMemo(() => {
    const t = (key: MessageKey | SettingsSectionMessageKey, values?: InterpolationValues) =>
      translate(locale, key, values)

    const formatDateTime = (
      value: number | string | Date | undefined,
      options: Intl.DateTimeFormatOptions = {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      }
    ): string => {
      if (value === undefined || value === null) return t('common.unknownTime')
      const date = value instanceof Date ? value : new Date(value)
      if (Number.isNaN(date.getTime())) return t('common.unknownTime')
      return new Intl.DateTimeFormat(locale, options).format(date)
    }

    const tHtml = (
      key: MessageKey | SettingsSectionMessageKey,
      values?: InterpolationValues
    ): { __html: string } => ({
      __html: `<span class="i18n-rich">${translate(locale, key, values)}</span>`,
    })

    const getSettingsSectionLabel = (section: Section): string =>
      t(settingsSectionKeyBySection[section])

    return {
      locale,
      t,
      tHtml,
      formatDateTime,
      getSettingsSectionLabel,
    }
  }, [locale])
}

export function formatTranscriptSourceType(locale: ResolvedLocale, value: string): string {
  const key = `transcript.sourceTypes.${value}` as const
  const message = readMessage(locale, key)
  if (message === key) {
    return locale === 'zh-CN' ? '转录' : 'Transcript'
  }
  return message
}

export function formatStructuredBlockKind(locale: ResolvedLocale, value: string): string {
  const key = `transcript.structuredBlockKinds.${value}` as const
  const message = readMessage(locale, key)
  if (message === key) {
    return translate(locale, 'transcript.structuredBlockKinds.default' as never)
  }
  return message
}
