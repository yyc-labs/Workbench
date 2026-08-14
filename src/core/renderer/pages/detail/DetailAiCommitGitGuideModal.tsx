import { CircleHelp, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { ModalShell } from '../../components/ModalShell'
import { useI18n } from '../../i18n'
import { DetailAiCommitCommitModal } from './DetailAiCommitCommitModal'
import { DetailAiCommitOperationConfirmModal } from './DetailAiCommitOperationConfirmModal'
import { DetailAiCommitGitWorkflowCanvas } from './DetailAiCommitGitWorkflowCanvas'
import { getGitGuideSections, getGitGuideTitle } from './gitGuideContent'
import { useGitWorkflowRunner } from './useGitWorkflowRunner'
import type { GitOperationResult } from './detail.types'
import type { DetailGitSnapshot } from './detail.types'

type DetailAiCommitGitGuideModalProps = {
  onClose: () => void
  open: boolean
  projectId: string
  gitSnapshot: DetailGitSnapshot | null
  onRefreshGitSnapshot: () => void | Promise<void>
  onOperationResult?: (result: GitOperationResult) => void
}

export function DetailAiCommitGitGuideModal({ onClose, open, projectId, gitSnapshot, onRefreshGitSnapshot, onOperationResult }: DetailAiCommitGitGuideModalProps) {
  const { t } = useI18n()
  const [showGuide, setShowGuide] = useState(false)
  const [operationConfirmInput, setOperationConfirmInput] = useState('')
  const workflow = useGitWorkflowRunner({ projectId, gitSnapshot, onRefreshGitSnapshot, onOperationResult })
  const guideTitle = getGitGuideTitle()
  const guideSections = getGitGuideSections()

  useEffect(() => {
    setOperationConfirmInput('')
  }, [workflow.pendingConfirmation?.nodeId])

  useEffect(() => {
    if (!workflow.pendingCommit) return
    workflow.setRuntimeCommitMessage(workflow.pendingCommit.presetMessage)
  }, [workflow.pendingCommit?.nodeId, workflow.setRuntimeCommitMessage])

  return (
    <>
      <ModalShell open={open} onClose={onClose} widthClassName="max-w-[1280px]" baseZIndex={1130} ariaLabel={t('detail.gitGuideAria')} panelClassName="max-h-[88vh] overflow-hidden">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <p className="section-label mb-1">{t('detail.gitGuideTitle')}</p>
            <p className="text-sm font-semibold text-[color:var(--color-foreground)]">{guideTitle}</p>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              className={`flex h-8 w-8 items-center justify-center rounded-full transition-colors ${showGuide ? 'bg-[color:var(--color-accent)] text-[color:var(--color-foreground)]' : 'text-[color:var(--color-muted-foreground)] hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)]'}`}
              onClick={() => setShowGuide((value) => !value)}
              title={t('detail.gitGuideTeaching')}
              aria-label={t('detail.gitGuideTeaching')}
              aria-expanded={showGuide}
            >
              <CircleHelp className="h-4 w-4" />
            </button>
            <button type="button" className="flex h-8 w-8 items-center justify-center rounded-full text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)]" onClick={onClose} title={t('detail.gitGuideClose')}>
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <DetailAiCommitGitWorkflowCanvas runner={workflow} />
      </ModalShell>

      <ModalShell open={showGuide} onClose={() => setShowGuide(false)} widthClassName="max-w-[520px]" baseZIndex={1140} ariaLabel={t('detail.gitGuideTeaching')}>
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <p className="section-label mb-1">{t('detail.gitGuideTeaching')}</p>
            <p className="text-sm font-semibold text-[color:var(--color-foreground)]">{guideTitle}</p>
          </div>
          <button type="button" className="flex h-8 w-8 items-center justify-center rounded-full text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)]" onClick={() => setShowGuide(false)} title={t('detail.gitGuideClose')}>
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-2 text-[12px] leading-5 text-[color:var(--color-foreground)]">
          {guideSections.map((section) => (
            <div key={section.title} className="rounded-[14px] border border-[color:var(--color-border)] bg-[color:var(--color-background-sunken)]/62 px-3 py-2">
              <p className="font-semibold">{section.title}</p>
              {section.lines.map((line, index) => (
                <p key={`${section.title}-${index}`} className={index === 0 ? 'mt-1' : ''}>
                  {line}
                </p>
              ))}
            </div>
          ))}
        </div>
      </ModalShell>

      <DetailAiCommitOperationConfirmModal
        confirmExactMatch={workflow.pendingConfirmation?.exactMatch ?? ''}
        confirmNeedsTypedMatch={Boolean(workflow.pendingConfirmation?.exactMatch)}
        confirmTypedMatchPassed={!workflow.pendingConfirmation?.exactMatch || operationConfirmInput.trim() === workflow.pendingConfirmation.exactMatch}
        onChangeOperationConfirmInput={setOperationConfirmInput}
        onClose={() => {
          setOperationConfirmInput('')
          workflow.cancelPendingAction()
        }}
        onConfirm={() => {
          setOperationConfirmInput('')
          void workflow.confirmPendingConfirmation()
        }}
        open={Boolean(workflow.pendingConfirmation)}
        operationConfirmInput={operationConfirmInput}
        pendingOperationLabel={workflow.pendingConfirmation?.title ?? 'Git'}
        pendingOperationMessage={workflow.pendingConfirmation?.message ?? ''}
        riskLevel={workflow.pendingConfirmation?.riskLevel}
        title={workflow.pendingConfirmation?.title}
        confirmLabel={workflow.pendingConfirmation?.confirmLabel}
        cancelLabel={workflow.pendingConfirmation?.cancelLabel}
        helperText={workflow.pendingConfirmation?.helperText}
      />

      <DetailAiCommitCommitModal
        blockedReason={null}
        commitError={null}
        commitMessage={workflow.runtimeCommitMessage}
        committing={false}
        onChangeCommitMessage={workflow.setRuntimeCommitMessage}
        onClose={() => {
          workflow.cancelPendingAction()
        }}
        onCommit={() => {
          if (!workflow.pendingCommit) return
          void workflow.confirmPendingCommit(workflow.runtimeCommitMessage || workflow.pendingCommit.presetMessage)
        }}
        open={Boolean(workflow.pendingCommit)}
        stagedFileCount={0}
      />
    </>
  )
}
