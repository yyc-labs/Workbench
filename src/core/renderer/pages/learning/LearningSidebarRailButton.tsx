import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '../../components/ui/button'
import { useI18n } from '../../i18n'

type LearningSidebarRailButtonProps = {
  side: 'left' | 'right'
  collapsed: boolean
  onClick: () => void
  className: string
}

export function LearningSidebarRailButton({
  side,
  collapsed,
  onClick,
  className,
}: LearningSidebarRailButtonProps) {
  const { t } = useI18n()
  const label = side === 'left'
    ? (collapsed ? t('learning.sidebarRail.expandLeft') : t('learning.sidebarRail.collapseLeft'))
    : (collapsed ? t('learning.sidebarRail.expandRight') : t('learning.sidebarRail.collapseRight'))
  const Icon = side === 'left'
    ? (collapsed ? ChevronRight : ChevronLeft)
    : (collapsed ? ChevronLeft : ChevronRight)

  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      className={`h-8 w-8 rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-card)]/96 shadow-[0_8px_20px_rgba(15,23,42,0.10)] backdrop-blur-md ${className}`}
      onClick={onClick}
      aria-label={label}
      title={label}
    >
      <Icon className="h-3.5 w-3.5" />
    </Button>
  )
}
