import { ipcMain } from 'electron'
import { IPC } from '../ipc'
import type {
  GitConflictFileRequest,
  GitFileDiffRequest,
  GitOperationRequest,
  GitResolveConflictRequest,
  GitSetFileStageRequest,
} from '../../../shared/types'
import {
  normalizeGitRequest,
  type RegisterIpcHandlersDependencies,
} from './registerIpcHandlers.shared'

export function registerGitIpcHandlers(
  deps: RegisterIpcHandlersDependencies
): void {
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

  ipcMain.handle(
    IPC.GIT_RESOLVE_CONFLICT_FILE,
    async (_event, request: GitResolveConflictRequest) => {
      return deps.gitService.resolveGitConflictFile(
        normalizeGitRequest(request) as GitResolveConflictRequest
      )
    }
  )
}
