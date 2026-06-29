import type {
  AppCacheLocationConfig,
  AppCacheLocationInfo,
  AppCacheLocationMode,
  BrowserDataCleanupResult,
  BrowserDataMaintenanceInfo,
  BrowserDataOperationItemResult,
} from '../../../shared/types'
import { useEffect, useState } from 'react'
import { useI18n } from '../../i18n'
import { Select, type SelectOption } from '../../components/ui/select'

type DataCachePanelProps = {
  cacheLocation: AppCacheLocationConfig
  cacheLocationInfo: AppCacheLocationInfo | null
  browserDataMaintenanceInfo: BrowserDataMaintenanceInfo | null
  browserDataMaintenanceAction: 'cleanup' | null
  browserDataMaintenanceResult: BrowserDataCleanupResult | null
  browserDataMaintenanceError: string | null
  onCacheLocationChange: (cacheLocation: AppCacheLocationConfig) => void | Promise<void>
  onRestartApp: () => void | Promise<void>
  onSelectCustomCacheDirectory: () => void | Promise<void>
  onCleanupLegacyBrowserCaches: (rootPath?: string | null) => void | Promise<void>
  onOpenCurrentBrowserDataDirectory: () => void | Promise<void>
  onOpenOldBrowserDataDirectory: (rootPath?: string | null) => void | Promise<void>
}

