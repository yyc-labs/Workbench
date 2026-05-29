import { useCallback, useEffect, useRef, useState } from 'react'
import type { ProjectFileReadResult } from '../../../shared/types'
import { useAppStore } from '../../stores/appStore'
import type { SaveStatus } from './code.types'

const SAVE_STATUS_RESET_DELAY_MS = 1600
const FILE_EXTERNAL_CHANGE_POLL_MS = 1200

export type DiscardUnsavedConfirmState = {
  nextRelativePath: string
  forceReload: boolean
} | null

type UseCodeFileStateOptions = {
  projectId: string
  projectPath: string
  persistedLastCodeFile?: string
  onBeforeOpenFile?: () => void
  onDidOpenFile?: (file: ProjectFileReadResult) => void
}

export function useCodeFileState({
  projectId,
  projectPath,
  persistedLastCodeFile,
  onBeforeOpenFile,
  onDidOpenFile,
}: UseCodeFileStateOptions) {
  const setProjectLastCodeFile = useAppStore((s) => s.setProjectLastCodeFile)
  const [activeFile, setActiveFile] = useState<ProjectFileReadResult | null>(null)
  const [editorValue, setEditorValue] = useState('')
  const [lastSavedValue, setLastSavedValue] = useState('')
  const [activeRelativePath, setActiveRelativePath] = useState<string | null>(null)
  const [isReading, setIsReading] = useState(false)
  const [readError, setReadError] = useState<string | null>(null)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const [saveError, setSaveError] = useState<string | null>(null)
  const [hasExternalChange, setHasExternalChange] = useState(false)
  const [isReloadingFromDisk, setIsReloadingFromDisk] = useState(false)
  const [discardUnsavedConfirm, setDiscardUnsavedConfirm] = useState<DiscardUnsavedConfirmState>(null)
  const discardUnsavedResolverRef = useRef<((proceed: boolean) => void) | null>(null)

  const isDirty = editorValue !== lastSavedValue

  const resolveDiscardUnsavedConfirm = useCallback((proceed: boolean) => {
    const resolve = discardUnsavedResolverRef.current
    discardUnsavedResolverRef.current = null
    setDiscardUnsavedConfirm(null)
    resolve?.(proceed)
  }, [])

  const requestDiscardUnsavedConfirm = useCallback((nextRelativePath: string, forceReload: boolean): Promise<boolean> => {
    return new Promise((resolve) => {
      const previousResolve = discardUnsavedResolverRef.current
      if (previousResolve) {
        previousResolve(false)
      }
      discardUnsavedResolverRef.current = resolve
      setDiscardUnsavedConfirm({ nextRelativePath, forceReload })
    })
  }, [])

  useEffect(() => {
    return () => {
      const resolve = discardUnsavedResolverRef.current
      discardUnsavedResolverRef.current = null
      resolve?.(false)
    }
  }, [])

  const openFile = useCallback(async (relativePath: string, forceReload = false): Promise<boolean> => {
    if (activeRelativePath === relativePath && !forceReload) return true
    if (isDirty && activeRelativePath && activeRelativePath !== relativePath) {
      const proceed = await requestDiscardUnsavedConfirm(relativePath, forceReload)
      if (!proceed) return false
    }

    onBeforeOpenFile?.()

    setIsReading(true)
    setReadError(null)
    setSaveError(null)
    setSaveStatus('idle')

    try {
      const result = await window.electronAPI.readProjectFile(projectPath, relativePath)
      setActiveFile(result)
      setActiveRelativePath(result.relativePath)
      setEditorValue(result.content)
      setLastSavedValue(result.content)
      setHasExternalChange(false)
      onDidOpenFile?.(result)
      void setProjectLastCodeFile(projectId, result.relativePath)
      return true
    } catch (error) {
      setReadError(error instanceof Error ? error.message : String(error))
      if (forceReload || persistedLastCodeFile === relativePath) {
        void setProjectLastCodeFile(projectId, undefined)
      }
      return false
    } finally {
      setIsReading(false)
    }
  }, [
    activeRelativePath,
    isDirty,
    onBeforeOpenFile,
    onDidOpenFile,
    persistedLastCodeFile,
    projectId,
    projectPath,
    requestDiscardUnsavedConfirm,
    setProjectLastCodeFile,
  ])

  const handleSave = useCallback(async () => {
    if (!activeRelativePath || !activeFile) return
    if (!isDirty) return

    setSaveStatus('saving')
    setSaveError(null)

    try {
      const result = await window.electronAPI.writeProjectFile(
        projectPath,
        activeRelativePath,
        editorValue,
        activeFile.mtimeMs
      )
      setActiveFile((prev) => (
        prev
          ? {
            ...prev,
            content: editorValue,
            size: result.size,
            mtimeMs: result.mtimeMs,
          }
          : prev
      ))
      setLastSavedValue(editorValue)
      setSaveStatus('saved')
      setHasExternalChange(false)
      window.setTimeout(() => {
        setSaveStatus((current) => (current === 'saved' ? 'idle' : current))
      }, SAVE_STATUS_RESET_DELAY_MS)
    } catch (error) {
      setSaveStatus('error')
      setSaveError(error instanceof Error ? error.message : String(error))
    }
  }, [activeFile, activeRelativePath, editorValue, isDirty, projectPath])

  useEffect(() => {
    if (!activeRelativePath || !activeFile) {
      setHasExternalChange(false)
      return
    }

    let cancelled = false
    let inFlight = false

    const checkOnce = async () => {
      if (cancelled || inFlight) return
      inFlight = true
      try {
        const stat = await window.electronAPI.statProjectFile(projectPath, activeRelativePath)
        if (cancelled) return
        if (Math.abs(stat.mtimeMs - activeFile.mtimeMs) <= 0.001) return

        if (isDirty) {
          setHasExternalChange(true)
          return
        }

        setIsReloadingFromDisk(true)
        await openFile(activeRelativePath, true)
      } catch {
        // ignore transient stat/read errors during polling
      } finally {
        inFlight = false
        if (!cancelled) {
          setIsReloadingFromDisk(false)
        }
      }
    }

    const timer = window.setInterval(() => {
      void checkOnce()
    }, FILE_EXTERNAL_CHANGE_POLL_MS)
    void checkOnce()

    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [activeFile, activeRelativePath, isDirty, openFile, projectPath])

  const saveText = saveStatus === 'saving' ? 'Saving...' : saveStatus === 'saved' ? 'Saved' : 'Save'
  const saveIndicatorText = !activeRelativePath
    ? 'No file selected'
    : saveStatus === 'saving'
      ? 'Saving...'
      : saveStatus === 'saved'
        ? 'Saved'
        : isDirty
          ? 'Unsaved changes'
          : 'All changes saved'
  const saveIndicatorToneClass = saveStatus === 'error'
    ? 'text-[color:var(--color-destructive)]'
    : saveStatus === 'saving' || isDirty
      ? 'text-[color:var(--color-warning)]'
      : 'text-[color:var(--color-muted-foreground)]'

  return {
    activeFile,
    editorValue,
    setEditorValue,
    activeRelativePath,
    isReading,
    readError,
    saveStatus,
    saveError,
    hasExternalChange,
    setHasExternalChange,
    isReloadingFromDisk,
    discardUnsavedConfirm,
    resolveDiscardUnsavedConfirm,
    isDirty,
    openFile,
    handleSave,
    saveText,
    saveIndicatorText,
    saveIndicatorToneClass,
  }
}
