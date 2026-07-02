import { Button } from '../../../components/ui/button'
import { useI18n } from '../../../i18n'
import type {
  ManagedProcessRow,
  SessionInventoryGroup,
  SessionInventoryRow,
} from './settingsRuntimeShared'

export function RuntimeTerminalInventory({
  usesTmuxRuntime,
  inventoryLoading,
  stopAllLoading,
  stopSummary,
  projectManagedRows,
  sessionGroups,
  idleManagedRows,
  onRefresh,
  onCloseAll,
  onCloseManagedProcess,
  onCloseSessionRow,
}: {
  usesTmuxRuntime: boolean
  inventoryLoading: boolean
  stopAllLoading: boolean
  stopSummary: string | null
  projectManagedRows: ManagedProcessRow[]
  sessionGroups: SessionInventoryGroup[]
  idleManagedRows: ManagedProcessRow[]
  onRefresh: () => void
  onCloseAll: () => void
  onCloseManagedProcess: (processId: string) => void
  onCloseSessionRow: (row: SessionInventoryRow) => void
}) {
  const { t } = useI18n()
  const sessionRowCount = sessionGroups.reduce((total, group) => total + group.items.length, 0)

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium text-[color:var(--color-foreground)]">{t('settingsRuntime.terminalProcesses')}</h3>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            className="quiet-control h-8 rounded-full border-0 px-3 text-xs text-[color:var(--color-foreground)] hover:bg-[color:var(--color-accent)]"
            onClick={onRefresh}
            disabled={stopAllLoading}
            loading={inventoryLoading}
          >
            {inventoryLoading ? t('settingsRuntime.refreshing') : t('settingsRuntime.refresh')}
          </Button>
          <Button
            variant="outline"
            className="h-8 rounded-full px-3 text-xs"
            onClick={onCloseAll}
            loading={stopAllLoading}
          >
            {stopAllLoading ? t('settingsRuntime.stopping') : t('settingsRuntime.closeAllTerminals')}
          </Button>
        </div>
      </div>
      {stopSummary && (
        <p className="mb-2 text-xs text-[color:var(--color-muted-foreground)]">{stopSummary}</p>
      )}
      <div className="space-y-3">
        <div className="rounded-[22px] border px-5 py-4 surface-card" style={{ borderColor: 'var(--color-border)' }}>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-medium text-[color:var(--color-foreground)]">
              {usesTmuxRuntime ? t('settings.runtimePanel.managedProjectGroup') : t('settings.runtimePanel.unmanagedProjectGroup')}
            </p>
            <span className="text-xs text-[color:var(--color-muted-foreground)]">{projectManagedRows.length}</span>
          </div>
          {projectManagedRows.length === 0 ? (
            <p className="text-xs text-[color:var(--color-muted-foreground)]">{t('settingsRuntime.none')}</p>
          ) : (
            <div className="space-y-1.5">
              {projectManagedRows.map((item) => (
                <div key={item.key} className="flex items-center justify-between gap-3 text-xs">
                  <span className="min-w-0 truncate text-[color:var(--color-foreground)]">{item.label}</span>
                  <Button
                    variant="outline"
                    className="h-7 rounded-full px-2 text-[11px]"
                    onClick={() => onCloseManagedProcess(item.processId)}
                    disabled={item.disabled}
                    loading={item.loading}
                  >
                    {t('settingsRuntime.close')}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-[22px] border px-5 py-4 surface-card" style={{ borderColor: 'var(--color-border)' }}>
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm font-medium text-[color:var(--color-foreground)]">{t('settingsRuntime.sessions')}</p>
            <span className="text-xs text-[color:var(--color-muted-foreground)]">{sessionRowCount}</span>
          </div>
          {sessionRowCount === 0 ? (
            <p className="text-xs text-[color:var(--color-muted-foreground)]">{t('settingsRuntime.none')}</p>
          ) : (
            <div className="space-y-3">
              {sessionGroups.map((group) => (
                <div key={group.key}>
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-xs font-medium text-[color:var(--color-muted-foreground)]">{group.label}</p>
                    <span className="text-[11px] text-[color:var(--color-muted-foreground)]">{group.items.length}</span>
                  </div>
                  {group.items.length === 0 ? (
                    <p className="text-xs text-[color:var(--color-muted-foreground)]">{t('settingsRuntime.none')}</p>
                  ) : (
                    <div className="space-y-1.5">
                      {group.items.map((item) => (
                        <div key={item.key} className="flex items-center justify-between gap-3 text-xs">
                          <span className="min-w-0 truncate text-[color:var(--color-foreground)]">{item.label}</span>
                          <Button
                            variant="outline"
                            className="h-7 rounded-full px-2 text-[11px]"
                            onClick={() => onCloseSessionRow(item)}
                            disabled={item.disabled || item.actionKey === null}
                            loading={item.loading}
                          >
                            {t('settingsRuntime.close')}
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-[22px] border px-5 py-4 surface-card" style={{ borderColor: 'var(--color-border)' }}>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-medium text-[color:var(--color-foreground)]">{t('settingsRuntime.cleanable')}</p>
            <span className="text-xs text-[color:var(--color-muted-foreground)]">{idleManagedRows.length}</span>
          </div>
          {idleManagedRows.length === 0 ? (
            <p className="text-xs text-[color:var(--color-muted-foreground)]">{t('settingsRuntime.none')}</p>
          ) : (
            <div className="space-y-1.5">
              {idleManagedRows.map((item) => (
                <div key={item.key} className="flex items-center justify-between gap-3 text-xs">
                  <span className="min-w-0 truncate text-[color:var(--color-foreground)]">{item.label}</span>
                  <Button
                    variant="outline"
                    className="h-7 rounded-full px-2 text-[11px]"
                    onClick={() => onCloseManagedProcess(item.processId)}
                    disabled={item.disabled}
                    loading={item.loading}
                  >
                    {t('settingsRuntime.close')}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>

        <p className="text-[11px] text-[color:var(--color-muted-foreground)]">
          {usesTmuxRuntime
            ? t('settings.runtimePanel.managedCleanupHint')
            : t('settings.runtimePanel.unmanagedCleanupHint')}
        </p>
      </div>
    </div>
  )
}
