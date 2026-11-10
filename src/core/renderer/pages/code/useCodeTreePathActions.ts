import { type Dispatch, type SetStateAction, useCallback, useRef, useState } from 'react'
import type { ProjectFileNodeKind } from '../../../shared/types'
import { toast } from '../../components/ui/toast'
import { useI18n } from '../../i18n'
import { buildScriptCommand, type ExecutableScriptInfo, resolveExecutableScript } from '../../lib/executableScripts'
import { resolveProcessUseWsl } from '../../lib/processEnvironmentResolution'
import { fileNameFromRelativePath, joinProjectPath } from '../../lib/projectPaths'
import { createAppStoreTerminalDeps, runCommandInEmbeddedShell, runCommandInSystemTerminal } from '../../lib/runActions/terminalExecution'
import { useAppStore } from '../../stores/appStore'
import type { CodeTreeContextMenuPayload } from './CodeTreeContextMenu'
import { copyTextToClipboard } from './code.clipboard'
import { formatFileSize } from './code.helpers'
import { defaultSelectedZipName, normalizeRelativePathForCopy, projectNameFromPath, removeRelativePathSlashes, resolveFileParentFolderPath, resolveTreeNodeFolderPath } from './code.pathActions'
import { type CodeTreeContextMenuSnapshot, dedupeByNormalizedPath, joinLines, pruneEntriesForArchive, toAbsolutePathItems, toNameItems } from './code.treeSelection'
import type { FileSearchLineTarget } from './code.types'

type UseCodeTreePathActionsArgs = {
  isNarrowViewport: boolean
  openContentSearchMatch: (relativePath: string, lineNumber: number, column: number, endLine?: number) => Promise<void> | void
  openFile: (relativePath: string) => Promise<boolean> | void
  openExcludedEntry: (relativePath: string, nodeKind: ProjectFileNodeKind) => Promise<boolean> | void
  openFileWithTreeLocate: (relativePath: string) => Promise<boolean> | void
  projectId: string
  projectPath: string
  /** 当前选择上下文标识，用于批量复制前的快照校验（§5.3）。 */
  selectionScopeKey: string
  setActiveContentSearchLocation: (value: { relativePath: string; lineNumber: number; column: number }) => void
  setIsExplorerOpen: Dispatch<SetStateAction<boolean>>
}

type PendingScriptExecution = {
  channel: 'system' | 'embedded'
  relativePath: string
  nodeKind: ProjectFileNodeKind
}

