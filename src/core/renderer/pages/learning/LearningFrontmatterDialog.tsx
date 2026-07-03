import { useMemo } from 'react'
import { FolderPlus, X } from 'lucide-react'
import type { LearningCategory, LearningNoteStatus } from '../../../shared/types'
import { ModalShell } from '../../components/ModalShell'
import { Button } from '../../components/ui/button'
import { Combobox, type ComboboxOption } from '../../components/ui/combobox'
import { Input } from '../../components/ui/input'
import { Select, type SelectOption } from '../../components/ui/select'
import { useI18n } from '../../i18n'
import type { FrontmatterDialogMode } from './learningCenterTypes'

type LearningFrontmatterDialogProps = {
  categories: LearningCategory[]
  categoryInput: string
  error: string | null
  mode: FrontmatterDialogMode
  open: boolean
  status: LearningNoteStatus
  submitting: boolean
  tags: string
  title: string
  onCategoryInputChange: (value: string) => void
  onClose: () => void
  onStatusChange: (status: LearningNoteStatus) => void
  onSubmit: () => void | Promise<void>
  onTagsChange: (value: string) => void
  onTitleChange: (value: string) => void
}

export function LearningFrontmatterDialog({
  categories,
  categoryInput,
  error,
  mode,
  open,
  status,
  submitting,
  tags,
  title,
  onCategoryInputChange,
  onClose,
  onStatusChange,
  onSubmit,
  onTagsChange,
  onTitleChange,
}: LearningFrontmatterDialogProps) {
  const { t } = useI18n()
  const statusOptions: SelectOption[] = useMemo(
    () => [
      { value: 'draft', label: t('learning.frontmatter.statusDraft') },
      { value: 'organized', label: t('learning.frontmatter.statusOrganized') },
    ],
    [t]
  )
  const categoryOptions: ComboboxOption[] = useMemo(
    () => categories.map((category) => ({
      value: category.name,
      label: category.name,
    })),
    [categories]
  )
  const uncategorizedOption = useMemo<ComboboxOption[]>(
    () => [{ value: '', label: t('learning.frontmatter.uncategorized') }],
    [t]
  )

  const handleClose = () => {
    if (submitting) return
    onClose()
  }

  return (
    <ModalShell
      open={open}
      onClose={handleClose}
      widthClassName="max-w-[640px]"
      ariaLabel={mode === 'create' ? t('learning.frontmatter.createAria') : t('learning.frontmatter.editAria')}
      panelClassName="p-0 overflow-hidden"
    >
      <div className="flex flex-col">
        <div className="border-b border-[color:var(--color-border)] px-5 py-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-base font-semibold text-[color:var(--color-foreground)]">
                {mode === 'create' ? t('learning.frontmatter.createTitle') : t('learning.frontmatter.editTitle')}
              </div>
              <div className="mt-1 text-sm leading-6 text-[color:var(--color-muted-foreground)]">
                {mode === 'create'
                  ? t('learning.frontmatter.createDescription')
                  : t('learning.frontmatter.editDescription')}
              </div>
            </div>
            <button
              type="button"
              className="flex h-8 w-8 items-center justify-center rounded-full text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)] disabled:cursor-not-allowed disabled:opacity-60"
              onClick={handleClose}
              title={t('common.close')}
              disabled={submitting}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="grid gap-4 px-5 py-5 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <div className="mb-1.5 text-xs text-[color:var(--color-muted-foreground)]">{t('learning.frontmatter.titleLabel')}</div>
            <Input
              value={title}
              onChange={(event) => onTitleChange(event.target.value)}
              placeholder={t('learning.frontmatter.titlePlaceholder')}
              disabled={submitting}
            />
          </div>
          <div>
            <div className="mb-1.5 text-xs text-[color:var(--color-muted-foreground)]">{t('learning.frontmatter.categoryLabel')}</div>
            <Combobox
              ariaLabel="learning-frontmatter-category"
              value={categoryInput}
              options={categoryOptions}
              pinnedOptions={uncategorizedOption}
              onChange={onCategoryInputChange}
              placeholder={t('learning.frontmatter.categoryPlaceholder')}
              allowCreate
              toggleAriaLabel={categoryInput.trim() ? t('learning.frontmatter.categoryToggleClose') : t('learning.frontmatter.categoryToggleOpen')}
              emptyText={t('learning.frontmatter.categoryEmpty')}
              isOptionSelected={(option, currentValue) => option.value === currentValue.trim()}
              createIcon={<FolderPlus className="h-4 w-4 shrink-0 text-[color:var(--color-primary)]" />}
              createLabel={(nextValue) => (
                <span className="flex min-w-0 items-center gap-2">
                  <FolderPlus className="h-4 w-4 shrink-0 text-[color:var(--color-primary)]" />
                  <span className="truncate">{t('learning.frontmatter.createCategory', { value: nextValue })}</span>
                </span>
              )}
              filterOption={(option, query) => {
                const normalizedQuery = query.trim().toLowerCase()
                if (!normalizedQuery) return option.value !== ''
                return option.label.toLowerCase().includes(normalizedQuery)
              }}
              disabled={submitting}
            />
            <div className="mt-2 text-xs text-[color:var(--color-muted-foreground)]">
              {t('learning.frontmatter.categoryHint')}
            </div>
          </div>
          <div>
            <div className="mb-1.5 text-xs text-[color:var(--color-muted-foreground)]">{t('learning.frontmatter.statusLabel')}</div>
            <Select
              ariaLabel="learning-frontmatter-status"
              value={status}
              options={statusOptions}
              onChange={(value) => onStatusChange(value as LearningNoteStatus)}
              disabled={submitting}
            />
          </div>
          <div className="sm:col-span-2">
            <div className="mb-1.5 text-xs text-[color:var(--color-muted-foreground)]">{t('learning.frontmatter.tagsLabel')}</div>
            <Input
              value={tags}
              onChange={(event) => onTagsChange(event.target.value)}
              placeholder={t('learning.frontmatter.tagsPlaceholder')}
              disabled={submitting}
            />
            <div className="mt-2 text-xs text-[color:var(--color-muted-foreground)]">
              {t('learning.frontmatter.tagsHint')}
            </div>
          </div>
          {error ? (
            <div className="sm:col-span-2 text-sm text-[color:var(--color-destructive)]">{error}</div>
          ) : null}
        </div>

        <div className="flex justify-end gap-3 border-t border-[color:var(--color-border)] px-5 py-4">
          <Button
            variant="outline"
            className="rounded-full"
            onClick={handleClose}
            disabled={submitting}
          >
            {t('common.cancel')}
          </Button>
          <Button
            className="rounded-full"
            onClick={() => void onSubmit()}
            loading={submitting}
          >
            {mode === 'create' ? t('learning.frontmatter.createSubmit') : t('learning.frontmatter.saveSubmit')}
          </Button>
        </div>
      </div>
    </ModalShell>
  )
}
