import type { AgentLogDetail } from '../../../../shared/types'
import type { useI18n } from '../../../i18n'
import { getSectionPrimaryFocusPath, getAgentLogSectionJsonRootPath } from './agentLogs.anchors'
import { snapshotValue } from './agentLogs.display'
import {
  buildAgentLogFlowSteps,
  createAgentLogFlowLabels,
  getDefaultAgentLogFlowStepId,
  type AgentLogFlowStep,
} from './agentLogs.flow'
import { toPrettyJson } from './agentLogs.helpers'
import type { AgentLogSectionJsonById } from './useAgentLogViewerModel'

type AgentLogTranslator = ReturnType<typeof useI18n>['t']
type AgentLogFormatDateTime = ReturnType<typeof useI18n>['formatDateTime']

export type AgentLogDocumentSection = AgentLogFlowStep & {
  jsonRootPath: string[]
  defaultFocusPath?: string[]
}

function markdownJsonBlock(title: string, value: unknown): string[] {
  if (typeof value === 'undefined') return []
  return [
    `### ${title}`,
    '',
    '```json',
    toPrettyJson(value),
    '```',
    '',
  ]
}

function markdownListItem(label: string, value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null
  return `- ${label}: ${String(value)}`
}

function summaryBulletLines(
  detail: AgentLogDetail,
  t: AgentLogTranslator,
  formatDateTime: AgentLogFormatDateTime,
): string[] {
  const summary = detail.summary
  const lines = [
    markdownListItem(t('settings.agentLogs.source'), detail.source === 'ai-gateway'
      ? t('settings.agentLogs.sourceGateway')
      : t('settings.agentLogs.sourceHooks')),
    markdownListItem(t('settings.agentLogs.level'), summary.level),
    markdownListItem(t('settings.agentLogs.timestamp'), formatDateTime(summary.timestamp, {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })),
    markdownListItem(t('settings.agentLogs.status'), summary.statusCode),
    markdownListItem(t('settings.agentLogs.duration'), typeof summary.durationMs === 'number' ? `${summary.durationMs}ms` : undefined),
    markdownListItem(t('settings.agentLogs.requestId'), detail.meta.requestId),
    markdownListItem(t('settings.agentLogs.truncation'), summary.truncated ? t('settings.agentLogs.truncated') : t('settings.agentLogs.notTruncated')),
  ].filter((line): line is string => Boolean(line))

  if (detail.source === 'ai-gateway') {
    lines.push(
      ...[
        markdownListItem(t('settings.agentLogs.route'), detail.meta.route),
        markdownListItem(t('settings.agentLogs.provider'), detail.meta.providerName || detail.meta.providerId),
        markdownListItem(t('settings.agentLogs.profile'), detail.meta.profileId),
        markdownListItem(t('settings.agentLogs.model'), detail.meta.model),
        markdownListItem(t('settings.agentLogs.requestedStream'), detail.stream?.requested ? t('common.on') : t('common.off')),
        markdownListItem(t('settings.agentLogs.actualStream'), detail.stream?.enabled ? t('common.on') : t('common.off')),
        markdownListItem(t('settings.agentLogs.eventCount'), detail.stream?.upstreamEventCount),
      ].filter((line): line is string => Boolean(line)),
    )
  } else {
    lines.push(
      ...[
        markdownListItem(t('settings.agentLogs.provider'), detail.meta.provider),
        markdownListItem(t('settings.agentLogs.providerEvent'), detail.meta.providerEvent),
        markdownListItem(t('settings.agentLogs.canonicalEvent'), detail.meta.canonicalEvent),
        markdownListItem(t('settings.agentLogs.cwd'), detail.summary.cwd),
        markdownListItem(t('settings.agentLogs.tool'), detail.summary.toolName),
      ].filter((line): line is string => Boolean(line)),
    )
  }

  if (detail.error) {
    lines.push(markdownListItem(t('settings.agentLogs.stepStatusError'), `${detail.error.code ? `${detail.error.code}: ` : ''}${detail.error.message}`) as string)
  }

  return lines
}

export function buildAgentLogDocumentSections(
  detail: AgentLogDetail,
  t: AgentLogTranslator,
): AgentLogDocumentSection[] {
  const labels = createAgentLogFlowLabels(t)
  const steps = buildAgentLogFlowSteps(detail, labels)

  return steps.map((step) => ({
    ...step,
    jsonRootPath: getAgentLogSectionJsonRootPath(detail, step.id),
    defaultFocusPath: getSectionPrimaryFocusPath(detail, step),
  }))
}

export function getDefaultAgentLogDocumentSectionId(
  detail: AgentLogDetail,
  sections: AgentLogDocumentSection[],
): string {
  return getDefaultAgentLogFlowStepId(detail, sections)
}

export function buildAgentLogMarkdownText(
  detail: AgentLogDetail,
  sections: AgentLogDocumentSection[],
  sectionJsonById: AgentLogSectionJsonById,
  t: AgentLogTranslator,
  formatDateTime: AgentLogFormatDateTime,
): string {
  const lines: string[] = [
    `# ${detail.summary.title}`,
    '',
    `## ${t('settings.agentLogs.summaryTab')}`,
    '',
    ...summaryBulletLines(detail, t, formatDateTime),
    '',
  ]

  for (const section of sections) {
    lines.push(`## ${section.title}`)
    lines.push('')

    if (section.description) {
      lines.push(section.description)
      lines.push('')
    }

    if (section.summary.length > 0) {
      for (const item of section.summary) {
        lines.push(`- ${item}`)
      }
      lines.push('')
    }

    const sectionJson = sectionJsonById[section.id]
    if (typeof sectionJson !== 'undefined') {
      lines.push(...markdownJsonBlock(section.title, sectionJson))
    }

    if (section.mergedStream) {
      const mergedText = snapshotValue(section.mergedStream.text)
      const mergedPayload = snapshotValue(section.mergedStream.payload)
      if (typeof mergedText !== 'undefined') {
        lines.push(...markdownJsonBlock(section.mergedStream.textLabel, mergedText))
      }
      if (typeof mergedPayload !== 'undefined') {
        lines.push(...markdownJsonBlock(section.mergedStream.payloadLabel, mergedPayload))
      }
    }
  }

  return lines.join('\n').trim()
}
