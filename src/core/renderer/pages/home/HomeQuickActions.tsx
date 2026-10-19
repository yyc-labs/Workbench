import { ChevronDown, Zap } from 'lucide-react'
import { useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import type { QuickActionResult } from '../../../shared/types'
import { UrlPopover, type UrlPopoverItem } from '../../components/UrlPopover'
import { Button } from '../../components/ui/button'
import { toast } from '../../components/ui/toast'
import { useI18n } from '../../i18n'
import { projectDisplayName } from '../../lib/projectDisplay'
import { describeQuickActionResult } from '../../lib/quickActionFeedback'
import { useAppStore } from '../../stores/appStore'

/**
 * Home header quick-actions dropdown. Reads its own data from the app store
 * (the store is the source of truth) instead of widening Home's props surface.
 * Renders only when at least one enabled action exists.
 */
export function HomeQuickActions() {
  const { t } = useI18n()
  const navigate = useNavigate()
  const quickActions = useAppStore((s) => s.quickActions)
  const projects = useAppStore((s) => s.projects)
  const executeQuickAction = useAppStore((s) => s.executeQuickAction)

  const enabledActions = useMemo(() => quickActions.filter((item) => item.enabled), [quickActions])

  const notifyResult = useCallback(
    (result: QuickActionResult) => {
      const feedback = describeQuickActionResult(t, result)
      if (feedback.kind === 'success') toast.success(feedback.message)
      else toast.error(feedback.message, { description: feedback.description })
    },
    [t],
  )

  /** 点击即执行：loading toast 常驻至主进程返回，再替换为成功/失败通知。 */
  const runAction = useCallback(
    async (id: string) => {
      const loadingId = toast.loading(t('home.quickActions.executing'))
      try {
        notifyResult(await executeQuickAction({ id }))
      } catch (error) {
        toast.error(error instanceof Error ? error.message : String(error))
      } finally {
        toast.dismiss(loadingId)
      }
    },
    [executeQuickAction, notifyResult, t],
  )

  const items = useMemo<UrlPopoverItem[]>(() => {
    const manageItem: UrlPopoverItem = {
      url: 'quick-action://manage',
      label: t('home.quickActions.manage'),
      onOpen: () => {
        navigate('/settings/quick-actions')
      },
    }
    const actionItems: UrlPopoverItem[] = enabledActions.map((action) => {
      const spec = action.action
      const project = spec.type === 'open-project' || spec.type === 'run-task' ? projects.find((item) => item.path === spec.projectPath) : undefined
      const description = project ? projectDisplayName(project) : spec.type === 'open-path' ? spec.path : spec.type === 'open-url' ? spec.url : undefined
      return {
        // url 仅作为条目 key 与搜索文本；onOpen 存在时不会真正打开它。
        url: `quick-action://${action.id}`,
        label: action.name,
        description,
        onOpen: () => runAction(action.id),
      }
    })
    return [manageItem, ...actionItems]
  }, [enabledActions, navigate, projects, runAction, t])

  if (enabledActions.length === 0) return null

  return (
    <UrlPopover items={items} forcePopover closeOnSelect searchPlaceholder={t('home.quickActions.searchPlaceholder')} triggerClassName="shrink-0">
      <Button variant="ghost" size="sm" className="h-8 gap-1 rounded-full px-3 text-sm text-[color:var(--color-muted-foreground)] hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)]">
        <Zap className="h-4 w-4" strokeWidth={1.8} />
        {t('home.quickActions.title')}
        <ChevronDown className="h-3.5 w-3.5" strokeWidth={1.8} />
      </Button>
    </UrlPopover>
  )
}
