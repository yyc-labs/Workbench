import { type SetStateAction, useCallback, useEffect, useRef, useState } from 'react'
import type { ProjectFileNodeKind, ProjectFilePreviewKind, ProjectFileReadResult } from '../../../shared/types'
import { translateCurrent } from '../../i18n'
import { toast } from '../../components/ui/toast'
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

type ActiveCodeFile = Omit<ProjectFileReadResult, 'content' | 'encoding'> & {
  kind: ProjectFilePreviewKind
  /** 仅 kind==='excluded' 时有效：记录被排除条目是目录还是文件，供解释视图展示。 */
  excludedNodeKind?: ProjectFileNodeKind
}

function toActiveCodeFile(result: ProjectFileReadResult): ActiveCodeFile {
  return {
    relativePath: result.relativePath,
    size: result.size,
    mtimeMs: result.mtimeMs,
    language: result.language,
    kind: result.kind,
    mimeType: result.mimeType,
    unsupportedReason: result.unsupportedReason,
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
  const [binaryDataUrl, setBinaryDataUrl] = useState<string | null>(null)
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

        const isBinaryKind = result.kind === 'image' || result.kind === 'pdf' || result.kind === 'video' || result.kind === 'audio'
        const isUnsupportedKind = result.kind === 'unsupported'

        setActiveFile(toActiveCodeFile(result))
        setActiveRelativePath(result.relativePath)

        if (isBinaryKind) {
          setBinaryDataUrl(`data:${result.mimeType ?? ''};base64,${result.content}`)
          setEditorValueState('')
          setSavedContentFingerprint(0)
          setSavedContentLength(0)
        } else if (isUnsupportedKind) {
          setBinaryDataUrl(null)
          setEditorValueState('')
          setSavedContentFingerprint(0)
          setSavedContentLength(0)
        } else {
          setBinaryDataUrl(null)
          setEditorValueState(result.content)
          const contentFingerprint = hashTextContent(result.content)
          setSavedContentFingerprint(contentFingerprint)
          setSavedContentLength(result.content.length)
        }

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

  const openExcludedEntry = useCallback(
    async (relativePath: string, nodeKind: ProjectFileNodeKind): Promise<boolean> => {
      const normalizedPath = relativePath.trim()
      if (!normalizedPath) return false
      if (activeRelativePath === normalizedPath) return true
      if (isDirty && activeRelativePath) {
        const proceed = await requestDiscardUnsavedConfirm(normalizedPath, false)
        if (!proceed) return false
      }

      onBeforeOpenFile?.()
      const requestSeq = openRequestSeqRef.current + 1
      openRequestSeqRef.current = requestSeq

      setActiveFile({
        relativePath: normalizedPath,
        size: 0,
        mtimeMs: 0,
        language: '',
        kind: 'excluded',
        excludedNodeKind: nodeKind,
        mimeType: undefined,
      })
      setActiveRelativePath(normalizedPath)
      setBinaryDataUrl(null)
      setEditorValueState('')
      setSavedContentFingerprint(0)
      setSavedContentLength(0)
      setHasUnsavedChanges(false)
      setHasExternalChange(false)
      setReadError(null)
      setSaveStatus('idle')
      setSaveError(null)
      return true
    },
    [activeRelativePath, isDirty, onBeforeOpenFile, requestDiscardUnsavedConfirm],
  )

  // 读取 / 保存错误与外部变更重载改为通知提醒，仅在状态出现或变化时弹一次。
  const previousReadErrorRef = useRef<string | null>(null)
  const previousSaveErrorRef = useRef<string | null>(null)
  const previousReloadingFromDiskRef = useRef(false)

  useEffect(() => {
    if (readError && previousReadErrorRef.current !== readError) {
      toast.error(readError)
    }
    previousReadErrorRef.current = readError
  }, [readError])

  useEffect(() => {
    if (saveError && previousSaveErrorRef.current !== saveError) {
      toast.error(saveError)
    }
    previousSaveErrorRef.current = saveError
  }, [saveError])

  useEffect(() => {
    if (isReloadingFromDisk && !previousReloadingFromDiskRef.current) {
      toast.info(translateCurrent('codeWorkspace.reloadingChangedFile'))
    }
    previousReloadingFromDiskRef.current = isReloadingFromDisk
  }, [isReloadingFromDisk])

  // 外部变更且存在未保存修改：以不自动消失的通知提供「保留修改 / 重新加载」两个操作，替代原 banner。
  const externalChangeToastIdRef = useRef<number | null>(null)
  // 已针对某个磁盘 mtime 弹过外部变更通知；通知被关闭后同一 mtime 不再重复弹，避免轮询轰炸。
  const lastNotifiedExternalMtimeRef = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (externalChangeToastIdRef.current != null) {
        toast.dismiss(externalChangeToastIdRef.current)
        externalChangeToastIdRef.current = null
      }
    }
  }, [])

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
    if (activeFile.kind !== 'text' && activeFile.kind !== 'markdown') return
    if (!isDirty) return

    setSaveStatus('saving')
    setSaveError(null)

    try {
      // 外部已变更（hasExternalChange）时用户保存是明确要覆盖磁盘版本，跳过 mtime 冲突校验。
      const expectedMtimeMs = hasExternalChange ? undefined : activeFile.mtimeMs
      const result = await window.electronAPI.writeProjectFile(projectPath, activeRelativePath, editorValue, expectedMtimeMs)
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
      const message = error instanceof Error ? error.message : String(error)
      setSaveStatus('error')
      setSaveError(message)
      // 通知被关闭后保存遇到 mtime 冲突：重新激活「保留 / 重载」入口，避免用户被堵死。
      if (message.includes('File has changed on disk')) {
        lastNotifiedExternalMtimeRef.current = null
        setHasExternalChange(true)
      }
    }
  }, [activeFile, activeRelativePath, editorValue, hasExternalChange, isDirty, projectPath])

  // 通知 action 使用 ref 调用最新 handleSave，避免通知显示期间继续编辑导致保存旧内容。
  const latestHandleSaveRef = useRef(handleSave)
  useEffect(() => {
    latestHandleSaveRef.current = handleSave
  }, [handleSave])

  useEffect(() => {
    if (hasExternalChange && activeRelativePath) {
      if (externalChangeToastIdRef.current != null) return
      externalChangeToastIdRef.current = toast.warning(translateCurrent('codeWorkspace.externalChange'), {
        durationMs: 0,
        // 该通知需要用户二选一，不允许通过 × 关闭绕过决策。
        closable: false,
        onDismiss: () => {
          externalChangeToastIdRef.current = null
          // 通知仅能通过「保留 / 重载」动作关闭；关闭后同步清理外部变更状态，后续保存恢复 mtime 冲突保护。
          setHasExternalChange(false)
        },
        actions: [
          {
            // 保留修改 = 把当前编辑内容写回磁盘，避免被外部版本覆盖。
            label: translateCurrent('codeWorkspace.keepMyChanges'),
            onAction: () => {
              void latestHandleSaveRef.current()
            },
          },
          {
            label: translateCurrent('codeWorkspace.reloadFromDisk'),
            variant: 'primary',
            onAction: () => {
              void openFile(activeRelativePath, true)
            },
          },
        ],
      })
      return
    }

    if (externalChangeToastIdRef.current != null) {
      toast.dismiss(externalChangeToastIdRef.current)
      externalChangeToastIdRef.current = null
    }
  }, [activeRelativePath, hasExternalChange, openFile])

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
    // 被排除条目解释视图没有真实文件内容，不参与外部变更轮询。
    if (activeFile.kind === 'excluded') {
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
        if (Math.abs(stat.mtimeMs - activeFile.mtimeMs) <= 0.001) {
          lastNotifiedExternalMtimeRef.current = null
          return
        }

        if (isDirty) {
          // 同一磁盘 mtime 只提醒一次；通知被关闭后不再重复弹，直到用户保存/重载或文件再次变化。
          if (lastNotifiedExternalMtimeRef.current !== stat.mtimeMs) {
            lastNotifiedExternalMtimeRef.current = stat.mtimeMs
            setHasExternalChange(true)
          }
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
    activeKind: activeFile?.kind ?? 'text',
    binaryDataUrl,
    editorValue,
    setEditorValue,
    activeRelativePath,
    isReading,
    readError,
    saveStatus,
    saveError,
    isReloadingFromDisk,
    discardUnsavedConfirm,
    resolveDiscardUnsavedConfirm,
    isDirty,
    openFile,
    openExcludedEntry,
    navigateFileHistory,
    handleSave,
    saveText,
    saveIndicatorText,
    saveIndicatorToneClass,
  }
}
