import { ipcRenderer } from 'electron'
import { IPC } from '../main/ipc'
import type { GitConflictFileRequest, GitFileDiffRequest, GitOperationRequest, GitResolveConflictRequest, GitSetFileStageRequest, GitStatusOptimizationRequest } from '../../shared/types'

export function createGitInvokeApi() {
  return {
    // Git 性能埋点开关（默认关闭）；renderer 侧计时仅在开启时输出，见 docs/todo/04-ai-commit-与-git-plan-detail.md §2。
    gitTraceEnabled: process.env.WORKBENCH_GIT_TRACE === '1',

    getLatestCommit: (repoRoot: string) => ipcRenderer.invoke(IPC.GIT_GET_LATEST_COMMIT, repoRoot),

    listGitRepositories: (workspacePath: string) => ipcRenderer.invoke(IPC.GIT_LIST_REPOSITORIES, workspacePath),

    getGitRepositorySnapshot: (repoRoot: string) => ipcRenderer.invoke(IPC.GIT_GET_REPOSITORY_SNAPSHOT, repoRoot),

    getGitRepositorySnapshotLight: (repoRoot: string) => ipcRenderer.invoke(IPC.GIT_GET_REPOSITORY_SNAPSHOT_LIGHT, repoRoot),

    getGitStatusOptimization: (repoRoot: string) => ipcRenderer.invoke(IPC.GIT_GET_STATUS_OPTIMIZATION, repoRoot),

    setGitStatusOptimization: (request: GitStatusOptimizationRequest) => ipcRenderer.invoke(IPC.GIT_SET_STATUS_OPTIMIZATION, request),

    runGitOperation: (request: GitOperationRequest) => ipcRenderer.invoke(IPC.GIT_RUN_OPERATION, request),

    setGitFileStage: (request: GitSetFileStageRequest) => ipcRenderer.invoke(IPC.GIT_SET_FILE_STAGE, request),

    getGitFileDiff: (request: GitFileDiffRequest) => ipcRenderer.invoke(IPC.GIT_GET_FILE_DIFF, request),

    getGitConflictFile: (request: GitConflictFileRequest) => ipcRenderer.invoke(IPC.GIT_GET_CONFLICT_FILE, request),

    resolveGitConflictFile: (request: GitResolveConflictRequest) => ipcRenderer.invoke(IPC.GIT_RESOLVE_CONFLICT_FILE, request),
  }
}
