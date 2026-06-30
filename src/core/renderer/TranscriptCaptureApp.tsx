import {
  ArrowDownToLine,
  CheckCircle2,
  ClipboardPaste,
  Clock3,
  FileText,
  FolderTree,
  Loader2,
  Search,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { ProjectInfo, SavedProject, TranscriptCaptureInitialText } from '../shared/types'
import { resolveTheme } from './app/windowTitle'
import { Button } from './components/ui/button'
import { Combobox, type ComboboxOption } from './components/ui/combobox'
import { useI18n } from './i18n'
import { middleTruncatePath, projectDisplayName } from './lib/projectDisplay'
import { useAppStore } from './stores/appStore'
import { applySavedProjectSnapshot, createFallbackProject } from './stores/appStore.helpers'

function buildQuickCaptureProjects(savedProjects: SavedProject[]): ProjectInfo[] {
  return savedProjects
    .map((saved) => applySavedProjectSnapshot(createFallbackProject(saved.path), saved))
    .sort((left, right) => {
      const openedDiff = (right.lastOpened ?? 0) - (left.lastOpened ?? 0)
      if (openedDiff !== 0) return openedDiff
      return projectDisplayName(left).localeCompare(projectDisplayName(right))
    })
}

function TranscriptCaptureThemeSync() {
  const theme = useAppStore((s) => s.config.theme)
  const { locale } = useI18n()

  useEffect(() => {
    const applyTheme = () => {
      const nextTheme = resolveTheme(theme)
      document.documentElement.setAttribute('data-theme-mode', theme)
      document.documentElement.setAttribute('data-theme', nextTheme)
      document.documentElement.style.colorScheme = nextTheme
      document.documentElement.lang = locale
      document.documentElement.style.backgroundColor = 'var(--color-background)'
      document.body.style.backgroundColor = 'var(--color-background)'
    }

    applyTheme()

    if (theme !== 'system') return

    const media = window.matchMedia('(prefers-color-scheme: dark)')
    media.addEventListener('change', applyTheme)
    return () => media.removeEventListener('change', applyTheme)
  }, [locale, theme])

  return null
}

function TranscriptCaptureLoading() {
  const { t } = useI18n()

  return (
    <div
      className="flex min-h-screen items-center justify-center bg-[color:var(--color-background)] p-3"
      style={{
        backgroundImage: [
          'radial-gradient(circle at top left, color-mix(in srgb, var(--color-primary) 16%, transparent), transparent 36%)',
          'radial-gradient(circle at bottom right, color-mix(in srgb, var(--color-accent) 88%, transparent), transparent 34%)',
        ].join(', '),
      }}
    >
      <div className="surface-card flex items-center gap-3 rounded-[20px] px-4 py-3">
        <Loader2 className="h-4 w-4 animate-spin text-[color:var(--color-primary)]" />
        <span className="text-sm text-[color:var(--color-foreground)]">{t('common.loading')}</span>
      </div>
    </div>
  )
}

export function TranscriptCaptureApp() {
  const { t } = useI18n()
  const [projects, setProjects] = useState<ProjectInfo[]>([])
  const [selectedProjectId, setSelectedProjectId] = useState('')
  const [projectSearchQuery, setProjectSearchQuery] = useState('')
  const [draftText, setDraftText] = useState('')
  const [isReady, setIsReady] = useState(false)
  const [isImporting, setIsImporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [clipboardHasText, setClipboardHasText] = useState(false)
  const [loadedTextSource, setLoadedTextSource] = useState<TranscriptCaptureInitialText['source']>('empty')
  const [openViewerAfterImport, setOpenViewerAfterImport] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    let active = true

    void (async () => {
      try {
        const config = await window.electronAPI.getConfig()
        if (!active) return

        useAppStore.setState((state) => ({
          config: {
            ...state.config,
            theme: config.theme,
            locale: config.locale,
            launchOnLogin: config.launchOnLogin ?? state.config.launchOnLogin,
          },
        }))

        const nextProjects = buildQuickCaptureProjects(config.projects)
        const initialCaptureText = await window.electronAPI.consumeTranscriptCaptureInitialText()
        const clipboardText = window.electronAPI.readClipboardText()
        const fallbackInitialText: TranscriptCaptureInitialText = {
          text: clipboardText,
          source: clipboardText.trim() ? 'clipboard' : 'empty',
        }
        const initialText = initialCaptureText.text.trim()
          ? initialCaptureText
          : fallbackInitialText
        if (!active) return

        setProjects(nextProjects)
        setSelectedProjectId(nextProjects[0]?.id ?? '')
        setDraftText(initialText.text)
        setClipboardHasText(Boolean(initialText.text.trim()))
        setLoadedTextSource(initialText.source)
        setOpenViewerAfterImport(Boolean(config.shortcutPreferences?.quickTranscriptCaptureOpenViewer))
      } catch (initError) {
        console.error('[TranscriptCaptureApp] initialization failed:', initError)
      } finally {
        if (active) {
          setIsReady(true)
        }
      }
    })()

    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (!isReady) return
    const frameId = window.requestAnimationFrame(() => {
      textareaRef.current?.focus()
    })
    return () => window.cancelAnimationFrame(frameId)
  }, [isReady])

  const handleClose = () => {
    void window.electronAPI.closeWindow()
  }

  const selectedProject = useMemo(
    () => projects.find((item) => item.id === selectedProjectId),
    [projects, selectedProjectId]
  )
  const projectOptions = useMemo<ComboboxOption[]>(
    () => projects.map((project) => ({
      value: project.id,
      label: projectDisplayName(project),
      keywords: [project.path, project.id],
    })),
    [projects]
  )
  const normalizedProjectSearchQuery = projectSearchQuery.trim().toLowerCase()
  const filteredProjects = useMemo(
    () => projects.filter((project) => {
      if (!normalizedProjectSearchQuery) return true
      return [
        projectDisplayName(project),
        project.path,
        project.id,
      ].some((value) => value.toLowerCase().includes(normalizedProjectSearchQuery))
    }),
    [normalizedProjectSearchQuery, projects]
  )
  const selectedProjectLabel = selectedProject
    ? projectDisplayName(selectedProject)
    : t('transcript.manualImportProjectPlaceholder')
  const clipboardStatusText = loadedTextSource === 'selection'
    ? t('transcript.quickCaptureSelectionReady')
    : clipboardHasText
    ? t('transcript.quickCaptureClipboardReady')
    : t('transcript.quickCaptureClipboardEmpty')
  const contentLength = draftText.trim().length
  const canSubmit = projects.length > 0 && Boolean(selectedProjectId.trim()) && Boolean(draftText.trim())

  const reloadClipboard = () => {
    const nextText = window.electronAPI.readClipboardText()
    setClipboardHasText(Boolean(nextText.trim()))
    setDraftText(nextText)
    setLoadedTextSource(nextText.trim() ? 'clipboard' : 'empty')
    setError(null)
    window.requestAnimationFrame(() => {
      textareaRef.current?.focus()
      textareaRef.current?.setSelectionRange(nextText.length, nextText.length)
    })
  }

  const handleSubmit = async () => {
    if (isImporting) return
    if (!selectedProjectId.trim()) {
      setError(t('transcript.manualImportProjectRequired'))
      return
    }
    if (!draftText.trim()) {
      setError(t('transcript.manualImportEmpty'))
      return
    }

    setError(null)
    setIsImporting(true)
    try {
      await window.electronAPI.importExternalTranscript({
        projectId: selectedProjectId,
        rawText: draftText,
        sourceType: 'manual-markdown',
        capturedAt: Date.now(),
        openViewer: openViewerAfterImport,
      })
      handleClose()
    } catch (importError) {
      console.error('[TranscriptCaptureApp] transcript import failed:', importError)
      setError(t('transcript.manualImportFailed'))
    } finally {
      setIsImporting(false)
    }
  }

  const handleEditorKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
    event.preventDefault()
    event.stopPropagation()
    void handleSubmit()
  }

  useEffect(() => {
    if (!isReady) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        handleClose()
        return
      }

      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault()
        void handleSubmit()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [draftText, isReady, selectedProjectId])

  if (!isReady) {
    return (
      <>
        <TranscriptCaptureThemeSync />
        <TranscriptCaptureLoading />
      </>
    )
  }

  return (
    <>
      <TranscriptCaptureThemeSync />
      <div
        className="flex min-h-screen items-stretch justify-center bg-[color:var(--color-background)] p-2.5"
        style={{
          backgroundImage: [
            'radial-gradient(circle at 0% 0%, color-mix(in srgb, var(--color-primary) 22%, transparent), transparent 34%)',
            'radial-gradient(circle at 100% 0%, color-mix(in srgb, var(--color-success) 18%, transparent), transparent 30%)',
            'linear-gradient(135deg, color-mix(in srgb, var(--color-background) 78%, var(--color-card)), var(--color-background-sunken))',
          ].join(', '),
        }}
      >
        <div
          className="surface-card app-drag-region relative grid min-h-0 w-full flex-1 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden rounded-[24px]"
          style={{
            background:
              'linear-gradient(145deg, color-mix(in srgb, var(--color-popover) 94%, transparent), color-mix(in srgb, var(--color-card) 84%, transparent))',
          }}
        >
          <div
            className="pointer-events-none absolute inset-x-0 top-0 h-28"
            style={{
              background:
                'linear-gradient(90deg, color-mix(in srgb, var(--color-primary) 18%, transparent), color-mix(in srgb, var(--color-success) 12%, transparent), transparent)',
            }}
          />
          <div
            className="pointer-events-none absolute -right-14 top-7 h-36 w-36 rounded-full opacity-70 blur-3xl"
            style={{ background: 'color-mix(in srgb, var(--color-primary) 24%, transparent)' }}
          />

          <header className="relative z-10 flex items-start justify-between gap-3 px-4 pb-2.5 pt-4">
            <div className="flex min-w-0 items-start gap-3">
              <div
                className="relative flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-[16px] text-white shadow-sm"
                style={{
                  background:
                    'linear-gradient(145deg, var(--color-primary), color-mix(in srgb, var(--color-success) 62%, var(--color-primary)))',
                }}
              >
                <ArrowDownToLine className="relative z-10 h-5 w-5" />
                <div className="absolute -bottom-4 -right-4 h-10 w-10 rounded-full bg-white/20" />
              </div>
              <div className="min-w-0">
                <div className="mb-1.5 flex flex-wrap items-center gap-2">
                  <span className="section-label">{t('transcript.listTitle')}</span>
                  <span
                    className="rounded-full border px-2 py-0.5 font-mono text-[10px] font-semibold text-[color:var(--color-primary)]"
                    style={{
                      borderColor: 'color-mix(in srgb, var(--color-primary) 24%, transparent)',
                      background: 'color-mix(in srgb, var(--color-primary) 9%, transparent)',
                    }}
                  >
                    Ctrl Shift K
                  </span>
                </div>
                <h1 className="truncate text-[20px] font-semibold leading-6 tracking-[-0.04em] text-[color:var(--color-foreground)]">
                  {t('transcript.quickCaptureTitle')}
                </h1>
                <p className="mt-1 max-w-[410px] truncate text-[12px] text-[color:var(--color-muted-foreground)]">
                  {t('transcript.quickCaptureDescription')}
                </p>
              </div>
            </div>
            <button
              type="button"
              className="app-no-drag button-interactive flex h-9 w-9 shrink-0 items-center justify-center rounded-full border text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)]"
              style={{
                borderColor: 'color-mix(in srgb, var(--color-border) 88%, transparent)',
                background: 'color-mix(in srgb, var(--color-card) 66%, transparent)',
              }}
              onClick={handleClose}
              aria-label={t('common.close')}
              title={t('common.close')}
            >
              <X className="h-4 w-4" />
            </button>
          </header>

          <main className="relative z-10 grid min-h-0 grid-cols-[205px_minmax(0,1fr)] gap-2.5 px-3.5 pb-2.5">
            <aside
              className="flex min-h-0 flex-col overflow-hidden rounded-[20px] border p-3"
              style={{
                borderColor: 'color-mix(in srgb, var(--color-border) 78%, transparent)',
                background:
                  'linear-gradient(180deg, color-mix(in srgb, var(--color-background-sunken) 48%, transparent), color-mix(in srgb, var(--color-card) 70%, transparent))',
                boxShadow: 'inset 0 1px 0 color-mix(in srgb, #ffffff 22%, transparent)',
              }}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <FolderTree className="h-3.5 w-3.5 shrink-0 text-[color:var(--color-primary)]" />
                  <span className="truncate text-xs font-semibold text-[color:var(--color-foreground)]">
                    {t('transcript.manualImportProjectLabel')}
                  </span>
                </div>
                {selectedProject && typeof selectedProject.lastOpened === 'number' ? (
                  <Clock3 className="h-3.5 w-3.5 shrink-0 text-[color:var(--color-muted-foreground)]" />
                ) : null}
              </div>

              {projects.length > 0 ? (
                <>
                  <Combobox
                    ariaLabel={t('transcript.manualImportProjectLabel')}
                    className="app-no-drag mt-3"
                    value={selectedProject?.id ?? ''}
                    searchValue={projectSearchQuery}
                    onSearchValueChange={setProjectSearchQuery}
                    options={projectOptions}
                    onChange={(value) => {
                      setSelectedProjectId(value)
                      setError(null)
                    }}
                    editable="open"
                    clearSearchOnClose
                    triggerPlaceholder={selectedProjectLabel}
                    inputPlaceholder={t('transcript.manualImportProjectSearchPlaceholder')}
                    disabled={isImporting}
                    emptyText={t('transcript.manualImportProjectSearchEmpty')}
                    maxHeight={210}
                    minDropdownWidth={340}
                    matchTriggerWidth={true}
                    inputClassName="h-10 rounded-[14px] pr-10 text-xs"
                    inputLeading={<Search className="h-3.5 w-3.5" />}
                    triggerClassName="h-10 gap-2 rounded-[14px] px-3 text-xs"
                    contentClassName="surface-card rounded-[16px] p-1"
                    optionClassName="items-start gap-2 rounded-[12px] px-2.5 py-2"
                    renderDisplayValue={() => (
                      <span className={`min-w-0 truncate ${selectedProject ? 'text-[color:var(--color-foreground)]' : 'text-[color:var(--color-muted-foreground)]'}`}>
                        {selectedProjectLabel}
                      </span>
                    )}
                    renderOption={(option, state) => {
                      const project = projects.find((item) => item.id === option.value)
                      if (!project) return null
                      const index = filteredProjects.findIndex((item) => item.id === project.id)
                      const isRecent = index >= 0 && index < 5 && typeof project.lastOpened === 'number'
                      return (
                        <>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="truncate text-[13px] font-medium text-[color:var(--color-foreground)]">
                                {projectDisplayName(project)}
                              </p>
                              {isRecent ? (
                                <span className="inline-flex items-center gap-1 rounded-full bg-[color:var(--color-accent)] px-1.5 py-0.5 text-[10px] text-[color:var(--color-muted-foreground)]">
                                  <Clock3 className="h-3 w-3" />
                                  {t('transcript.manualImportRecentProject')}
                                </span>
                              ) : null}
                            </div>
                            <p
                              className="mt-0.5 truncate text-[11px] text-[color:var(--color-muted-foreground)]"
                              title={project.path}
                            >
                              {middleTruncatePath(project.path, 24, 18)}
                            </p>
                          </div>
                          <span className={`mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                            state.selected
                              ? 'border-[color:var(--color-primary)] bg-[color:var(--color-primary)] text-white'
                              : 'border-[color:var(--color-border)] text-transparent'
                          }`}>
                            <span className="h-2 w-2 rounded-full bg-current" />
                          </span>
                        </>
                      )
                    }}
                    filterOption={(option, nextQuery) => {
                      const normalizedQuery = nextQuery.trim().toLowerCase()
                      if (!normalizedQuery) return true
                      const project = projects.find((item) => item.id === option.value)
                      if (!project) return false
                      return [
                        projectDisplayName(project),
                        project.path,
                        project.id,
                      ].some((field) => field.toLowerCase().includes(normalizedQuery))
                    }}
                    onOpenChange={(open) => {
                      if (!open) {
                        setProjectSearchQuery('')
                      }
                    }}
                  />

                  {selectedProject ? (
                    <div className="mt-3 min-h-0 rounded-[16px] border border-dashed border-[color:var(--color-border)] p-3">
                      <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--color-muted-foreground)]">
                        <CheckCircle2 className="h-3.5 w-3.5 text-[color:var(--color-success)]" />
                        {t('transcript.quickCaptureProjectPathLabel')}
                      </div>
                      <div
                        className="break-all font-mono text-[11px] leading-5 text-[color:var(--color-foreground)]"
                        title={selectedProject.path}
                      >
                        {middleTruncatePath(selectedProject.path, 24, 22)}
                      </div>
                    </div>
                  ) : null}
                </>
              ) : (
                <div
                  className="mt-3 rounded-[16px] border px-3 py-3 text-xs leading-5 text-[color:var(--color-muted-foreground)]"
                  style={{ borderColor: 'var(--color-border)' }}
                >
                  {t('transcript.manualImportNoProjects')}
                </div>
              )}

              <div className="mt-auto space-y-2 pt-3">
                <div
                  className="rounded-[16px] border px-3 py-2.5"
                  style={{
                    borderColor: 'color-mix(in srgb, var(--color-border) 80%, transparent)',
                    background: 'color-mix(in srgb, var(--color-card) 52%, transparent)',
                  }}
                >
                  <div className="mb-1 flex items-center gap-2 text-[11px] font-semibold text-[color:var(--color-foreground)]">
                    <ClipboardPaste className="h-3.5 w-3.5 text-[color:var(--color-primary)]" />
                    {t('transcript.quickCaptureClipboardLoad')}
                  </div>
                  <p className="line-clamp-2 text-[11px] leading-4 text-[color:var(--color-muted-foreground)]">
                    {clipboardStatusText}
                  </p>
                </div>
                <div className="flex items-center justify-between rounded-full bg-[color:var(--color-accent)] px-3 py-1.5 text-[11px] text-[color:var(--color-muted-foreground)]">
                  <span>{t('transcript.manualImportContentLabel')}</span>
                  <span className="font-mono">{contentLength}</span>
                </div>
              </div>
            </aside>

            <section
              className="flex min-h-0 flex-col overflow-hidden rounded-[20px] border"
              style={{
                borderColor: 'color-mix(in srgb, var(--color-border) 78%, transparent)',
                background: 'color-mix(in srgb, var(--color-card-solid) 64%, transparent)',
                boxShadow: 'inset 0 1px 0 color-mix(in srgb, #ffffff 24%, transparent)',
              }}
            >
              <div className="flex items-center justify-between gap-3 px-3.5 py-3">
                <div className="flex min-w-0 items-center gap-2.5">
                  <div
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[12px]"
                    style={{
                      color: 'var(--color-primary)',
                      background: 'color-mix(in srgb, var(--color-primary) 10%, transparent)',
                    }}
                  >
                    <FileText className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold tracking-[-0.02em] text-[color:var(--color-foreground)]">
                      {t('transcript.manualImportContentLabel')}
                    </p>
                    <p className="truncate text-[11px] text-[color:var(--color-muted-foreground)]">
                      {t('transcript.quickCaptureShortcutHint')}
                    </p>
                  </div>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="app-no-drag h-8 shrink-0 rounded-full px-3 text-xs"
                  onClick={reloadClipboard}
                  disabled={isImporting}
                >
                  <ClipboardPaste className="h-3.5 w-3.5" />
                  {t('transcript.quickCaptureClipboardLoad')}
                </Button>
              </div>

              <div className="flex min-h-0 flex-1 px-3 pb-3">
                <div
                  className="flex min-h-0 flex-1 overflow-hidden rounded-[18px] border"
                  style={{
                    borderColor: 'color-mix(in srgb, var(--color-border) 80%, transparent)',
                    background:
                      'linear-gradient(180deg, color-mix(in srgb, var(--color-background) 34%, transparent), color-mix(in srgb, var(--color-card) 92%, transparent))',
                  }}
                >
                  <textarea
                    ref={textareaRef}
                    value={draftText}
                    onChange={(event) => {
                      setDraftText(event.target.value)
                      setError(null)
                    }}
                    onKeyDown={handleEditorKeyDown}
                    className="app-no-drag min-h-[120px] w-full resize-none border-0 bg-transparent px-4 py-4 font-mono text-[12px] leading-6 text-[color:var(--color-foreground)] outline-none placeholder:font-sans placeholder:text-[color:var(--color-muted-foreground)]"
                    placeholder={t('transcript.manualImportContentPlaceholder')}
                    spellCheck={false}
                    disabled={isImporting}
                  />
                </div>
              </div>
            </section>
          </main>

          <footer className="relative z-10 flex items-center justify-between gap-3 px-4 pb-4 pt-1">
            <div className="min-w-0 flex-1">
              {error ? (
                <div
                  className="truncate rounded-full border px-3 py-2 text-xs"
                  style={{
                    borderColor: 'var(--color-destructive)',
                    background: 'var(--color-destructive-background)',
                    color: 'var(--color-destructive)',
                  }}
                >
                  {error}
                </div>
              ) : (
                <div className="truncate text-xs text-[color:var(--color-muted-foreground)]">
                  {selectedProject
                    ? t('transcript.manualImportSelectedProject', { value: projectDisplayName(selectedProject) })
                    : t('transcript.manualImportProjectPlaceholder')}
                </div>
              )}
            </div>
            <div className="app-no-drag flex shrink-0 items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9 px-3.5"
                onClick={handleClose}
                disabled={isImporting}
              >
                {t('common.cancel')}
              </Button>
              <Button
                type="button"
                size="sm"
                className="h-9 px-4 shadow-sm"
                onClick={() => void handleSubmit()}
                loading={isImporting}
                disabled={!canSubmit}
              >
                {t('transcript.importPastedContent')}
              </Button>
            </div>
          </footer>
        </div>
      </div>
    </>
  )
}
