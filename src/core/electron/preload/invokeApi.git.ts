import { ipcRenderer } from 'electron'
import { IPC } from '../main/ipc'
import type {
  GitConflictFileRequest,
  GitFileDiffRequest,
  GitOperationRequest,
  GitResolveConflictRequest,
  GitSetFileStageRequest,
} from '../../shared/types'

export function createGitInvokeApi() {
  return {
    getLatestCommit: (repoRoot: string) => ipcRenderer.invoke(IPC.GIT_GET_LATEST_COMMIT, repoRoot),

    listGitRepositories: (workspacePath: string) =>
      ipcRenderer.invoke(IPC.GIT_LIST_REPOSITORIES, workspacePath),

    getGitRepositorySnapshot: (repoRoot: string) =>
      ipcRenderer.invoke(IPC.GIT_GET_REPOSITORY_SNAPSHOT, repoRoot),

    runGitOperation: (request: GitOperationRequest) =>
      ipcRenderer.invoke(IPC.GIT_RUN_OPERATION, request),

    setGitFileStage: (request: GitSetFileStageRequest) =>
      ipcRenderer.invoke(IPC.GIT_SET_FILE_STAGE, request),

    getGitFileDiff: (request: GitFileDiffRequest) =>
      ipcRenderer.invoke(IPC.GIT_GET_FILE_DIFF, request),

    getGitConflictFile: (request: GitConflictFileRequest) =>
      ipcRenderer.invoke(IPC.GIT_GET_CONFLICT_FILE, request),

    resolveGitConflictFile: (request: GitResolveConflictRequest) =>
      ipcRenderer.invoke(IPC.GIT_RESOLVE_CONFLICT_FILE, request),
  }
}
