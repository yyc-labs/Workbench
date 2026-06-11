import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  ChevronDown,
  Copy,
  ExternalLink,
  GripVertical,
  KeyRound,
  Pencil,
  StickyNote,
  Trash2,
  UserRound,
} from 'lucide-react'
import { memo } from 'react'
import type { ProjectDocLink, ProjectDocTagOption } from '../../../shared/types'
import {
  normalizeProjectDocLinkTag,
  projectDocLinkTagLabel,
} from '../../lib/projectDocLinks'
import { useI18n, useLocale } from '../../i18n'
import type { DetailDocumentationEditState } from './detail.documentationCard.types'
import { DetailDocumentationTagSelect } from './DetailDocumentationTagSelect'

type DetailDocumentationLinkItemProps = {
  link: ProjectDocLink
  isDefault: boolean
  isEditing: boolean
  isExpanded: boolean
  isSorting: boolean
  dragDisabled: boolean
  editing: DetailDocumentationEditState
  copiedAccount: boolean
  copiedSecret: boolean
  secretPreview: string | null
  secretPreviewLoading: boolean
  docTagOptions: ReadonlyArray<ProjectDocTagOption>
  onCopyAccount: (linkId: string) => Promise<void>
  onCopySecret: (linkId: string) => Promise<void>
  onRevealSecret: (linkId: string) => Promise<void>
  onToggleExpand: (linkId: string) => void
  onSetDefaultDocLink: (linkId: string) => Promise<void>
  onRemoveDocLink: (linkId: string) => Promise<void>
}

