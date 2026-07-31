import { type SetStateAction, useCallback, useEffect, useRef, useState } from 'react'
import type { ProjectFileReadResult } from '../../../shared/types'
import { translateCurrent } from '../../i18n'
import { useAppStore } from '../../stores/appStore'
import type { SaveStatus } from './code.types'
import { markMarkdownPreviewPerformance } from './markdownPreviewPerformance'

const SAVE_STATUS_RESET_DELAY_MS = 1600
const FILE_EXTERNAL_CHANGE_POLL_MS = 1200
const DIRTY_CHECK_DEBOUNCE_MS = 180
const MAX_FILE_NAVIGATION_HISTORY = 100

type ProjectFileNavigationHistory = {
  entries: string[]
  index: number
}

const fileNavigationHistoryByProjectId = new Map<string, ProjectFileNavigationHistory>()

function recordFileNavigation(projectId: string, relativePath: string): void {
  const normalizedPath = relativePath.trim()
  if (!normalizedPath) return
  const current = fileNavigationHistoryByProjectId.get(projectId)
  if (!current) {
    fileNavigationHistoryByProjectId.set(projectId, { entries: [normalizedPath], index: 0 })
    return
  }
  if (current.entries[current.index] === normalizedPath) return

  const entries = [...current.entries.slice(0, current.index + 1), normalizedPath].slice(-MAX_FILE_NAVIGATION_HISTORY)
  fileNavigationHistoryByProjectId.set(projectId, { entries, index: entries.length - 1 })
}

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

type ActiveCodeFile = Omit<ProjectFileReadResult, 'content' | 'encoding'>

function toActiveCodeFile(result: ProjectFileReadResult): ActiveCodeFile {
  return {
    relativePath: result.relativePath,
    size: result.size,
    mtimeMs: result.mtimeMs,
    language: result.language,
  }
}

