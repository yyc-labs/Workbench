import { clipboard, dialog, ipcMain, nativeImage, nativeTheme, shell } from 'electron'
import type { BrowserWindow } from 'electron'
import http from 'http'
import { detectProject } from '../detector'
import { loadConfig, updateConfig } from '../config'
import { IPC } from '../ipc'
import { readLocalImageAsDataUrl } from '../local-image-service'
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
  normalizeCodexConfig,
  resolveCodexEnvironmentScope,
  readCodexSettings,
  writeCodexSettings,
} from '../codex-config'
import { applyWindowsUserEnvToCurrentProcess, writeWindowsUserEnv } from '../windows-env'
import {
  deleteDocLinkSecret,
  getDocLinkSecret,
  setDocLinkSecret,
} from '../doc-link-secret-store'
import { applyWindowBackground } from '../window/createWindow'
import {
  openFolder,
  openSshTerminal,
  openTerminalAtPath,
  openVsCode,
} from '../shell/openers'
import type { AiCommitService } from '../ai-commit/ai-commit-service'
import type { AgentHookGateway } from '../hooks/agent-hook-gateway'
import type { GitService } from '../git/git-service'
import type { LearningService } from '../learning/learningService'
import type { RuntimeService } from '../runtime/runtime-service'
import type { ProcessManager } from '../runner'
import type { TranscriptService } from '../transcript/transcriptService'
import type { TranscriptShareService } from '../transcript/transcriptShareService'
import type {
  AiCommitRunOverride,
  AiCommitTaskSnapshot,
  AiCommitUndoCloseReason,
  AiCommitUndoResult,
  AppConfig,
  Capability,
  CodexSettingsSaveResult,
  GitConflictFileRequest,
  GitFileDiffRequest,
  GitOperationRequest,
  GitResolveConflictRequest,
  GitSetFileStageRequest,
  ProjectFileContentSearchOptions,
  TerminalProcessInventory,
  TerminalStopAllResult,
  LearningCreateCategoryPayload,
  LearningCreateNotePayload,
  LearningUpdateNotePayload,
  TranscriptGatewayImportPayload,
  TranscriptImportPayload,
  TranscriptShareStartPayload,
  TranscriptUpdatePayload,
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
  agentHookGateway: AgentHookGateway
  gitService: GitService
  runtimeService: RuntimeService
  learningService: LearningService
  transcriptService: TranscriptService
  transcriptShareService: TranscriptShareService
}

