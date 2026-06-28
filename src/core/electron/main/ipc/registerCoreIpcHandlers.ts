import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  nativeImage,
  nativeTheme,
  shell,
} from 'electron'
import { detectProject } from '../detector'
import { loadConfig, updateConfig } from '../config'
import { IPC } from '../ipc'
import { readLocalImageAsDataUrl } from '../local-image-service'
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
import { openFolder, openVsCode } from '../shell/openers'
import { syncWindowsLaunchOnLogin } from '../launchOnLogin'
import type {
  AiCommitRunOverride,
  AiCommitTaskSnapshot,
  AiCommitUndoCloseReason,
  AiCommitUndoResult,
  AppConfig,
  CodexSettingsSaveResult,
} from '../../../shared/types'
import { getBootDistro, type RegisterIpcHandlersDependencies } from './registerIpcHandlers.shared'

export function registerCoreIpcHandlers(
  deps: RegisterIpcHandlersDependencies
): void {
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

  ipcMain.handle(IPC.PROCESS_INPUT, (_event, projectId: string, data: string) => {
    deps.getProcessManager()?.sendInput(projectId, data)
    return true
  })

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

  ipcMain.handle(
    IPC.CONFIG_SET,
    async (_event, partial: Record<string, unknown>) => {
      const updated = await updateConfig(
        partial as Partial<AppConfig> & { startupDefaultTagId?: string }
      )
      if (Object.prototype.hasOwnProperty.call(partial, 'theme')) {
        applyWindowBackground(
          deps.getMainWindow(),
          updated.theme,
          nativeTheme.shouldUseDarkColors
        )
      }
      if (Object.prototype.hasOwnProperty.call(partial, 'launchOnLogin')) {
        syncWindowsLaunchOnLogin(updated)
      }
      return updated
    }
  )

  ipcMain.handle(IPC.CODEX_SCOPE_GET, async () => {
    return resolveCodexEnvironmentScope(deps.getCapability())
  })

  ipcMain.handle(IPC.CODEX_SETTINGS_GET, async () => {
    return readCodexSettings(deps.getCapability())
  })

  ipcMain.handle(
    IPC.CODEX_SETTINGS_SET,
    async (_event, payload: Record<string, unknown>): Promise<CodexSettingsSaveResult> => {
      const providerApiKeys =
        payload.providerApiKeys && typeof payload.providerApiKeys === 'object'
          ? (payload.providerApiKeys as Record<string, string>)
          : {}
      const config =
        payload.config && typeof payload.config === 'object'
          ? normalizeCodexConfig(payload.config as Record<string, unknown>)
          : normalizeCodexConfig({})

      const snapshot = await writeCodexSettings(deps.getCapability(), {
        providerApiKeys,
        config,
      })
      return {
        snapshot,
        appConfig: loadConfig(),
      }
    }
  )

  ipcMain.handle(IPC.CLAUDE_BASHRC_GET, async () => {
    return readClaudeBashrcConfig()
  })

  ipcMain.handle(IPC.CLAUDE_BASHRC_SET, async (_event, config: Record<string, unknown>) => {
    const normalized = normalizeClaudeBashrcConfig(config)
    const saved = await writeClaudeBashrcConfig(normalized)
    await writeWindowsUserEnv(saved).catch(() => {})
    return process.platform === 'win32'
      ? applyWindowsUserEnvToCurrentProcess(saved)
      : saved
  })

  ipcMain.handle(IPC.WINDOWS_USER_ENV_SET, async (_event, config: Record<string, unknown>) => {
    const normalized = normalizeClaudeBashrcConfig(config)
    await writeWindowsUserEnv(normalized)
    return applyWindowsUserEnvToCurrentProcess(normalized)
  })

  ipcMain.handle(
    IPC.DOC_LINK_SECRET_SET,
    (_event, projectId: string, linkId: string, secret: string) => {
      setDocLinkSecret(projectId, linkId, secret)
      return true
    }
  )

  ipcMain.handle(IPC.DOC_LINK_SECRET_GET, (_event, projectId: string, linkId: string) => {
    const secret = getDocLinkSecret(projectId, linkId)
    return { secret }
  })

  ipcMain.handle(IPC.DOC_LINK_SECRET_DELETE, (_event, projectId: string, linkId: string) => {
    deleteDocLinkSecret(projectId, linkId)
    return true
  })

  ipcMain.handle(
    IPC.AI_COMMIT_RUN,
    async (_event, projectId: string, repoRoot: string, override?: AiCommitRunOverride) => {
      return deps.aiCommitService.runAiCommit(projectId, repoRoot, override)
    }
  )

  ipcMain.handle(IPC.AI_COMMIT_GET_STATE, (_event, projectId: string): AiCommitTaskSnapshot | null => {
    return deps.aiCommitService.getAiCommitState(projectId)
  })

  ipcMain.handle(
    IPC.AI_COMMIT_BEGIN_UNDO_AUTH,
    (_event, projectId: string): AiCommitTaskSnapshot | null => {
      return deps.aiCommitService.beginAiCommitUndoAuth(projectId)
    }
  )

  ipcMain.handle(
    IPC.AI_COMMIT_CANCEL_UNDO_AUTH,
    (_event, projectId: string): AiCommitTaskSnapshot | null => {
      return deps.aiCommitService.cancelAiCommitUndoAuth(projectId)
    }
  )

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

  ipcMain.handle(IPC.SHELL_OPEN_EXTERNAL, (_event, url: string) => {
    return shell.openExternal(url)
  })

  ipcMain.handle(IPC.SHELL_OPEN_FOLDER, async (_event, folderPath: string, revealPath?: string) => {
    return openFolder(folderPath, revealPath)
  })

  ipcMain.handle(IPC.SHELL_OPEN_VSCODE, (_event, folderPath: string) => {
    openVsCode(folderPath, getBootDistro(deps))
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

  ipcMain.handle(IPC.TRAY_PANEL_SHOW_MAIN, () => {
    deps.getMainWindow()?.show()
    deps.getMainWindow()?.focus()
    return true
  })

  ipcMain.handle(IPC.TRAY_PANEL_HIDE_MAIN, () => {
    deps.getMainWindow()?.hide()
    return true
  })

  ipcMain.handle(IPC.TRAY_PANEL_QUIT, () => {
    app.quit()
    return true
  })

  ipcMain.handle(IPC.TRAY_PANEL_DISMISS, () => {
    return true
  })

  ipcMain.handle(IPC.TRAY_PANEL_RESIZE_TO_CONTENT, () => true)

  ipcMain.handle(IPC.WINDOW_IS_MAXIMIZED, () => {
    return deps.getMainWindow()?.isMaximized() ?? false
  })

  ipcMain.handle(IPC.DIALOG_SELECT_DIRECTORY, async (_event, defaultPath?: string) => {
    const currentWindow = deps.getMainWindow()
    if (!currentWindow) return null

    const result = await dialog.showOpenDialog(currentWindow, {
      properties: ['openDirectory'],
      defaultPath:
        typeof defaultPath === 'string' && defaultPath.trim()
          ? defaultPath.trim()
          : undefined,
    })
    if (!result.canceled && result.filePaths.length > 0) {
      return result.filePaths[0]
    }
    return null
  })
}
