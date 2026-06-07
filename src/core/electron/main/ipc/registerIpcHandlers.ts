import { dialog, ipcMain, nativeTheme, shell } from 'electron'
import type { BrowserWindow } from 'electron'
import { detectProject } from '../detector'
import { loadConfig, updateConfig } from '../config'
import { IPC } from '../ipc'
import { tmuxManager } from '../tmux-manager'
import {
  listProjectDirectoryFiles,
  listProjectFiles,
  readProjectFile,
  searchProjectContent,
  searchProjectFiles,
  statProjectFile,
  toProjectFileServiceErrorMessage,
  writeProjectFile,
  writeProjectImageFile,
} from '../project-file-service'
import {
  normalizeClaudeBashrcConfig,
  readClaudeBashrcConfig,
  writeClaudeBashrcConfig,
} from '../claude-bashrc'
import {
  deleteDocLinkSecret,
  getDocLinkSecret,
  setDocLinkSecret,
} from '../doc-link-secret-store'
import { applyWindowBackground } from '../window/createWindow'
import {
  openFolder,
  openTerminalAtPath,
  openVsCode,
} from '../shell/openers'
import type { AiCommitService } from '../ai-commit/ai-commit-service'
import type { GitService } from '../git/git-service'
import type { RuntimeService } from '../runtime/runtime-service'
import type { ProcessManager } from '../runner'
import type {
  AiCommitRunOverride,
  AiCommitTaskSnapshot,
  AppConfig,
  Capability,
  GitConflictFileRequest,
  GitFileDiffRequest,
  GitOperationRequest,
  GitResolveConflictRequest,
  GitSetFileStageRequest,
  ProjectFileContentSearchOptions,
  TerminalProcessInventory,
  TerminalStopAllResult,
} from '../../../shared/types'

type RuntimeStateChangedPayload = {
  reason: string
  projectId?: string
  sessionName?: string
}

type RegisterIpcHandlersDependencies = {
  getMainWindow: () => BrowserWindow | null
  getProcessManager: () => ProcessManager | null
  getBootCapability: () => Capability | null
  emitRuntimeStateChanged: (payload: RuntimeStateChangedPayload) => void
  aiCommitService: AiCommitService
  gitService: GitService
  runtimeService: RuntimeService
}

let ipcHandlersRegistered = false

