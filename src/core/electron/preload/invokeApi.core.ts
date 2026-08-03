import { clipboard, ipcRenderer, webUtils } from 'electron'
import { IPC } from '../main/ipc'
import type {
  AgentHookEnvelope,
  AgentHookGatewayStatus,
  AiCommitRunOverride,
  AiCommitTaskSnapshot,
  AiCommitUndoCloseReason,
  AiCommitUndoResult,
  BrowserDataCleanupResult,
  BrowserDataMaintenanceInfo,
  LegacyUserDataMigrationInfo,
  LegacyUserDataMigrationResult,
  ClaudeBashrcConfig,
  CodexSettingsInput,
  CodexSettingsSaveResult,
  TranscriptCaptureInitialText,
} from '../../shared/types'

export function createCoreInvokeApi() {
  return {
    detectProjects: (dirPath: string) => ipcRenderer.invoke(IPC.DETECT_DIRECTORY, dirPath),

    startProcess: (projectId: string, command: string, cwd: string, useWsl?: boolean) => ipcRenderer.invoke(IPC.PROCESS_START, projectId, command, cwd, useWsl),

    stopProcess: (projectId: string) => ipcRenderer.invoke(IPC.PROCESS_STOP, projectId),

    sendInput: (projectId: string, data: string) => ipcRenderer.invoke(IPC.PROCESS_INPUT, projectId, data),

    resizeTerminal: (projectId: string, cols: number, rows: number) => ipcRenderer.invoke(IPC.PROCESS_RESIZE, projectId, cols, rows),

    getConfig: () => ipcRenderer.invoke(IPC.CONFIG_GET),

    setConfig: (partial: Record<string, unknown>) => ipcRenderer.invoke(IPC.CONFIG_SET, partial),

    restartApp: () => ipcRenderer.invoke(IPC.APP_RESTART) as Promise<boolean>,

    getCacheLocationInfo: () => ipcRenderer.invoke(IPC.CACHE_LOCATION_GET),

    getLegacyUserDataMigrationInfo: () => ipcRenderer.invoke(IPC.LEGACY_USER_DATA_MIGRATION_GET) as Promise<LegacyUserDataMigrationInfo>,

    migrateLegacyUserData: () => ipcRenderer.invoke(IPC.LEGACY_USER_DATA_MIGRATION_RUN) as Promise<LegacyUserDataMigrationResult>,

    getBrowserDataMaintenanceInfo: () => ipcRenderer.invoke(IPC.BROWSER_DATA_MAINTENANCE_GET) as Promise<BrowserDataMaintenanceInfo>,

    cleanupLegacyBrowserCaches: (rootPath?: string) => ipcRenderer.invoke(IPC.BROWSER_DATA_MAINTENANCE_CLEANUP, rootPath) as Promise<BrowserDataCleanupResult>,

    getCodexEnvironmentScope: () => ipcRenderer.invoke(IPC.CODEX_SCOPE_GET),

    getCodexSettings: () => ipcRenderer.invoke(IPC.CODEX_SETTINGS_GET),

    setCodexSettings: (payload: CodexSettingsInput): Promise<CodexSettingsSaveResult> => ipcRenderer.invoke(IPC.CODEX_SETTINGS_SET, payload),

    getClaudeBashrcConfig: () => ipcRenderer.invoke(IPC.CLAUDE_BASHRC_GET),

    setClaudeBashrcConfig: (config: ClaudeBashrcConfig) => ipcRenderer.invoke(IPC.CLAUDE_BASHRC_SET, config),

    setWindowsUserEnv: (config: ClaudeBashrcConfig) => ipcRenderer.invoke(IPC.WINDOWS_USER_ENV_SET, config),

    setDocLinkSecret: (projectId: string, linkId: string, secret: string) => ipcRenderer.invoke(IPC.DOC_LINK_SECRET_SET, projectId, linkId, secret),

    getDocLinkSecret: (projectId: string, linkId: string) =>
      ipcRenderer.invoke(IPC.DOC_LINK_SECRET_GET, projectId, linkId) as Promise<{
        secret: string | null
      }>,

    deleteDocLinkSecret: (projectId: string, linkId: string) => ipcRenderer.invoke(IPC.DOC_LINK_SECRET_DELETE, projectId, linkId),

    selectDirectory: (defaultPath?: string) => ipcRenderer.invoke(IPC.DIALOG_SELECT_DIRECTORY, defaultPath),

    getPathForFile: (file: File) => {
      try {
        return webUtils.getPathForFile(file)
      } catch {
        return ''
      }
    },

    readClipboardImagePngBase64: () => {
      try {
        const image = clipboard.readImage()
        if (image.isEmpty()) return null
        return image.toPNG().toString('base64')
      } catch {
        return null
      }
    },

    readClipboardText: () => {
      try {
        return clipboard.readText()
      } catch {
        return ''
      }
    },

    consumeTranscriptCaptureInitialText: () => ipcRenderer.invoke(IPC.TRANSCRIPT_CAPTURE_INITIAL_TEXT_CONSUME) as Promise<TranscriptCaptureInitialText>,

    captureWindowRectToPngBase64: (rect: { x: number; y: number; width: number; height: number }) => ipcRenderer.invoke(IPC.WINDOW_CAPTURE_RECT, rect) as Promise<string>,

    writeClipboardImagePngBase64: (pngBase64: string) => ipcRenderer.invoke(IPC.CLIPBOARD_WRITE_IMAGE, pngBase64) as Promise<boolean>,

    readLocalImageAsDataUrl: (source: string) => ipcRenderer.invoke(IPC.LOCAL_IMAGE_READ_DATA_URL, source) as Promise<string>,

    openExternal: (url: string) => ipcRenderer.invoke(IPC.SHELL_OPEN_EXTERNAL, url),

    openFolder: (folderPath: string, revealPath?: string) => ipcRenderer.invoke(IPC.SHELL_OPEN_FOLDER, folderPath, revealPath),

    openInVsCode: (folderPath: string) => ipcRenderer.invoke(IPC.SHELL_OPEN_VSCODE, folderPath),

    minimizeWindow: () => ipcRenderer.invoke(IPC.WINDOW_MINIMIZE),

    toggleMaximizeWindow: () => ipcRenderer.invoke(IPC.WINDOW_TOGGLE_MAXIMIZE),

    closeWindow: () => ipcRenderer.invoke(IPC.WINDOW_CLOSE),

    isWindowMaximized: () => ipcRenderer.invoke(IPC.WINDOW_IS_MAXIMIZED),

    trayPanelShowMainWindow: () => ipcRenderer.invoke(IPC.TRAY_PANEL_SHOW_MAIN),

    trayPanelHideMainWindow: () => ipcRenderer.invoke(IPC.TRAY_PANEL_HIDE_MAIN),

    trayPanelQuitApp: () => ipcRenderer.invoke(IPC.TRAY_PANEL_QUIT),

    trayPanelDismiss: () => ipcRenderer.invoke(IPC.TRAY_PANEL_DISMISS),

    trayPanelResizeToContent: (size: { width: number; height: number }) => ipcRenderer.invoke(IPC.TRAY_PANEL_RESIZE_TO_CONTENT, size),

    runAiCommit: (projectId: string, repoRoot: string, override?: AiCommitRunOverride) => ipcRenderer.invoke(IPC.AI_COMMIT_RUN, projectId, repoRoot, override),

    cancelAiCommit: (projectId: string) => ipcRenderer.invoke(IPC.AI_COMMIT_CANCEL, projectId) as Promise<boolean>,

    getAiCommitState: (projectId: string) => ipcRenderer.invoke(IPC.AI_COMMIT_GET_STATE, projectId) as Promise<AiCommitTaskSnapshot | null>,

    beginAiCommitUndoAuth: (projectId: string) => ipcRenderer.invoke(IPC.AI_COMMIT_BEGIN_UNDO_AUTH, projectId) as Promise<AiCommitTaskSnapshot | null>,

    cancelAiCommitUndoAuth: (projectId: string) => ipcRenderer.invoke(IPC.AI_COMMIT_CANCEL_UNDO_AUTH, projectId) as Promise<AiCommitTaskSnapshot | null>,

    undoAiCommit: (projectId: string) => ipcRenderer.invoke(IPC.AI_COMMIT_UNDO, projectId) as Promise<AiCommitUndoResult>,

    closeAiCommitUndo: (projectId: string, reason?: AiCommitUndoCloseReason) => ipcRenderer.invoke(IPC.AI_COMMIT_CLOSE_UNDO, projectId, reason) as Promise<AiCommitTaskSnapshot | null>,

    getAgentHookStatus: () => ipcRenderer.invoke(IPC.AGENT_HOOK_GET_STATUS) as Promise<AgentHookGatewayStatus>,

    getAgentHookRecentEvents: () => ipcRenderer.invoke(IPC.AGENT_HOOK_GET_RECENT_EVENTS) as Promise<AgentHookEnvelope[]>,
  }
}
