import { useMemo } from 'react'
import type { AgentLogDetail } from '../../../../shared/types'
import { useI18n } from '../../../i18n'
import {
  buildAgentLogDocumentSections,
  getDefaultAgentLogDocumentSectionId,
  type AgentLogDocumentSection,
} from './agentLogs.document'
import { agentLogKey, detailToJson, readValueAtPath } from './agentLogs.helpers'

export type AgentLogSectionJsonById = Record<string, unknown>

function buildSectionJsonById(
  jsonValue: unknown,
  sections: AgentLogDocumentSection[],
): AgentLogSectionJsonById {
  const next: AgentLogSectionJsonById = {}

  for (const section of sections) {
    next[section.id] = section.jsonRootPath.length > 0
      ? readValueAtPath(jsonValue, section.jsonRootPath)
      : undefined
  }

  return next
}

export function useAgentLogViewerModel(detail: AgentLogDetail | null) {
  const { t } = useI18n()
  const detailKey = detail ? agentLogKey(detail.summary) : null
  const jsonValue = useMemo(() => detailToJson(detail), [detail])
  const sections = useMemo(
    () => (detail ? buildAgentLogDocumentSections(detail, t) : []),
    [detail, t],
  )
  const defaultSectionId = useMemo(
    () => (detail ? getDefaultAgentLogDocumentSectionId(detail, sections) : ''),
    [detail, sections],
  )
  const sectionJsonById = useMemo(
    () => buildSectionJsonById(jsonValue, sections),
    [jsonValue, sections],
  )

  return {
    defaultSectionId,
    detailKey,
    jsonValue,
    sectionJsonById,
    sections,
  }
}
