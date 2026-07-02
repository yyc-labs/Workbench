import { ipcMain } from 'electron'
import { IPC } from '../ipc'
import type { RegisterIpcHandlersDependencies } from './registerIpcHandlers.shared'
import type { AiGatewayClientCli, CodexGatewayBindingSaveInput } from '../../../shared/types'

function normalizeCli(value: unknown): AiGatewayClientCli {
  return value === 'codex' ? 'codex' : 'claude'
}

function normalizeCodexGatewayBindingInput(value: unknown): CodexGatewayBindingSaveInput {
  const raw = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Partial<CodexGatewayBindingSaveInput>
    : {}
  return {
    enabled: Boolean(raw.enabled),
    providerId: typeof raw.providerId === 'string' ? raw.providerId : undefined,
    providerApiKeys: raw.providerApiKeys && typeof raw.providerApiKeys === 'object'
      ? raw.providerApiKeys
      : {},
    config: raw.config && typeof raw.config === 'object'
      ? raw.config
      : {} as CodexGatewayBindingSaveInput['config'],
  }
}

export function registerAiGatewayIpcHandlers(
  deps: RegisterIpcHandlersDependencies
): void {
  ipcMain.handle(IPC.AI_GATEWAY_GET_STATUS, () => {
    return deps.aiGatewayService.getStatus()
  })

  ipcMain.handle(IPC.AI_GATEWAY_GET_CONFIG, () => {
    return deps.aiGatewayService.getConfig()
  })

  ipcMain.handle(IPC.AI_GATEWAY_GET_RECENT_LOGS, () => {
    return deps.aiGatewayService.getRecentLogs()
  })

  ipcMain.handle(IPC.AI_GATEWAY_SAVE_CONFIG, async (_event, config: unknown) => {
    return deps.aiGatewayService.saveConfig(config)
  })

  ipcMain.handle(IPC.AI_GATEWAY_START, async () => {
    return deps.aiGatewayService.start(true)
  })

  ipcMain.handle(IPC.AI_GATEWAY_STOP, async () => {
    return deps.aiGatewayService.stop(true)
  })

  ipcMain.handle(IPC.AI_GATEWAY_APPLY_CLIENT_BINDING, async (_event, cli: unknown) => {
    return deps.aiGatewayService.applyClientBinding(normalizeCli(cli))
  })

  ipcMain.handle(IPC.AI_GATEWAY_RESTORE_CLIENT_BINDING, async (_event, cli: unknown) => {
    return deps.aiGatewayService.restoreClientBinding(normalizeCli(cli))
  })

  ipcMain.handle(IPC.AI_GATEWAY_GET_CODEX_BINDING, async () => {
    return deps.aiGatewayService.getCodexGatewayBinding()
  })

  ipcMain.handle(IPC.AI_GATEWAY_SAVE_CODEX_BINDING, async (_event, input: unknown) => {
    return deps.aiGatewayService.saveCodexGatewayBinding(normalizeCodexGatewayBindingInput(input))
  })
}
