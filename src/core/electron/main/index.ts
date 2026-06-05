import { app, BrowserWindow, ipcMain, dialog, shell, nativeTheme } from 'electron'
import { spawn } from 'child_process'
import { join } from 'path'
import { StringDecoder } from 'string_decoder'
import { ProcessManager } from './runner'
import { detectProject } from './detector'
import { loadConfig, updateConfig } from './config'
import { IPC } from './ipc'
import { capabilityManager } from './capability-manager'
import { tmuxManager } from './tmux-manager'
import { wslBridge } from './wsl-bridge'
import { getAiCommitTask, upsertAiCommitTask, appendAiCommitTaskOutput } from './ai-commit-registry'
import {
  listProjectDirectoryFiles,
  listProjectFiles,
  searchProjectFiles,
  searchProjectContent,
  readProjectFile,
  statProjectFile,
  writeProjectImageFile,
  writeProjectFile,
  toProjectFileServiceErrorMessage,
} from './project-file-service'
import {
  normalizeClaudeBashrcConfig,
  readClaudeBashrcConfig,
  writeClaudeBashrcConfig,
} from './claude-bashrc'
import {
  deleteDocLinkSecret,
  getDocLinkSecret,
  setDocLinkSecret,
} from './doc-link-secret-store'
import { createGitService } from './git/git-service'
import { createRuntimeService } from './runtime/runtime-service'
import { createWindow, applyWindowBackground } from './window/createWindow'
import { openFolder, openTerminalAtPath, openVsCode, resolveWslVsCodeTarget } from './shell/openers'
import type {
  AiCommitTaskSnapshot,
  AiCommitRunOverride,
  Capability,
  AppConfig,
  GitOperationRequest,
  GitSetFileStageRequest,
  GitFileDiffRequest,
  GitConflictFileRequest,
  GitResolveConflictRequest,
  ProjectFileContentSearchOptions,
  TerminalProcessInventory,
  TerminalStopAllResult,
} from '../../shared/types'

let mainWindow: BrowserWindow | null = null
let processManager: ProcessManager | null = null
let bootCapability: Capability | null = null
const activeAiCommitProjects = new Set<string>()
let ipcHandlersRegistered = false
const gitService = createGitService({
  getDefaultWslDistro: () => bootCapability?.wslDistro || 'Ubuntu',
})
const runtimeService = createRuntimeService({
  getCapability: () => bootCapability,
  getProcessManager: () => processManager,
  emitRuntimeStateChanged,
})

function createMainWindow(): void {
  const config = loadConfig()

  mainWindow = createWindow({
    theme: config.theme,
    shouldUseDarkColors: nativeTheme.shouldUseDarkColors,
    onToggleViewMode: () => {
      mainWindow?.webContents.send(IPC.CODE_TOGGLE_VIEW_MODE)
    },
    onFocusSearch: () => {
      mainWindow?.webContents.send(IPC.CODE_FOCUS_SEARCH)
    },
    onWindowStateChange: (isMaximized) => {
      mainWindow?.webContents.send(IPC.WINDOW_STATE, { isMaximized })
    },
    onClosed: () => {
      processManager?.setOutputWindow(null)
      mainWindow = null
    },
  })

  processManager?.setOutputWindow(mainWindow)
}

function sendAiCommitOutput(projectId: string, data: string): void {
  appendAiCommitTaskOutput(projectId, data)
  mainWindow?.webContents.send(IPC.AI_COMMIT_OUTPUT, { projectId, data })
}

function sendAiCommitStatus(projectId: string, status: 'running' | 'success' | 'error'): void {
  const current = getAiCommitTask(projectId)
  if (current) {
    const now = Date.now()
    upsertAiCommitTask({
      ...current,
      status,
      updatedAt: now,
      finishedAt: status === 'running' ? undefined : now,
    })
  }
  mainWindow?.webContents.send(IPC.AI_COMMIT_STATUS, { projectId, status })
}

function emitRuntimeStateChanged(payload: { reason: string; projectId?: string; sessionName?: string }): void {
  mainWindow?.webContents.send(IPC.RUNTIME_STATE_CHANGED, payload)
}

