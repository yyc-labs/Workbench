import { registerAgentLogsIpcHandlers } from './registerAgentLogsIpcHandlers'
import { registerAiConnectionIpcHandlers } from './registerAiConnectionIpcHandlers'
import { registerAiGatewayIpcHandlers } from './registerAiGatewayIpcHandlers'
import { registerBrowserAiIpcHandlers } from './registerBrowserAiIpcHandlers'
import { registerBrowserScreenshotIpcHandlers } from './registerBrowserScreenshotIpcHandlers'
import { registerCoreIpcHandlers } from './registerCoreIpcHandlers'
import { registerDocLinkLibraryIpcHandlers } from './registerDocLinkLibraryIpcHandlers'
import { registerGitIpcHandlers } from './registerGitIpcHandlers'
import type { RegisterIpcHandlersDependencies, RuntimeStateChangedPayload } from './registerIpcHandlers.shared'
import { registerLearningIpcHandlers } from './registerLearningIpcHandlers'
import { registerMarkdownDocumentIpcHandlers } from './registerMarkdownDocumentIpcHandlers'
import { registerProcessPortsIpcHandlers } from './registerProcessPortsIpcHandlers'
import { registerProjectFileIpcHandlers } from './registerProjectFileIpcHandlers'
import { registerQuickActionIpcHandlers } from './registerQuickActionIpcHandlers'
import { registerRunTaskIpcHandlers } from './registerRunTaskIpcHandlers'
import { registerRuntimeIpcHandlers } from './registerRuntimeIpcHandlers'
import { registerSkillIpcHandlers } from './registerSkillIpcHandlers'
import { registerTranscriptIpcHandlers } from './registerTranscriptIpcHandlers'

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
  registerRunTaskIpcHandlers(deps)
  registerAiGatewayIpcHandlers(deps)
  registerAiConnectionIpcHandlers(deps)
  registerBrowserAiIpcHandlers(deps)
  registerBrowserScreenshotIpcHandlers(deps)
  registerMarkdownDocumentIpcHandlers(deps.markdownDocumentService, deps.markdownDocumentOpenRequestStore, deps.routeMarkdownDocumentOpen)
  registerDocLinkLibraryIpcHandlers(deps.docLinkLibraryService)
  registerQuickActionIpcHandlers(deps)
}
