import { registerCoreIpcHandlers } from './registerCoreIpcHandlers'
import { registerGitIpcHandlers } from './registerGitIpcHandlers'
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
  registerGitIpcHandlers(deps)
  registerProjectFileIpcHandlers()
  registerTranscriptIpcHandlers(deps)
  registerLearningIpcHandlers(deps)
  registerRuntimeIpcHandlers(deps)
}
