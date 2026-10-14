import { memo, useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { Loader2, PanelBottom, PanelLeft, PanelRight, PanelTop, Plus, TerminalSquare, Trash2, X } from 'lucide-react'
import type { FloatingTerminalDock, FloatingTerminalInstance } from '../../../shared/types'
import { useI18n } from '../../i18n'
import { useAppStore } from '../../stores/appStore'
import { ContextCascader } from '../ui/ContextCascader'
import { Terminal } from '../Terminal'

const DOCK_RESIZE_STRIP = 8

/** 停靠几何直出（纯函数）。 */
function panelGeometryStyle(instance: FloatingTerminalInstance): CSSProperties {
  const ratioPercent = `${Math.round(instance.sizeRatio * 100)}vh`
  const ratioPercentW = `${Math.round(instance.sizeRatio * 100)}vw`
  switch (instance.dock) {
    case 'bottom':
      return { left: 0, right: 0, bottom: 0, height: ratioPercent }
    case 'top':
      return { left: 0, right: 0, top: 0, height: ratioPercent }
    case 'left':
      return { top: 0, bottom: 0, left: 0, width: ratioPercentW }
    case 'right':
      return { top: 0, bottom: 0, right: 0, width: ratioPercentW }
  }
}

interface ResizeState {
  startPointerX: number
  startPointerY: number
  startWidth: number
  startHeight: number
  dock: FloatingTerminalDock
  frameId: number
}

function FloatingTerminalPanelInner({ instances, activeInstance }: { instances: FloatingTerminalInstance[]; activeInstance: FloatingTerminalInstance }) {
  const { t } = useI18n()
  const panelRef = useRef<HTMLDivElement | null>(null)
  const resizeStateRef = useRef<ResizeState | null>(null)
  const [menuPosition, setMenuPosition] = useState<{ x: number; y: number } | null>(null)
  const [isReconnecting, setIsReconnecting] = useState(false)

  const processStatus = useAppStore((s) => s.processes[activeInstance.processKey]?.status)
  const focusFloatingTerminal = useAppStore((s) => s.focusFloatingTerminal)
  const setActiveFloatingTerminal = useAppStore((s) => s.setActiveFloatingTerminal)
  const closeFloatingTerminal = useAppStore((s) => s.closeFloatingTerminal)
  const closeAllFloatingTerminals = useAppStore((s) => s.closeAllFloatingTerminals)
  const hideAllFloatingTerminals = useAppStore((s) => s.hideAllFloatingTerminals)
  const addFloatingTerminal = useAppStore((s) => s.addFloatingTerminal)
  const setFloatingTerminalDock = useAppStore((s) => s.setFloatingTerminalDock)
  const setFloatingTerminalSizeRatio = useAppStore((s) => s.setFloatingTerminalSizeRatio)
  const reconnectFloatingTerminal = useAppStore((s) => s.reconnectFloatingTerminal)

  useEffect(() => {
    return () => {
      if (resizeStateRef.current) window.cancelAnimationFrame(resizeStateRef.current.frameId)
    }
  }, [])

  // 切换标签时复位重连按钮状态。
  useEffect(() => {
    setIsReconnecting(false)
  }, [activeInstance.id])

  // ── resize：停靠态贴边分隔条拖拽，按视口宽/高换算 sizeRatio ──
  const handleResizeStart = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return
      event.preventDefault()
      event.stopPropagation()
      ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)

      const startRect = panelRef.current?.getBoundingClientRect()
      const state: ResizeState = {
        startPointerX: event.clientX,
        startPointerY: event.clientY,
        startWidth: startRect?.width ?? window.innerWidth * 0.35,
        startHeight: startRect?.height ?? window.innerHeight * 0.35,
        dock: activeInstance.dock,
        frameId: 0,
      }
      resizeStateRef.current = state

      const onMove = (moveEvent: PointerEvent) => {
        const resize = resizeStateRef.current
        if (!resize) return
        if (resize.frameId) return
        resize.frameId = window.requestAnimationFrame(() => {
          const current = resizeStateRef.current
          if (!current) return
          current.frameId = 0
          const dx = moveEvent.clientX - current.startPointerX
          const dy = moveEvent.clientY - current.startPointerY
          const viewportWidth = window.innerWidth
          const viewportHeight = window.innerHeight
          const ratio = current.dock === 'left' ? (current.startWidth + dx) / viewportWidth : current.dock === 'right' ? (current.startWidth - dx) / viewportWidth : current.dock === 'top' ? (current.startHeight + dy) / viewportHeight : (current.startHeight - dy) / viewportHeight
          setFloatingTerminalSizeRatio(activeInstance.id, ratio)
        })
      }

      const onUp = () => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        const resize = resizeStateRef.current
        resizeStateRef.current = null
        if (!resize) return
        if (resize.frameId) window.cancelAnimationFrame(resize.frameId)
      }

      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    },
    [activeInstance.dock, activeInstance.id, setFloatingTerminalSizeRatio],
  )

  const handleReconnect = useCallback(() => {
    if (isReconnecting) return
    setIsReconnecting(true)
    void reconnectFloatingTerminal(activeInstance.id).finally(() => setIsReconnecting(false))
  }, [activeInstance.id, isReconnecting, reconnectFloatingTerminal])

  const isProcessAlive = processStatus === 'running' || processStatus === 'stopping'
  // 仅明确退出（stopped/error）才进入「结束态」；脚本标签（::script::）是一次性任务，
  // 跑完就退出，「重新连接」等于重跑且遮罩会盖住最终输出——结束后保持输出可见，不显示任何遮罩。
  const isScriptTab = activeInstance.processKey.includes('::script::')
  const hasExitStatus = processStatus === 'stopped' || processStatus === 'error'
  const showReconnect = !isScriptTab && hasExitStatus
  // 启动中：仅进程尚无状态/正在拉起时显示；已退出（stopped/error）不显示。
  const showStarting = !isProcessAlive && !hasExitStatus

  // 停靠态贴边缩放命中条（跨面板边缘 8px）
  const dockStripSide: CSSProperties | null =
    activeInstance.dock === 'bottom'
      ? { top: -DOCK_RESIZE_STRIP / 2, left: 0, right: 0, height: DOCK_RESIZE_STRIP, cursor: 'row-resize' }
      : activeInstance.dock === 'top'
        ? { bottom: -DOCK_RESIZE_STRIP / 2, left: 0, right: 0, height: DOCK_RESIZE_STRIP, cursor: 'row-resize' }
        : activeInstance.dock === 'left'
          ? { right: -DOCK_RESIZE_STRIP / 2, top: 0, bottom: 0, width: DOCK_RESIZE_STRIP, cursor: 'col-resize' }
          : { left: -DOCK_RESIZE_STRIP / 2, top: 0, bottom: 0, width: DOCK_RESIZE_STRIP, cursor: 'col-resize' }

  const dockLineClass = activeInstance.dock === 'top' || activeInstance.dock === 'bottom' ? 'absolute left-0 right-0 top-1/2 h-[2px] -translate-y-1/2 rounded-full' : 'absolute bottom-0 top-0 left-1/2 w-[2px] -translate-x-1/2 rounded-full'

  const positionMenuItems = [
    { dock: 'top' as const, label: t('common.floatingTerminal.positionTop'), icon: <PanelTop className="h-3.5 w-3.5" /> },
    { dock: 'bottom' as const, label: t('common.floatingTerminal.positionBottom'), icon: <PanelBottom className="h-3.5 w-3.5" /> },
    { dock: 'left' as const, label: t('common.floatingTerminal.positionLeft'), icon: <PanelLeft className="h-3.5 w-3.5" /> },
    { dock: 'right' as const, label: t('common.floatingTerminal.positionRight'), icon: <PanelRight className="h-3.5 w-3.5" /> },
  ]

  // 同名标签（同项目多终端）附加序号区分。
  const duplicatedTitles = new Set(instances.map((item) => item.title).filter((title, index, all) => all.indexOf(title) !== index || all.lastIndexOf(title) !== index))

  return (
    <div
      ref={panelRef}
      // nodrag：面板会盖住标题栏的 -webkit-app-region: drag 区域，而系统拖拽区命中计算不看 z-index，
      // 不显式 no-drag 的话停靠 top/left/right 时右键会弹出窗口系统菜单（最大化等）、点击被拖拽劫持。
      className="nodrag fixed flex flex-col overflow-hidden rounded-[16px] border border-[color:var(--color-border)] bg-[color:var(--color-card)] shadow-[var(--shadow-popover)]"
      style={{ ...panelGeometryStyle(activeInstance), zIndex: activeInstance.zIndex }}
      onPointerDown={() => focusFloatingTerminal(activeInstance.id)}
      onContextMenu={(event) => event.preventDefault()}
    >
      {/* 标签条：点击切换，× 关闭该终端；空白处右键打开位置菜单 */}
      <div
        className="app-chrome flex h-9 shrink-0 items-stretch border-b border-[color:var(--color-border)] bg-[color:var(--color-background-sunken)]"
        title={t('common.floatingTerminal.dockHint')}
        onContextMenu={(event) => {
          event.preventDefault()
          event.stopPropagation()
          setMenuPosition({ x: event.clientX, y: event.clientY })
        }}
      >
        <div className="flex min-w-0 flex-1 items-stretch overflow-x-auto">
          {instances.map((tab) => {
            const active = tab.id === activeInstance.id
            const label = duplicatedTitles.has(tab.title) ? `${tab.title} ${instances.indexOf(tab) + 1}` : tab.title
            return (
              <div
                key={tab.id}
                className={`group/tab flex shrink-0 cursor-pointer items-center gap-1.5 border-r border-[color:var(--color-border)] px-3 text-[11px] transition-colors ${active ? 'bg-[color:var(--color-card)] text-[color:var(--color-foreground)]' : 'text-[color:var(--color-muted-foreground)] hover:bg-[color:var(--color-accent)]/45'}`}
                onClick={() => setActiveFloatingTerminal(tab.id)}
                title={label}
              >
                <TerminalSquare className="h-3 w-3 shrink-0" />
                <span className="max-w-[160px] truncate font-medium">{label}</span>
                <button
                  type="button"
                  className="-mr-1 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)]"
                  title={t('common.floatingTerminal.closeTerminal')}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation()
                    closeFloatingTerminal(tab.id)
                  }}
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            )
          })}
        </div>
        <div className="flex shrink-0 items-center gap-1 px-2">
          <button
            type="button"
            className="quiet-control inline-flex h-6 w-6 items-center justify-center rounded-full text-[color:var(--color-muted-foreground)] transition-colors hover:text-[color:var(--color-foreground)]"
            title={t('common.floatingTerminal.newTerminal')}
            onClick={() => void addFloatingTerminal(activeInstance.projectId, activeInstance.cwd)}
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            className="quiet-control inline-flex h-6 w-6 items-center justify-center rounded-full text-[color:var(--color-muted-foreground)] transition-colors hover:text-[color:var(--color-foreground)]"
            title={t('common.floatingTerminal.closeAllTerminals')}
            onClick={() => closeAllFloatingTerminals()}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
          <button type="button" className="quiet-control inline-flex h-6 w-6 items-center justify-center rounded-full text-[color:var(--color-muted-foreground)] transition-colors hover:text-[color:var(--color-foreground)]" title={t('common.floatingTerminal.hideTerminal')} onClick={() => hideAllFloatingTerminals()}>
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="relative min-h-0 flex-1">
        <Terminal key={activeInstance.id} projectId={activeInstance.processKey} variant="soft" />
        {showStarting ? (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-[color:var(--color-card)]">
            <Loader2 className="h-4 w-4 animate-spin text-[color:var(--color-muted-foreground)]" />
            <span className="text-[11px] text-[color:var(--color-muted-foreground)]">{t('common.floatingTerminal.startingSession')}</span>
          </div>
        ) : null}
        {showReconnect ? (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-[color:var(--color-card)]/85 backdrop-blur-[6px]">
            <span className="text-[11px] text-[color:var(--color-muted-foreground)]">{t('common.floatingTerminal.reconnectHint')}</span>
            <button type="button" className="quiet-control rounded-full px-4 py-1.5 text-[11px] text-[color:var(--color-foreground)] transition-colors hover:bg-[color:var(--color-accent)] disabled:opacity-50" onClick={handleReconnect} disabled={isReconnecting}>
              {t('common.floatingTerminal.reconnect')}
            </button>
          </div>
        ) : null}
      </div>

      {/* 停靠态贴边分隔条：默认可见细线，hover / 拖拽高亮 */}
      {dockStripSide ? (
        <div className="group/resize absolute z-20" style={dockStripSide} onPointerDown={handleResizeStart}>
          <div className={`${dockLineClass} bg-[color:var(--color-border)] transition-[background-color,height,width] group-hover/resize:bg-[color:var(--color-primary)]/55`} />
        </div>
      ) : null}

      {/* 标签条右键菜单：面板位置切换 */}
      {menuPosition ? (
        <ContextCascader
          x={menuPosition.x}
          y={menuPosition.y}
          layout="grouped"
          sections={[
            {
              id: 'panel-position',
              label: t('common.floatingTerminal.panelPosition'),
              items: positionMenuItems.map((item) => ({
                id: item.dock,
                label: item.label,
                icon: item.icon,
                disabled: item.dock === activeInstance.dock,
                onSelect: () => setFloatingTerminalDock(activeInstance.id, item.dock, activeInstance.sizeRatio),
              })),
            },
          ]}
          onClose={() => setMenuPosition(null)}
        />
      ) : null}
    </div>
  )
}

export const FloatingTerminalPanel = memo(FloatingTerminalPanelInner)
