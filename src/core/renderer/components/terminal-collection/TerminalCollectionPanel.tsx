import { CircleStop, Eye, EyeOff, ListTree, Loader2, PanelBottom, PanelLeft, PanelRight, PanelTop, Plus, Server, SquareTerminal, TerminalSquare, Trash2, X } from 'lucide-react'
import { type CSSProperties, memo, type PointerEvent as ReactPointerEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FloatingTerminalDock } from '../../../shared/types'
import type { TerminalProcessKind } from '../../../shared/terminals'
import { buildTerminalCollectionModel, type CollectionTerminalItem } from '../../lib/terminalCollectionModel'
import { TERMINAL_LIST_WIDTH, TERMINAL_PANEL_HEADER_HEIGHT } from '../../lib/terminalViewportSize'
import { useI18n } from '../../i18n'
import { useAppStore } from '../../stores/appStore'
import { Terminal } from '../Terminal'
import { TerminalTabRenameInput } from '../TerminalTabRenameInput'
import { ConfirmDialog } from '../ConfirmDialog'
import { ContextCascader } from '../ui/ContextCascader'
import { TerminalCollectionProjectPicker } from './TerminalCollectionProjectPicker'

const DOCK_RESIZE_STRIP = 8

/** 停靠几何直出（纯函数）。 */
function panelGeometryStyle(dock: FloatingTerminalDock, sizeRatio: number): CSSProperties {
  const ratioPercent = `${Math.round(sizeRatio * 100)}vh`
  const ratioPercentW = `${Math.round(sizeRatio * 100)}vw`
  switch (dock) {
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

function kindIcon(kind: TerminalProcessKind) {
  switch (kind) {
    case 'primary':
      return <Server className="h-3 w-3 shrink-0" />
    case 'run':
      return <ListTree className="h-3 w-3 shrink-0" />
    case 'script':
      return <SquareTerminal className="h-3 w-3 shrink-0" />
    case 'float':
      return <TerminalSquare className="h-3 w-3 shrink-0" />
    case 'toolbox':
      return <Eye className="h-3 w-3 shrink-0" />
  }
}

function statusDotClass(status: string): string {
  if (status === 'running' || status === 'ready') return 'bg-[color:var(--color-success)]'
  if (status === 'stopping' || status === 'starting') return 'bg-[color:var(--color-warning)]'
  if (status === 'failed' || status === 'error') return 'bg-[color:var(--color-destructive)]'
  return 'bg-[color:var(--color-muted-foreground)]'
}

interface TerminalCollectionPanelInnerProps {
  /** 项目路由上下文（/project/:projectId）：项目 tab 置顶 + Ctrl+J 聚焦目标。 */
  contextProjectId?: string
}

function TerminalCollectionPanelInner({ contextProjectId }: TerminalCollectionPanelInnerProps) {
  const { t } = useI18n()
  const panelRef = useRef<HTMLDivElement | null>(null)
  const resizeStateRef = useRef<ResizeState | null>(null)
  /** 右键菜单锚点；projectId 非空 = 项目 tab 右键（只操作该项目），为空 = tab 行空白右键（面板级操作）。 */
  const [menuPosition, setMenuPosition] = useState<{ x: number; y: number; projectId?: string } | null>(null)
  const [pickerAnchor, setPickerAnchor] = useState<{ top: number; left: number; bottom: number } | null>(null)
  const [renamingKey, setRenamingKey] = useState<string | null>(null)
  const [draftTitle, setDraftTitle] = useState('')
  /** 停止确认：project 范围只停该项目，all 范围停全部项目。 */
  const [stopConfirm, setStopConfirm] = useState<{ scope: 'project' | 'all'; projectId?: string; projectName?: string } | null>(null)
  const addButtonRef = useRef<HTMLButtonElement | null>(null)
  /** 重命名提交守卫：Enter 与 blur 可能同帧触发，只允许第一个路径生效。 */
  const renamingKeyGuardRef = useRef<string | null>(null)

  const floatingPanel = useAppStore((s) => s.floatingPanel)
  const inventory = useAppStore((s) => s.terminalInventory)
  const projects = useAppStore((s) => s.projects)
  const processes = useAppStore((s) => s.processes)
  const runTaskStates = useAppStore((s) => s.runTaskStates)
  const runTaskConfigs = useAppStore((s) => s.runTaskConfigs)
  const showToolbox = useAppStore((s) => s.collectionShowToolbox)
  const activeProjectId = useAppStore((s) => s.collectionActiveProjectId)
  const activeKey = useAppStore((s) => s.collectionActiveKey)
  const pendingTerminals = useAppStore((s) => s.collectionPendingTerminals)
  const setActiveProject = useAppStore((s) => s.setCollectionActiveProject)
  const setActiveKey = useAppStore((s) => s.setCollectionActiveKey)
  const setShowToolbox = useAppStore((s) => s.setCollectionShowToolbox)
  const addCollectionTerminal = useAppStore((s) => s.addCollectionTerminal)
  const renameTerminal = useAppStore((s) => s.renameTerminal)
  const stopCollectionTerminal = useAppStore((s) => s.stopCollectionTerminal)
  const stopAllCollectionTerminals = useAppStore((s) => s.stopAllCollectionTerminals)
  const stopProjectTerminals = useAppStore((s) => s.stopProjectTerminals)
  const setFloatingPanelDock = useAppStore((s) => s.setFloatingPanelDock)
  const setFloatingPanelSizeRatio = useAppStore((s) => s.setFloatingPanelSizeRatio)
  const toggleTerminalCollection = useAppStore((s) => s.toggleTerminalCollection)

  const model = useMemo(
    () =>
      buildTerminalCollectionModel({
        inventory,
        projects,
        routeProjectId: contextProjectId,
        showToolbox,
        processes,
        runTaskStates,
        runTaskConfigs,
        titles: Object.fromEntries(projects.map((project) => [project.id, project.terminalDock?.titles ?? {}])),
        pendingTerminals,
        ordinalLabels: {
          script: (token) => t('terminalCollection.scriptOrdinal', { n: token }),
          terminal: (token) => t('terminalCollection.terminalOrdinal', { n: token }),
        },
      }),
    [contextProjectId, inventory, pendingTerminals, projects, processes, runTaskConfigs, runTaskStates, showToolbox, t],
  )

  const activeGroup = model.groups.find((group) => group.projectId === activeProjectId) ?? model.groups.find((group) => group.projectId === model.activeProjectId) ?? model.groups[0] ?? null
  const activeTerminal: CollectionTerminalItem | null = activeGroup?.terminals.find((terminal) => terminal.processKey === activeKey) ?? activeGroup?.terminals[0] ?? null
  // 右键菜单命中的项目分组（tab 右键时非空）。
  const menuGroup = menuPosition?.projectId ? (model.groups.find((group) => group.projectId === menuPosition.projectId) ?? null) : null

  const startRename = useCallback((key: string, currentTitle: string) => {
    renamingKeyGuardRef.current = key
    setRenamingKey(key)
    setDraftTitle(currentTitle)
  }, [])

  const cancelRename = useCallback(() => {
    renamingKeyGuardRef.current = null
    setRenamingKey(null)
    setDraftTitle('')
  }, [])

  const commitRename = useCallback(
    (projectId: string, processKey: string) => {
      if (renamingKeyGuardRef.current !== processKey) return
      renamingKeyGuardRef.current = null
      renameTerminal(projectId, processKey, draftTitle)
      setRenamingKey(null)
      setDraftTitle('')
    },
    [draftTitle, renameTerminal],
  )

  useEffect(() => {
    return () => {
      if (resizeStateRef.current) window.cancelAnimationFrame(resizeStateRef.current.frameId)
    }
  }, [])

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
        dock: floatingPanel.dock,
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
          setFloatingPanelSizeRatio(ratio)
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
    [floatingPanel.dock, setFloatingPanelSizeRatio],
  )

  const handleAddTerminal = useCallback(() => {
    if (!activeGroup) return
    const project = projects.find((item) => item.id === activeGroup.projectId)
    if (!project) return
    void addCollectionTerminal(project.id, project.path)
  }, [activeGroup, addCollectionTerminal, projects])

  // 停靠态贴边缩放命中条（跨面板边缘 8px）
  const dockStripSide: CSSProperties | null =
    floatingPanel.dock === 'bottom'
      ? { top: -DOCK_RESIZE_STRIP / 2, left: 0, right: 0, height: DOCK_RESIZE_STRIP, cursor: 'row-resize' }
      : floatingPanel.dock === 'top'
        ? { bottom: -DOCK_RESIZE_STRIP / 2, left: 0, right: 0, height: DOCK_RESIZE_STRIP, cursor: 'row-resize' }
        : floatingPanel.dock === 'left'
          ? { right: -DOCK_RESIZE_STRIP / 2, top: 0, bottom: 0, width: DOCK_RESIZE_STRIP, cursor: 'col-resize' }
          : { left: -DOCK_RESIZE_STRIP / 2, top: 0, bottom: 0, width: DOCK_RESIZE_STRIP, cursor: 'col-resize' }

  const dockLineClass = floatingPanel.dock === 'top' || floatingPanel.dock === 'bottom' ? 'absolute left-0 right-0 top-1/2 h-[2px] -translate-y-1/2 rounded-full' : 'absolute bottom-0 top-0 left-1/2 w-[2px] -translate-x-1/2 rounded-full'

  const positionMenuItems = [
    { dock: 'top' as const, label: t('terminalCollection.positionTop'), icon: <PanelTop className="h-3.5 w-3.5" /> },
    { dock: 'bottom' as const, label: t('terminalCollection.positionBottom'), icon: <PanelBottom className="h-3.5 w-3.5" /> },
    { dock: 'left' as const, label: t('terminalCollection.positionLeft'), icon: <PanelLeft className="h-3.5 w-3.5" /> },
    { dock: 'right' as const, label: t('terminalCollection.positionRight'), icon: <PanelRight className="h-3.5 w-3.5" /> },
  ]

  return (
    <div
      ref={panelRef}
      // nodrag：面板会盖住标题栏的 -webkit-app-region: drag 区域，而系统拖拽区命中计算不看 z-index，
      // 不显式 no-drag 的话停靠 top/left/right 时右键会弹出窗口系统菜单（最大化等）、点击被拖拽劫持。
      className="nodrag fixed flex flex-col overflow-hidden rounded-[16px] border border-[color:var(--color-border)] bg-[color:var(--color-card)] shadow-[var(--shadow-popover)]"
      style={{ ...panelGeometryStyle(floatingPanel.dock, floatingPanel.sizeRatio), zIndex: 9000 }}
      onContextMenu={(event) => event.preventDefault()}
    >
      {/* 项目 tab 行：点击切换项目；空白处右键打开位置菜单 */}
      <div
        className="app-chrome flex shrink-0 items-stretch border-b border-[color:var(--color-border)] bg-[color:var(--color-background-sunken)]"
        style={{ height: TERMINAL_PANEL_HEADER_HEIGHT }}
        title={t('terminalCollection.dockHint')}
        onContextMenu={(event) => {
          event.preventDefault()
          event.stopPropagation()
          setMenuPosition({ x: event.clientX, y: event.clientY })
        }}
      >
        <div className="flex min-w-0 flex-1 items-stretch overflow-x-auto">
          {model.groups.map((group) => {
            const active = group.projectId === activeGroup?.projectId
            return (
              <button
                key={group.projectId}
                type="button"
                className={`group/tab flex shrink-0 cursor-pointer items-center gap-1.5 border-r border-[color:var(--color-border)] px-3 text-[11px] transition-colors ${active ? 'bg-[color:var(--color-card)] text-[color:var(--color-foreground)]' : 'text-[color:var(--color-muted-foreground)] hover:bg-[color:var(--color-accent)]/45'}`}
                onClick={() => setActiveProject(group.projectId)}
                onContextMenu={(event) => {
                  // tab 自身右键：只操作该项目的菜单（阻止冒泡到行级面板菜单）。
                  event.preventDefault()
                  event.stopPropagation()
                  setMenuPosition({ x: event.clientX, y: event.clientY, projectId: group.projectId })
                }}
                title={group.projectName}
              >
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${group.runningCount > 0 ? 'bg-[color:var(--color-success)]' : 'bg-transparent'}`} />
                <span className="max-w-[160px] truncate font-medium">{group.projectName}</span>
              </button>
            )
          })}
        </div>
        <div className="flex shrink-0 items-center gap-1 px-2">
          <button
            ref={addButtonRef}
            type="button"
            className="quiet-control inline-flex h-6 w-6 items-center justify-center rounded-full text-[color:var(--color-muted-foreground)] transition-colors hover:text-[color:var(--color-foreground)]"
            title={t('terminalCollection.addProjectTerminal')}
            onClick={() => {
              const rect = addButtonRef.current?.getBoundingClientRect()
              if (rect) setPickerAnchor({ top: rect.top, left: rect.left, bottom: rect.bottom })
            }}
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            className={`quiet-control inline-flex h-6 w-6 items-center justify-center rounded-full transition-colors ${showToolbox ? 'text-primary' : 'text-[color:var(--color-muted-foreground)] hover:text-[color:var(--color-foreground)]'}`}
            title={t('terminalCollection.showToolbox')}
            aria-pressed={showToolbox}
            onClick={() => setShowToolbox(!showToolbox)}
          >
            {showToolbox ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          </button>
          <button
            type="button"
            className="quiet-control inline-flex h-6 w-6 items-center justify-center rounded-full text-[color:var(--color-muted-foreground)] transition-colors hover:text-[color:var(--color-foreground)]"
            title={t('terminalCollection.stopAll')}
            onClick={() => setStopConfirm({ scope: 'all' })}
            disabled={inventory.length === 0 && pendingTerminals.length === 0}
          >
            <CircleStop className="h-3.5 w-3.5" />
          </button>
          <button type="button" className="quiet-control inline-flex h-6 w-6 items-center justify-center rounded-full text-[color:var(--color-muted-foreground)] transition-colors hover:text-[color:var(--color-foreground)]" title={t('terminalCollection.hideTerminal')} onClick={() => void toggleTerminalCollection()}>
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {pickerAnchor && <TerminalCollectionProjectPicker anchor={pickerAnchor} triggerRef={addButtonRef} onClose={() => setPickerAnchor(null)} />}

      <div className="flex min-h-0 flex-1">
        {/* 左侧：激活终端视图 / 空态 */}
        <div className="relative min-h-0 flex-1 bg-[color:var(--color-background-sunken)]">
          {activeTerminal ? (
            <>
              <Terminal key={activeTerminal.processKey} projectId={activeTerminal.processKey} variant="soft" />
              {activeTerminal.status === 'starting' && (
                <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-[color:var(--color-card)]">
                  <Loader2 className="h-4 w-4 animate-spin text-[color:var(--color-muted-foreground)]" />
                  <span className="text-[11px] text-[color:var(--color-muted-foreground)]">{t('terminalCollection.startingSession')}</span>
                </div>
              )}
            </>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-3 px-4 text-center">
              <p className="text-xs font-medium text-[color:var(--color-foreground)]">{t('terminalCollection.emptyTerminals')}</p>
              <p className="max-w-[360px] text-[11px] leading-5 text-[color:var(--color-muted-foreground)]">{t('terminalCollection.emptyTerminalsHint')}</p>
              <button type="button" className="quiet-control inline-flex h-7 items-center gap-1 rounded-full px-3 text-[11px] text-[color:var(--color-foreground)] transition-colors hover:bg-[color:var(--color-accent)] disabled:opacity-50" onClick={handleAddTerminal} disabled={!activeGroup}>
                <Plus className="h-3.5 w-3.5" />
                {t('terminalCollection.newTerminal')}
              </button>
            </div>
          )}
        </div>

        {/* 右侧：当前项目的终端列表 */}
        <div className="flex shrink-0 flex-col border-l border-[color:var(--color-border)] bg-[color:var(--color-background-sunken)]" style={{ width: TERMINAL_LIST_WIDTH }}>
          <div className="min-h-0 flex-1 overflow-y-auto py-1">
            {activeGroup?.terminals.map((terminal) => {
              const active = terminal.processKey === activeTerminal?.processKey
              return (
                <div
                  key={terminal.processKey}
                  className={`group/item flex cursor-pointer items-center gap-1.5 px-2 py-1.5 text-[11px] transition-colors ${active ? 'bg-[color:var(--color-accent)] text-[color:var(--color-foreground)]' : 'text-[color:var(--color-muted-foreground)] hover:bg-[color:var(--color-accent)]/45'}`}
                  onClick={() => setActiveKey(terminal.processKey)}
                  onDoubleClick={() => startRename(terminal.processKey, terminal.title)}
                  title={`${terminal.title} · ${t(`terminalCollection.kindLabel.${terminal.kind}`)}`}
                >
                  {kindIcon(terminal.kind)}
                  {renamingKey === terminal.processKey && activeGroup ? (
                    <TerminalTabRenameInput
                      value={draftTitle}
                      onChange={(event) => setDraftTitle(event.target.value)}
                      onClick={(event) => event.stopPropagation()}
                      onDoubleClick={(event) => event.stopPropagation()}
                      onKeyDown={(event) => {
                        event.stopPropagation()
                        if (event.key === 'Enter') commitRename(activeGroup.projectId, terminal.processKey)
                        if (event.key === 'Escape') cancelRename()
                      }}
                      onBlur={() => commitRename(activeGroup.projectId, terminal.processKey)}
                    />
                  ) : (
                    <span className="min-w-0 flex-1 truncate font-medium">{terminal.title}</span>
                  )}
                  <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${statusDotClass(terminal.status)}`} />
                  {terminal.kind !== 'toolbox' && (
                    <button
                      type="button"
                      className="-mr-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[color:var(--color-muted-foreground)] opacity-0 transition-opacity hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)] group-hover/item:opacity-100"
                      title={t('terminalCollection.closeTerminal')}
                      onClick={(event) => {
                        event.stopPropagation()
                        if (activeGroup) stopCollectionTerminal(activeGroup.projectId, terminal.processKey)
                      }}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </div>
              )
            })}
          </div>
          <div className="shrink-0 border-t border-[color:var(--color-border)] p-1.5">
            <button type="button" className="quiet-control inline-flex h-7 w-full items-center justify-center gap-1 rounded-full text-[11px] text-[color:var(--color-foreground)] transition-colors hover:bg-[color:var(--color-accent)] disabled:opacity-50" onClick={handleAddTerminal} disabled={!activeGroup}>
              <Plus className="h-3.5 w-3.5" />
              {t('terminalCollection.newTerminal')}
            </button>
          </div>
        </div>
      </div>

      {/* 停靠态贴边分隔条：默认可见细线，hover / 拖拽高亮 */}
      {dockStripSide ? (
        <div className="group/resize absolute z-20" style={dockStripSide} onPointerDown={handleResizeStart}>
          <div className={`${dockLineClass} bg-[color:var(--color-border)] transition-[background-color,height,width] group-hover/resize:bg-[color:var(--color-primary)]/55`} />
        </div>
      ) : null}

      {/* 右键菜单：项目 tab 右键 = 只操作该项目；tab 行空白右键 = 面板位置 + 跨项目会话 */}
      {menuPosition ? (
        <ContextCascader
          x={menuPosition.x}
          y={menuPosition.y}
          layout="grouped"
          sections={
            menuPosition.projectId
              ? [
                  {
                    id: 'project-sessions',
                    label: menuGroup?.projectName ?? '',
                    items: [
                      {
                        id: 'stop-project',
                        label: t('terminalCollection.stopProjectTerminals'),
                        icon: <CircleStop className="h-3.5 w-3.5" />,
                        disabled: (menuGroup?.terminals.length ?? 0) === 0,
                        onSelect: () => {
                          setStopConfirm({ scope: 'project', projectId: menuPosition.projectId, projectName: menuGroup?.projectName })
                          setMenuPosition(null)
                        },
                      },
                    ],
                  },
                ]
              : [
                  {
                    id: 'panel-position',
                    label: t('terminalCollection.panelPosition'),
                    items: positionMenuItems.map((item) => ({
                      id: item.dock,
                      label: item.label,
                      icon: item.icon,
                      disabled: item.dock === floatingPanel.dock,
                      onSelect: () => setFloatingPanelDock(item.dock),
                    })),
                  },
                  {
                    id: 'sessions',
                    label: t('terminalCollection.sessions'),
                    items: [
                      {
                        id: 'stop-all',
                        label: t('terminalCollection.stopAll'),
                        icon: <CircleStop className="h-3.5 w-3.5" />,
                        disabled: inventory.length === 0 && pendingTerminals.length === 0,
                        onSelect: () => {
                          setStopConfirm({ scope: 'all' })
                          setMenuPosition(null)
                        },
                      },
                    ],
                  },
                ]
          }
          onClose={() => setMenuPosition(null)}
        />
      ) : null}

      <ConfirmDialog
        open={stopConfirm !== null}
        onClose={() => setStopConfirm(null)}
        onConfirm={() => {
          if (stopConfirm?.scope === 'project' && stopConfirm.projectId) {
            stopProjectTerminals(stopConfirm.projectId)
          } else {
            stopAllCollectionTerminals()
          }
          setStopConfirm(null)
        }}
        ariaLabel={stopConfirm?.scope === 'project' ? t('terminalCollection.stopProjectConfirmTitle', { name: stopConfirm?.projectName ?? '' }) : t('terminalCollection.stopAllConfirmTitle')}
        title={stopConfirm?.scope === 'project' ? t('terminalCollection.stopProjectConfirmTitle', { name: stopConfirm?.projectName ?? '' }) : t('terminalCollection.stopAllConfirmTitle')}
        description={stopConfirm?.scope === 'project' ? t('terminalCollection.stopProjectConfirmDescription', { name: stopConfirm?.projectName ?? '' }) : t('terminalCollection.stopAllConfirmDescription')}
        confirmLabel={stopConfirm?.scope === 'project' ? t('terminalCollection.stopProjectConfirmLabel') : t('terminalCollection.stopAllConfirmLabel')}
        confirmVariant="destructive"
        widthClassName="max-w-[440px]"
      />
    </div>
  )
}

export const TerminalCollectionPanel = memo(TerminalCollectionPanelInner)
