import * as React from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useI18n } from '../../i18n'

export type ToastKind = 'info' | 'success' | 'warning' | 'error'

/** 通知卡片渲染位置。 */
export type ToastViewportPosition = 'top-left' | 'top-center' | 'top-right' | 'bottom-left' | 'bottom-center' | 'bottom-right'

/** 通知卡片尺寸。 */
export type ToastSize = 'sm' | 'md' | 'lg'

/** 通知卡片强调色，决定图标与点缀颜色；默认跟随 kind。 */
export type ToastTone = ToastKind

/** 动作按钮层级：primary 有主色背景，secondary 无背景仅文字。 */
export type ToastActionVariant = 'primary' | 'secondary'

export type ToastAction = {
  label: string
  onAction: () => void
  variant?: ToastActionVariant
}

export type ToastOptions = {
  description?: string
  durationMs?: number
  /** 是否显示手动关闭按钮，默认 true；需要用户决策的通知可设为 false。 */
  closable?: boolean
  /** 通知被关闭（点击动作 / 手动关闭 / 超时消失）时回调。 */
  onDismiss?: () => void
  /** 单动作（简化用法）。 */
  actionLabel?: string
  onAction?: () => void
  /** 单动作按钮层级，默认 secondary。 */
  actionVariant?: ToastActionVariant
  /** 多动作按钮；提供时优先于单个 actionLabel/onAction。 */
  actions?: ToastAction[]
  /** 覆盖 viewport 默认尺寸。 */
  size?: ToastSize
  /** 覆盖默认强调色（默认与 kind 一致）。 */
  tone?: ToastTone
}

export type ToastViewportProps = {
  /** 通知挂载位置，默认右下角。 */
  position?: ToastViewportPosition
  /** 卡片默认尺寸，默认 md。 */
  size?: ToastSize
  /** 距屏幕边缘的距离（px），支持单值或 x/y 分别设置。 */
  offset?: number | { x?: number; y?: number }
  /** 单张卡片最大宽度（px）。 */
  maxWidth?: number
}

type ToastItem = {
  id: number
  message: string
  kind: ToastKind
  tone: ToastTone
  size: ToastSize
  description?: string
  durationMs: number
  closable: boolean
  onDismiss?: () => void
  actionLabel?: string
  onAction?: () => void
  actionVariant: ToastActionVariant
  actions?: ToastAction[]
}

const DEFAULT_DURATION_MS = 3200
const DEFAULT_OFFSET = 16

let toasts: ToastItem[] = []
let listeners: Array<() => void> = []
let nextToastId = 1

function subscribe(listener: () => void): () => void {
  listeners.push(listener)
  return () => {
    listeners = listeners.filter((item) => item !== listener)
  }
}

function emit(): void {
  for (const listener of listeners) listener()
}

function dismissToast(id: number): void {
  const target = toasts.find((item) => item.id === id)
  toasts = toasts.filter((item) => item.id !== id)
  emit()
  target?.onDismiss?.()
}

function pushToast(message: string, options: ToastOptions & { kind: ToastKind }): number {
  const id = nextToastId
  nextToastId += 1
  const item: ToastItem = {
    id,
    message,
    kind: options.kind,
    tone: options.tone ?? options.kind,
    size: options.size ?? 'md',
    description: options.description,
    durationMs: options.durationMs ?? DEFAULT_DURATION_MS,
    closable: options.closable ?? true,
    onDismiss: options.onDismiss,
    actionLabel: options.actionLabel,
    onAction: options.onAction,
    actionVariant: options.actionVariant ?? 'secondary',
    actions: options.actions,
  }
  toasts = [...toasts, item]
  emit()

  if (item.durationMs > 0) {
    window.setTimeout(() => {
      dismissToast(id)
    }, item.durationMs)
  }
  return id
}

/**
 * 通用通知 API：`toast.info(...)` / `toast.success(...)` / `toast.warning(...)` / `toast.error(...)`。
 * 需在组件树中挂载一次 `<ToastViewport />` 才会渲染。
 */