function markAiCommitInterruptedIfOrphan(projectId: string): AiCommitTaskSnapshot | undefined {
  const task = getAiCommitTask(projectId)
  if (!task) return undefined
  if (task.status !== 'running') return task
  if (activeAiCommitProjects.has(projectId)) return task

  const now = Date.now()
  const interruptedLine = '[AI Commit] previous task interrupted: app process exited before completion.\r\n'
  const next = upsertAiCommitTask({
    ...task,
    status: 'error',
    output: `${task.output || ''}${interruptedLine}`,
    updatedAt: now,
    finishedAt: now,
  })

  mainWindow?.webContents.send(IPC.AI_COMMIT_OUTPUT, { projectId, data: interruptedLine })
  mainWindow?.webContents.send(IPC.AI_COMMIT_STATUS, { projectId, status: 'error' as const })
  return next
}

async function runAiCommit(
  projectId: string,
  projectPath: string,
  override?: AiCommitRunOverride
): Promise<boolean> {
  const existing = markAiCommitInterruptedIfOrphan(projectId)
  if (existing && existing.status === 'running') {
    sendAiCommitOutput(projectId, '[AI Commit] skipped: a commit task is already running for this project.\r\n')
    sendAiCommitStatus(projectId, 'running')
    return true
  }

  const now = Date.now()
  upsertAiCommitTask({
    projectId,
    projectPath,
    runId: `${now}-${Math.random().toString(36).slice(2, 8)}`,
    status: 'running',
    output: '',
    startedAt: now,
    updatedAt: now,
    override,
  })
  activeAiCommitProjects.add(projectId)

  const config = loadConfig()
  const aiCfgRaw = config.aiCommit || {}
  const aiCfg = {
    ...aiCfgRaw,
    split: typeof override?.split === 'boolean' ? override.split : aiCfgRaw.split,
    splitMaxBatches: typeof override?.splitMaxBatches === 'number'
      ? override.splitMaxBatches
      : aiCfgRaw.splitMaxBatches,
    maxBullets: typeof override?.maxBullets === 'number'
      ? override.maxBullets
      : aiCfgRaw.maxBullets,
  }
  const wslPwshPath = (aiCfg.wslPwshPath || '').replace(/[\r\n]/g, '').trim() || '/snap/bin/pwsh'
  const splitEnabled = Boolean(aiCfg.split)
  const splitMaxBatches = Math.max(
    1,
    Math.min(
      12,
      Number.isFinite(aiCfg.splitMaxBatches)
        ? Math.trunc(aiCfg.splitMaxBatches as number)
        : 4
    )
  )
  const maxBullets = Math.max(
    1,
    Math.min(
      20,
      Number.isFinite(aiCfg.maxBullets)
        ? Math.trunc(aiCfg.maxBullets as number)
        : 8
    )
  )
  const scriptPs1Path = join(__dirname, '../../script/auto-git-commit/auto_commit.ps1')
  const scriptPs1WslPath = process.platform === 'win32' ? wslBridge.toWslPath(scriptPs1Path) : null
  const wslTarget = process.platform === 'win32'
    ? resolveWslVsCodeTarget(projectPath, bootCapability?.wslDistro || 'Ubuntu')
    : null

  sendAiCommitStatus(projectId, 'running')
  sendAiCommitOutput(projectId, `\r\n[AI Commit] Starting in ${projectPath}\r\n`)
  sendAiCommitOutput(
    projectId,
    `[AI Commit] mode: ${splitEnabled ? `split (max batches=${splitMaxBatches})` : 'single'}, max bullets=${maxBullets}\r\n`
  )

  return new Promise<boolean>((resolve) => {
    const windowsPsArgs = [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      scriptPs1Path,
      '-All',
    ]

    if (aiCfg.enabled ?? true) {
      windowsPsArgs.push('-UseAi')
    }
    if (splitEnabled) {
      windowsPsArgs.push('-Split', '-SplitMaxBatches', String(splitMaxBatches))
    }
    windowsPsArgs.push('-MaxBullets', String(maxBullets))

    if (aiCfg.apiBaseUrl && aiCfg.apiBaseUrl.trim()) {
      windowsPsArgs.push('-ApiBaseUrl', aiCfg.apiBaseUrl.trim())
    }
    if (aiCfg.apiKey && aiCfg.apiKey.trim()) {
      windowsPsArgs.push('-ApiKey', aiCfg.apiKey.trim())
    }
    if (aiCfg.model && aiCfg.model.trim()) {
      windowsPsArgs.push('-Model', aiCfg.model.trim())
    }

    const spawnWindowsPowerShell = (cmd: string) =>
      spawn(cmd, windowsPsArgs, {
        cwd: projectPath,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
      })

    const quoteBash = (value: string) => `'${quoteBashSingle(value)}'`

    const spawnWslPowerShell = () => {
      if (!wslTarget || !scriptPs1WslPath) return spawnWindowsPowerShell('pwsh')

      const wslPwshArgs = [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        scriptPs1WslPath,
        '-All',
      ]
      if (aiCfg.enabled ?? true) {
        wslPwshArgs.push('-UseAi')
      }
      if (splitEnabled) {
        wslPwshArgs.push('-Split', '-SplitMaxBatches', String(splitMaxBatches))
      }
      wslPwshArgs.push('-MaxBullets', String(maxBullets))
      if (aiCfg.apiBaseUrl && aiCfg.apiBaseUrl.trim()) {
        wslPwshArgs.push('-ApiBaseUrl', aiCfg.apiBaseUrl.trim())
      }
      if (aiCfg.apiKey && aiCfg.apiKey.trim()) {
        wslPwshArgs.push('-ApiKey', aiCfg.apiKey.trim())
      }
      if (aiCfg.model && aiCfg.model.trim()) {
        wslPwshArgs.push('-Model', aiCfg.model.trim())
      }

      const preferredPwsh = quoteBash(wslPwshPath)
      const quotedArgs = wslPwshArgs.map((arg) => quoteBash(arg)).join(' ')
      const command = [
        'set -euo pipefail',
        `if [ -x ${preferredPwsh} ]; then`,
        `  echo "[AI Commit] wsl pwsh cmd: ${wslPwshPath}"`,
        `  exec ${preferredPwsh} ${quotedArgs}`,
        'else',
        '  echo "[AI Commit] wsl pwsh cmd: pwsh"',
        `  exec pwsh ${quotedArgs}`,
        'fi',
      ].join('\n')

      return spawn('wsl.exe', [
        '-d',
        wslTarget.distro,
        '--cd',
        wslTarget.linuxPath,
        '--',
        'bash',
        '-lc',
        command,
      ], {
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    }

    let child = (() => {
      if (wslTarget) {
        return spawnWslPowerShell()
      }

      return spawnWindowsPowerShell('pwsh')
    })()

    let started = false
    const allowWindowsFallback = !wslTarget
    let switchedToWindowsPowerShell = false

    const stdoutDecoder = new StringDecoder('utf8')
    const stderrDecoder = new StringDecoder('utf8')

    const attachStreams = () => {
      child.stdout?.on('data', (buf: Buffer) => {
        const text = stdoutDecoder.write(buf)
        if (text) {
          sendAiCommitOutput(projectId, text.replace(/\r?\n/g, '\r\n'))
        }
      })

      child.stderr?.on('data', (buf: Buffer) => {
        const text = stderrDecoder.write(buf)
        if (text) {
          sendAiCommitOutput(projectId, text.replace(/\r?\n/g, '\r\n'))
        }
      })
    }

    child.on('spawn', () => {
      started = true
      sendAiCommitOutput(projectId, `[AI Commit] shell: ${wslTarget ? 'wsl-pwsh' : 'pwsh'}\r\n`)
      attachStreams()
    })

    child.on('error', (err) => {
      if (!started && allowWindowsFallback && !switchedToWindowsPowerShell) {
        switchedToWindowsPowerShell = true
        sendAiCommitOutput(projectId, `[AI Commit] pwsh unavailable, fallback to powershell.exe (${err.message})\r\n`)
        child = spawnWindowsPowerShell('powershell.exe')
        child.on('spawn', () => {
          sendAiCommitOutput(projectId, '[AI Commit] shell: powershell.exe\r\n')
          attachStreams()
        })
        child.on('error', (fallbackErr) => {
          sendAiCommitOutput(projectId, `[AI Commit] process error: ${fallbackErr.message}\r\n`)
          sendAiCommitStatus(projectId, 'error')
          activeAiCommitProjects.delete(projectId)
          resolve(false)
        })
        child.on('close', (code) => {
          const tailOut = stdoutDecoder.end()
          if (tailOut) {
            sendAiCommitOutput(projectId, tailOut.replace(/\r?\n/g, '\r\n'))
          }
          const tailErr = stderrDecoder.end()
          if (tailErr) {
            sendAiCommitOutput(projectId, tailErr.replace(/\r?\n/g, '\r\n'))
          }
          const ok = code === 0
          sendAiCommitOutput(projectId, `[AI Commit] finished with code ${code}\r\n`)
          sendAiCommitStatus(projectId, ok ? 'success' : 'error')
          activeAiCommitProjects.delete(projectId)
          resolve(ok)
        })
        return
      }
      sendAiCommitOutput(projectId, `[AI Commit] process error: ${err.message}\r\n`)
      sendAiCommitStatus(projectId, 'error')
      activeAiCommitProjects.delete(projectId)
      resolve(false)
    })

    child.on('close', (code) => {
      const tailOut = stdoutDecoder.end()
      if (tailOut) {
        sendAiCommitOutput(projectId, tailOut.replace(/\r?\n/g, '\r\n'))
      }
      const tailErr = stderrDecoder.end()
      if (tailErr) {
        sendAiCommitOutput(projectId, tailErr.replace(/\r?\n/g, '\r\n'))
      }
      const ok = code === 0
      sendAiCommitOutput(projectId, `[AI Commit] finished with code ${code}\r\n`)
      sendAiCommitStatus(projectId, ok ? 'success' : 'error')
      activeAiCommitProjects.delete(projectId)
      resolve(ok)
    })
  })
}

function quoteBashSingle(input: string): string {
  return input.replace(/'/g, "'\\''")
}

function registerIpcHandlers(): void {
  if (ipcHandlersRegistered) return
  ipcHandlersRegistered = true

  ipcMain.handle(IPC.DETECT_DIRECTORY, (_event, dirPath: string) => {
    return detectProject(dirPath)
  })

  ipcMain.handle(
    IPC.PROCESS_START,
    (_event, projectId: string, command: string, cwd: string, useWsl?: boolean) => {
      const started = processManager?.start(projectId, command, cwd, useWsl) ?? false
      if (started) {
        emitRuntimeStateChanged({ reason: 'process-start', projectId })
      }
      return started
    }
  )

  ipcMain.handle(IPC.PROCESS_STOP, (_event, projectId: string) => {
    const stopped = processManager?.stop(projectId) ?? false
    if (stopped) {
      emitRuntimeStateChanged({ reason: 'process-stop', projectId })
    }
    return stopped
  })

  ipcMain.handle(
    IPC.PROCESS_INPUT,
    (_event, projectId: string, data: string) => {
      processManager?.sendInput(projectId, data)
      return true
    }
  )

  ipcMain.handle(IPC.PROCESS_RESIZE, (_event, projectId: string, cols: number, rows: number) => {
    processManager?.resize(projectId, cols, rows)
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
        applyWindowBackground(mainWindow, updated.theme, nativeTheme.shouldUseDarkColors)
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
    return runAiCommit(projectId, projectPath, override)
  })

  ipcMain.handle(IPC.AI_COMMIT_GET_STATE, (_event, projectId: string): AiCommitTaskSnapshot | null => {
    return markAiCommitInterruptedIfOrphan(projectId) ?? null
  })

  ipcMain.handle(IPC.GIT_GET_LATEST_COMMIT, async (_event, projectPath: string) => {
    return gitService.readRecentCommits(projectPath)
  })

  ipcMain.handle(IPC.GIT_GET_WORKSPACE_SNAPSHOT, async (_event, projectPath: string) => {
    return gitService.readGitWorkspaceSnapshot(projectPath)
  })

  ipcMain.handle(IPC.GIT_RUN_OPERATION, async (_event, request: GitOperationRequest) => {
    return gitService.runGitOperation(request)
  })

  ipcMain.handle(IPC.GIT_SET_FILE_STAGE, async (_event, request: GitSetFileStageRequest) => {
    return gitService.setGitFileStage(request)
  })

  ipcMain.handle(IPC.GIT_GET_FILE_DIFF, async (_event, request: GitFileDiffRequest) => {
    return gitService.getGitFileDiff(request)
  })

  ipcMain.handle(IPC.GIT_GET_CONFLICT_FILE, async (_event, request: GitConflictFileRequest) => {
    return gitService.getGitConflictFile(request)
  })

  ipcMain.handle(IPC.GIT_RESOLVE_CONFLICT_FILE, async (_event, request: GitResolveConflictRequest) => {
    return gitService.resolveGitConflictFile(request)
  })

  ipcMain.handle(IPC.SHELL_OPEN_EXTERNAL, (_event, url: string) => {
    return shell.openExternal(url)
  })

  ipcMain.handle(IPC.SHELL_OPEN_FOLDER, async (_event, folderPath: string, revealPath?: string) => {
    return openFolder(folderPath, revealPath)
  })

  ipcMain.handle(IPC.SHELL_OPEN_VSCODE, (_event, folderPath: string) => {
    openVsCode(folderPath, bootCapability?.wslDistro || 'Ubuntu')
  })

  ipcMain.handle(IPC.WINDOW_MINIMIZE, () => {
    mainWindow?.minimize()
    return true
  })

  ipcMain.handle(IPC.WINDOW_TOGGLE_MAXIMIZE, () => {
    if (!mainWindow) return false
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize()
    } else {
      mainWindow.maximize()
    }
    return mainWindow.isMaximized()
  })

  ipcMain.handle(IPC.WINDOW_CLOSE, () => {
    mainWindow?.close()
    return true
  })

  ipcMain.handle(IPC.WINDOW_IS_MAXIMIZED, () => {
    return mainWindow?.isMaximized() ?? false
  })

  ipcMain.handle(IPC.DIALOG_SELECT_DIRECTORY, async () => {
    if (!mainWindow) return null
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
    })
    if (!result.canceled && result.filePaths.length > 0) {
      return result.filePaths[0]
    }
    return null
  })

  ipcMain.handle(IPC.PROJECT_FILE_TREE, async (_event, projectPath: string) => {
    try {
      return await listProjectFiles(projectPath)
    } catch (error) {
      throw new Error(toProjectFileServiceErrorMessage(error))
    }
  })

  ipcMain.handle(IPC.PROJECT_FILE_TREE_DIRECTORY, async (_event, projectPath: string, directoryRelativePath: string | null) => {
    try {
      return await listProjectDirectoryFiles(projectPath, directoryRelativePath)
    } catch (error) {
      throw new Error(toProjectFileServiceErrorMessage(error))
    }
  })

  ipcMain.handle(IPC.PROJECT_FILE_SEARCH, async (_event, projectPath: string, query: string) => {
    try {
      return await searchProjectFiles(projectPath, query)
    } catch (error) {
      throw new Error(toProjectFileServiceErrorMessage(error))
    }
  })

  ipcMain.handle(
    IPC.PROJECT_FILE_CONTENT_SEARCH,
    async (_event, projectPath: string, query: string, options?: ProjectFileContentSearchOptions) => {
    try {
        return await searchProjectContent(projectPath, query, options)
    } catch (error) {
      throw new Error(toProjectFileServiceErrorMessage(error))
    }
    }
  )

  ipcMain.handle(IPC.PROJECT_FILE_READ, async (_event, projectPath: string, relativePath: string) => {
    try {
      return await readProjectFile(projectPath, relativePath)
    } catch (error) {
      throw new Error(toProjectFileServiceErrorMessage(error))
    }
  })

  ipcMain.handle(IPC.PROJECT_FILE_STAT, async (_event, projectPath: string, relativePath: string) => {
    try {
      return await statProjectFile(projectPath, relativePath)
    } catch (error) {
      throw new Error(toProjectFileServiceErrorMessage(error))
    }
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
      try {
        return await writeProjectFile(projectPath, relativePath, content, expectedMtimeMs)
      } catch (error) {
        throw new Error(toProjectFileServiceErrorMessage(error))
      }
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
      try {
        return await writeProjectImageFile(
          projectPath,
          targetDirectoryRelativePath,
          extension,
          dataBase64
        )
      } catch (error) {
        throw new Error(toProjectFileServiceErrorMessage(error))
      }
    }
  )

  // ── Runtime Manager ──────────────────────────────────────

  ipcMain.handle(
    IPC.RUNTIME_START,
    async (_event, projectId: string, projectPath: string, cli?: 'claude' | 'codex') => {
      return runtimeService.startRuntime(projectId, projectPath, cli)
    }
  )

  ipcMain.handle(IPC.SHELL_OPEN_TERMINAL, async (_event, sessionName: string, statusHint?: string) => {
    return runtimeService.openRuntimeTerminal(sessionName, statusHint)
  })

  ipcMain.handle(IPC.SHELL_OPEN_PATH_TERMINAL, async (_event, folderPath: string, command?: string) => {
    return openTerminalAtPath(folderPath, bootCapability?.wslDistro || 'Ubuntu', command)
  })

  ipcMain.handle(IPC.RUNTIME_LIST_ENTRIES, () => {
    return runtimeService.listRuntimeEntries()
  })

  ipcMain.handle(IPC.RUNTIME_DIAGNOSTICS, async () => {
    return runtimeService.diagnoseRuntime()
  })

  // ── WSL / tmux ──────────────────────────────────────────

  ipcMain.handle(IPC.WSL_GET_CAPABILITY, () => {
    return bootCapability
  })

  ipcMain.handle(IPC.TMUX_LIST_SESSIONS, () => {
    return tmuxManager.listLauncherSessions()
  })

  ipcMain.handle(IPC.TMUX_KILL_SESSION, (_event, sessionName: string) => {
    return runtimeService.killTmuxSession(sessionName)
  })

  ipcMain.handle(IPC.TERMINAL_LIST_ALL, async (): Promise<TerminalProcessInventory> => {
    return runtimeService.listTerminalInventory()
  })

  ipcMain.handle(IPC.TERMINAL_STOP_ALL, async (): Promise<TerminalStopAllResult> => {
    return runtimeService.stopAllTerminals()
  })

}

// ── before-quit ───────────────────────────────────────────

let isQuitting = false

app.on('before-quit', async (e) => {
  if (isQuitting) return
  e.preventDefault()
  isQuitting = true

  const { runtimeKeepAliveOnQuit = false } = loadConfig()
  if (!runtimeKeepAliveOnQuit) {
    await runtimeService.cleanupOnBeforeQuit()
  }

  processManager?.stopAll()

  setTimeout(() => {
    app.quit()
  }, 1500)
})

// ── startup ──────────────────────────────────────────────

if (process.platform === 'win32' && app.isPackaged) {
  app.setAppUserModelId('com.yaoyuchen.yyc')
}

app.whenReady().then(async () => {
  nativeTheme.on('updated', () => {
    const { theme } = loadConfig()
    if (theme === 'system') {
      applyWindowBackground(mainWindow, theme, nativeTheme.shouldUseDarkColors)
    }
  })

  // P0 1: One-time capability probe
  await capabilityManager.init()
  bootCapability = capabilityManager.get()

  // Create ProcessManager with capability injected
  processManager = new ProcessManager(bootCapability)

  registerIpcHandlers()
  createMainWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
