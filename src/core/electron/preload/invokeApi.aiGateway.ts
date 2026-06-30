import { ipcRenderer } from 'electron'
import { IPC } from '../main/ipc'
import type {
  AiGatewayBindingResult,
  AiGatewayClientCli,
  AiGatewayConfig,
  AiGatewayLogEntry,
  AiGatewaySaveConfigResult,
  AiGatewayStatus,
} from '../../shared/types'

export function createAiGatewayInvokeApi() {
  return {
    getAiGatewayStatus: () =>
      ipcRenderer.invoke(IPC.AI_GATEWAY_GET_STATUS) as Promise<AiGatewayStatus>,

    getAiGatewayConfig: () =>
      ipcRenderer.invoke(IPC.AI_GATEWAY_GET_CONFIG) as Promise<AiGatewayConfig>,

    getAiGatewayRecentLogs: () =>
      ipcRenderer.invoke(IPC.AI_GATEWAY_GET_RECENT_LOGS) as Promise<AiGatewayLogEntry[]>,

    saveAiGatewayConfig: (config: AiGatewayConfig) =>
      ipcRenderer.invoke(IPC.AI_GATEWAY_SAVE_CONFIG, config) as Promise<AiGatewaySaveConfigResult>,

    startAiGateway: () =>
      ipcRenderer.invoke(IPC.AI_GATEWAY_START) as Promise<AiGatewayStatus>,

    stopAiGateway: () =>
      ipcRenderer.invoke(IPC.AI_GATEWAY_STOP) as Promise<AiGatewayStatus>,

    applyAiGatewayClientBinding: (cli: AiGatewayClientCli) =>
      ipcRenderer.invoke(IPC.AI_GATEWAY_APPLY_CLIENT_BINDING, cli) as Promise<AiGatewayBindingResult>,

    restoreAiGatewayClientBinding: (cli: AiGatewayClientCli) =>
      ipcRenderer.invoke(IPC.AI_GATEWAY_RESTORE_CLIENT_BINDING, cli) as Promise<AiGatewayBindingResult>,
  }
}