const DetailDocumentationLinkItem = memo(function DetailDocumentationLinkItem({
  link,
  isDefault,
  isEditing,
  isExpanded,
  isSorting,
  dragDisabled,
  editing,
  copiedAccount,
  copiedSecret,
  secretPreview,
  secretPreviewLoading,
  docTagOptions,
  onCopyAccount,
  onCopySecret,
  onRevealSecret,
  onToggleExpand,
  onSetDefaultDocLink,
  onRemoveDocLink,
}: DetailDocumentationLinkItemProps) {
  const locale = useLocale()
  const { t } = useI18n()
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: link.id,
    disabled: dragDisabled,
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`quiet-control rounded-[16px] px-4 py-3 ${isDragging ? 'opacity-45 will-change-transform' : ''}`}
    >
      {isEditing ? (
        <div className="grid grid-cols-1 gap-2">
          <input
            type="text"
            value={editing.title}
            onChange={(event) => editing.setTitle(event.target.value)}
            placeholder={t('documentation.namePlaceholder')}
            className="quiet-control block h-9 w-full rounded-full border-0 px-3 text-xs text-[color:var(--color-foreground)]"
          />
          <input
            type="text"
            value={editing.url}
            onChange={(event) => editing.setUrl(event.target.value)}
            placeholder="https://..."
            className="quiet-control block h-9 w-full rounded-full border-0 px-3 text-xs text-[color:var(--color-foreground)]"
            onKeyDown={(event) => {
              if (event.key === 'Enter') void editing.save()
            }}
          />
          <DetailDocumentationTagSelect
            value={editing.tag}
            onChange={editing.setTag}
            options={docTagOptions}
            compact
          />
          <textarea
            value={editing.note}
            onChange={(event) => editing.setNote(event.target.value)}
            placeholder={t('documentation.notePlaceholder')}
            rows={2}
            className="quiet-control block min-h-[64px] w-full rounded-[14px] border-0 px-3 py-2 text-xs text-[color:var(--color-foreground)]"
          />
          <input
            type="text"
            value={editing.account}
            onChange={(event) => editing.setAccount(event.target.value)}
            placeholder={t('documentation.accountPlaceholder')}
            className="quiet-control block h-9 w-full rounded-full border-0 px-3 text-xs text-[color:var(--color-foreground)]"
          />
          <input
            type="text"
            value={editing.secret}
            onChange={(event) => {
              editing.setSecret(event.target.value)
              if (event.target.value.trim()) editing.setClearSecret(false)
            }}
            placeholder={editing.secretLoading ? t('documentation.loadingPassword') : t('documentation.secretPlaceholder')}
            disabled={editing.secretLoading}
            className="quiet-control block h-9 w-full rounded-full border-0 px-3 text-xs text-[color:var(--color-foreground)]"
          />
          {link.hasSecret && (
            <label className="inline-flex items-center gap-2 text-xs text-[color:var(--color-muted-foreground)]">
              <input
                type="checkbox"
                checked={editing.clearSecret}
                disabled={editing.secretLoading}
                onChange={(event) => {
                  editing.setClearSecret(event.target.checked)
                  if (event.target.checked) editing.setSecret('')
                }}
              />
              {t('documentation.clearSavedPassword')}
            </label>
          )}
          <div className="flex items-center gap-2">
            <button
              className="inline-flex h-8 items-center gap-1 rounded-full bg-primary px-3 text-xs font-medium text-white hover:bg-primary-hover"
              onClick={() => {
                void editing.save()
              }}
            >
              {t('common.save')}
            </button>
            <button
              className="inline-flex h-8 items-center gap-1 rounded-full border border-[color:var(--color-border)] px-3 text-xs text-[color:var(--color-foreground)] transition-colors hover:bg-[color:var(--color-accent)]"
              onClick={editing.cancel}
            >
              {t('common.cancel')}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-2">
          <button
            type="button"
            ref={setActivatorNodeRef}
            className={`inline-flex h-8 w-8 touch-none items-center justify-center rounded-full text-[color:var(--color-muted-foreground)] transition-colors ${
              dragDisabled
                ? 'cursor-not-allowed opacity-50'
                : 'cursor-grab active:cursor-grabbing hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)]'
            }`}
            title={dragDisabled ? t('documentation.dragDisabled') : t('documentation.dragToReorder')}
            disabled={dragDisabled}
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
            }}
            {...attributes}
            {...listeners}
          >
            <GripVertical className="h-3.5 w-3.5" />
          </button>
          <div className="min-w-0 flex-1">
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-[10px] px-1 py-1 text-left transition-colors hover:bg-[color:var(--color-accent)]"
              onClick={() => onToggleExpand(link.id)}
              aria-expanded={isExpanded}
              title={link.title}
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-[color:var(--color-foreground)]">{link.title}</p>
                <p className="truncate text-[11px] text-[color:var(--color-muted-foreground)]">
                  {isExpanded ? link.url : link.url.replace(/^https?:\/\//, '')}
                </p>
                <div className="mt-1 flex items-center gap-1.5">
                  <span className="inline-flex items-center rounded-full bg-[color:var(--color-accent)] px-2 py-0.5 text-[10px] text-[color:var(--color-muted-foreground)]">
                    {projectDocLinkTagLabel(
                      normalizeProjectDocLinkTag(link.tag, docTagOptions),
                      docTagOptions,
                      locale
                    )}
                  </span>
                </div>
              </div>
              <div className="inline-flex items-center gap-1">
                {isDefault && (
                  <span className="rounded-full bg-[color:var(--color-accent)] px-2 py-0.5 text-[10px] text-[color:var(--color-muted-foreground)]">
                    {t('documentation.defaultBadge')}
                  </span>
                )}
                <ChevronDown
                  className={`h-4 w-4 text-[color:var(--color-muted-foreground)] transition-transform ${
                    isExpanded ? 'rotate-180' : ''
                  }`}
                />
              </div>
            </button>

            {!isSorting && (
              <div className="mt-1 space-y-1.5 px-1">
                {link.note?.trim() && (
                  <div className="flex items-start gap-1.5 text-[11px] text-[color:var(--color-muted-foreground)]">
                    <StickyNote className="mt-0.5 h-3 w-3 shrink-0" />
                    <p className="line-clamp-2 break-words">{link.note}</p>
                  </div>
                )}
                <div className="flex flex-wrap items-center gap-1.5">
                  {link.account?.trim() && (
                    <>
                      <span className="inline-flex max-w-[320px] items-center gap-1 rounded-full bg-[color:var(--color-accent)] px-2 py-0.5 text-[10px] text-[color:var(--color-muted-foreground)]">
                        <UserRound className="h-2.5 w-2.5 shrink-0" />
                        <span className="truncate">{t('documentation.accountLabel')}: {link.account}</span>
                      </span>
                      <button
                        className={`inline-flex h-7 items-center gap-1 rounded-full px-2 text-[11px] transition-all ${
                          copiedAccount
                            ? 'scale-105 bg-[color:var(--color-accent)] text-[color:var(--color-foreground)]'
                            : 'text-[color:var(--color-muted-foreground)] hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)]'
                        }`}
                        onClick={() => {
                          void onCopyAccount(link.id)
                        }}
                        title={t('documentation.copyAccount')}
                      >
                        <Copy className="h-3 w-3" />
                        {copiedAccount ? t('common.copied') : t('documentation.copyAccount')}
                      </button>
                    </>
                  )}
                  {link.hasSecret && (
                    <>
                      <span className="inline-flex max-w-[320px] items-center gap-1 rounded-full bg-[color:var(--color-accent)] px-2 py-0.5 text-[10px] text-[color:var(--color-muted-foreground)]">
                        <KeyRound className="h-2.5 w-2.5 shrink-0" />
                        <span className="truncate">
                          {t('documentation.passwordLabel')}: {secretPreviewLoading ? t('common.loading') : (secretPreview ?? '******')}
                        </span>
                      </span>
                      {!secretPreview && !secretPreviewLoading && (
                        <button
                          className="inline-flex h-7 items-center gap-1 rounded-full px-2 text-[11px] text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)]"
                          onClick={() => {
                            void onRevealSecret(link.id)
                          }}
                          title={t('common.show')}
                        >
                          {t('common.show')}
                        </button>
                      )}
                      <button
                        className={`inline-flex h-7 items-center gap-1 rounded-full px-2 text-[11px] transition-all ${
                          copiedSecret
                            ? 'scale-105 bg-[color:var(--color-accent)] text-[color:var(--color-foreground)]'
                            : 'text-[color:var(--color-muted-foreground)] hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)]'
                        }`}
                        onClick={() => {
                          void onCopySecret(link.id)
                        }}
                        title={t('documentation.copyPassword')}
                      >
                        <Copy className="h-3 w-3" />
                        {copiedSecret ? t('common.copied') : t('documentation.copyPassword')}
                      </button>
                    </>
                  )}
                </div>
              </div>
            )}

            {isExpanded && !isSorting && (
              <div className="mt-2 space-y-2 rounded-[12px] border border-[color:var(--color-border)] bg-[color:var(--color-background)]/50 p-2.5">
                {(link.note?.trim() || link.account?.trim() || link.hasSecret) && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    {link.note?.trim() && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-[color:var(--color-accent)] px-2 py-0.5 text-[10px] text-[color:var(--color-muted-foreground)]">
                        <StickyNote className="h-2.5 w-2.5" />
                        {t('documentation.noteLabel')}
                      </span>
                    )}
                    {link.account?.trim() && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-[color:var(--color-accent)] px-2 py-0.5 text-[10px] text-[color:var(--color-muted-foreground)]">
                        <UserRound className="h-2.5 w-2.5" />
                        {t('documentation.accountLabel')}
                      </span>
                    )}
                    {link.hasSecret && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-[color:var(--color-accent)] px-2 py-0.5 text-[10px] text-[color:var(--color-muted-foreground)]">
                        <KeyRound className="h-2.5 w-2.5" />
                        {t('documentation.passwordLabel')}
                      </span>
                    )}
                  </div>
                )}
                {link.note?.trim() && (
                  <p className="text-xs text-[color:var(--color-muted-foreground)]">{link.note}</p>
                )}
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    className="inline-flex h-8 items-center gap-1 rounded-full px-2 text-xs text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-accent)] hover:text-primary"
                    onClick={() => window.electronAPI.openExternal(link.url)}
                  >
                    <ExternalLink className="h-3 w-3" />
                    {t('documentation.openLink')}
                  </button>
                  {link.account?.trim() && (
                    <button
                      className={`inline-flex h-8 items-center gap-1 rounded-full px-2 text-xs transition-all ${
                        copiedAccount
                          ? 'scale-105 bg-[color:var(--color-accent)] text-[color:var(--color-foreground)]'
                          : 'text-[color:var(--color-muted-foreground)] hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)]'
                      }`}
                      onClick={() => {
                        void onCopyAccount(link.id)
                      }}
                      title={t('documentation.copyAccount')}
                    >
                      <Copy className="h-3 w-3" />
                      {copiedAccount ? t('common.copied') : t('documentation.accountLabel')}
                    </button>
                  )}
                  {link.hasSecret && (
                    <button
                      className={`inline-flex h-8 items-center gap-1 rounded-full px-2 text-xs transition-all ${
                        copiedSecret
                          ? 'scale-105 bg-[color:var(--color-accent)] text-[color:var(--color-foreground)]'
                          : 'text-[color:var(--color-muted-foreground)] hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)]'
                      }`}
                      onClick={() => {
                        void onCopySecret(link.id)
                      }}
                      title={t('documentation.copyPassword')}
                    >
                      <KeyRound className="h-3 w-3" />
                      {copiedSecret ? t('common.copied') : t('documentation.passwordLabel')}
                    </button>
                  )}
                  <button
                    className="inline-flex h-8 items-center gap-1 rounded-full px-2 text-xs text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)]"
                    onClick={() => {
                      void editing.start(link)
                    }}
                    title={t('documentation.editLink')}
                  >
                    <Pencil className="h-3 w-3" />
                    {t('documentation.editLink')}
                  </button>
                  <button
                    className="inline-flex h-8 items-center gap-1 rounded-full px-2 text-xs text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)] disabled:cursor-not-allowed disabled:opacity-60"
                    onClick={() => {
                      void onSetDefaultDocLink(link.id)
                    }}
                    disabled={isDefault}
                    title={isDefault ? t('documentation.currentDefaultTitle') : t('documentation.setDefaultTitle')}
                  >
                    {isDefault ? t('documentation.currentDefault') : t('documentation.setDefault')}
                  </button>
                  <button
                    className="inline-flex h-8 w-8 items-center justify-center rounded-full text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-destructive-background)] hover:text-[color:var(--color-destructive)]"
                    onClick={() => {
                      if (isEditing) editing.cancel()
                      void onRemoveDocLink(link.id)
                    }}
                    title={t('documentation.removeLink')}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}, (prev, next) => {
  const editingStateEqual = prev.isEditing || next.isEditing
    ? (
      prev.editing.linkId === next.editing.linkId &&
      prev.editing.title === next.editing.title &&
      prev.editing.url === next.editing.url &&
      prev.editing.tag === next.editing.tag &&
      prev.editing.note === next.editing.note &&
      prev.editing.account === next.editing.account &&
      prev.editing.secret === next.editing.secret &&
      prev.editing.secretLoading === next.editing.secretLoading &&
      prev.editing.clearSecret === next.editing.clearSecret
    )
    : true

  return (
    prev.link === next.link &&
    prev.isDefault === next.isDefault &&
    prev.isEditing === next.isEditing &&
    prev.isExpanded === next.isExpanded &&
    prev.isSorting === next.isSorting &&
    prev.dragDisabled === next.dragDisabled &&
    editingStateEqual &&
    prev.copiedAccount === next.copiedAccount &&
    prev.copiedSecret === next.copiedSecret &&
    prev.secretPreview === next.secretPreview &&
    prev.secretPreviewLoading === next.secretPreviewLoading &&
    prev.docTagOptions === next.docTagOptions
  )
})

export { DetailDocumentationLinkItem }
