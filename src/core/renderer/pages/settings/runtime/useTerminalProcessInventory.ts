import { useCallback, useEffect, useMemo, useState } from 'react'
import { projectDisplayName } from '../../../lib/projectDisplay'
import { useI18n } from '../../../i18n'
import { backendLabel, formatSince } from '../settings.helpers'
import type { ManagedProcessSnapshot, RuntimeSessionInfo, TmuxSessionInfo } from '../../../../shared/types'
import { useAppStore } from '../../../stores/appStore'
import type { ManagedProcessRow, RuntimePanelProject, SessionInventoryGroup, SessionInventoryRow } from './settingsRuntimeShared'

function classifyManagedProcess(item: ManagedProcessSnapshot): 'tmux' | 'project' | 'idle' {
  if (item.processId.includes('::toolbox')) return 'idle'
  if (item.backend === 'tmux') return 'tmux'
  return 'project'
}

const EMPTY_SESSIONS: { runtimeSessions: RuntimeSessionInfo[]; tmuxSessions: TmuxSessionInfo[] } = { runtimeSessions: [], tmuxSessions: [] }

export function useTerminalProcessInventory(projects: RuntimePanelProject[]) {
  const { t } = useI18n()
  // 托管进程：共享 terminalInventory（主进程事件驱动，全局唯一一份，不再单独轮询）。
  const managedProcesses = useAppStore((s) => s.terminalInventory)
  const applyTerminalInventorySnapshot = useAppStore((s) => s.applyTerminalInventorySnapshot)
  // 外部会话（runtime/tmux）：用户在应用外创建/销毁的会话没有可靠事件源，
  // 改为按需异步校准（挂载 / 窗口重聚焦 / runtime 状态事件 / 动作后），不再 5s 轮询。
  const [sessions, setSessions] = useState(EMPTY_SESSIONS)
  const [inventoryLoading, setInventoryLoading] = useState(false)
  const [stopAllLoading, setStopAllLoading] = useState(false)
  const [stopSummary, setStopSummary] = useState<string | null>(null)
  const [activeTerminalActionKey, setActiveTerminalActionKey] = useState<string | null>(null)

  const projectNameMap = useMemo(() => new Map(projects.map((project) => [project.id, projectDisplayName(project)])), [projects])

  const refreshSessions = useCallback(async () => {
    try {
      const data = await window.electronAPI.listTerminalProcesses()
      setSessions({ runtimeSessions: data.runtimeSessions ?? [], tmuxSessions: data.tmuxSessions ?? [] })
    } catch {
      // 校准失败：保留上一次结果，下次触发再试。
    }
  }, [])

  /** 全量刷新（刷新按钮 / 动作后）：轻量清单快照（带 revision）+ 外部会话校准。 */
  const refreshInventory = useCallback(async () => {
    setInventoryLoading(true)
    try {
      const [snapshot, data] = await Promise.all([window.electronAPI.getTerminalInventorySnapshot(), window.electronAPI.listTerminalProcesses()])
      applyTerminalInventorySnapshot(snapshot)
      setSessions({ runtimeSessions: data.runtimeSessions ?? [], tmuxSessions: data.tmuxSessions ?? [] })
    } finally {
      setInventoryLoading(false)
    }
  }, [applyTerminalInventorySnapshot])

  useEffect(() => {
    void refreshInventory()
  }, [refreshInventory])

  // 外部会话校准触发点：runtime 生命周期事件 + 窗口重聚焦/恢复可见。
  useEffect(() => {
    const unsubscribe = window.electronAPI.onRuntimeStateChanged(() => {
      void refreshSessions()
    })
    const onFocus = () => void refreshSessions()
    const onVisible = () => {
      if (document.visibilityState === 'visible') onFocus()
    }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      unsubscribe()
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [refreshSessions])

  const projectManagedRows = useMemo<ManagedProcessRow[]>(
    () =>
      (managedProcesses || [])
        .filter((item) => classifyManagedProcess(item) === 'project')
        .map((item) => {
          const actionKey = `process:${item.processId}`
          return {
            key: `m-${item.processId}`,
            label: `${projectNameMap.get(item.projectId) || item.projectId} · ${backendLabel(item.backend)} · ${formatSince(item.startTime)}`,
            processId: item.processId,
            actionKey,
            loading: activeTerminalActionKey === actionKey,
            disabled: activeTerminalActionKey !== null,
          }
        }),
    [activeTerminalActionKey, managedProcesses, projectNameMap],
  )

  const idleManagedRows = useMemo<ManagedProcessRow[]>(
    () =>
      (managedProcesses || [])
        .filter((item) => classifyManagedProcess(item) === 'idle')
        .map((item) => {
          const actionKey = `process:${item.processId}`
          return {
            key: `idle-m-${item.processId}`,
            label: `${item.processId} · ${backendLabel(item.backend)} · ${formatSince(item.startTime)}`,
            processId: item.processId,
            actionKey,
            loading: activeTerminalActionKey === actionKey,
            disabled: activeTerminalActionKey !== null,
          }
        }),
    [activeTerminalActionKey, managedProcesses],
  )

  const sessionGroups = useMemo<SessionInventoryGroup[]>(() => {
    const rows = new Map<
      string,
      {
        sessionName: string
        projectLabel?: string
        mode?: string
        status?: string
        createdAt?: number
        startTime?: number
        managedProcessId?: string
        closeBy: 'session' | 'process'
      }
    >()

    const ensureRow = (sessionName: string) => {
      let row = rows.get(sessionName)
      if (!row) {
        row = {
          sessionName,
          closeBy: 'process',
        }
        rows.set(sessionName, row)
      }
      return row
    }

    for (const item of managedProcesses || []) {
      if (!item.sessionName) continue
      const row = ensureRow(item.sessionName)
      row.projectLabel ||= projectNameMap.get(item.projectId) || item.projectId
      row.startTime ||= item.startTime
      row.managedProcessId ||= item.processId
    }

    for (const item of sessions.runtimeSessions) {
      if (!item.sessionName) continue
      const row = ensureRow(item.sessionName)
      row.projectLabel ||= projectNameMap.get(item.projectId) || item.projectId
      row.mode ||= item.mode
      row.status ||= item.status
      row.createdAt ||= item.createdAt
      row.closeBy = 'session'
    }

    for (const item of sessions.tmuxSessions) {
      if (!item.sessionName) continue
      const row = ensureRow(item.sessionName)
      row.projectLabel ||= projectNameMap.get(item.projectId) || item.projectId
      row.status ||= item.status
      row.createdAt ||= item.createdAt
      row.closeBy = 'session'
    }

    const sortedRows = Array.from(rows.values()).sort((a, b) => {
      const left = a.createdAt || a.startTime || 0
      const right = b.createdAt || b.startTime || 0
      return right - left
    })
    const toSessionInventoryRow = (item: (typeof sortedRows)[number], index: number): SessionInventoryRow => {
      const meta = [item.sessionName, item.mode, item.status, item.createdAt ? formatSince(item.createdAt) : item.startTime ? formatSince(item.startTime) : undefined].filter(Boolean)
      const actionKey = item.closeBy === 'session' ? `session:${item.sessionName}` : item.managedProcessId ? `process:${item.managedProcessId}` : null

      return {
        key: `session-${index}-${item.sessionName}`,
        label: item.projectLabel ? `${item.projectLabel} · ${meta.join(' · ')}` : meta.join(' · '),
        sessionName: item.sessionName,
        closeBy: item.closeBy,
        managedProcessId: item.managedProcessId,
        actionKey,
        loading: actionKey !== null && activeTerminalActionKey === actionKey,
        disabled: activeTerminalActionKey !== null,
      }
    }

    return [
      {
        key: 'active',
        label: t('common.active'),
        items: sortedRows.filter((item) => item.status === 'attached').map(toSessionInventoryRow),
      },
      {
        key: 'inactive',
        label: t('common.background'),
        items: sortedRows.filter((item) => item.status !== 'attached').map(toSessionInventoryRow),
      },
    ]
  }, [activeTerminalActionKey, managedProcesses, sessions.runtimeSessions, sessions.tmuxSessions, projectNameMap, t])

  const closeManagedProcess = async (processId: string) => {
    const actionKey = `process:${processId}`
    setActiveTerminalActionKey(actionKey)
    try {
      await window.electronAPI.stopProcess(processId)
      await refreshInventory()
    } finally {
      setActiveTerminalActionKey((current) => (current === actionKey ? null : current))
    }
  }

  const closeSessionRow = async (row: SessionInventoryRow) => {
    const actionKey = row.actionKey
    if (!actionKey) return
    setActiveTerminalActionKey(actionKey)
    try {
      if (row.closeBy === 'session') {
        await window.electronAPI.killTmuxSession(row.sessionName)
      } else if (row.managedProcessId) {
        await window.electronAPI.stopProcess(row.managedProcessId)
      }
      await refreshInventory()
    } finally {
      setActiveTerminalActionKey((current) => (current === actionKey ? null : current))
    }
  }

  const closeAllTerminals = async () => {
    setStopAllLoading(true)
    setStopSummary(null)
    try {
      const result = await window.electronAPI.stopAllTerminalProcesses()
      setStopSummary(
        t('settingsRuntime.stopSummary', {
          managed: result.managedStopped,
          tmux: result.tmuxKilled,
          skipped: result.tmuxSkipped > 0 ? t('settingsRuntime.stopSummarySkipped', { count: result.tmuxSkipped }) : '',
        }),
      )
      await refreshInventory()
    } finally {
      setStopAllLoading(false)
    }
  }

  return {
    inventoryLoading,
    stopAllLoading,
    stopSummary,
    projectManagedRows,
    sessionGroups,
    idleManagedRows,
    refreshInventory,
    closeManagedProcess,
    closeSessionRow,
    closeAllTerminals,
  }
}
