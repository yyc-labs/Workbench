import { X } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { AgentLogDetail } from '../../../../shared/types'
import { ModalShell } from '../../../components/ModalShell'
import { Button } from '../../../components/ui/button'
import { useI18n } from '../../../i18n'
import { AgentLogFlowMap } from './AgentLogFlowMap'
import { AgentLogJsonInspectorRail } from './AgentLogJsonInspectorRail'
import { AgentLogMarkdownView } from './AgentLogMarkdownView'
import { AgentLogJsonFieldIndexPanel } from './AgentLogJsonView'
import { useAgentLogViewerModel } from './useAgentLogViewerModel'

type AgentLogViewerModalProps = {
  open: boolean
  detail: AgentLogDetail | null
  loading: boolean
  error: string | null
  onClose: () => void
}

type ViewerSurface = 'outline' | 'document' | 'json'
const DESKTOP_VIEWPORT_QUERY = '(min-width: 1280px)'

function useIsDesktopViewerViewport() {
  const [isDesktopViewport, setIsDesktopViewport] = useState(
    () => window.matchMedia(DESKTOP_VIEWPORT_QUERY).matches
  )

  useEffect(() => {
    const media = window.matchMedia(DESKTOP_VIEWPORT_QUERY)
    const syncViewport = () => setIsDesktopViewport(media.matches)
    syncViewport()
    media.addEventListener('change', syncViewport)
    return () => media.removeEventListener('change', syncViewport)
  }, [])

  return isDesktopViewport
}

