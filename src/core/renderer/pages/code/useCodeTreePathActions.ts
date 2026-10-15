import { useCallback, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import type { ProjectFileNodeKind } from '../../../shared/types'
import { toast } from '../../components/ui/toast'
import { useI18n } from '../../i18n'
import { resolveProcessUseWsl } from '../../lib/processEnvironmentResolution'
import { useAppStore } from '../../stores/appStore'
import { formatFileSize } from './code.helpers'
import { buildScriptCommand, resolveExecutableScript, type ExecutableScriptInfo } from './code.executable'
import { copyTextToClipboard } from './code.clipboard'
import { fileNameFromRelativePath } from './code.markdownShared'
import { joinProjectPath, normalizeRelativePathForCopy, removeRelativePathSlashes, resolveFileParentFolderPath, resolveTreeNodeFolderPath } from './code.pathActions'
import type { CodeTreeContextMenuPayload } from './CodeTreeContextMenu'
import type { FileSearchLineTarget } from './code.types'

type UseCodeTreePathActionsArgs = {
  isNarrowViewport: boolean
  openContentSearchMatch: (relativePath: string, lineNumber: number, column: number, endLine?: number) => Promise<void> | void
  openFile: (relativePath: string) => Promise<boolean> | void
  openExcludedEntry: (relativePath: string, nodeKind: ProjectFileNodeKind) => Promise<boolean> | void
  openFileWithTreeLocate: (relativePath: string) => Promise<boolean> | void
  projectId: string
  projectPath: string
  setActiveContentSearchLocation: (value: { relativePath: string; lineNumber: number; column: number }) => void
  setIsExplorerOpen: Dispatch<SetStateAction<boolean>>
  setIsQuickDrawerOpen: Dispatch<SetStateAction<boolean>>
}

type PendingScriptExecution = {
  channel: 'system' | 'embedded'
  relativePath: string
  nodeKind: ProjectFileNodeKind
}

export function useCodeTreePathActions({ isNarrowViewport, openContentSearchMatch, openFile, openExcludedEntry, openFileWithTreeLocate, projectId, projectPath, setActiveContentSearchLocation, setIsExplorerOpen, setIsQuickDrawerOpen }: UseCodeTreePathActionsArgs) {
  const { t } = useI18n()
  const collapseExplorerIfNeeded = useCallback(() => {
    if (isNarrowViewport) {
      setIsExplorerOpen(false)
    }
  }, [isNarrowViewport, setIsExplorerOpen])

  const handleSelectTreeFile = useCallback(
    (relativePath: string, lineTarget?: FileSearchLineTarget) => {
      if (lineTarget) {
        // 文件搜索查询携带行号（path:N / path:N-M）时复用内容搜索的跳转链路。
        void openContentSearchMatch(relativePath, lineTarget.startLine, 1, lineTarget.endLine)
      } else {
        void openFile(relativePath)
      }
      collapseExplorerIfNeeded()
    },
    [collapseExplorerIfNeeded, openContentSearchMatch, openFile],
  )

  const handleSelectExcluded = useCallback(
    (relativePath: string, nodeKind: ProjectFileNodeKind) => {
      void openExcludedEntry(relativePath, nodeKind)
      collapseExplorerIfNeeded()
    },
    [collapseExplorerIfNeeded, openExcludedEntry],
  )

  const handleOpenTreeNodeFolder = useCallback(
    async (relativePath: string, nodeKind: ProjectFileNodeKind) => {
      const folderPath = resolveTreeNodeFolderPath(projectPath, relativePath, nodeKind)
      const revealPath = nodeKind === 'file' ? joinProjectPath(projectPath, relativePath) : undefined
      await window.electronAPI.openFolder(folderPath, revealPath)
    },
    [projectPath],
  )

  const handleOpenTreeNodeTerminal = useCallback(
    async (relativePath: string, nodeKind: ProjectFileNodeKind) => {
      const folderPath = resolveTreeNodeFolderPath(projectPath, relativePath, nodeKind)
      await window.electronAPI.openPathTerminal(folderPath)
    },
    [projectPath],
  )

  const copyWithToast = useCallback(
    async (value: string) => {
      const ok = await copyTextToClipboard(value)
      if (ok) toast.success(t('codeFileTree.copiedToClipboard'))
      else toast.error(t('codeFileTree.copyFailed'))
      return ok
    },
    [t],
  )

  const handleCopyTreeNodeName = useCallback(
    (nodeName: string) => {
      void copyWithToast(nodeName)
    },
    [copyWithToast],
  )

  const handleCopyTreeNodeRelativePath = useCallback(
    (relativePath: string) => {
      void copyWithToast(normalizeRelativePathForCopy(relativePath))
    },
    [copyWithToast],
  )

  const handleCopyTreeNodeRelativePathWithoutSlashes = useCallback(
    (relativePath: string) => {
      void copyWithToast(removeRelativePathSlashes(relativePath))
    },
    [copyWithToast],
  )

  // #11-1：搜索结果 match 行复制「path:lineNumber」，供快速跳转引用。
  const handleCopyTreeNodePathWithLineNumber = useCallback(
    (relativePath: string, lineNumber: number) => {
      void copyWithToast(`${normalizeRelativePathForCopy(relativePath)}:${lineNumber}`)
    },
    [copyWithToast],
  )

  // 「复制文件」：把文件本身以 Windows 标准文件格式（CF_HDROP）写入系统剪贴板——
  // 粘贴到资源管理器 / 聊天窗口得到的是文件本身，不是文本内容。非 Windows 宿主由主进程抛错提示。
  const handleCopyTreeNodeToClipboard = useCallback(
    async (relativePath: string) => {
      // 加载中 toast（durationMs 0 = 不自动消失），完成后再替换为成功/失败，避免用户以为卡住。
      const pendingToastId = toast.info(t('codeFileTree.fileCopying', { name: fileNameFromRelativePath(relativePath) }), { durationMs: 0 })
      try {
        const result = await window.electronAPI.copyProjectFileToClipboard(projectPath, relativePath)
        toast.dismiss(pendingToastId)
        toast.success(t('codeFileTree.fileCopiedToClipboard', { name: result.name }), {
          description: formatFileSize(result.size),
        })
      } catch (error) {
        toast.dismiss(pendingToastId)
        const reason = error instanceof Error && error.message ? error.message : String(error)
        toast.error(t('codeFileTree.fileClipboardFailed', { reason }))
      }
    },
    [projectPath, t],
  )

  // 13.2：导出文件夹为 zip。产物落点为文件夹同级目录，成功后 toast 提供「查看」动作在资源管理器中高亮产物。
  const handleZipTreeNode = useCallback(
    async (relativePath: string, nodeName: string, zipNameOverride?: string) => {
      const zipName = (zipNameOverride ?? nodeName).trim()
      try {
        const result = await window.electronAPI.zipProjectFolder(projectPath, relativePath, zipName)
        const zipAbsolutePath = joinProjectPath(projectPath, result.relativePath)
        const folderAbsolutePath = resolveFileParentFolderPath(projectPath, relativePath)
        toast.success(t('codeFileTree.zipCreated', { name: fileNameFromRelativePath(result.relativePath) }), {
          actionLabel: t('codeFileTree.zipReveal'),
          onAction: () => {
            void window.electronAPI.openFolder(folderAbsolutePath, zipAbsolutePath)
          },
        })
      } catch (error) {
        const reason = error instanceof Error && error.message ? error.message : String(error)
        toast.error(t('codeFileTree.zipFailed', { reason }))
      }
    },
    [projectPath, t],
  )

  // 13.2：「复制 zip 到剪贴板」。项目内不落盘——主进程打包到系统临时目录后以文件格式写入剪贴板。
  // 大文件夹打包可能耗时数秒：点击后立即给「正在打包」反馈，完成后再报成功（附大小）。
  const zipClipboardBusyRef = useRef(false)
  const handleCopyTreeNodeZipToClipboard = useCallback(
    async (relativePath: string, nodeName: string) => {
      const zipName = nodeName.trim()
      if (zipClipboardBusyRef.current) return
      zipClipboardBusyRef.current = true
      // 加载中 toast（durationMs 0 = 不自动消失），打包耗时可能超过默认 3.2s，完成后再替换为结果。
      const pendingToastId = toast.info(t('codeFileTree.zipPacking', { name: zipName }), { durationMs: 0 })
      try {
        const result = await window.electronAPI.copyProjectFolderZipToClipboard(projectPath, relativePath, zipName)
        toast.dismiss(pendingToastId)
        toast.success(t('codeFileTree.zipCopiedToClipboard', { name: result.name }), {
          description: formatFileSize(result.size),
        })
      } catch (error) {
        toast.dismiss(pendingToastId)
        const reason = error instanceof Error && error.message ? error.message : String(error)
        toast.error(t('codeFileTree.zipClipboardFailed', { reason }))
      } finally {
        zipClipboardBusyRef.current = false
      }
    },
    [projectPath, t],
  )

  // 13.2：导出为 zip…（弹窗命名）。弹窗状态由本 hook 持有，弹窗 UI 由调用方（CodeWorkspacePanel）渲染。
  const [zipAsTarget, setZipAsTarget] = useState<{ relativePath: string; nodeName: string } | null>(null)
  const [isZipDialogBusy, setIsZipDialogBusy] = useState(false)

  const handleZipTreeNodeAs = useCallback((relativePath: string, nodeName: string) => {
    setZipAsTarget({ relativePath, nodeName })
  }, [])

  const confirmZipTreeNodeAs = useCallback(
    async (zipName: string) => {
      if (!zipAsTarget) return
      setIsZipDialogBusy(true)
      try {
        await handleZipTreeNode(zipAsTarget.relativePath, zipAsTarget.nodeName, zipName)
        setZipAsTarget(null)
      } finally {
        setIsZipDialogBusy(false)
      }
    },
    [handleZipTreeNode, zipAsTarget],
  )

  const closeZipAsDialog = useCallback(() => {
    if (isZipDialogBusy) return
    setZipAsTarget(null)
  }, [isZipDialogBusy])

  // ── 13.3 脚本执行 ─────────────────────────────────────────────
  // 安全红线：命令只由「映射表解释器 + 校验后的 relativePath」构成（buildScriptCommand），
  // 不引入任何用户自定义片段；仅显式点击触发；.bat/.cmd 先过二次确认。
  const resolveTreeNodeRunnableScript = useCallback(
    (relativePath: string, nodeKind: ProjectFileNodeKind): ExecutableScriptInfo | null => {
      const cwd = resolveTreeNodeFolderPath(projectPath, relativePath, nodeKind)
      const useWsl = resolveProcessUseWsl(cwd) ?? false
      return resolveExecutableScript(relativePath, useWsl)
    },
    [projectPath],
  )

  const allocateScriptProcessKey = useCallback(() => {
    const processes = useAppStore.getState().processes
    const prefix = `${projectId}::script::`
    const used = new Set<number>()
    for (const key of Object.keys(processes)) {
      if (!key.startsWith(prefix)) continue
      const n = Number.parseInt(key.slice(prefix.length), 10)
      if (Number.isInteger(n) && n >= 0) used.add(n)
    }
    let n = 0
    while (used.has(n)) n += 1
    return `${prefix}${n}`
  }, [projectId])

  const executeScript = useCallback(
    (channel: 'system' | 'embedded', relativePath: string, nodeKind: ProjectFileNodeKind, info: ExecutableScriptInfo) => {
      // cwd 是文件父目录（resolveTreeNodeFolderPath），命令参数必须只用文件名——
      // 用完整 relativePath 会拼出 <parent>/<relativePath> 双路径（scripts\scripts\…）。
      const cwd = resolveTreeNodeFolderPath(projectPath, relativePath, nodeKind)
      const command = buildScriptCommand(info, fileNameFromRelativePath(relativePath))
      if (channel === 'system') {
        void window.electronAPI.openPathTerminal(cwd, command).then((opened) => {
          if (!opened) toast.error(t('codeFileTree.terminalLaunchFailed'))
        })
        return
      }
      // 内置通道：显式传 'silent' 启动模式，避免 isPrimaryProjectRun 命中时被劫持到外部终端。
      const processKey = allocateScriptProcessKey()
      const startProject = useAppStore.getState().startProject
      const useWsl = resolveProcessUseWsl(cwd) ?? false
      void startProject(projectId, command, processKey, useWsl, cwd, 'silent').then((ok) => {
        if (!ok) {
          toast.error(t('codeFileTree.terminalLaunchFailed'))
          return
        }
        // 挂进浮动终端面板：脚本输出直接显示给用户，不再让用户去 设置 → 启动日志 找。
        useAppStore.getState().attachFloatingTerminal({ processKey, projectId, cwd, useWsl, title: fileNameFromRelativePath(relativePath) })
      })
    },
    [allocateScriptProcessKey, projectId, projectPath, t],
  )

  const [pendingScriptConfirm, setPendingScriptConfirm] = useState<PendingScriptExecution | null>(null)
  const [isScriptConfirmBusy, setIsScriptConfirmBusy] = useState(false)

  const requestExecuteScript = useCallback(
    (channel: 'system' | 'embedded', relativePath: string, nodeKind: ProjectFileNodeKind) => {
      const info = resolveTreeNodeRunnableScript(relativePath, nodeKind)
      if (!info) return
      if (info.runtime === 'cmd') {
        setPendingScriptConfirm({ channel, relativePath, nodeKind })
        return
      }
      executeScript(channel, relativePath, nodeKind, info)
    },
    [executeScript, resolveTreeNodeRunnableScript],
  )

  const handleExecuteScriptInSystemTerminal = useCallback(
    (relativePath: string, nodeKind: ProjectFileNodeKind) => {
      requestExecuteScript('system', relativePath, nodeKind)
    },
    [requestExecuteScript],
  )

  const handleExecuteScriptInEmbeddedTerminal = useCallback(
    (relativePath: string, nodeKind: ProjectFileNodeKind) => {
      requestExecuteScript('embedded', relativePath, nodeKind)
    },
    [requestExecuteScript],
  )

  const confirmPendingScript = useCallback(async () => {
    if (!pendingScriptConfirm) return
    setIsScriptConfirmBusy(true)
    try {
      const info = resolveTreeNodeRunnableScript(pendingScriptConfirm.relativePath, pendingScriptConfirm.nodeKind)
      if (info) executeScript(pendingScriptConfirm.channel, pendingScriptConfirm.relativePath, pendingScriptConfirm.nodeKind, info)
      setPendingScriptConfirm(null)
    } finally {
      setIsScriptConfirmBusy(false)
    }
  }, [executeScript, pendingScriptConfirm, resolveTreeNodeRunnableScript])

  const closePendingScriptConfirm = useCallback(() => {
    if (isScriptConfirmBusy) return
    setPendingScriptConfirm(null)
  }, [isScriptConfirmBusy])

  // ── 13.5 文件夹内按名搜索 ─────────────────────────────────────
  const [folderSearchTarget, setFolderSearchTarget] = useState<CodeTreeContextMenuPayload | null>(null)

  const handleFindTreeNodeFilesByName = useCallback((payload: CodeTreeContextMenuPayload) => {
    setFolderSearchTarget(payload)
  }, [])

  const closeFolderFileSearch = useCallback(() => {
    setFolderSearchTarget(null)
  }, [])

  const handleFolderSearchContextMenu = useCallback((payload: CodeTreeContextMenuPayload) => {
    setFolderSearchContextMenuPayload(payload)
  }, [])

  // 搜索结果右键菜单独立于弹层 state：菜单关闭只还原菜单 state，不关闭弹层。
  const [folderSearchContextMenuPayload, setFolderSearchContextMenuPayload] = useState<CodeTreeContextMenuPayload | null>(null)
  const closeFolderSearchContextMenu = useCallback(() => {
    setFolderSearchContextMenuPayload(null)
  }, [])

  const openFileFromQuickDrawer = useCallback(
    (relativePath: string) => {
      void openFileWithTreeLocate(relativePath)
      collapseExplorerIfNeeded()
      setIsQuickDrawerOpen(false)
    },
    [collapseExplorerIfNeeded, openFileWithTreeLocate, setIsQuickDrawerOpen],
  )

  const handleOpenContentSearchResult = useCallback(
    (relativePath: string, lineNumber: number, column: number) => {
      void openContentSearchMatch(relativePath, lineNumber, column)
      setActiveContentSearchLocation({ relativePath, lineNumber, column })
      collapseExplorerIfNeeded()
    },
    [collapseExplorerIfNeeded, openContentSearchMatch, setActiveContentSearchLocation],
  )

  const handleOpenSmartEmptyFile = useCallback(
    (relativePath: string) => {
      void openFileWithTreeLocate(relativePath)
      collapseExplorerIfNeeded()
    },
    [collapseExplorerIfNeeded, openFileWithTreeLocate],
  )

  return {
    closeFolderFileSearch,
    closeFolderSearchContextMenu,
    closePendingScriptConfirm,
    closeZipAsDialog,
    confirmPendingScript,
    confirmZipTreeNodeAs,
    handleCopyTreeNodeToClipboard,
    handleCopyTreeNodeName,
    handleCopyTreeNodeRelativePath,
    handleCopyTreeNodeRelativePathWithoutSlashes,
    handleCopyTreeNodePathWithLineNumber,
    handleCopyTreeNodeZipToClipboard,
    handleExecuteScriptInEmbeddedTerminal,
    handleExecuteScriptInSystemTerminal,
    handleFindTreeNodeFilesByName,
    handleFolderSearchContextMenu,
    handleOpenContentSearchResult,
    handleOpenSmartEmptyFile,
    handleOpenTreeNodeFolder,
    handleOpenTreeNodeTerminal,
    handleSelectExcluded,
    handleSelectTreeFile,
    handleZipTreeNode,
    handleZipTreeNodeAs,
    folderSearchContextMenuPayload,
    folderSearchTarget,
    isScriptConfirmBusy,
    isZipDialogBusy,
    openFileFromQuickDrawer,
    pendingScriptConfirm,
    resolveTreeNodeRunnableScript,
    zipAsTarget,
  }
}
