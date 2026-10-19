import { ChevronDown, ChevronRight, Folder, Terminal as TerminalIcon, TriangleAlert } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { parseRunTaskProcessKey } from '../../../shared/runTasks'
import type { ManagedProcessSnapshot } from '../../../shared/types'
import { Button } from '../../components/ui/button'
import { useOpenProjectTerminal } from '../../hooks/useOpenProjectTerminal'
import { useI18n } from '../../i18n'
import { projectDisplayName } from '../../lib/projectDisplay'
import { useAppStore } from '../../stores/appStore'
import { backendLabel } from './settings.helpers'

type StartupLogsPanelProps = {
  projects: { id: string; name: string; path: string }[]
  initialProjectId?: string | null
}

interface ProcessTreeGroup {
  projectId: string
  name: string
  processes: ManagedProcessSnapshot[]
}

function SettingsStartupLogsPanel({ projects, initialProjectId }: StartupLogsPanelProps) {
  const { t } = useI18n()
  const openProjectTerminal = useOpenProjectTerminal()
  // 托管进程清单：共享 terminalInventory（主进程事件驱动），不再本地 5s 轮询。
  const managedProcesses = useAppStore((s) => s.terminalInventory)
  const applyTerminalInventorySnapshot = useAppStore((s) => s.applyTerminalInventorySnapshot)
  const [inventoryLoading, setInventoryLoading] = useState(false)
  const [selectedProcessId, setSelectedProcessId] = useState<string | null>(null)
  const [collapsedProjectIds, setCollapsedProjectIds] = useState<ReadonlySet<string>>(new Set())
  const appliedInitialProjectIdRef = useRef<string | null | undefined>(undefined)

  const projectNameMap = useMemo(() => new Map(projects.map((p) => [p.id, projectDisplayName(p)])), [projects])

  const runTaskConfigNames = useAppStore((s) => {
    const names = new Map<string, string>()
    for (const [projectId, config] of Object.entries(s.runTaskConfigs)) {
      if (!config) continue
      for (const task of config.tasks) {
        names.set(`${projectId}::${task.id}`, task.name)
      }
    }
    return names
  })

  const runTaskStates = useAppStore((s) => s.runTaskStates)

  const classifyManagedProcess = (item: ManagedProcessSnapshot): 'project' | 'other' => {
    if (item.processId.includes('::toolbox')) return 'other'
    if (item.backend === 'tmux') return 'other'
    return 'project'
  }

  // 脚本通道（::script::<n>）与浮动终端（::float::<n>）的 processId 即完整 key，
  // 主进程未归一化 projectId，这里拆回裸 projectId 让它们归入所属项目分组。
  const resolveSnapshotProjectId = (item: ManagedProcessSnapshot): string => {
    if (item.processId.includes('::script::') || item.processId.includes('::float::')) {
      const separatorIndex = item.processId.indexOf('::')
      if (separatorIndex > 0) return item.processId.slice(0, separatorIndex)
    }
    return item.projectId
  }

  // 刷新按钮：拉一次轻量快照（带 revision）写回共享清单。
  const refreshInventory = async () => {
    setInventoryLoading(true)
    try {
      const snapshot = await window.electronAPI.getTerminalInventorySnapshot()
      applyTerminalInventorySnapshot(snapshot)
    } finally {
      setInventoryLoading(false)
    }
  }

  const projectManaged = useMemo(() => managedProcesses.filter((p) => classifyManagedProcess(p) === 'project'), [managedProcesses])

  // Group processes by project so multi-process projects read as one tree node.
  const processGroups = useMemo<ProcessTreeGroup[]>(() => {
    const groups = new Map<string, ProcessTreeGroup>()
    for (const item of projectManaged) {
      const groupProjectId = resolveSnapshotProjectId(item)
      let group = groups.get(groupProjectId)
      if (!group) {
        group = { projectId: groupProjectId, name: projectNameMap.get(groupProjectId) || groupProjectId, processes: [] }
        groups.set(groupProjectId, group)
      }
      group.processes.push(item)
    }
    return [...groups.values()]
  }, [projectManaged, projectNameMap])

  useEffect(() => {
    if (projectManaged.length === 0) {
      setSelectedProcessId(null)
      return
    }
    if (selectedProcessId && projectManaged.some((p) => p.processId === selectedProcessId)) return

    // Prefer the URL-specified project process (first load or target change); otherwise fall back to the first one.
    if (initialProjectId && appliedInitialProjectIdRef.current !== initialProjectId) {
      appliedInitialProjectIdRef.current = initialProjectId
      const target = projectManaged.find((item) => item.processId === initialProjectId || item.processId === `${initialProjectId}::toolbox`) || projectManaged.find((item) => item.processId.startsWith(`${initialProjectId}::run::`))
      if (target) {
        setSelectedProcessId(target.processId)
        return
      }
    }
    appliedInitialProjectIdRef.current = null
    setSelectedProcessId(projectManaged[0].processId)
  }, [initialProjectId, projectManaged, selectedProcessId])

  const getProcessLabel = (item: ManagedProcessSnapshot): string => {
    const runTask = parseRunTaskProcessKey(item.processId)
    if (runTask) return runTaskConfigNames.get(`${runTask.projectId}::${runTask.taskId}`) || runTask.taskId
    const scriptMatch = /::script::(\d+)$/.exec(item.processId)
    if (scriptMatch) return t('startupLogs.scriptProcessLabel', { n: scriptMatch[1] })
    const floatMatch = /::float::(\d+)$/.exec(item.processId)
    if (floatMatch) return t('startupLogs.floatTerminalLabel', { n: floatMatch[1] })
    return backendLabel(item.backend)
  }

  const toggleProjectGroup = (projectId: string) => {
    setCollapsedProjectIds((current) => {
      const next = new Set(current)
      if (next.has(projectId)) next.delete(projectId)
      else next.add(projectId)
      return next
    })
  }

  const handleSelectProjectGroup = (group: ProcessTreeGroup) => {
    setCollapsedProjectIds((current) => {
      if (!current.has(group.projectId)) return current
      const next = new Set(current)
      next.delete(group.projectId)
      return next
    })
    const target = group.processes.find((item) => item.processId === selectedProcessId) ?? group.processes[0]
    if (target) setSelectedProcessId(target.processId)
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-8 shrink-0">
        <p className="section-label mb-3">{t('startupLogs.kicker')}</p>
        <h2 className="text-[28px] font-semibold tracking-[-0.04em] text-[color:var(--color-foreground)]">{t('startupLogs.title')}</h2>
        <p className="text-sm leading-6 text-[color:var(--color-muted-foreground)] mt-2">{t('startupLogs.description')}</p>
      </div>

      <div className="flex min-h-0 flex-1 flex-col rounded-[22px] border px-5 py-4 surface-card" style={{ borderColor: 'var(--color-border)' }}>
        <div className="mb-2 flex shrink-0 items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-[color:var(--color-foreground)]">{t('startupLogs.sectionTitle')}</p>
            <p className="text-[11px] text-[color:var(--color-muted-foreground)]">{t('startupLogs.sectionDescription')}</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="shrink-0 text-xs text-[color:var(--color-muted-foreground)]">{t('startupLogs.treeSummary', { projects: processGroups.length, processes: projectManaged.length })}</span>
            <Button variant="outline" className="h-7 rounded-full px-2 text-[11px]" onClick={() => void refreshInventory()} disabled={inventoryLoading}>
              {inventoryLoading ? t('settingsRuntime.refreshing') : t('settingsRuntime.refresh')}
            </Button>
          </div>
        </div>
        {projectManaged.length === 0 ? (
          <p className="text-xs text-[color:var(--color-muted-foreground)]">{t('startupLogs.noRunningProcesses')}</p>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-3 lg:flex-row">
            <div className="w-full shrink-0 space-y-1 lg:w-64 lg:min-h-0 lg:overflow-y-auto">
              {processGroups.map((group) => {
                const collapsed = collapsedProjectIds.has(group.projectId)
                const containsSelected = group.processes.some((item) => item.processId === selectedProcessId)
                return (
                  <div key={`log-group-${group.projectId}`}>
                    <div className={`flex items-center gap-0.5 rounded-[10px] pr-2 text-xs transition-colors ${containsSelected ? 'bg-[color:var(--color-accent)]/60' : 'hover:bg-[color:var(--color-accent)]/45'}`}>
                      <button type="button" className="flex h-7 w-6 shrink-0 items-center justify-center rounded-md text-[color:var(--color-muted-foreground)] hover:text-[color:var(--color-foreground)]" aria-expanded={!collapsed} onClick={() => toggleProjectGroup(group.projectId)}>
                        {collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                      </button>
                      <button type="button" className="flex min-w-0 flex-1 items-center gap-1.5 py-1.5 text-left" onClick={() => handleSelectProjectGroup(group)} title={group.name}>
                        <Folder className="h-3.5 w-3.5 shrink-0 text-[color:var(--color-muted-foreground)]" />
                        <span className="min-w-0 flex-1 truncate font-medium text-[color:var(--color-foreground)]">{group.name}</span>
                        <span className="shrink-0 text-[10px] text-[color:var(--color-muted-foreground)]">{group.processes.length}</span>
                      </button>
                    </div>
                    {!collapsed && (
                      <div className="ml-[22px] border-l pl-2" style={{ borderColor: 'var(--color-border)' }}>
                        {group.processes.map((item) => {
                          const selected = selectedProcessId === item.processId
                          const label = getProcessLabel(item)
                          const runTask = parseRunTaskProcessKey(item.processId)
                          const errorHint = runTask ? runTaskStates[group.projectId]?.[runTask.taskId]?.warning : undefined
                          return (
                            <button
                              key={`log-tab-${item.processId}`}
                              className={`mb-0.5 flex w-full min-w-0 items-center gap-1.5 rounded-[9px] px-2 py-1 text-left text-[11px] transition-colors ${selected ? 'bg-[color:var(--color-accent)] text-[color:var(--color-foreground)]' : 'text-[color:var(--color-muted-foreground)] hover:bg-[color:var(--color-accent)]/50 hover:text-[color:var(--color-foreground)]'}`}
                              onClick={() => {
                                setSelectedProcessId(item.processId)
                                openProjectTerminal(resolveSnapshotProjectId(item), item.processId)
                              }}
                              title={errorHint ? `${label} — ${errorHint}` : `${label} · ${t('startupLogs.openInBuiltinTerminal')}`}
                            >
                              {errorHint ? <TriangleAlert className="h-3 w-3 shrink-0 text-[color:var(--color-warning)]" /> : <TerminalIcon className="h-3 w-3 shrink-0" />}
                              <span className="min-w-0 flex-1 truncate">{label}</span>
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            <div className="min-h-0 min-w-0 flex-1">
              {/* D2：右侧不再内嵌终端查看器；点击左侧进程即深链到该项目内置终端。 */}
              <div className="flex h-72 flex-col items-center justify-center gap-2 rounded-[12px] border bg-[color:var(--color-background-sunken)] px-4 py-2 text-center lg:h-full" style={{ borderColor: 'var(--color-border)' }}>
                <TerminalIcon className="h-5 w-5 text-[color:var(--color-muted-foreground)]" />
                <p className="text-[11px] font-medium text-[color:var(--color-foreground)]">{t('startupLogs.openInBuiltinTerminal')}</p>
                <p className="max-w-[280px] text-[11px] leading-5 text-[color:var(--color-muted-foreground)]">{t('startupLogs.sectionDescription')}</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export { SettingsStartupLogsPanel }