export const toast = {
  info: (message: string, options?: ToastOptions): number => pushToast(message, { ...options, kind: 'info' }),
  success: (message: string, options?: ToastOptions): number => pushToast(message, { ...options, kind: 'success' }),
  warning: (message: string, options?: ToastOptions): number => pushToast(message, { ...options, kind: 'warning' }),
  error: (message: string, options?: ToastOptions): number => pushToast(message, { ...options, kind: 'error' }),
  dismiss: dismissToast,
  clear: (): void => {
    toasts = []
    emit()
  },
}

const TOAST_KIND_ICON = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  error: XCircle,
} as const

type ToastPositionStyle = {
  top?: number | string
  bottom?: number | string
  left?: number | string
  right?: number | string
  transform?: string
  alignItems: 'flex-start' | 'center' | 'flex-end'
}

function resolvePositionStyle(position: ToastViewportPosition, offsetX: number, offsetY: number): ToastPositionStyle {
  switch (position) {
    case 'top-left':
      return { top: offsetY, left: offsetX, alignItems: 'flex-start' }
    case 'top-center':
      return { top: offsetY, left: '50%', transform: 'translateX(-50%)', alignItems: 'center' }
    case 'top-right':
      return { top: offsetY, right: offsetX, alignItems: 'flex-end' }
    case 'bottom-left':
      return { bottom: offsetY, left: offsetX, alignItems: 'flex-start' }
    case 'bottom-center':
      return { bottom: offsetY, left: '50%', transform: 'translateX(-50%)', alignItems: 'center' }
    case 'bottom-right':
      return { bottom: offsetY, right: offsetX, alignItems: 'flex-end' }
  }
}

/** 全局通知渲染入口，挂载在应用根部（如 AppGlobalEffects）。位置、尺寸、颜色均可通过 props 配置。 */
export function ToastViewport({ position = 'bottom-right', size = 'md', offset = DEFAULT_OFFSET, maxWidth = 380 }: ToastViewportProps) {
  const { t } = useI18n()
  const [items, setItems] = React.useState<ToastItem[]>([])
  const positionRef = React.useRef<ToastViewportPosition>(position)
  positionRef.current = position

  React.useEffect(() => {
    const sync = () => setItems([...toasts])
    const unsubscribe = subscribe(sync)
    sync()
    return unsubscribe
  }, [])

  if (items.length <= 0) return null

  const offsetX = typeof offset === 'number' ? offset : (offset.x ?? DEFAULT_OFFSET)
  const offsetY = typeof offset === 'number' ? offset : (offset.y ?? DEFAULT_OFFSET)
  const positionStyle = resolvePositionStyle(positionRef.current, offsetX, offsetY)

  return createPortal(
    <div className="toast-viewport" role="region" aria-label={t('common.notifications')} style={{ ...positionStyle, maxWidth: `min(${maxWidth}px, calc(100vw - ${offsetX * 2}px))` }}>
      {items.map((item) => {
        const Icon = TOAST_KIND_ICON[item.kind]
        const itemSize = item.size ?? size
        return (
          <div key={item.id} className={cn('toast-item', `toast-item--${itemSize}`, `toast-item--${item.tone}`)} role="status">
            <Icon className="toast-item-icon" />
            <div className="toast-item-body">
              <div className="toast-item-message">{item.message}</div>
              {item.description ? <div className="toast-item-description">{item.description}</div> : null}
            </div>
            {item.actions && item.actions.length > 0 ? (
              <div className="toast-item-actions">
                {item.actions.map((action) => (
                  <button
                    key={action.label}
                    type="button"
                    className={cn('toast-item-action', action.variant === 'primary' ? 'toast-item-action--primary' : 'toast-item-action--secondary')}
                    onClick={() => {
                      action.onAction()
                      dismissToast(item.id)
                    }}
                  >
                    {action.label}
                  </button>
                ))}
              </div>
            ) : item.actionLabel && item.onAction ? (
              <button
                type="button"
                className={cn('toast-item-action', item.actionVariant === 'primary' ? 'toast-item-action--primary' : 'toast-item-action--secondary')}
                onClick={() => {
                  item.onAction?.()
                  dismissToast(item.id)
                }}
              >
                {item.actionLabel}
              </button>
            ) : null}
            {item.closable ? (
              <button type="button" className="toast-item-close" onClick={() => dismissToast(item.id)} aria-label={t('common.close')}>
                <X className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>
        )
      })}
    </div>,
    document.body,
  )
}
