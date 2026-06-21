import { BookOpen } from 'lucide-react'
import { useI18n } from '../i18n'
import type { UrlPopoverItem } from './UrlPopover'
import { UrlPopover } from './UrlPopover'

type ProjectLinksTriggerProps = {
  items: UrlPopoverItem[]
  tagOptions?: ReadonlyArray<{ value: string; label: string }>
  onOpenDefault?: () => void | Promise<void>
  onOpenManager?: () => void
  size?: 'icon' | 'compact' | 'default'
  label?: string
  title?: string
  className?: string
}

export function ProjectLinksTrigger({
  items,
  tagOptions,
  onOpenDefault,
  onOpenManager,
  size = 'icon',
  label,
  title,
  className,
}: ProjectLinksTriggerProps) {
  const { t } = useI18n()
  const resolvedTitle = title ?? t('common.leftClickOpenFirstLink')

  const baseClassName = size === 'icon'
    ? 'quiet-control inline-flex h-8 w-8 items-center justify-center rounded-full border-0 text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)] cursor-pointer'
    : size === 'compact'
      ? 'inline-flex items-center gap-1.5 rounded-full border border-[color:var(--color-border)] px-3 py-1.5 text-xs font-medium text-[color:var(--color-foreground)] transition-colors hover:bg-[color:var(--color-accent)]'
      : 'inline-flex items-center gap-2 rounded-full border border-[color:var(--color-border)] px-4 py-2 text-sm font-medium text-[color:var(--color-foreground)] transition-colors hover:bg-[color:var(--color-accent)]'

  const iconClassName = size === 'default' ? 'h-4 w-4 shrink-0' : 'h-3.5 w-3.5 shrink-0'

  const content = size === 'icon'
    ? <BookOpen className={iconClassName} />
    : (
      <>
        <BookOpen className={iconClassName} />
        {label && <span>{label}</span>}
      </>
    )

  const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    if (onOpenDefault) {
      void onOpenDefault()
      return
    }
    if (onOpenManager) onOpenManager()
  }

  const handleContextMenu = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
    onOpenManager?.()
  }

  const trigger = (
    <button
      type="button"
      className={className ? `${baseClassName} ${className}` : baseClassName}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
      title={resolvedTitle}
    >
      {content}
    </button>
  )

  if (items.length > 0) {
    return (
      <UrlPopover items={items} tagOptions={tagOptions}>
        {trigger}
      </UrlPopover>
    )
  }

  return trigger
}
