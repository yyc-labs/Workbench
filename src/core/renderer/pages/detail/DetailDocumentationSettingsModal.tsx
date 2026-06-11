import { ChevronDown, Edit3, Plus, Trash2, X } from 'lucide-react'
import { ModalShell } from '../../components/ModalShell'
import { useI18n } from '../../i18n'
import type { DetailDocumentationCardProps } from './detail.documentationCard.types'
import { DetailDocumentationLinkList } from './DetailDocumentationLinkList'
import { DetailDocumentationTagSelect } from './DetailDocumentationTagSelect'
import type { UseDetailDocumentationCardStateResult } from './useDetailDocumentationCardState'

type DetailDocumentationSettingsModalProps = Pick<
  DetailDocumentationCardProps,
  | 'docTitleInput'
  | 'setDocTitleInput'
  | 'docUrlInput'
  | 'setDocUrlInput'
  | 'docTagInput'
  | 'setDocTagInput'
  | 'docNoteInput'
  | 'setDocNoteInput'
  | 'docAccountInput'
  | 'setDocAccountInput'
  | 'docSecretInput'
  | 'setDocSecretInput'
  | 'docError'
  | 'onAddDocLink'
> & {
  state: UseDetailDocumentationCardStateResult
}

function DetailDocumentationSettingsModal({
  docTitleInput,
  setDocTitleInput,
  docUrlInput,
  setDocUrlInput,
  docTagInput,
  setDocTagInput,
  docNoteInput,
  setDocNoteInput,
  docAccountInput,
  setDocAccountInput,
  docSecretInput,
  setDocSecretInput,
  docError,
  onAddDocLink,
  state,
}: DetailDocumentationSettingsModalProps) {
  const { t } = useI18n()

  return (
    <ModalShell
      open={state.settings.open}
      baseZIndex={1000}
      widthClassName="max-w-[760px]"
      ariaLabel={t('documentation.modalAria')}
      onClose={state.settings.close}
    >
      <div className="flex h-[78vh] max-h-[780px] flex-col">
        <div className="mb-4 flex shrink-0 items-start justify-between gap-4">
          <div>
            <p className="section-label mb-1 text-base">{t('documentation.modalTitle')}</p>
            <p className="text-xs text-[color:var(--color-muted-foreground)]">
              {t('documentation.modalDescription')}
            </p>
          </div>
          <button
            type="button"
            className="flex h-8 w-8 items-center justify-center rounded-full text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)]"
            onClick={state.settings.close}
            title={t('common.close')}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mb-4 shrink-0 space-y-2.5">
          <input
            type="text"
            value={docTitleInput}
            onChange={(event) => setDocTitleInput(event.target.value)}
            placeholder={t('documentation.namePlaceholder')}
            className="quiet-control block h-10 w-full rounded-full border-0 px-4 text-sm text-[color:var(--color-foreground)] placeholder:text-[color:var(--color-muted-foreground)] outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <input
              type="text"
              value={docUrlInput}
              onChange={(event) => setDocUrlInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void onAddDocLink()
              }}
              placeholder={t('documentation.urlPlaceholder')}
              className="quiet-control block h-10 w-full min-w-0 rounded-full border-0 px-4 text-sm text-[color:var(--color-foreground)] placeholder:text-[color:var(--color-muted-foreground)] outline-none focus-visible:ring-2 focus-visible:ring-ring sm:flex-1"
            />
            <button
              className="inline-flex h-10 w-full shrink-0 items-center justify-center gap-1.5 rounded-full bg-primary px-4 text-sm font-medium text-white transition-colors hover:bg-primary-hover sm:w-auto"
              onClick={() => {
                void onAddDocLink()
              }}
            >
              <Plus className="h-3.5 w-3.5" />
              {t('documentation.addLink')}
            </button>
          </div>
          <button
            type="button"
            className="quiet-control flex h-9 w-full items-center justify-between rounded-full border-0 px-3 text-xs text-[color:var(--color-foreground)] transition-colors hover:border-[color:var(--color-border-hover)]"
            aria-expanded={state.settings.advancedOptionsOpen}
            onClick={state.settings.toggleAdvancedOptions}
          >
            <span>{t('documentation.advancedOptions')}</span>
            <ChevronDown
              className={`h-3.5 w-3.5 text-[color:var(--color-muted-foreground)] transition-transform ${
                state.settings.advancedOptionsOpen ? 'rotate-180' : ''
              }`}
            />
          </button>
          {state.settings.advancedOptionsOpen && (
            <>
              <DetailDocumentationTagSelect
                value={docTagInput}
                onChange={setDocTagInput}
                options={state.tags.options}
              />
              <textarea
                value={docNoteInput}
                onChange={(event) => setDocNoteInput(event.target.value)}
                rows={2}
                placeholder={t('documentation.notePlaceholder')}
                className="quiet-control block min-h-[72px] w-full rounded-[14px] border-0 px-4 py-2 text-sm text-[color:var(--color-foreground)] placeholder:text-[color:var(--color-muted-foreground)] outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <input
                  type="text"
                  value={docAccountInput}
                  onChange={(event) => setDocAccountInput(event.target.value)}
                  placeholder={t('documentation.accountPlaceholder')}
                  className="quiet-control block h-10 w-full rounded-full border-0 px-4 text-sm text-[color:var(--color-foreground)] placeholder:text-[color:var(--color-muted-foreground)] outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                <input
                  type="text"
                  value={docSecretInput}
                  onChange={(event) => setDocSecretInput(event.target.value)}
                  placeholder={t('documentation.secretPlaceholder')}
                  className="quiet-control block h-10 w-full rounded-full border-0 px-4 text-sm text-[color:var(--color-foreground)] placeholder:text-[color:var(--color-muted-foreground)] outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>
              <div className="rounded-[14px] border border-[color:var(--color-border)] px-3 py-2">
                <p className="mb-2 px-1 text-[11px] text-[color:var(--color-muted-foreground)]">
                  {t('documentation.categoriesTitle')}
                </p>
                <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-center">
                  <input
                    type="text"
                    value={state.tags.newLabel}
                    onChange={(event) => state.tags.setNewLabel(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') void state.tags.create()
                    }}
                    placeholder={t('documentation.newCategoryPlaceholder')}
                    className="quiet-control block h-9 w-full rounded-full border-0 px-3 text-xs text-[color:var(--color-foreground)] placeholder:text-[color:var(--color-muted-foreground)] outline-none focus-visible:ring-2 focus-visible:ring-ring sm:flex-1"
                  />
                  <button
                    type="button"
                    className="inline-flex h-9 shrink-0 items-center justify-center rounded-full border border-[color:var(--color-border)] px-3 text-xs text-[color:var(--color-foreground)] transition-colors hover:bg-[color:var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={!state.tags.newLabel.trim() || state.tags.saving}
                    onClick={() => {
                      void state.tags.create()
                    }}
                  >
                    {t('documentation.addCategory')}
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {state.tags.options.map((option) => {
                    const isRenaming = state.tags.renamingValue === option.value
                    return (
                      <div
                        key={option.value}
                        className="inline-flex items-center gap-1 rounded-full border border-[color:var(--color-border)] px-2 py-1 text-[11px] text-[color:var(--color-muted-foreground)]"
                      >
                        {isRenaming ? (
                          <>
                            <input
                              type="text"
                              value={state.tags.renamingLabel}
                              onChange={(event) => state.tags.setRenamingLabel(event.target.value)}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter') void state.tags.saveRename()
                                if (event.key === 'Escape') state.tags.cancelRename()
                              }}
                              className="h-6 min-w-[88px] rounded-full border border-[color:var(--color-border)] bg-transparent px-2 text-[11px] text-[color:var(--color-foreground)] outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            />
                            <button
                              type="button"
                              className="rounded-full px-1.5 py-0.5 text-[11px] text-[color:var(--color-foreground)] transition-colors hover:bg-[color:var(--color-accent)]"
                              onClick={() => {
                                void state.tags.saveRename()
                              }}
                              disabled={state.tags.saving}
                            >
                              {t('common.save')}
                            </button>
                            <button
                              type="button"
                              className="rounded-full px-1.5 py-0.5 text-[11px] text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-accent)]"
                              onClick={state.tags.cancelRename}
                            >
                              {t('common.cancel')}
                            </button>
                          </>
                        ) : (
                          <>
                            <span>{option.label}</span>
                            <button
                              type="button"
                              className="inline-flex h-5 w-5 items-center justify-center rounded-full text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)]"
                              onClick={() => state.tags.beginRename(option)}
                              title={t('common.rename')}
                            >
                              <Edit3 className="h-3 w-3" />
                            </button>
                            <button
                              type="button"
                              className="inline-flex h-5 w-5 items-center justify-center rounded-full text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-destructive-background)] hover:text-[color:var(--color-destructive)]"
                              onClick={() => {
                                void state.tags.remove(option.value)
                              }}
                              title={t('common.delete')}
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            </>
          )}
        </div>

        <div className="mb-3 shrink-0 flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            className={`inline-flex h-7 items-center rounded-full px-2.5 text-[11px] transition-colors ${
              state.tags.activeFilter === 'all'
                ? 'bg-primary text-white'
                : 'border border-[color:var(--color-border)] text-[color:var(--color-muted-foreground)] hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)]'
            }`}
            onClick={() => state.tags.selectFilter('all')}
          >
            {t('documentation.all')}
          </button>
          {state.tags.options.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`inline-flex h-7 items-center rounded-full px-2.5 text-[11px] transition-colors ${
                state.tags.activeFilter === option.value
                  ? 'bg-primary text-white'
                  : 'border border-[color:var(--color-border)] text-[color:var(--color-muted-foreground)] hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)]'
              }`}
              onClick={() => state.tags.selectFilter(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden pr-1">
          <DetailDocumentationLinkList
            links={state.links}
            editing={state.editing}
            docTagOptions={state.tags.options}
          />
        </div>

        {docError && (
          <p className="mt-3 shrink-0 text-xs text-[color:var(--color-destructive)]">
            {docError}
          </p>
        )}
      </div>
    </ModalShell>
  )
}

export { DetailDocumentationSettingsModal }