export function useCodeTreePathActions({ isNarrowViewport, openContentSearchMatch, openFile, openExcludedEntry, openFileWithTreeLocate, projectId, projectPath, selectionScopeKey, setActiveContentSearchLocation, setIsExplorerOpen }: UseCodeTreePathActionsArgs) {
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

  // ── 16 批量复制 ──────────────────────────────────────
  // 快照已由 CodeFileTree 按当前 nodes 复核（过滤失效 id）；这里只做项目/scope 校验，
  // 然后按固定四步装配文本：按路径去重 → 保序 → 按类型转换 → 单换行拼接，只复制一次。
  const copySelectedItems = useCallback(
    async (snapshot: CodeTreeContextMenuSnapshot, mode: 'relative' | 'absolute' | 'name') => {
      if (snapshot.projectPath !== projectPath || snapshot.scopeKey !== selectionScopeKey || snapshot.selectedItems.length === 0) {
        // 防御：正常流程不可达（复核 + scope 变化即关菜单）。
        toast.error(t('codeFileTree.selectionExpired'))
        return
      }
      const deduped = dedupeByNormalizedPath(snapshot.selectedItems)
      const converted = mode === 'relative' ? deduped.map((item) => ({ relativePath: normalizeRelativePathForCopy(item.relativePath) })) : mode === 'absolute' ? toAbsolutePathItems(deduped, projectPath) : toNameItems(deduped)
      const text = joinLines(converted)
      const ok = await copyTextToClipboard(text)
      if (!ok) {
        toast.error(t('codeFileTree.copyFailed'))
        return
      }
      if (mode === 'name') {
        toast.success(t('codeFileTree.copiedNamesCount', { count: converted.length }))
      } else {
        toast.success(t('codeFileTree.copiedPathsCount', { count: converted.length }))
      }
    },
    [projectPath, selectionScopeKey, t],
  )

  const handleCopySelectedRelativePaths = useCallback(
    (snapshot: CodeTreeContextMenuSnapshot) => {
      void copySelectedItems(snapshot, 'relative')
    },
    [copySelectedItems],
  )

  const handleCopySelectedAbsolutePaths = useCallback(
    (snapshot: CodeTreeContextMenuSnapshot) => {
      void copySelectedItems(snapshot, 'absolute')
    },
    [copySelectedItems],
  )

  const handleCopySelectedNames = useCallback(
    (snapshot: CodeTreeContextMenuSnapshot) => {
      void copySelectedItems(snapshot, 'name')
    },
    [copySelectedItems],
  )

  // ── 17 批量复制文件 / 批量 zip 到剪贴板 ─────────────────────
  // 两个动作共用同一裁剪：复核后快照 → pruneEntriesForArchive（目录吸收后代，防重复）→ IPC → toast。
  // zip 剪贴板打包进行中标志：单选与批量两个入口共用，任一打包期间另一个点击直接忽略。
  const zipClipboardBusyRef = useRef(false)
  const toArchiveEntries = useCallback(
    (snapshot: CodeTreeContextMenuSnapshot) => {
      if (snapshot.projectPath !== projectPath || snapshot.scopeKey !== selectionScopeKey) return null
      const entries = pruneEntriesForArchive(snapshot.selectedItems).map((item) => ({ relativePath: item.relativePath, kind: item.kind }))
      return entries.length > 0 ? entries : null
    },
    [projectPath, selectionScopeKey],
  )

  // 「复制文件（N 个）」：全 file 快照一次性写入剪贴板 FileDropList；含目录时菜单不渲染该选项（需求②），
  // 主进程仍对目录条目兜底拒绝。非 Windows 宿主由主进程抛错提示。
  const handleCopySelectedFiles = useCallback(
    async (snapshot: CodeTreeContextMenuSnapshot) => {
      const entries = toArchiveEntries(snapshot)
      if (!entries) {
        toast.error(t('codeFileTree.selectionExpired'))
        return
      }
      try {
        const result = await window.electronAPI.copyProjectEntriesToClipboard(projectPath, entries)
        toast.success(t('codeFileTree.copiedFilesCount', { count: result.count }))
      } catch (error) {
        const reason = error instanceof Error && error.message ? error.message : String(error)
        toast.error(t('codeFileTree.fileClipboardFailed', { reason }))
      }
    },
    [projectPath, t, toArchiveEntries],
  )

  // 「复制 zip 到剪贴板（N 项）」：混合打包不落项目盘，zip 名由主进程按 {项目名}-selected.zip 生成。
  // 打包可能耗时数秒：点击后立即给「打包中」常驻反馈，完成后再报成功（附大小，复用 F8 模式）。
  // 与单选「复制 zip 到剪贴板」共用同一 busy 标志：任一打包进行中时另一个点击直接忽略。
  const handleCopySelectedZipToClipboard = useCallback(
    async (snapshot: CodeTreeContextMenuSnapshot, zipName?: string) => {
      const entries = toArchiveEntries(snapshot)
      if (!entries) {
        toast.error(t('codeFileTree.selectionExpired'))
        return
      }
      if (zipClipboardBusyRef.current) return
      zipClipboardBusyRef.current = true
      const projectName = projectNameFromPath(projectPath) || defaultSelectedZipName(projectPath)
      const pendingToastId = toast.info(t('codeFileTree.zipPacking', { name: projectName }), { durationMs: 0 })
      try {
        // 二级命名面板回车提交的名字；留空时主进程按 {项目名}-selected.zip 默认生成。
        const result = await window.electronAPI.copyProjectEntriesZipToClipboard(projectPath, entries, zipName?.trim() ? zipName.trim() : undefined)
        toast.dismiss(pendingToastId)
        toast.success(t('codeFileTree.selectedZipCopiedToClipboard', { count: entries.length, name: result.name }), {
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
    [projectPath, t, toArchiveEntries],
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
  // 大文件夹打包可能耗时数秒：先给旋转加载 toast（常驻不自动消失），完成后再替换为成功/失败，避免用户以为卡住。
  const handleZipTreeNode = useCallback(
    async (relativePath: string, nodeName: string, zipNameOverride?: string) => {
      // 命名面板清空回车时 zipNameOverride 为空串：回退文件夹名（与旧弹窗默认值一致）。
      const zipName = (zipNameOverride || nodeName).trim()
      const pendingToastId = toast.loading(t('codeFileTree.zipPacking', { name: zipName }))
      try {
        const result = await window.electronAPI.zipProjectFolder(projectPath, relativePath, zipName)
        toast.dismiss(pendingToastId)
        const zipAbsolutePath = joinProjectPath(projectPath, result.relativePath)
        const folderAbsolutePath = resolveFileParentFolderPath(projectPath, relativePath)
        toast.success(t('codeFileTree.zipCreated', { name: fileNameFromRelativePath(result.relativePath) }), {
          actionLabel: t('codeFileTree.zipReveal'),
          onAction: () => {
            void window.electronAPI.openFolder(folderAbsolutePath, zipAbsolutePath)
          },
        })
      } catch (error) {
        toast.dismiss(pendingToastId)
        const reason = error instanceof Error && error.message ? error.message : String(error)
        toast.error(t('codeFileTree.zipFailed', { reason }))
      }
    },
    [projectPath, t],
  )

  // 13.2：「复制 zip 到剪贴板」。项目内不落盘——主进程打包到系统临时目录后以文件格式写入剪贴板。
  // 大文件夹打包可能耗时数秒：点击后立即给「正在打包」反馈，完成后再报成功（附大小）。
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

  const executeScript = useCallback(
    async (channel: 'system' | 'embedded', relativePath: string, nodeKind: ProjectFileNodeKind, info: ExecutableScriptInfo) => {
      // cwd 是文件父目录（resolveTreeNodeFolderPath），命令参数必须只用文件名——
      // 用完整 relativePath 会拼出 <parent>/<relativePath> 双路径（scripts\\scripts\\…）。
      const cwd = resolveTreeNodeFolderPath(projectPath, relativePath, nodeKind)
      const command = buildScriptCommand(info, fileNameFromRelativePath(relativePath))
      // 启动/分配/发送链路统一走 lib/runActions 共享模块（19 号计划 §3.5），编辑器运行入口复用同一实现。
      const deps = createAppStoreTerminalDeps(useAppStore, {
        onProcessOutput: window.electronAPI.onProcessOutput,
        openPathTerminal: (cwdPath, terminalCommand) => window.electronAPI.openPathTerminal(cwdPath, terminalCommand),
      })
      if (channel === 'system') {
        const opened = await runCommandInSystemTerminal(deps, { cwd, command })
        if (!opened) toast.error(t('codeFileTree.terminalLaunchFailed'))
        return
      }
      // 内置通道：启动交互 shell，再把命令作为键盘输入发送——脚本结束后 shell 回到提示符，
      // 终端保持打开供查看输出（直接 spawn 一次性命令会在退出时带着终端一起消失）。
      const useWsl = resolveProcessUseWsl(cwd) ?? false
      const ok = await runCommandInEmbeddedShell(deps, {
        projectId,
        cwd,
        command,
        // 脚本输出归属集合面板：初始 title 用脚本文件名（D6），并唤起面板聚焦该终端（D5 显式终端动作）。
        title: fileNameFromRelativePath(relativePath),
        useWsl,
      })
      if (!ok) toast.error(t('codeFileTree.terminalLaunchFailed'))
    },
    [projectId, projectPath, t],
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
      void executeScript(channel, relativePath, nodeKind, info)
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
      if (info) void executeScript(pendingScriptConfirm.channel, pendingScriptConfirm.relativePath, pendingScriptConfirm.nodeKind, info)
      setPendingScriptConfirm(null)
    } finally {
      setIsScriptConfirmBusy(false)
    }
  }, [executeScript, pendingScriptConfirm, resolveTreeNodeRunnableScript])

  const closePendingScriptConfirm = useCallback(() => {
    if (isScriptConfirmBusy) return
    setPendingScriptConfirm(null)
  }, [isScriptConfirmBusy])

  // ── 13.5 文件夹内按名搜索 / 17 搜索文件夹 ─────────────────────
  // 同一弹层实例按 searchKind 分流：file = 按名称查找文件，directory = 搜索文件夹。
  const [folderSearchTarget, setFolderSearchTarget] = useState<{ payload: CodeTreeContextMenuPayload; searchKind: 'file' | 'directory' } | null>(null)

  const handleFindTreeNodeFilesByName = useCallback((payload: CodeTreeContextMenuPayload) => {
    setFolderSearchTarget({ payload, searchKind: 'file' })
  }, [])

  const handleSearchFoldersInFolder = useCallback((payload: CodeTreeContextMenuPayload) => {
    setFolderSearchTarget({ payload, searchKind: 'directory' })
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
    },
    [collapseExplorerIfNeeded, openFileWithTreeLocate],
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
    confirmPendingScript,
    handleCopyTreeNodeToClipboard,
    handleCopyTreeNodeName,
    handleCopyTreeNodeRelativePath,
    handleCopyTreeNodeRelativePathWithoutSlashes,
    handleCopyTreeNodePathWithLineNumber,
    handleCopyTreeNodeZipToClipboard,
    handleCopySelectedAbsolutePaths,
    handleCopySelectedFiles,
    handleCopySelectedNames,
    handleCopySelectedRelativePaths,
    handleCopySelectedZipToClipboard,
    handleExecuteScriptInEmbeddedTerminal,
    handleExecuteScriptInSystemTerminal,
    handleFindTreeNodeFilesByName,
    handleFolderSearchContextMenu,
    handleSearchFoldersInFolder,
    handleOpenContentSearchResult,
    handleOpenSmartEmptyFile,
    handleOpenTreeNodeFolder,
    handleOpenTreeNodeTerminal,
    handleSelectExcluded,
    handleSelectTreeFile,
    handleZipTreeNode,
    folderSearchContextMenuPayload,
    folderSearchTarget,
    isScriptConfirmBusy,
    openFileFromQuickDrawer,
    pendingScriptConfirm,
    resolveTreeNodeRunnableScript,
  }
}