export function AgentLogViewerModal({
  open,
  detail,
  loading,
  error,
  onClose,
}: AgentLogViewerModalProps) {
  const { t } = useI18n()
  const isDesktopViewport = useIsDesktopViewerViewport()
  const [activeSectionId, setActiveSectionId] = useState('')
  const [focusedPath, setFocusedPath] = useState<string[] | undefined>(undefined)
  const [surface, setSurface] = useState<ViewerSurface>('document')
  const {
    defaultSectionId,
    detailKey,
    jsonValue,
    sectionJsonById,
    sections,
  } = useAgentLogViewerModel(detail)
  const desktopSurface: Exclude<ViewerSurface, 'outline'> = surface === 'json' ? 'json' : 'document'

  useEffect(() => {
    if (!detail) {
      setActiveSectionId('')
      setFocusedPath(undefined)
      return
    }

    const nextSectionId = defaultSectionId
    setActiveSectionId((current) => sections.some((section) => section.id === current) ? current : nextSectionId)
    setFocusedPath((current) => current ?? sections.find((section) => section.id === nextSectionId)?.defaultFocusPath)
    setSurface('document')
  }, [defaultSectionId, detail, detailKey, sections])

  useEffect(() => {
    if (!isDesktopViewport || surface !== 'outline') return
    setSurface('document')
  }, [isDesktopViewport, surface])

  const handleSelectSection = (sectionId: string) => {
    setActiveSectionId(sectionId)
    const section = sections.find((entry) => entry.id === sectionId)
    if (section?.defaultFocusPath) {
      setFocusedPath(section.defaultFocusPath)
    }
    setSurface('document')
  }

  const handleFocusPath = (path: string[] | undefined, sectionId?: string) => {
    if (sectionId) {
      setActiveSectionId(sectionId)
    }
    setFocusedPath(path)
    setSurface('json')
  }

  const viewerJsonPersistenceKey = detailKey ? `${detailKey}:viewer-json` : undefined

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      widthClassName="max-w-[min(1700px,calc(100vw-28px))]"
      baseZIndex={1180}
      ariaLabel={t('settings.agentLogs.fullscreenViewer')}
      overlayClassName="backdrop-blur-0 bg-black/18"
      panelClassName="p-4 sm:p-5"
    >
      <div className="relative flex max-h-[min(92vh,1100px)] min-h-0 flex-col">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="section-label mb-1">{t('settings.agentLogs.fullscreenViewer')}</p>
            <h3 className="text-xl font-semibold tracking-[-0.03em] text-[color:var(--color-foreground)]">
              {detail?.summary.title ?? t('settings.agentLogs.title')}
            </h3>
            <p className="mt-1 text-sm text-[color:var(--color-muted-foreground)]">
              {detail?.meta.requestId ?? t('settings.agentLogs.selectLogHint')}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="flex h-8 w-8 items-center justify-center rounded-full text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)]"
              onClick={onClose}
              title={t('common.close')}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {!isDesktopViewport ? (
          <div className="quiet-control mb-4 flex rounded-full p-1">
            <Button
              type="button"
              variant={surface === 'outline' ? 'default' : 'outline'}
              className="h-8 flex-1 rounded-full px-3 text-xs"
              onClick={() => setSurface('outline')}
            >
              {t('settings.agentLogs.flowOutline')}
            </Button>
            <Button
              type="button"
              variant={surface === 'document' ? 'default' : 'outline'}
              className="h-8 flex-1 rounded-full px-3 text-xs"
              onClick={() => setSurface('document')}
            >
              {t('settings.agentLogs.documentView')}
            </Button>
            <Button
              type="button"
              variant={surface === 'json' ? 'default' : 'outline'}
              className="h-8 flex-1 rounded-full px-3 text-xs"
              onClick={() => setSurface('json')}
            >
              {t('settings.agentLogs.jsonInspector')}
            </Button>
          </div>
        ) : null}

        {!detail && loading ? (
          <div className="flex min-h-[420px] items-center justify-center text-sm text-[color:var(--color-muted-foreground)]">
            {t('common.loading')}
          </div>
        ) : !detail ? (
          <div className="flex min-h-[420px] items-center justify-center text-sm text-[color:var(--color-muted-foreground)]">
            {error || t('settings.agentLogs.selectLogHint')}
          </div>
        ) : (
          isDesktopViewport ? (
            <div className="min-h-0 flex-1 grid grid-cols-[minmax(280px,0.72fr)_minmax(0,1.68fr)] gap-4">
              <aside className="min-h-0 flex flex-col gap-4">
                <div className="quiet-control flex rounded-full p-1">
                  <Button
                    type="button"
                    variant={desktopSurface === 'document' ? 'default' : 'outline'}
                    className="h-8 flex-1 rounded-full px-3 text-xs"
                    onClick={() => setSurface('document')}
                  >
                    {t('settings.agentLogs.documentView')}
                  </Button>
                  <Button
                    type="button"
                    variant={desktopSurface === 'json' ? 'default' : 'outline'}
                    className="h-8 flex-1 rounded-full px-3 text-xs"
                    onClick={() => setSurface('json')}
                  >
                    {t('settings.agentLogs.jsonInspector')}
                  </Button>
                </div>
                <div className="min-h-0 flex-1 overflow-auto pr-1">
                  {desktopSurface === 'json' ? (
                    <AgentLogJsonFieldIndexPanel
                      value={jsonValue}
                      focusedPath={focusedPath}
                      onFocusPathChange={(path) => handleFocusPath(path)}
                      maxHeightClassName="max-h-[min(72vh,900px)]"
                    />
                  ) : (
                    <AgentLogFlowMap
                      steps={sections}
                      activeStepId={activeSectionId}
                      onSelectStep={handleSelectSection}
                      maxHeightClassName="max-h-[min(72vh,900px)]"
                    />
                  )}
                </div>
              </aside>

              <div className="min-h-0">
                {desktopSurface === 'json' ? (
                  <div className="max-h-[min(78vh,960px)] overflow-auto">
                    <AgentLogJsonInspectorRail
                      persistenceKey={viewerJsonPersistenceKey}
                      jsonValue={jsonValue}
                      sections={sections}
                      activeSectionId={activeSectionId}
                      focusedPath={focusedPath}
                      onFocusPathChange={(path) => handleFocusPath(path)}
                      showFieldIndex={false}
                    />
                  </div>
                ) : (
                  <AgentLogMarkdownView
                    detail={detail}
                    loading={false}
                    sections={sections}
                    sectionJsonById={sectionJsonById}
                    activeSectionId={activeSectionId}
                    onSelectSection={handleSelectSection}
                    onFocusPath={handleFocusPath}
                    maxHeightClassName="max-h-[min(78vh,960px)]"
                    domIdPrefix="agent-log-viewer-modal-desktop"
                    focusedPath={focusedPath}
                  />
                )}
              </div>
            </div>
          ) : (
            <div className="min-h-0 flex-1">
              {surface === 'outline' ? (
                <AgentLogFlowMap
                  steps={sections}
                  activeStepId={activeSectionId}
                  onSelectStep={handleSelectSection}
                />
              ) : surface === 'json' ? (
                <div className="max-h-[min(78vh,960px)] overflow-auto">
                  <AgentLogJsonInspectorRail
                    persistenceKey={viewerJsonPersistenceKey}
                    jsonValue={jsonValue}
                    sections={sections}
                    activeSectionId={activeSectionId}
                    focusedPath={focusedPath}
                    onFocusPathChange={(path) => handleFocusPath(path)}
                  />
                </div>
              ) : (
                <AgentLogMarkdownView
                  detail={detail}
                  loading={false}
                  sections={sections}
                  sectionJsonById={sectionJsonById}
                  activeSectionId={activeSectionId}
                  onSelectSection={handleSelectSection}
                  onFocusPath={handleFocusPath}
                  maxHeightClassName="max-h-[min(78vh,960px)]"
                  domIdPrefix="agent-log-viewer-modal-mobile"
                  focusedPath={focusedPath}
                />
              )}
            </div>
          )
        )}
      </div>
    </ModalShell>
  )
}
