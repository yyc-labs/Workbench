import { Check, Copy, ExternalLink, KeyRound, Link2, Settings2, UserRound } from 'lucide-react'
import { type MutableRefObject, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useI18n } from '../i18n'
import { copyTextToClipboard } from '../pages/code/code.clipboard'
import type { UrlPopoverCredentialAction, UrlPopoverItem } from './UrlPopover'
import { openUrlPopoverItem } from './UrlPopover'

type UrlPopoverItemDetailCardProps = {
  position: { x: number; y: number }
  entry: UrlPopoverItem
  zIndex?: number
  onClose: () => void
  /** 「管理链接」动作；不传则不渲染该按钮 */
  onOpenManager?: () => void
  /** 由 UrlPopover 持有：点击卡片内不关 popover 的判定依据 */
  cardRef?: MutableRefObject<HTMLDivElement | null>
}

const CARD_WIDTH = 300
const VIEWPORT_PADDING = 12
const ESTIMATED_HEIGHT = 240

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max))
}

export function UrlPopoverItemDetailCard({ position, entry, zIndex = 10001, onClose, onOpenManager, cardRef }: UrlPopoverItemDetailCardProps) {
  const { t } = useI18n()
  const localRef = useRef<HTMLDivElement | null>(null)
  const [layout, setLayout] = useState(() => ({
    top: clamp(position.y, VIEWPORT_PADDING, window.innerHeight - ESTIMATED_HEIGHT - VIEWPORT_PADDING),
    left: clamp(position.x, VIEWPORT_PADDING, window.innerWidth - CARD_WIDTH - VIEWPORT_PADDING),
  }))
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const setRef = (node: HTMLDivElement | null) => {
    localRef.current = node
    if (cardRef) cardRef.current = node
  }

  // 挂载后按实测高度修正：下方放不下时向上翻（弹层不监听 scroll 关闭，仅首帧定位）。
  useLayoutEffect(() => {
    const node = localRef.current
    if (!node) return
    const height = node.getBoundingClientRect().height
    const belowTop = position.y + 8
    const fitsBelow = belowTop + height <= window.innerHeight - VIEWPORT_PADDING
    const top = fitsBelow ? Math.min(belowTop, window.innerHeight - height - VIEWPORT_PADDING) : Math.max(VIEWPORT_PADDING, position.y - height - 8)
    setLayout((current) => (current.top === top ? current : { ...current, top }))
  }, [position.x, position.y])

  // 关闭：Escape + 外部点击；不注册 scroll 监听（卡片内容一般不满一屏；内部滚动不自关闭）。
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      // 搜索框的 Escape 已 preventDefault（清空搜索），此时不关闭卡片。
      if (event.defaultPrevented) return
      onClose()
    }
    const handleMouseDown = (event: globalThis.MouseEvent) => {
      if (localRef.current?.contains(event.target as Node)) return
      onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('mousedown', handleMouseDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('mousedown', handleMouseDown)
    }
  }, [onClose])

  useEffect(() => {
    return () => {
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current)
    }
  }, [])

  const showCopied = (key: string) => {
    setCopiedKey(key)
    if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current)
    copiedTimerRef.current = setTimeout(() => {
      setCopiedKey((current) => (current === key ? null : current))
    }, 1200)
  }

  const handleCopyLink = async () => {
    try {
      const value = entry.copyValueResolver ? await entry.copyValueResolver() : (entry.copyValue ?? entry.url)
      if (!value) return
      const copied = await copyTextToClipboard(value)
      if (!copied) return
      showCopied('link')
    } catch {
      return
    }
  }

  const handleCopyCredential = async (action: UrlPopoverCredentialAction) => {
    try {
      const copied = await action.onCopy()
      if (!copied) return
      showCopied(`credential:${action.key}`)
    } catch {
      return
    }
  }

  const credentialIcon = (icon: UrlPopoverCredentialAction['icon']) => (icon === 'password' ? <KeyRound className="h-3.5 w-3.5 shrink-0" /> : <UserRound className="h-3.5 w-3.5 shrink-0" />)

  return createPortal(
    <div
      ref={setRef}
      className="fixed overflow-hidden rounded-[14px]"
      style={{
        top: layout.top,
        left: layout.left,
        width: CARD_WIDTH,
        zIndex,
        background: 'var(--color-popover)',
        border: '1px solid var(--color-border)',
        boxShadow: 'var(--shadow-popover)',
        backdropFilter: 'saturate(145%) blur(14px)',
        WebkitBackdropFilter: 'saturate(145%) blur(14px)',
      }}
      role="dialog"
      aria-label={t('documentation.linkDetails')}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
    >
      <div className="space-y-2 p-3">
        <div className="flex items-center gap-1.5">
          <span className="min-w-0 flex-1 truncate text-xs font-medium text-[color:var(--color-foreground)]" title={entry.label}>
            {entry.label}
          </span>
          {entry.source === 'shared' && <span className="shrink-0 rounded-full bg-[color:var(--color-accent)] px-1.5 py-0.5 text-[10px] text-[color:var(--color-muted-foreground)]">{t('documentation.sharedBadge')}</span>}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {entry.tagLabel && <span className="rounded-full bg-[color:var(--color-accent)] px-1.5 py-0.5 text-[10px] text-[color:var(--color-muted-foreground)]">{entry.tagLabel}</span>}
          <span className="inline-flex items-center gap-1 rounded-full border border-[color:var(--color-border)] px-1.5 py-0.5 text-[10px] text-[color:var(--color-muted-foreground)]">
            {entry.kind === 'ssh' ? <Link2 className="h-3 w-3 shrink-0" /> : <ExternalLink className="h-3 w-3 shrink-0" />}
            {entry.kind === 'ssh' ? t('documentation.kindSsh') : t('documentation.kindUrl')}
          </span>
        </div>

        {entry.description && (
          <p className="break-all font-mono text-[11px] text-[color:var(--color-muted-foreground)]" title={entry.description}>
            {entry.description}
          </p>
        )}

        {entry.note && (
          <p className="text-[11px] text-[color:var(--color-muted-foreground)]" title={entry.note}>
            {entry.note}
          </p>
        )}

        <div className="flex flex-wrap gap-1.5 border-t border-[color:var(--color-border)] pt-2">
          <button
            type="button"
            className="quiet-control inline-flex h-7 items-center gap-1 rounded-full border-0 px-2.5 text-[11px] text-[color:var(--color-foreground)] transition-colors hover:bg-[color:var(--color-accent)]"
            onClick={() => {
              void openUrlPopoverItem(entry)
              onClose()
            }}
          >
            <ExternalLink className="h-3 w-3 shrink-0" />
            {t('documentation.openLink')}
          </button>
          <button
            type="button"
            className="quiet-control inline-flex h-7 items-center gap-1 rounded-full border-0 px-2.5 text-[11px] text-[color:var(--color-foreground)] transition-colors hover:bg-[color:var(--color-accent)]"
            onClick={() => {
              void handleCopyLink()
            }}
          >
            {copiedKey === 'link' ? <Check className="h-3 w-3 shrink-0" /> : <Copy className="h-3 w-3 shrink-0" />}
            {copiedKey === 'link' ? t('common.copied') : t('documentation.copyLink')}
          </button>
          {(entry.credentialActions ?? []).map((action) => (
            <button
              key={action.key}
              type="button"
              className="quiet-control inline-flex h-7 items-center gap-1 rounded-full border-0 px-2.5 text-[11px] text-[color:var(--color-foreground)] transition-colors hover:bg-[color:var(--color-accent)]"
              onClick={() => {
                void handleCopyCredential(action)
              }}
            >
              {copiedKey === `credential:${action.key}` ? <Check className="h-3.5 w-3.5 shrink-0" /> : credentialIcon(action.icon)}
              {copiedKey === `credential:${action.key}` ? t('common.copied') : action.label}
            </button>
          ))}
          {onOpenManager && (
            <button
              type="button"
              className="quiet-control inline-flex h-7 items-center gap-1 rounded-full border-0 px-2.5 text-[11px] text-[color:var(--color-foreground)] transition-colors hover:bg-[color:var(--color-accent)]"
              onClick={() => {
                onClose()
                onOpenManager()
              }}
            >
              <Settings2 className="h-3 w-3 shrink-0" />
              {t('documentation.manageLinks')}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
