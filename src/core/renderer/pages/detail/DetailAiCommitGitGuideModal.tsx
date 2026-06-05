import { X } from 'lucide-react'
import { ModalShell } from '../../components/ModalShell'
import { GIT_GUIDE_SECTIONS, GIT_GUIDE_TITLE } from './gitGuideContent'

type DetailAiCommitGitGuideModalProps = {
  onClose: () => void
  open: boolean
}

export function DetailAiCommitGitGuideModal({
  onClose,
  open,
}: DetailAiCommitGitGuideModalProps) {
  return (
    <ModalShell
      open={open}
      onClose={onClose}
      widthClassName="max-w-[520px]"
      baseZIndex={1130}
      ariaLabel="Git 操作指南"
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <p className="section-label mb-1">Git Guide</p>
          <p className="text-sm font-semibold text-[color:var(--color-foreground)]">{GIT_GUIDE_TITLE}</p>
        </div>
        <button
          type="button"
          className="flex h-8 w-8 items-center justify-center rounded-full text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)]"
          onClick={onClose}
          title="Close"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="space-y-2 text-[12px] leading-5 text-[color:var(--color-foreground)]">
        {GIT_GUIDE_SECTIONS.map((section) => (
          <div
            key={section.title}
            className="rounded-[14px] border border-[color:var(--color-border)] bg-[color:var(--color-background-sunken)]/62 px-3 py-2"
          >
            <p className="font-semibold">{section.title}</p>
            {section.lines.map((line, index) => (
              <p key={`${section.title}-${index}`} className={index === 0 ? 'mt-1' : ''}>{line}</p>
            ))}
          </div>
        ))}
      </div>
    </ModalShell>
  )
}
