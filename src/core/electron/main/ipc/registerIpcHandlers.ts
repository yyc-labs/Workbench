import { registerCoreIpcHandlers } from './registerCoreIpcHandlers'
import { registerAgentLogsIpcHandlers } from './registerAgentLogsIpcHandlers'
import { registerGitIpcHandlers } from './registerGitIpcHandlers'
import { registerAiGatewayIpcHandlers } from './registerAiGatewayIpcHandlers'
import { registerAiConnectionIpcHandlers } from './registerAiConnectionIpcHandlers'
import { registerBrowserAiIpcHandlers } from './registerBrowserAiIpcHandlers'
import { registerBrowserScreenshotIpcHandlers } from './registerBrowserScreenshotIpcHandlers'
import { registerLearningIpcHandlers } from './registerLearningIpcHandlers'
import { registerSkillIpcHandlers } from './registerSkillIpcHandlers'
import { registerProjectFileIpcHandlers } from './registerProjectFileIpcHandlers'
import { registerRuntimeIpcHandlers } from './registerRuntimeIpcHandlers'
import { registerProcessPortsIpcHandlers } from './registerProcessPortsIpcHandlers'
import { registerTranscriptIpcHandlers } from './registerTranscriptIpcHandlers'
import { registerMarkdownDocumentIpcHandlers } from './registerMarkdownDocumentIpcHandlers'
import type { RegisterIpcHandlersDependencies, RuntimeStateChangedPayload } from './registerIpcHandlers.shared'

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
  registerSkillIpcHandlers(deps)
  registerRuntimeIpcHandlers(deps)
  registerProcessPortsIpcHandlers(deps)
  registerAiGatewayIpcHandlers(deps)
  registerAiConnectionIpcHandlers(deps)
  registerBrowserAiIpcHandlers(deps)
  registerBrowserScreenshotIpcHandlers(deps)
  registerMarkdownDocumentIpcHandlers(deps.markdownDocumentService, deps.markdownDocumentOpenRequestStore, deps.routeMarkdownDocumentOpen)
}
