import { useEffect, useMemo, useState } from 'react'
import { projectDisplayName } from '../../../lib/projectDisplay'
import { useI18n } from '../../../i18n'
import { backendLabel, formatSince } from '../settings.helpers'
import type {
  ManagedProcessSnapshot,
  TerminalProcessInventory,
} from '../../../../shared/types'
import type {
  ManagedProcessRow,
  RuntimePanelProject,
  SessionInventoryGroup,
  SessionInventoryRow,
} from './settingsRuntimeShared'

function classifyManagedProcess(item: ManagedProcessSnapshot): 'tmux' | 'project' | 'idle' {
  if (item.processId.includes('::toolbox')) return 'idle'
  if (item.backend === 'tmux') return 'tmux'
  return 'project'
}

export function useTerminalProcessInventory(projects: RuntimePanelProject[]) {
  const { t } = useI18n()
  const [inventoryLoading, setInventoryLoading] = useState(false)
  const [inventory, setInventory] = useState<TerminalProcessInventory | null>(null)
  const [stopAllLoading, setStopAllLoading] = useState(false)
  const [stopSummary, setStopSummary] = useState<string | null>(null)
  const [activeTerminalActionKey, setActiveTerminalActionKey] = useState<string | null>(null)

  const projectNameMap = useMemo(
    () => new Map(projects.map((project) => [project.id, projectDisplayName(project)])),
    [projects]
  )

  const refreshInventory = async (silent = false) => {
    if (!silent) setInventoryLoading(true)
    try {
      const data = await window.electronAPI.listTerminalProcesses()
      setInventory(data)
    } finally {
      if (!silent) setInventoryLoading(false)
    }
  }

  useEffect(() => {
    void refreshInventory()
  }, [])

  useEffect(() => {
    const timer = window.setInterval(() => {
      void refreshInventory(true)
    }, 5000)
    return () => {
      window.clearInterval(timer)
    }
  }, [])

  const projectManagedRows = useMemo<ManagedProcessRow[]>(() => (
    (inventory?.managedProcesses || [])
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
      })
  ), [activeTerminalActionKey, inventory?.managedProcesses, projectNameMap])

  const idleManagedRows = useMemo<ManagedProcessRow[]>(() => (
    (inventory?.managedProcesses || [])
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
      })
  ), [activeTerminalActionKey, inventory?.managedProcesses])

  const sessionGroups = useMemo<SessionInventoryGroup[]>(() => {
    const rows = new Map<string, {
      sessionName: string
      projectLabel?: string
      mode?: string
      status?: string
      createdAt?: number
      startTime?: number
      managedProcessId?: string
      closeBy: 'session' | 'process'
    }>()

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

    for (const item of inventory?.managedProcesses || []) {
      if (!item.sessionName) continue
      const row = ensureRow(item.sessionName)
      row.projectLabel ||= projectNameMap.get(item.projectId) || item.projectId
      row.startTime ||= item.startTime
      row.managedProcessId ||= item.processId
    }

    for (const item of inventory?.runtimeSessions || []) {
      if (!item.sessionName) continue
      const row = ensureRow(item.sessionName)
      row.projectLabel ||= projectNameMap.get(item.projectId) || item.projectId
      row.mode ||= item.mode
      row.status ||= item.status
      row.createdAt ||= item.createdAt
      row.closeBy = 'session'
    }

    for (const item of inventory?.tmuxSessions || []) {
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
    const toSessionInventoryRow = (item: typeof sortedRows[number], index: number): SessionInventoryRow => {
        const meta = [
          item.sessionName,
          item.mode,
          item.status,
          item.createdAt ? formatSince(item.createdAt) : item.startTime ? formatSince(item.startTime) : undefined,
        ].filter(Boolean)
        const actionKey = item.closeBy === 'session'
          ? `session:${item.sessionName}`
          : item.managedProcessId
            ? `process:${item.managedProcessId}`
            : null

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
        items: sortedRows
          .filter((item) => item.status === 'attached')
          .map(toSessionInventoryRow),
      },
      {
        key: 'inactive',
        label: t('common.background'),
        items: sortedRows
          .filter((item) => item.status !== 'attached')
          .map(toSessionInventoryRow),
      },
    ]
  }, [activeTerminalActionKey, inventory?.managedProcesses, inventory?.runtimeSessions, inventory?.tmuxSessions, projectNameMap, t])

  const closeManagedProcess = async (processId: string) => {
    const actionKey = `process:${processId}`
    setActiveTerminalActionKey(actionKey)
    try {
      await window.electronAPI.stopProcess(processId)
      await refreshInventory()
    } finally {
      setActiveTerminalActionKey((current) => current === actionKey ? null : current)
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
      setActiveTerminalActionKey((current) => current === actionKey ? null : current)
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
        })
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
