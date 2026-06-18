import { ExternalLink, Settings2 } from 'lucide-react'
import {
  isSshProjectDocLink,
  normalizeProjectDocLinkTag,
  projectDocLinkTarget,
  projectDocLinkTagLabel,
} from '../../lib/projectDocLinks'
import { useI18n, useLocale } from '../../i18n'
import { DetailDocumentationSettingsModal } from './DetailDocumentationSettingsModal'
import type { DetailDocumentationCardProps } from './detail.documentationCard.types'
import { useDetailDocumentationCardState } from './useDetailDocumentationCardState'

function DetailDocumentationCard({
  docLinks,
  docKindInput,
  setDocKindInput,
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
  docSshHostInput,
  setDocSshHostInput,
  docSshPortInput,
  setDocSshPortInput,
  docSshUsernameInput,
  setDocSshUsernameInput,
  docSshShortcutInput,
  setDocSshShortcutInput,
  docSshRouteInput,
  setDocSshRouteInput,
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
  onOpenDocLink,
  settingsOpen,
  setSettingsOpen,
  hideCard = false,
}: DetailDocumentationCardProps) {
  const locale = useLocale()
  const { t } = useI18n()
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
    onOpenDocLink,
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
              <p className="section-label">{t('documentation.cardTitle')}</p>
              <p className="mt-1 text-xs text-[color:var(--color-muted-foreground)]">
                {t('documentation.cardDescription')}
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
                onClick={() => { void onOpenDocLink(defaultLink) }}
                title={projectDocLinkTarget(defaultLink)}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-[color:var(--color-foreground)]">{defaultLink.title}</p>
                  <p className="truncate text-[10px] text-[color:var(--color-muted-foreground)]">
                    {projectDocLinkTagLabel(
                      normalizeProjectDocLinkTag(defaultLink.tag, state.tags.options),
                      state.tags.options,
                      locale
                    )}
                  </p>
                  <p className="truncate text-[11px] text-[color:var(--color-muted-foreground)]">{projectDocLinkTarget(defaultLink)}</p>
                </div>
                <span className="rounded-full bg-[color:var(--color-accent)] px-2 py-0.5 text-[10px] text-[color:var(--color-muted-foreground)]">
                  {t('documentation.defaultBadge')}
                </span>
                <ExternalLink className="h-3.5 w-3.5 text-[color:var(--color-muted-foreground)]" />
                {isSshProjectDocLink(defaultLink) && (
                  <span className="rounded-full bg-[color:var(--color-accent)] px-2 py-0.5 text-[10px] text-[color:var(--color-muted-foreground)]">
                    {t('documentation.kindSsh')}
                  </span>
                )}
              </button>
            ) : (
              <div className="rounded-[16px] border border-dashed border-[color:var(--color-border)] px-4 py-4 text-xs text-[color:var(--color-muted-foreground)]">
                {t('documentation.noDefaultLink')}
              </div>
            )}
            <button
              className="inline-flex h-9 items-center gap-1.5 rounded-full border border-[color:var(--color-border)] px-3 text-xs text-[color:var(--color-foreground)] transition-colors hover:bg-[color:var(--color-accent)]"
              onClick={() => state.settings.setOpen(true)}
            >
              <Settings2 className="h-3.5 w-3.5" />
              {t('documentation.settings')}
            </button>
          </div>
        </div>
      )}

      <DetailDocumentationSettingsModal
        docKindInput={docKindInput}
        setDocKindInput={setDocKindInput}
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
        docSshHostInput={docSshHostInput}
        setDocSshHostInput={setDocSshHostInput}
        docSshPortInput={docSshPortInput}
        setDocSshPortInput={setDocSshPortInput}
        docSshUsernameInput={docSshUsernameInput}
        setDocSshUsernameInput={setDocSshUsernameInput}
        docSshShortcutInput={docSshShortcutInput}
        setDocSshShortcutInput={setDocSshShortcutInput}
        docSshRouteInput={docSshRouteInput}
        setDocSshRouteInput={setDocSshRouteInput}
        docError={docError}
        setDocError={setDocError}
        onAddDocLink={onAddDocLink}
        state={state}
      />
    </>
  )
}

export { DetailDocumentationCard }
