import type { AppLocale } from '../../shared/types'
import { aiAndRuntimeMessages } from './messages/aiAndRuntime'
import { codeMessages } from './messages/code'
import { commonMessages } from './messages/common'
import { detailMessages } from './messages/detail'
import { docsAndCommandsMessages } from './messages/docsAndCommands'
import { learningMessages } from './messages/learning'
import { markdownDocumentMessages } from './messages/markdownDocument'
import { projectMessages } from './messages/project'
import { settingsMessages } from './messages/settings'
import { transcriptMessages } from './messages/transcript'

export type ResolvedLocale = Exclude<AppLocale, 'system'>

export const SUPPORTED_LOCALES: readonly ResolvedLocale[] = ['en-US', 'zh-CN'] as const
export const FALLBACK_LOCALE: ResolvedLocale = 'en-US'

function mergeLocaleMessages(locale: ResolvedLocale) {
  return Object.assign(
    {},
    { common: commonMessages[locale].common },
    { settings: settingsMessages[locale].settings },
    { home: commonMessages[locale].home },
    { transcript: transcriptMessages[locale].transcript },
    { project: projectMessages[locale].project },
    { detail: detailMessages[locale].detail },
    { learning: learningMessages[locale].learning },
    { markdownDocument: markdownDocumentMessages[locale].markdownDocument },
    {
      projectMeta: projectMessages[locale].projectMeta,
      workspaceManager: projectMessages[locale].workspaceManager,
    },
    { documentation: docsAndCommandsMessages[locale].documentation },
    {
      settingsTranscript: transcriptMessages[locale].settingsTranscript,
      referenceDrawer: transcriptMessages[locale].referenceDrawer,
    },
    { runCommand: docsAndCommandsMessages[locale].runCommand },
    {
      settingsAiCommit: aiAndRuntimeMessages[locale].settingsAiCommit,
      startupLogs: aiAndRuntimeMessages[locale].startupLogs,
    },
    {
      codeWorkspace: codeMessages[locale].codeWorkspace,
      codeFileTree: codeMessages[locale].codeFileTree,
      codeMarkdown: codeMessages[locale].codeMarkdown,
    },
    {
      settingsRuntime: aiAndRuntimeMessages[locale].settingsRuntime,
      settingsRules: aiAndRuntimeMessages[locale].settingsRules,
    },
  )
}

export const messages = {
  'en-US': {
    appName: 'IDE Electron',
    ...mergeLocaleMessages('en-US'),
  },
  'zh-CN': {
    appName: 'IDE Electron',
    ...mergeLocaleMessages('zh-CN'),
  },
} as const

export type MessageTree = typeof messages
export type MessageKey = string
export type SettingsSectionMessageKey = string

export type InterpolationValues = Record<string, number | string>