type GitRequestWithRepoRoot = {
  repoRoot?: unknown
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

  const normalizeGitRequest = <T extends GitRequestWithRepoRoot>(request: T): T => ({
    ...request,
    repoRoot: typeof request?.repoRoot === 'string' ? request.repoRoot : '',
  })

  const requestTranscriptImportViaGateway = async (payload: TranscriptGatewayImportPayload) => {
    const agentHooks = loadConfig().agentHooks || {}
    const transcriptImport = agentHooks.transcriptImport || {}
    const enabled = transcriptImport.enabled ?? true
    if (!enabled) {
      throw new Error('Transcript import API is disabled.')
    }

    const host = (agentHooks.host && agentHooks.host !== '127.0.0.1' ? agentHooks.host : '127.0.0.1') || '127.0.0.1'
    const port = Number.isFinite(agentHooks.port) ? Number(agentHooks.port) : 17373
    const body = JSON.stringify({
      projectId: payload.projectId,
      rawText: payload.rawText,
      title: payload.title,
      sourceType: payload.sourceType ?? 'manual-markdown',
      sourceLabel: payload.sourceLabel,
      processId: payload.processId,
      capturedAt: payload.capturedAt,
      openViewer: payload.openViewer,
    })

    return new Promise<{
      ok: boolean
      projectId: string
      sessionId: string
      title: string
      sourceType: string
      openViewer: boolean
    }>((resolve, reject) => {
      const req = http.request({
        host,
        port,
        path: '/transcripts/import',
        method: 'POST',
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'content-length': Buffer.byteLength(body),
          ...(transcriptImport.token
            ? { 'x-ide-electron-transcript-token': transcriptImport.token }
            : {}),
        },
      }, (res) => {
        let responseBody = ''
        res.setEncoding('utf8')
        res.on('data', (chunk) => {
          responseBody += chunk
        })
        res.on('end', () => {
          const statusCode = res.statusCode ?? 500
          try {
            const parsed = responseBody.trim() ? JSON.parse(responseBody) : {}
            if (statusCode >= 200 && statusCode < 300) {
              resolve(parsed as {
                ok: boolean
                projectId: string
                sessionId: string
                title: string
                sourceType: string
                openViewer: boolean
              })
              return
            }
            reject(new Error(
              typeof parsed?.error === 'string'
                ? parsed.error
                : `Transcript import API request failed with status ${statusCode}.`
            ))
          } catch {
            reject(new Error(`Transcript import API request failed with status ${statusCode}.`))
          }
        })
      })

      req.on('error', (error) => {
        reject(error)
      })

      req.write(body)
      req.end()
    })
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

  ipcMain.handle(
    IPC.WINDOW_CAPTURE_RECT,
    async (_event, rect: { x: number; y: number; width: number; height: number }) => {
      const targetWindow = deps.getMainWindow()
      if (!targetWindow || targetWindow.isDestroyed()) {
        throw new Error('Main window is not available.')
      }

      const x = Math.max(0, Math.floor(Number(rect?.x) || 0))
      const y = Math.max(0, Math.floor(Number(rect?.y) || 0))
      const width = Math.max(1, Math.floor(Number(rect?.width) || 0))
      const height = Math.max(1, Math.floor(Number(rect?.height) || 0))

      const image = await targetWindow.webContents.capturePage({ x, y, width, height })
      return image.toPNG().toString('base64')
    }
  )

  ipcMain.handle(IPC.CLIPBOARD_WRITE_IMAGE, (_event, pngBase64: string) => {
    const normalized = typeof pngBase64 === 'string' ? pngBase64.trim() : ''
    if (!normalized) {
      throw new Error('Clipboard image payload is empty.')
    }

    const image = nativeImage.createFromBuffer(Buffer.from(normalized, 'base64'))
    if (image.isEmpty()) {
      throw new Error('Clipboard image payload is invalid.')
    }

    clipboard.writeImage(image)
    return true
  })

  ipcMain.handle(IPC.LOCAL_IMAGE_READ_DATA_URL, async (_event, source: string) => {
    return readLocalImageAsDataUrl(source)
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

  ipcMain.handle(IPC.CODEX_SCOPE_GET, async () => {
    return resolveCodexEnvironmentScope(deps.getBootCapability())
  })

  ipcMain.handle(IPC.CODEX_SETTINGS_GET, async () => {
    return readCodexSettings(deps.getBootCapability())
  })

  ipcMain.handle(IPC.CODEX_SETTINGS_SET, async (_event, payload: Record<string, unknown>): Promise<CodexSettingsSaveResult> => {
    const providerApiKeys = payload.providerApiKeys && typeof payload.providerApiKeys === 'object'
      ? payload.providerApiKeys as Record<string, string>
      : {}
    const config = payload.config && typeof payload.config === 'object'
      ? normalizeCodexConfig(payload.config as Record<string, unknown>)
      : normalizeCodexConfig({})

    const snapshot = await writeCodexSettings(deps.getBootCapability(), {
      providerApiKeys,
      config,
    })
    return {
      snapshot,
      appConfig: loadConfig(),
    }
  })

  ipcMain.handle(IPC.CLAUDE_BASHRC_GET, async () => {
    return readClaudeBashrcConfig()
  })

  ipcMain.handle(IPC.CLAUDE_BASHRC_SET, async (_event, config: Record<string, unknown>) => {
    const normalized = normalizeClaudeBashrcConfig(config)
    const saved = await writeClaudeBashrcConfig(normalized)
    // Also persist to Windows User env vars so native terminals pick them up
    await writeWindowsUserEnv(saved).catch(() => { /* non-fatal on non-Windows */ })
    return process.platform === 'win32'
      ? applyWindowsUserEnvToCurrentProcess(saved)
      : saved
  })

  ipcMain.handle(IPC.WINDOWS_USER_ENV_SET, async (_event, config: Record<string, unknown>) => {
    const normalized = normalizeClaudeBashrcConfig(config)
    await writeWindowsUserEnv(normalized)
    return applyWindowsUserEnvToCurrentProcess(normalized)
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

  ipcMain.handle(IPC.AI_COMMIT_RUN, async (_event, projectId: string, repoRoot: string, override?: AiCommitRunOverride) => {
    return deps.aiCommitService.runAiCommit(projectId, repoRoot, override)
  })

  ipcMain.handle(IPC.AI_COMMIT_GET_STATE, (_event, projectId: string): AiCommitTaskSnapshot | null => {
    return deps.aiCommitService.getAiCommitState(projectId)
  })

  ipcMain.handle(IPC.AI_COMMIT_BEGIN_UNDO_AUTH, (_event, projectId: string): AiCommitTaskSnapshot | null => {
    return deps.aiCommitService.beginAiCommitUndoAuth(projectId)
  })

  ipcMain.handle(IPC.AI_COMMIT_CANCEL_UNDO_AUTH, (_event, projectId: string): AiCommitTaskSnapshot | null => {
    return deps.aiCommitService.cancelAiCommitUndoAuth(projectId)
  })

  ipcMain.handle(IPC.AI_COMMIT_UNDO, async (_event, projectId: string): Promise<AiCommitUndoResult> => {
    return deps.aiCommitService.undoAiCommit(projectId)
  })

  ipcMain.handle(
    IPC.AI_COMMIT_CLOSE_UNDO,
    (_event, projectId: string, reason?: AiCommitUndoCloseReason): AiCommitTaskSnapshot | null => {
      return deps.aiCommitService.closeAiCommitUndo(projectId, reason)
    }
  )

  ipcMain.handle(IPC.AGENT_HOOK_GET_STATUS, () => {
    return deps.agentHookGateway.getStatus()
  })

  ipcMain.handle(IPC.AGENT_HOOK_GET_RECENT_EVENTS, () => {
    return deps.agentHookGateway.getRecentEvents()
  })

  ipcMain.handle(IPC.GIT_GET_LATEST_COMMIT, async (_event, repoRoot: string) => {
    return deps.gitService.readRecentCommits(repoRoot)
  })

  ipcMain.handle(IPC.GIT_LIST_REPOSITORIES, async (_event, workspacePath: string) => {
    return deps.gitService.listGitRepositories(workspacePath)
  })

  ipcMain.handle(IPC.GIT_GET_REPOSITORY_SNAPSHOT, async (_event, repoRoot: string) => {
    return deps.gitService.readGitRepositorySnapshot(repoRoot)
  })

  ipcMain.handle(IPC.GIT_RUN_OPERATION, async (_event, request: GitOperationRequest) => {
    return deps.gitService.runGitOperation(normalizeGitRequest(request) as GitOperationRequest)
  })

  ipcMain.handle(IPC.GIT_SET_FILE_STAGE, async (_event, request: GitSetFileStageRequest) => {
    return deps.gitService.setGitFileStage(normalizeGitRequest(request) as GitSetFileStageRequest)
  })

  ipcMain.handle(IPC.GIT_GET_FILE_DIFF, async (_event, request: GitFileDiffRequest) => {
    return deps.gitService.getGitFileDiff(normalizeGitRequest(request) as GitFileDiffRequest)
  })

  ipcMain.handle(IPC.GIT_GET_CONFLICT_FILE, async (_event, request: GitConflictFileRequest) => {
    return deps.gitService.getGitConflictFile(normalizeGitRequest(request) as GitConflictFileRequest)
  })

  ipcMain.handle(IPC.GIT_RESOLVE_CONFLICT_FILE, async (_event, request: GitResolveConflictRequest) => {
    return deps.gitService.resolveGitConflictFile(normalizeGitRequest(request) as GitResolveConflictRequest)
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

  ipcMain.handle(IPC.DIALOG_SELECT_DIRECTORY, async (_event, defaultPath?: string) => {
    const currentWindow = deps.getMainWindow()
    if (!currentWindow) return null

    const result = await dialog.showOpenDialog(currentWindow, {
      properties: ['openDirectory'],
      defaultPath: typeof defaultPath === 'string' && defaultPath.trim() ? defaultPath.trim() : undefined,
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

  ipcMain.handle(IPC.TRANSCRIPT_IMPORT, async (_event, payload: TranscriptImportPayload) => {
    return deps.transcriptService.importTranscript(payload)
  })

  ipcMain.handle(IPC.TRANSCRIPT_IMPORT_VIA_GATEWAY, async (_event, payload: TranscriptGatewayImportPayload) => {
    return requestTranscriptImportViaGateway(payload)
  })

  ipcMain.handle(IPC.TRANSCRIPT_LIST, async (_event, projectId: string) => {
    return deps.transcriptService.listProjectTranscripts(projectId)
  })

  ipcMain.handle(IPC.TRANSCRIPT_LIST_ALL, async () => {
    return deps.transcriptService.listAllTranscripts()
  })

  ipcMain.handle(IPC.TRANSCRIPT_GET, async (_event, projectId: string, transcriptId: string) => {
    return deps.transcriptService.getTranscript(projectId, transcriptId)
  })

  ipcMain.handle(IPC.TRANSCRIPT_UPDATE, async (_event, payload: TranscriptUpdatePayload) => {
    return deps.transcriptService.updateTranscript(payload)
  })

  ipcMain.handle(IPC.TRANSCRIPT_DELETE, async (_event, projectId: string, transcriptId: string) => {
    return deps.transcriptService.deleteTranscript(projectId, transcriptId)
  })

  ipcMain.handle(IPC.TRANSCRIPT_SHARE_START, async (_event, payload: TranscriptShareStartPayload) => {
    return deps.transcriptShareService.start(payload)
  })

  ipcMain.handle(IPC.TRANSCRIPT_SHARE_STOP, (_event, token: string) => {
    return deps.transcriptShareService.stop(token)
  })

  ipcMain.handle(IPC.TRANSCRIPT_SHARE_LIST, () => {
    return deps.transcriptShareService.list()
  })

  ipcMain.handle(IPC.LEARNING_LIST_CATEGORIES, async () => {
    return deps.learningService.listCategories()
  })

  ipcMain.handle(IPC.LEARNING_CREATE_CATEGORY, async (_event, payload: LearningCreateCategoryPayload) => {
    return deps.learningService.createCategory(payload)
  })

  ipcMain.handle(IPC.LEARNING_LIST_NOTES, async () => {
    return deps.learningService.listNotes()
  })

  ipcMain.handle(IPC.LEARNING_GET_NOTE, async (_event, noteId: string) => {
    return deps.learningService.getNote(noteId)
  })

  ipcMain.handle(IPC.LEARNING_CREATE_NOTE, async (_event, payload?: LearningCreateNotePayload) => {
    return deps.learningService.createNote(payload)
  })

  ipcMain.handle(IPC.LEARNING_UPDATE_NOTE, async (_event, payload: LearningUpdateNotePayload) => {
    return deps.learningService.updateNote(payload)
  })

  ipcMain.handle(IPC.LEARNING_DELETE_NOTE, async (_event, noteId: string) => {
    return deps.learningService.deleteNote(noteId)
  })

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

  ipcMain.handle(
    IPC.SHELL_OPEN_SSH_TERMINAL,
    async (
      _event,
      payload: {
        host: string
        port?: number
        username: string
        password?: string | null
        route?: 'wsl' | 'windows'
      }
    ) => {
      return openSshTerminal(getBootDistro(), payload)
    }
  )

  ipcMain.handle(IPC.RUNTIME_LIST_ENTRIES, () => {
    return deps.runtimeService.listRuntimeEntries()
  })

  ipcMain.handle(IPC.RUNTIME_LIST_SESSIONS, () => {
    return deps.runtimeService.listRuntimeSessions()
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
