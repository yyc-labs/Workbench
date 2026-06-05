import { ExternalLink, Settings2 } from 'lucide-react'
import {
  normalizeProjectDocLinkTag,
  projectDocLinkTagLabel,
} from '../../lib/projectDocLinks'
import { DetailDocumentationSettingsModal } from './DetailDocumentationSettingsModal'
import type { DetailDocumentationCardProps } from './detail.documentationCard.types'
import { useDetailDocumentationCardState } from './useDetailDocumentationCardState'

function DetailDocumentationCard({
  docLinks,
  docTitleInput,
  setDocTitleInput,
  docUrlInput,
  setDocUrlInput,
  docTagInput,
  setDocTagInput,
  docTagOptions,
  docNoteInput,
  setDocNoteInput,
  docAccountInput,
  setDocAccountInput,
  docSecretInput,
  setDocSecretInput,
  docError,
  setDocError,
  onAddDocLink,
  onAddDocTag,
  onRenameDocTag,
  onRemoveDocTag,
  onUpdateDocLink,
  onSetDefaultDocLink,
  onReorderDocLinks,
  onRemoveDocLink,
  onCopyDocLinkAccount,
  onCopyDocLinkSecret,
  onGetDocLinkSecret,
  settingsOpen,
  setSettingsOpen,
  hideCard = false,
}: DetailDocumentationCardProps) {
  const state = useDetailDocumentationCardState({
    docLinks,
    docTagOptions,
    docTagInput,
    setDocTagInput,
    setDocError,
    onAddDocTag,
    onRenameDocTag,
    onRemoveDocTag,
    onUpdateDocLink,
    onSetDefaultDocLink,
    onReorderDocLinks,
    onRemoveDocLink,
    onCopyDocLinkAccount,
    onCopyDocLinkSecret,
    onGetDocLinkSecret,
    settingsOpen,
    setSettingsOpen,
  })
  const defaultLink = state.links.defaultLink

  return (
    <>
      {!hideCard && (
        <div className="rounded-[24px] p-5 surface-card">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <p className="section-label">项目资料</p>
              <p className="mt-1 text-xs text-[color:var(--color-muted-foreground)]">
                接口文档、部署地址、后台账号、设计稿等项目关键入口
              </p>
            </div>
            <span className="rounded-full px-2.5 py-1 text-[11px] text-[color:var(--color-muted-foreground)] quiet-control">
              {state.links.allCount}
            </span>
          </div>

          <div className="space-y-2.5">
            {defaultLink ? (
              <button
                className="quiet-control flex w-full min-w-0 items-center gap-2 rounded-[16px] px-4 py-3 text-left"
                onClick={() => window.electronAPI.openExternal(defaultLink.url)}
                title={defaultLink.url}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-[color:var(--color-foreground)]">{defaultLink.title}</p>
                  <p className="truncate text-[10px] text-[color:var(--color-muted-foreground)]">
                    {projectDocLinkTagLabel(
                      normalizeProjectDocLinkTag(defaultLink.tag, state.tags.options),
                      state.tags.options
                    )}
                  </p>
                  <p className="truncate text-[11px] text-[color:var(--color-muted-foreground)]">{defaultLink.url}</p>
                </div>
                <span className="rounded-full bg-[color:var(--color-accent)] px-2 py-0.5 text-[10px] text-[color:var(--color-muted-foreground)]">
                  Default
                </span>
                <ExternalLink className="h-3.5 w-3.5 text-[color:var(--color-muted-foreground)]" />
              </button>
            ) : (
              <div className="rounded-[16px] border border-dashed border-[color:var(--color-border)] px-4 py-4 text-xs text-[color:var(--color-muted-foreground)]">
                暂无默认资料链接。
              </div>
            )}
            <button
              className="inline-flex h-9 items-center gap-1.5 rounded-full border border-[color:var(--color-border)] px-3 text-xs text-[color:var(--color-foreground)] transition-colors hover:bg-[color:var(--color-accent)]"
              onClick={() => state.settings.setOpen(true)}
            >
              <Settings2 className="h-3.5 w-3.5" />
              资料设置
            </button>
          </div>
        </div>
      )}

      <DetailDocumentationSettingsModal
        docTitleInput={docTitleInput}
        setDocTitleInput={setDocTitleInput}
        docUrlInput={docUrlInput}
        setDocUrlInput={setDocUrlInput}
        docTagInput={docTagInput}
        setDocTagInput={setDocTagInput}
        docNoteInput={docNoteInput}
        setDocNoteInput={setDocNoteInput}
        docAccountInput={docAccountInput}
        setDocAccountInput={setDocAccountInput}
        docSecretInput={docSecretInput}
        setDocSecretInput={setDocSecretInput}
        docError={docError}
        onAddDocLink={onAddDocLink}
        state={state}
      />
    </>
  )
}

export { DetailDocumentationCard }
