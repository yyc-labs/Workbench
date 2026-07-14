import { registerCoreIpcHandlers } from './registerCoreIpcHandlers'
import { registerAgentLogsIpcHandlers } from './registerAgentLogsIpcHandlers'
import { registerGitIpcHandlers } from './registerGitIpcHandlers'
import { registerAiGatewayIpcHandlers } from './registerAiGatewayIpcHandlers'
import { registerBrowserAiIpcHandlers } from './registerBrowserAiIpcHandlers'
import { registerLearningIpcHandlers } from './registerLearningIpcHandlers'
import { registerProjectFileIpcHandlers } from './registerProjectFileIpcHandlers'
import { registerRuntimeIpcHandlers } from './registerRuntimeIpcHandlers'
import { registerTranscriptIpcHandlers } from './registerTranscriptIpcHandlers'
import type {
  RegisterIpcHandlersDependencies,
  RuntimeStateChangedPayload,
} from './registerIpcHandlers.shared'

let ipcHandlersRegistered = false

export type {
  RegisterIpcHandlersDependencies,
  RuntimeStateChangedPayload,
} from './registerIpcHandlers.shared'

export function registerIpcHandlers(deps: RegisterIpcHandlersDependencies): void {
  if (ipcHandlersRegistered) return
  ipcHandlersRegistered = true

  registerCoreIpcHandlers(deps)
  registerAgentLogsIpcHandlers(deps)
  registerGitIpcHandlers(deps)
  registerProjectFileIpcHandlers()
  registerTranscriptIpcHandlers(deps)
  registerLearningIpcHandlers(deps)
  registerRuntimeIpcHandlers(deps)
  registerAiGatewayIpcHandlers(deps)
  registerBrowserAiIpcHandlers(deps)
}
