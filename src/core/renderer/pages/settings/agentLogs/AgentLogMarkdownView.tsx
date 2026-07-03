import { Check, Copy } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { AgentLogDetail } from '../../../../shared/types'
import { Button } from '../../../components/ui/button'
import { useI18n } from '../../../i18n'
import { AgentLogDocumentView } from './AgentLogDocumentView'
import {
  buildAgentLogMarkdownText,
  type AgentLogDocumentSection,
} from './agentLogs.document'
import type { AgentLogSectionJsonById } from './useAgentLogViewerModel'

type AgentLogMarkdownViewProps = {
  detail: AgentLogDetail | null
  loading: boolean
  sections: AgentLogDocumentSection[]
  sectionJsonById: AgentLogSectionJsonById
  activeSectionId: string
  onSelectSection: (sectionId: string) => void
  onFocusPath: (path: string[], sectionId?: string) => void
  maxHeightClassName?: string
  domIdPrefix?: string
  focusedPath?: string[]
}

export function AgentLogMarkdownView({
  detail,
  loading,
  sections,
  sectionJsonById,
  activeSectionId,
  onSelectSection,
  onFocusPath,
  maxHeightClassName = 'max-h-[720px]',
  domIdPrefix = 'agent-log-markdown',
  focusedPath,
}: AgentLogMarkdownViewProps) {
  const { t, formatDateTime } = useI18n()
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 1200)
    return () => window.clearTimeout(timer)
  }, [copied])

  const handleCopy = async () => {
    if (!detail) return
    const markdownText = buildAgentLogMarkdownText(detail, sections, sectionJsonById, t, formatDateTime)
    await navigator.clipboard.writeText(markdownText)
    setCopied(true)
  }

  if (loading || !detail) {
    return (
      <pre className={`${maxHeightClassName} overflow-auto rounded-[18px] bg-[color:var(--color-background-sunken)]/70 px-4 py-4 font-mono text-xs leading-5 text-[color:var(--color-foreground)] whitespace-pre-wrap break-all`}>
        {loading ? t('common.loading') : t('settings.agentLogs.noMarkdown')}
      </pre>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button
          variant="outline"
          className="h-9 rounded-full px-3 text-xs"
          onClick={() => void handleCopy()}
          disabled={!detail}
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? t('common.copied') : t('settings.agentLogs.copyMarkdown')}
        </Button>
      </div>
      <div className={`${maxHeightClassName} overflow-auto rounded-[18px] bg-[color:var(--color-background-sunken)]/70 px-4 py-4`}>
        <AgentLogDocumentView
          detail={detail}
          sections={sections}
          sectionJsonById={sectionJsonById}
          activeSectionId={activeSectionId}
          onSelectSection={onSelectSection}
          onFocusPath={onFocusPath}
          domIdPrefix={domIdPrefix}
          focusedPath={focusedPath}
        />
      </div>
    </div>
  )
}