export function registerIpcHandlers(deps: RegisterIpcHandlersDependencies): void {
  if (ipcHandlersRegistered) return
  ipcHandlersRegistered = true

  const getBootDistro = () => deps.getBootCapability()?.wslDistro || 'Ubuntu'

  const withProjectFileErrors = async <T>(action: () => Promise<T>): Promise<T> => {
    try {
      return await action()
    } catch (error) {
      throw new Error(toProjectFileServiceErrorMessage(error))
    }
  }

  ipcMain.handle(IPC.DETECT_DIRECTORY, (_event, dirPath: string) => {
    return detectProject(dirPath)
  })

  ipcMain.handle(
    IPC.PROCESS_START,
    (_event, projectId: string, command: string, cwd: string, useWsl?: boolean) => {
      const started = deps.getProcessManager()?.start(projectId, command, cwd, useWsl) ?? false
      if (started) {
        deps.emitRuntimeStateChanged({ reason: 'process-start', projectId })
      }
      return started
    }
  )

  ipcMain.handle(IPC.PROCESS_STOP, (_event, projectId: string) => {
    const stopped = deps.getProcessManager()?.stop(projectId) ?? false
    if (stopped) {
      deps.emitRuntimeStateChanged({ reason: 'process-stop', projectId })
    }
    return stopped
  })

  ipcMain.handle(
    IPC.PROCESS_INPUT,
    (_event, projectId: string, data: string) => {
      deps.getProcessManager()?.sendInput(projectId, data)
      return true
    }
  )

  ipcMain.handle(IPC.PROCESS_RESIZE, (_event, projectId: string, cols: number, rows: number) => {
    deps.getProcessManager()?.resize(projectId, cols, rows)
    return true
  })

  ipcMain.handle(IPC.CONFIG_GET, () => {
    return loadConfig()
  })

  ipcMain.on(IPC.CONFIG_GET_THEME_SYNC, (event) => {
    event.returnValue = loadConfig().theme
  })

  ipcMain.handle(
    IPC.CONFIG_SET,
    async (_event, partial: Record<string, unknown>) => {
      const updated = await updateConfig(
        partial as Partial<AppConfig> & { startupDefaultTagId?: string }
      )
      if (Object.prototype.hasOwnProperty.call(partial, 'theme')) {
        applyWindowBackground(deps.getMainWindow(), updated.theme, nativeTheme.shouldUseDarkColors)
      }
      return updated
    }
  )

  ipcMain.handle(IPC.CLAUDE_BASHRC_GET, async () => {
    return readClaudeBashrcConfig()
  })

  ipcMain.handle(IPC.CLAUDE_BASHRC_SET, async (_event, config: Record<string, unknown>) => {
    return writeClaudeBashrcConfig(normalizeClaudeBashrcConfig(config))
  })

  ipcMain.handle(IPC.DOC_LINK_SECRET_SET, (_event, projectId: string, linkId: string, secret: string) => {
    setDocLinkSecret(projectId, linkId, secret)
    return true
  })

  ipcMain.handle(IPC.DOC_LINK_SECRET_GET, (_event, projectId: string, linkId: string) => {
    const secret = getDocLinkSecret(projectId, linkId)
    return { secret }
  })

  ipcMain.handle(IPC.DOC_LINK_SECRET_DELETE, (_event, projectId: string, linkId: string) => {
    deleteDocLinkSecret(projectId, linkId)
    return true
  })

  ipcMain.handle(IPC.AI_COMMIT_RUN, async (_event, projectId: string, projectPath: string, override?: AiCommitRunOverride) => {
    return deps.aiCommitService.runAiCommit(projectId, projectPath, override)
  })

  ipcMain.handle(IPC.AI_COMMIT_GET_STATE, (_event, projectId: string): AiCommitTaskSnapshot | null => {
    return deps.aiCommitService.getAiCommitState(projectId)
  })

  ipcMain.handle(IPC.GIT_GET_LATEST_COMMIT, async (_event, projectPath: string) => {
    return deps.gitService.readRecentCommits(projectPath)
  })

  ipcMain.handle(IPC.GIT_LIST_REPOSITORIES, async (_event, projectPath: string) => {
    return deps.gitService.listGitRepositories(projectPath)
  })

  ipcMain.handle(IPC.GIT_GET_WORKSPACE_SNAPSHOT, async (_event, projectPath: string) => {
    return deps.gitService.readGitWorkspaceSnapshot(projectPath)
  })

  ipcMain.handle(IPC.GIT_RUN_OPERATION, async (_event, request: GitOperationRequest) => {
    return deps.gitService.runGitOperation(request)
  })

  ipcMain.handle(IPC.GIT_SET_FILE_STAGE, async (_event, request: GitSetFileStageRequest) => {
    return deps.gitService.setGitFileStage(request)
  })

  ipcMain.handle(IPC.GIT_GET_FILE_DIFF, async (_event, request: GitFileDiffRequest) => {
    return deps.gitService.getGitFileDiff(request)
  })

  ipcMain.handle(IPC.GIT_GET_CONFLICT_FILE, async (_event, request: GitConflictFileRequest) => {
    return deps.gitService.getGitConflictFile(request)
  })

  ipcMain.handle(IPC.GIT_RESOLVE_CONFLICT_FILE, async (_event, request: GitResolveConflictRequest) => {
    return deps.gitService.resolveGitConflictFile(request)
  })

  ipcMain.handle(IPC.SHELL_OPEN_EXTERNAL, (_event, url: string) => {
    return shell.openExternal(url)
  })

  ipcMain.handle(IPC.SHELL_OPEN_FOLDER, async (_event, folderPath: string, revealPath?: string) => {
    return openFolder(folderPath, revealPath)
  })

  ipcMain.handle(IPC.SHELL_OPEN_VSCODE, (_event, folderPath: string) => {
    openVsCode(folderPath, getBootDistro())
  })

  ipcMain.handle(IPC.WINDOW_MINIMIZE, () => {
    deps.getMainWindow()?.minimize()
    return true
  })

  ipcMain.handle(IPC.WINDOW_TOGGLE_MAXIMIZE, () => {
    const currentWindow = deps.getMainWindow()
    if (!currentWindow) return false
    if (currentWindow.isMaximized()) {
      currentWindow.unmaximize()
    } else {
      currentWindow.maximize()
    }
    return currentWindow.isMaximized()
  })

  ipcMain.handle(IPC.WINDOW_CLOSE, () => {
    deps.getMainWindow()?.close()
    return true
  })

  ipcMain.handle(IPC.WINDOW_IS_MAXIMIZED, () => {
    return deps.getMainWindow()?.isMaximized() ?? false
  })

  ipcMain.handle(IPC.DIALOG_SELECT_DIRECTORY, async () => {
    const currentWindow = deps.getMainWindow()
    if (!currentWindow) return null

    const result = await dialog.showOpenDialog(currentWindow, {
      properties: ['openDirectory'],
    })
    if (!result.canceled && result.filePaths.length > 0) {
      return result.filePaths[0]
    }
    return null
  })

  ipcMain.handle(IPC.PROJECT_FILE_TREE, async (_event, projectPath: string) => {
    return withProjectFileErrors(() => listProjectFiles(projectPath))
  })

  ipcMain.handle(IPC.PROJECT_FILE_TREE_DIRECTORY, async (_event, projectPath: string, directoryRelativePath: string | null) => {
    return withProjectFileErrors(() => listProjectDirectoryFiles(projectPath, directoryRelativePath))
  })

  ipcMain.handle(IPC.PROJECT_FILE_SEARCH, async (_event, projectPath: string, query: string) => {
    return withProjectFileErrors(() => searchProjectFiles(projectPath, query))
  })

  ipcMain.handle(
    IPC.PROJECT_FILE_CONTENT_SEARCH,
    async (_event, projectPath: string, query: string, options?: ProjectFileContentSearchOptions) => {
      return withProjectFileErrors(() => searchProjectContent(projectPath, query, options))
    }
  )

  ipcMain.handle(IPC.PROJECT_FILE_READ, async (_event, projectPath: string, relativePath: string) => {
    return withProjectFileErrors(() => readProjectFile(projectPath, relativePath))
  })

  ipcMain.handle(IPC.PROJECT_FILE_STAT, async (_event, projectPath: string, relativePath: string) => {
    return withProjectFileErrors(() => statProjectFile(projectPath, relativePath))
  })

  ipcMain.handle(
    IPC.PROJECT_FILE_WRITE,
    async (
      _event,
      projectPath: string,
      relativePath: string,
      content: string,
      expectedMtimeMs?: number
    ) => {
      return withProjectFileErrors(() => writeProjectFile(projectPath, relativePath, content, expectedMtimeMs))
    }
  )

  ipcMain.handle(
    IPC.PROJECT_FILE_WRITE_IMAGE,
    async (
      _event,
      projectPath: string,
      targetDirectoryRelativePath: string,
      extension: string,
      dataBase64: string
    ) => {
      return withProjectFileErrors(() => writeProjectImageFile(
        projectPath,
        targetDirectoryRelativePath,
        extension,
        dataBase64
      ))
    }
  )

  ipcMain.handle(
    IPC.RUNTIME_START,
    async (_event, projectId: string, projectPath: string, cli?: 'claude' | 'codex') => {
      return deps.runtimeService.startRuntime(projectId, projectPath, cli)
    }
  )

  ipcMain.handle(IPC.SHELL_OPEN_TERMINAL, async (_event, sessionName: string, statusHint?: string) => {
    return deps.runtimeService.openRuntimeTerminal(sessionName, statusHint)
  })

  ipcMain.handle(IPC.SHELL_OPEN_PATH_TERMINAL, async (_event, folderPath: string, command?: string) => {
    return openTerminalAtPath(folderPath, getBootDistro(), command)
  })

  ipcMain.handle(IPC.RUNTIME_LIST_ENTRIES, () => {
    return deps.runtimeService.listRuntimeEntries()
  })

  ipcMain.handle(IPC.RUNTIME_DIAGNOSTICS, async () => {
    return deps.runtimeService.diagnoseRuntime()
  })

  ipcMain.handle(IPC.WSL_GET_CAPABILITY, () => {
    return deps.getBootCapability()
  })

  ipcMain.handle(IPC.TMUX_LIST_SESSIONS, () => {
    return tmuxManager.listLauncherSessions()
  })

  ipcMain.handle(IPC.TMUX_KILL_SESSION, (_event, sessionName: string) => {
    return deps.runtimeService.killTmuxSession(sessionName)
  })

  ipcMain.handle(IPC.TERMINAL_LIST_ALL, async (): Promise<TerminalProcessInventory> => {
    return deps.runtimeService.listTerminalInventory()
  })

  ipcMain.handle(IPC.TERMINAL_STOP_ALL, async (): Promise<TerminalStopAllResult> => {
    return deps.runtimeService.stopAllTerminals()
  })
}
