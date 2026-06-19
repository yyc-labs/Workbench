import { useEffect, useState } from 'react'
import { projectDisplayName } from '../../lib/projectDisplay'
import type { ManagedProcessSnapshot, TerminalProcessInventory } from '../../../shared/types'
import { Terminal as AppTerminal } from '../../components/Terminal'
import { Button } from '../../components/ui/button'
import { useI18n } from '../../i18n'
import { backendLabel } from './settings.helpers'

type StartupLogsPanelProps = {
  projects: { id: string; name: string; path: string }[]
}

function SettingsStartupLogsPanel({ projects }: StartupLogsPanelProps) {
  const { t } = useI18n()
  const [inventoryLoading, setInventoryLoading] = useState(false)
  const [inventory, setInventory] = useState<TerminalProcessInventory | null>(null)
  const [selectedProcessId, setSelectedProcessId] = useState<string | null>(null)

  const projectNameMap = new Map(projects.map((p) => [p.id, projectDisplayName(p)]))

  const classifyManagedProcess = (item: ManagedProcessSnapshot): 'project' | 'other' => {
    if (item.processId.includes('::toolbox')) return 'other'
    if (item.backend === 'tmux') return 'other'
    return 'project'
  }

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

  const projectManaged = (inventory?.managedProcesses || []).filter((p) => classifyManagedProcess(p) === 'project')

  useEffect(() => {
    if (projectManaged.length === 0) {
      setSelectedProcessId(null)
      return
    }
    if (selectedProcessId && projectManaged.some((p) => p.processId === selectedProcessId)) return
    setSelectedProcessId(projectManaged[0].processId)
  }, [projectManaged, selectedProcessId])

  const selectedManagedProcess = selectedProcessId
    ? projectManaged.find((p) => p.processId === selectedProcessId) || null
    : null

  return (
    <div className="space-y-8">
      <div>
        <p className="section-label mb-3">{t('startupLogs.kicker')}</p>
        <h2 className="text-[28px] font-semibold tracking-[-0.04em] text-[color:var(--color-foreground)]">{t('startupLogs.title')}</h2>
        <p className="text-sm leading-6 text-[color:var(--color-muted-foreground)] mt-2 mb-6">
          {t('startupLogs.description')}
        </p>
      </div>

      <div className="rounded-[22px] border px-5 py-4 surface-card" style={{ borderColor: 'var(--color-border)' }}>
        <div className="flex items-center justify-between mb-2 gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-[color:var(--color-foreground)]">{t('startupLogs.sectionTitle')}</p>
            <p className="text-[11px] text-[color:var(--color-muted-foreground)]">
              {t('startupLogs.sectionDescription')}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-[color:var(--color-muted-foreground)] shrink-0">{projectManaged.length}</span>
            <Button
              variant="outline"
              className="h-7 rounded-full px-2 text-[11px]"
              onClick={() => void refreshInventory()}
              disabled={inventoryLoading}
            >
              {inventoryLoading ? t('settingsRuntime.refreshing') : t('settingsRuntime.refresh')}
            </Button>
          </div>
        </div>
        {projectManaged.length === 0 ? (
          <p className="text-xs text-[color:var(--color-muted-foreground)]">{t('startupLogs.noRunningProcesses')}</p>
        ) : (
          <div className="space-y-2.5">
            <div className="flex flex-wrap gap-1.5">
              {projectManaged.map((item) => {
                const selected = selectedProcessId === item.processId
                const label = `${projectNameMap.get(item.projectId) || item.projectId} · ${backendLabel(item.backend)}`
                return (
                  <button
                    key={`log-tab-${item.processId}`}
                    className={`button-interactive px-2.5 py-1 rounded-full border text-[11px] transition-colors ${
                      selected
                        ? 'bg-[color:var(--color-accent)] text-[color:var(--color-foreground)]'
                        : 'text-[color:var(--color-muted-foreground)] hover:text-[color:var(--color-foreground)]'
                    }`}
                    style={{ borderColor: 'var(--color-border)' }}
                    onClick={() => setSelectedProcessId(item.processId)}
                    title={label}
                  >
                    {label}
                  </button>
                )
              })}
            </div>

            {selectedManagedProcess ? (
              <div
                className="h-72 overflow-hidden rounded-[12px] border bg-[color:var(--color-background-sunken)]"
                style={{ borderColor: 'var(--color-border)' }}
              >
                <AppTerminal projectId={selectedManagedProcess.processId} variant="soft" />
              </div>
            ) : (
              <div
                className="h-72 rounded-[12px] border bg-[color:var(--color-background-sunken)] px-3 py-2 text-[11px] text-[color:var(--color-muted-foreground)]"
                style={{ borderColor: 'var(--color-border)' }}
              >
                {t('startupLogs.selectProcess')}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export { SettingsStartupLogsPanel }
