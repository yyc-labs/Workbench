import { ChevronDown, ChevronUp, Copy, Link2, Link2Off, Pencil, Play, Power, RotateCw, Trash2 } from 'lucide-react'
import type { QuickActionView } from '../../../../shared/types'
import { useI18n } from '../../../i18n'
import { describeQuickActionSummary, QUICK_ACTION_ICON_COMPONENTS } from './quickActions.helpers'

type QuickActionCardProps = {
  action: QuickActionView
  projectName: string | null
  taskName: string | null
  canMoveUp: boolean
  canMoveDown: boolean
  onExecute: () => void
  onEdit: () => void
  onToggleEnabled: () => void
  onMove: (direction: 'up' | 'down') => void
  onDuplicate: () => void
  onDelete: () => void
  onCreateShortcut: () => void
  onRemoveShortcut: () => void
}

export function QuickActionCard({ action, projectName, taskName, canMoveUp, canMoveDown, onExecute, onEdit, onToggleEnabled, onMove, onDuplicate, onDelete, onCreateShortcut, onRemoveShortcut }: QuickActionCardProps) {
  const { t } = useI18n()
  const Icon = QUICK_ACTION_ICON_COMPONENTS[action.icon]
  const summary = describeQuickActionSummary(t, action.action, projectName, taskName)

  return (
    <div className="surface-card flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[color:var(--color-accent)] text-[color:var(--color-foreground)]">
          <Icon className="h-4 w-4" strokeWidth={1.8} />
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-medium text-[color:var(--color-foreground)]">{action.name}</span>
            {action.shortcutState === 'valid' ? <span className="rounded-full bg-[color:var(--color-accent)] px-2 py-0.5 text-xs text-[color:var(--color-muted-foreground)]">{t('quickActions.card.badgeShortcut')}</span> : null}
            {action.shortcutState === 'missing' ? <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-xs text-destructive">{t('quickActions.card.badgeShortcutMissing')}</span> : null}
            {!action.enabled ? <span className="rounded-full bg-[color:var(--color-accent)] px-2 py-0.5 text-xs text-[color:var(--color-muted-foreground)]">{t('quickActions.card.badgeDisabled')}</span> : null}
          </div>
          <p className="mt-0.5 truncate text-xs text-[color:var(--color-muted-foreground)]" title={summary}>
            {summary}
          </p>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          onClick={onExecute}
          title={t('quickActions.card.execute')}
          aria-label={t('quickActions.card.execute')}
          className="button-interactive flex h-9 w-9 items-center justify-center rounded-full text-[color:var(--color-muted-foreground)] hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)]"
        >
          <Play className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onEdit}
          title={t('quickActions.card.edit')}
          aria-label={t('quickActions.card.edit')}
          className="button-interactive flex h-9 w-9 items-center justify-center rounded-full text-[color:var(--color-muted-foreground)] hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)]"
        >
          <Pencil className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onToggleEnabled}
          title={action.enabled ? t('quickActions.card.disable') : t('quickActions.card.enable')}
          aria-label={action.enabled ? t('quickActions.card.disable') : t('quickActions.card.enable')}
          className="button-interactive flex h-9 w-9 items-center justify-center rounded-full text-[color:var(--color-muted-foreground)] hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)]"
        >
          <Power className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => onMove('up')}
          disabled={!canMoveUp}
          title={t('quickActions.card.moveUp')}
          aria-label={t('quickActions.card.moveUp')}
          className="button-interactive flex h-9 w-9 items-center justify-center rounded-full text-[color:var(--color-muted-foreground)] hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)] disabled:opacity-40"
        >
          <ChevronUp className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => onMove('down')}
          disabled={!canMoveDown}
          title={t('quickActions.card.moveDown')}
          aria-label={t('quickActions.card.moveDown')}
          className="button-interactive flex h-9 w-9 items-center justify-center rounded-full text-[color:var(--color-muted-foreground)] hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)] disabled:opacity-40"
        >
          <ChevronDown className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onDuplicate}
          title={t('quickActions.card.duplicate')}
          aria-label={t('quickActions.card.duplicate')}
          className="button-interactive flex h-9 w-9 items-center justify-center rounded-full text-[color:var(--color-muted-foreground)] hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)]"
        >
          <Copy className="h-4 w-4" />
        </button>
        {action.shortcutState === 'valid' ? (
          <button
            type="button"
            onClick={onRemoveShortcut}
            title={t('quickActions.shortcut.remove')}
            aria-label={t('quickActions.shortcut.remove')}
            className="button-interactive flex h-9 w-9 items-center justify-center rounded-full text-[color:var(--color-muted-foreground)] hover:bg-destructive/10 hover:text-destructive"
          >
            <Link2Off className="h-4 w-4" />
          </button>
        ) : action.shortcutState === 'missing' ? (
          <button
            type="button"
            onClick={onCreateShortcut}
            title={t('quickActions.shortcut.rebuild')}
            aria-label={t('quickActions.shortcut.rebuild')}
            className="button-interactive flex h-9 w-9 items-center justify-center rounded-full text-[color:var(--color-muted-foreground)] hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)]"
          >
            <RotateCw className="h-4 w-4" />
          </button>
        ) : (
          <button
            type="button"
            onClick={onCreateShortcut}
            title={t('quickActions.shortcut.create')}
            aria-label={t('quickActions.shortcut.create')}
            className="button-interactive flex h-9 w-9 items-center justify-center rounded-full text-[color:var(--color-muted-foreground)] hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)]"
          >
            <Link2 className="h-4 w-4" />
          </button>
        )}
        <button type="button" onClick={onDelete} title={t('quickActions.card.delete')} aria-label={t('quickActions.card.delete')} className="button-interactive flex h-9 w-9 items-center justify-center rounded-full text-[color:var(--color-muted-foreground)] hover:bg-destructive/10 hover:text-destructive">
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