function hashTextContent(value: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

export function useCodeFileState({ projectId, projectPath, persistedLastCodeFile, onBeforeOpenFile, onDidOpenFile }: UseCodeFileStateOptions) {
  const setProjectLastCodeFile = useAppStore((s) => s.setProjectLastCodeFile)
  const [activeFile, setActiveFile] = useState<ActiveCodeFile | null>(null)
  const [editorValue, setEditorValueState] = useState('')
  const [activeRelativePath, setActiveRelativePath] = useState<string | null>(null)
  const [isReading, setIsReading] = useState(false)
  const [readError, setReadError] = useState<string | null>(null)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const [saveError, setSaveError] = useState<string | null>(null)
  const [hasExternalChange, setHasExternalChange] = useState(false)
  const [isReloadingFromDisk, setIsReloadingFromDisk] = useState(false)
  const [discardUnsavedConfirm, setDiscardUnsavedConfirm] = useState<DiscardUnsavedConfirmState>(null)
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  const [savedContentFingerprint, setSavedContentFingerprint] = useState(0)
  const [savedContentLength, setSavedContentLength] = useState(0)
  const discardUnsavedResolverRef = useRef<((proceed: boolean) => void) | null>(null)
  const openRequestSeqRef = useRef(0)
  const mountedRef = useRef(true)

  const isDirty = hasUnsavedChanges

  const setEditorValue = useCallback((value: SetStateAction<string>) => {
    setHasUnsavedChanges(true)
    setEditorValueState(value)
  }, [])

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
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      openRequestSeqRef.current += 1
      const resolve = discardUnsavedResolverRef.current
      discardUnsavedResolverRef.current = null
      resolve?.(false)
    }
  }, [])

  const openFile = useCallback(
    async (relativePath: string, forceReload = false, navigationHistoryIndex?: number): Promise<boolean> => {
      if (activeRelativePath === relativePath && !forceReload) return true
      if (isDirty && activeRelativePath && activeRelativePath !== relativePath) {
        const proceed = await requestDiscardUnsavedConfirm(relativePath, forceReload)
        if (!proceed) return false
      }

      onBeforeOpenFile?.()
      const requestSeq = openRequestSeqRef.current + 1
      openRequestSeqRef.current = requestSeq

      setIsReading(true)
      setReadError(null)
      setSaveError(null)
      setSaveStatus('idle')
      markMarkdownPreviewPerformance('file.read.start')

      try {
        const result = await window.electronAPI.readProjectFile(projectPath, relativePath)
        if (!mountedRef.current || openRequestSeqRef.current !== requestSeq) return false
        const contentFingerprint = hashTextContent(result.content)
        setActiveFile(toActiveCodeFile(result))
        setActiveRelativePath(result.relativePath)
        setEditorValueState(result.content)
        setSavedContentFingerprint(contentFingerprint)
        setSavedContentLength(result.content.length)
        setHasUnsavedChanges(false)
        setHasExternalChange(false)
        onDidOpenFile?.(result)
        void setProjectLastCodeFile(projectId, result.relativePath)
        if (navigationHistoryIndex === undefined) {
          recordFileNavigation(projectId, result.relativePath)
        } else {
          const history = fileNavigationHistoryByProjectId.get(projectId)
          if (history?.entries[navigationHistoryIndex] === result.relativePath) {
            history.index = navigationHistoryIndex
          }
        }
        return true
      } catch (error) {
        if (!mountedRef.current || openRequestSeqRef.current !== requestSeq) return false
        setReadError(error instanceof Error ? error.message : String(error))
        if (forceReload || persistedLastCodeFile === relativePath) {
          void setProjectLastCodeFile(projectId, undefined)
        }
        return false
      } finally {
        markMarkdownPreviewPerformance('file.read.end')
        if (mountedRef.current && openRequestSeqRef.current === requestSeq) {
          setIsReading(false)
        }
      }
    },
    [activeRelativePath, isDirty, onBeforeOpenFile, onDidOpenFile, persistedLastCodeFile, projectId, projectPath, requestDiscardUnsavedConfirm, setProjectLastCodeFile],
  )

  const navigateFileHistory = useCallback(
    async (direction: -1 | 1): Promise<boolean> => {
      const history = fileNavigationHistoryByProjectId.get(projectId)
      if (!history) return false
      const nextIndex = history.index + direction
      const nextPath = history.entries[nextIndex]
      if (!nextPath) return false
      return openFile(nextPath, false, nextIndex)
    },
    [openFile, projectId],
  )

  const handleSave = useCallback(async () => {
    if (!activeRelativePath || !activeFile) return
    if (!isDirty) return

    setSaveStatus('saving')
    setSaveError(null)

    try {
      const result = await window.electronAPI.writeProjectFile(projectPath, activeRelativePath, editorValue, activeFile.mtimeMs)
      const contentFingerprint = hashTextContent(editorValue)
      setActiveFile((prev) =>
        prev
          ? {
              ...prev,
              size: result.size,
              mtimeMs: result.mtimeMs,
            }
          : prev,
      )
      setSavedContentFingerprint(contentFingerprint)
      setSavedContentLength(editorValue.length)
      setHasUnsavedChanges(false)
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
    if (!hasUnsavedChanges) return
    const timer = window.setTimeout(() => {
      const matchesSavedSnapshot = editorValue.length === savedContentLength && hashTextContent(editorValue) === savedContentFingerprint
      if (matchesSavedSnapshot) {
        setHasUnsavedChanges(false)
      }
    }, DIRTY_CHECK_DEBOUNCE_MS)

    return () => {
      window.clearTimeout(timer)
    }
  }, [editorValue, hasUnsavedChanges, savedContentFingerprint, savedContentLength])

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

  const saveText = saveStatus === 'saving' ? translateCurrent('common.saving') : saveStatus === 'saved' ? translateCurrent('codeWorkspace.saved') : translateCurrent('codeWorkspace.save')
  const saveIndicatorText = !activeRelativePath
    ? translateCurrent('codeWorkspace.noFileSelected')
    : saveStatus === 'saving'
      ? translateCurrent('common.saving')
      : saveStatus === 'saved'
        ? translateCurrent('codeWorkspace.saved')
        : isDirty
          ? translateCurrent('codeWorkspace.unsavedChanges')
          : translateCurrent('codeWorkspace.allChangesSaved')
  const saveIndicatorToneClass = saveStatus === 'error' ? 'text-[color:var(--color-destructive)]' : saveStatus === 'saving' || isDirty ? 'text-[color:var(--color-warning)]' : 'text-[color:var(--color-muted-foreground)]'

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
    navigateFileHistory,
    handleSave,
    saveText,
    saveIndicatorText,
    saveIndicatorToneClass,
  }
}