function SettingsDataCachePanel({
  cacheLocation,
  cacheLocationInfo,
  browserDataMaintenanceInfo,
  browserDataMaintenanceAction,
  browserDataMaintenanceResult,
  browserDataMaintenanceError,
  onCacheLocationChange,
  onRestartApp,
  onSelectCustomCacheDirectory,
  onCleanupLegacyBrowserCaches,
  onOpenCurrentBrowserDataDirectory,
  onOpenOldBrowserDataDirectory,
}: DataCachePanelProps) {
  const { t } = useI18n()
  const [selectedOldCacheRootPath, setSelectedOldCacheRootPath] = useState<string>('all')
  const customPath = cacheLocation.customPath || cacheLocationInfo?.customPath || ''
  const cacheOptions: Array<{
    value: AppCacheLocationMode
    label: string
    description: string
    path: string
  }> = [
    {
      value: 'default',
      label: t('settings.dataCache.cacheLocationDefault'),
      description: t('settings.dataCache.cacheLocationDefaultHint'),
      path: cacheLocationInfo?.defaultPath || t('common.loading'),
    },
    {
      value: 'install',
      label: t('settings.dataCache.cacheLocationInstall'),
      description: t('settings.dataCache.cacheLocationInstallHint'),
      path: cacheLocationInfo?.installPath || t('common.loading'),
    },
    {
      value: 'custom',
      label: t('settings.dataCache.cacheLocationCustom'),
      description: t('settings.dataCache.cacheLocationCustomHint'),
      path: customPath || t('settings.dataCache.cacheLocationCustomEmpty'),
    },
  ]
  const cacheSwitchLossDescriptions = [
    t('settings.dataCache.cacheSwitchLossLogin'),
    t('settings.dataCache.cacheSwitchLossLocalStorage'),
    t('settings.dataCache.cacheSwitchLossIndexedDb'),
    t('settings.dataCache.cacheSwitchLossUiState'),
  ]
  const cacheCleanupSafeDescriptions = [
    t('settings.dataCache.cacheCleanupSafeProjects'),
    t('settings.dataCache.cacheCleanupSafeTranscripts'),
    t('settings.dataCache.cacheCleanupSafeLearningNotes'),
    t('settings.dataCache.cacheCleanupSafeSettings'),
  ]
  const browserDataResultItems = browserDataMaintenanceResult?.items ?? []
  const oldCacheRoots = browserDataMaintenanceInfo?.oldCacheRoots ?? []
  const selectedOldCacheRoot = selectedOldCacheRootPath === 'all' ? null : selectedOldCacheRootPath
  const oldCacheRootOptions: SelectOption[] = [
    {
      value: 'all',
      label: t('settings.dataCache.oldCacheDirectoryAll', { count: oldCacheRoots.length }),
    },
    ...oldCacheRoots.map((item) => ({
      value: item.rootPath,
      label: item.rootPath,
    })),
  ]
  const visibleOldCacheRoots = selectedOldCacheRoot
    ? oldCacheRoots.filter((item) => item.rootPath === selectedOldCacheRoot)
    : oldCacheRoots

  useEffect(() => {
    if (
      selectedOldCacheRootPath !== 'all'
      && !oldCacheRoots.some((item) => item.rootPath === selectedOldCacheRootPath)
    ) {
      setSelectedOldCacheRootPath('all')
    }
  }, [oldCacheRoots, selectedOldCacheRootPath])

  const handleCacheModeClick = (mode: AppCacheLocationMode) => {
    if (mode === 'custom') {
      if (!customPath) {
        void onSelectCustomCacheDirectory()
        return
      }
      void onCacheLocationChange({ mode, customPath })
      return
    }
    void onCacheLocationChange({ mode })
  }

  const formatBrowserDataStatus = (status: BrowserDataOperationItemResult['status']) => {
    return t(`settings.dataCache.browserDataStatus.${status}`)
  }

  const getBrowserDataStatusClassName = (status: BrowserDataOperationItemResult['status']) => {
    if (status === 'deleted') {
      return 'text-emerald-700 dark:text-emerald-300'
    }
    if (status === 'failed') {
      return 'text-red-700 dark:text-red-300'
    }
    if (status === 'skipped-same-path') {
      return 'text-amber-700 dark:text-amber-300'
    }
    return 'text-[color:var(--color-muted-foreground)]'
  }

  return (
    <div className="space-y-8">
      <div>
        <p className="section-label mb-3">{t('settings.dataCache.cacheStorage')}</p>
        <h2 className="text-[28px] font-semibold tracking-[-0.04em] text-[color:var(--color-foreground)]">{t('settings.dataCache.cacheLocation')}</h2>
        <p className="text-sm leading-6 text-[color:var(--color-muted-foreground)] mt-2 mb-6">
          {t('settings.dataCache.cacheLocationDescription')}
        </p>

        <div className="space-y-3">
          {cacheOptions.map((option) => {
            const selected = cacheLocation.mode === option.value
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => handleCacheModeClick(option.value)}
                className={`button-interactive quiet-control w-full rounded-[20px] px-4 py-3 text-left transition-all ${
                  selected
                    ? 'ring-2 ring-[color:var(--color-ring)] bg-[color:var(--color-card)]'
                    : 'hover:bg-[color:var(--color-accent)]'
                }`}
              >
                <span className="flex items-start gap-3">
                  <span className={`mt-1 h-3 w-3 rounded-full border ${
                    selected
                      ? 'border-primary bg-primary'
                      : 'border-[color:var(--color-muted-foreground)]'
                  }`} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-[color:var(--color-foreground)]">
                      {option.label}
                    </span>
                    <span className="mt-1 block text-xs leading-5 text-[color:var(--color-muted-foreground)]">
                      {option.description}
                    </span>
                    <code className="mt-2 block break-all rounded-[12px] bg-[color:var(--color-background)] px-3 py-2 font-mono text-[11px] text-[color:var(--color-foreground)]">
                      {option.path}
                    </code>
                  </span>
                </span>
              </button>
            )
          })}
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void onSelectCustomCacheDirectory()}
            className="button-interactive quiet-control h-9 rounded-full px-4 text-xs text-[color:var(--color-foreground)] hover:bg-[color:var(--color-accent)]"
          >
            {t('settings.dataCache.selectCacheDirectory')}
          </button>
        </div>

        {cacheLocationInfo && (
          <div className="mt-4 grid gap-3 text-xs text-[color:var(--color-muted-foreground)]">
            <div>
              <span className="font-medium text-[color:var(--color-foreground)]">
                {t('settings.dataCache.activeCachePath')}
              </span>
              <code className="mt-1 block break-all rounded-[12px] bg-[color:var(--color-background)] px-3 py-2 font-mono text-[11px] text-[color:var(--color-foreground)]">
                {cacheLocationInfo.activePath}
              </code>
            </div>
            <div>
              <span className="font-medium text-[color:var(--color-foreground)]">
                {t('settings.dataCache.nextCachePath')}
              </span>
              <code className="mt-1 block break-all rounded-[12px] bg-[color:var(--color-background)] px-3 py-2 font-mono text-[11px] text-[color:var(--color-foreground)]">
                {cacheLocationInfo.nextActivePath}
              </code>
            </div>
          </div>
        )}

        {cacheLocationInfo?.restartRequired && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-[16px] bg-amber-500/10 px-4 py-3 text-xs leading-5 text-amber-700 dark:text-amber-200">
            <span className="min-w-0 flex-1">
              {t('settings.dataCache.cacheLocationRestartRequired')}
            </span>
            <button
              type="button"
              onClick={() => void onRestartApp()}
              className="button-interactive h-8 rounded-full bg-amber-600 px-4 text-xs font-medium text-white hover:bg-amber-700 dark:bg-amber-500 dark:text-zinc-950 dark:hover:bg-amber-400"
            >
              {t('settings.dataCache.restartApp')}
            </button>
          </div>
        )}

        {cacheLocationInfo?.usedFallback && cacheLocationInfo.fallbackReason && (
          <p className="mt-3 rounded-[16px] bg-red-500/10 px-4 py-3 text-xs leading-5 text-red-700 dark:text-red-200">
            {t('settings.dataCache.cacheLocationFallback', {
              reason: cacheLocationInfo.fallbackReason,
            })}
          </p>
        )}
      </div>

      <div className="rounded-[24px] border border-amber-500/20 bg-amber-500/10 p-5">
        <p className="section-label mb-3 text-amber-700 dark:text-amber-200">
          {t('settings.dataCache.cacheSwitchRiskKicker')}
        </p>
        <h2 className="text-[24px] font-semibold tracking-[-0.04em] text-[color:var(--color-foreground)]">
          {t('settings.dataCache.cacheSwitchRiskTitle')}
        </h2>
        <p className="mt-2 text-sm leading-6 text-[color:var(--color-muted-foreground)]">
          {t('settings.dataCache.cacheSwitchRiskDescription')}
        </p>
        <div className="mt-4 rounded-[18px] border border-amber-500/20 bg-[color:var(--color-background)]/60 p-4">
          <p className="text-xs font-semibold text-[color:var(--color-foreground)]">
            {t('settings.dataCache.cacheSwitchLossTitle')}
          </p>
          <ul className="mt-3 space-y-2 text-xs leading-5 text-[color:var(--color-muted-foreground)]">
            {cacheSwitchLossDescriptions.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      </div>

      <div>
        <p className="section-label mb-3">{t('settings.dataCache.cacheCleanupKicker')}</p>
        <h2 className="text-[28px] font-semibold tracking-[-0.04em] text-[color:var(--color-foreground)]">
          {t('settings.dataCache.cacheCleanupTitle')}
        </h2>
        <p className="text-sm leading-6 text-[color:var(--color-muted-foreground)] mt-2 mb-6">
          {t('settings.dataCache.cacheCleanupDescription')}
        </p>

        <div className="rounded-[24px] border border-[color:var(--color-border)] bg-[color:var(--color-card)]/70 p-5">
          <div className="grid gap-3 text-xs text-[color:var(--color-muted-foreground)]">
            <div>
              <span className="font-medium text-[color:var(--color-foreground)]">
                {t('settings.dataCache.currentBrowserDataPath')}
              </span>
              <code className="mt-1 block break-all rounded-[12px] bg-[color:var(--color-background)] px-3 py-2 font-mono text-[11px] text-[color:var(--color-foreground)]">
                {browserDataMaintenanceInfo?.currentBrowserDataPath || t('common.loading')}
              </code>
            </div>
            {oldCacheRoots.length > 1 && (
              <label className="grid gap-1.5">
                <span className="font-medium text-[color:var(--color-foreground)]">
                  {t('settings.dataCache.oldCacheDirectorySelector')}
                </span>
                <Select
                  ariaLabel={t('settings.dataCache.oldCacheDirectorySelector')}
                  value={selectedOldCacheRootPath}
                  options={oldCacheRootOptions}
                  onChange={setSelectedOldCacheRootPath}
                  triggerClassName="h-10 rounded-[12px] border border-[color:var(--color-border)] bg-[color:var(--color-background)] px-3 text-xs hover:border-[color:var(--color-border-hover)]"
                  contentClassName="rounded-[16px] p-1"
                  optionClassName="rounded-[12px] px-3 py-2 text-xs"
                />
              </label>
            )}
            <div>
              <span className="font-medium text-[color:var(--color-foreground)]">
                {browserDataMaintenanceInfo?.oldBrowserDataDetected
                  ? t('settings.dataCache.detectedOldBrowserDataPath')
                  : t('settings.dataCache.noOldBrowserDataDetected')}
              </span>
              {oldCacheRoots.length > 0 ? (
                <div className="mt-1 max-h-36 space-y-2 overflow-y-auto pr-1">
                  {visibleOldCacheRoots.map((item) => (
                    <code
                      key={item.rootPath}
                      className="block break-all rounded-[12px] bg-[color:var(--color-background)] px-3 py-2 font-mono text-[11px] text-[color:var(--color-foreground)]"
                    >
                      {item.rootPath}
                    </code>
                  ))}
                </div>
              ) : (
                <code className="mt-1 block break-all rounded-[12px] bg-[color:var(--color-background)] px-3 py-2 font-mono text-[11px] text-[color:var(--color-foreground)]">
                  {browserDataMaintenanceInfo?.oldCacheRootPath || t('common.loading')}
                </code>
              )}
            </div>
          </div>

          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <div className="rounded-[18px] border border-[color:var(--color-border)] bg-[color:var(--color-background)]/70 p-4">
              <p className="text-xs font-semibold text-[color:var(--color-foreground)]">
                {t('settings.dataCache.cacheCleanupDeletesTitle')}
              </p>
              <ul className="mt-3 max-h-64 space-y-2 overflow-y-auto pr-1 text-xs leading-5 text-[color:var(--color-muted-foreground)]">
                {(browserDataMaintenanceInfo?.cleanupItems ?? []).map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
            <div className="rounded-[18px] border border-[color:var(--color-border)] bg-[color:var(--color-background)]/70 p-4">
              <p className="text-xs font-semibold text-[color:var(--color-foreground)]">
                {t('settings.dataCache.cacheCleanupSafeTitle')}
              </p>
              <ul className="mt-3 max-h-64 space-y-2 overflow-y-auto pr-1 text-xs leading-5 text-[color:var(--color-muted-foreground)]">
                {cacheCleanupSafeDescriptions.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          </div>

          <p className="mt-4 rounded-[16px] bg-[color:var(--color-background)]/80 px-4 py-3 text-xs leading-5 text-[color:var(--color-muted-foreground)]">
            {t('settings.dataCache.browserDataRiskHint')}
          </p>

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={oldCacheRoots.length === 0 || browserDataMaintenanceAction !== null}
              onClick={() => void onOpenOldBrowserDataDirectory(selectedOldCacheRoot)}
              className="button-interactive quiet-control h-9 rounded-full px-4 text-xs text-[color:var(--color-foreground)] hover:bg-[color:var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t('settings.dataCache.openSelectedCacheDirectory')}
            </button>
            <button
              type="button"
              disabled={oldCacheRoots.length === 0 || browserDataMaintenanceAction !== null}
              onClick={() => void onCleanupLegacyBrowserCaches(selectedOldCacheRoot)}
              className="button-interactive quiet-control h-9 rounded-full px-4 text-xs text-[color:var(--color-foreground)] hover:bg-[color:var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {browserDataMaintenanceAction === 'cleanup'
                ? t('settings.dataCache.cleanupLegacyBrowserCachesRunning')
                : t('settings.dataCache.deleteSelectedCacheDirectory')}
            </button>
            <button
              type="button"
              disabled={!browserDataMaintenanceInfo || browserDataMaintenanceAction !== null}
              onClick={() => void onOpenCurrentBrowserDataDirectory()}
              className="button-interactive quiet-control h-9 rounded-full px-4 text-xs text-[color:var(--color-foreground)] hover:bg-[color:var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t('settings.dataCache.openActiveCacheDirectory')}
            </button>
          </div>

          {browserDataMaintenanceError && (
            <p className="mt-3 rounded-[16px] bg-red-500/10 px-4 py-3 text-xs leading-5 text-red-700 dark:text-red-200">
              {browserDataMaintenanceError}
            </p>
          )}

          {browserDataMaintenanceResult && (
            <div className="mt-4 rounded-[18px] border border-[color:var(--color-border)] bg-[color:var(--color-background)]/70 p-4">
              <p className="text-xs font-semibold text-[color:var(--color-foreground)]">
                {t('settings.dataCache.browserDataCleanupResultTitle')}
              </p>
              <div className="mt-3 max-h-64 space-y-2 overflow-y-auto pr-1">
                {browserDataResultItems.map((item) => (
                  <div
                    key={item.name}
                    className="rounded-[14px] border border-[color:var(--color-border)] bg-[color:var(--color-card)]/70 px-3 py-2 text-xs"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="min-w-0 break-all font-mono text-[11px] text-[color:var(--color-foreground)]">
                        {item.rootPath ? `${item.rootPath} :: ${item.name}` : item.name}
                      </span>
                      <span className={`shrink-0 font-medium ${getBrowserDataStatusClassName(item.status)}`}>
                        {formatBrowserDataStatus(item.status)}
                      </span>
                    </div>
                    {item.error && (
                      <p className="mt-1 break-all text-[11px] leading-5 text-red-700 dark:text-red-300">
                        {item.error}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export { SettingsDataCachePanel }
