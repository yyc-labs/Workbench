import { CloudDownload, CloudUpload, Download, GitMerge, GitCommitHorizontal, Shuffle } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { GitWorkflowExecutionContext, GitWorkflowNodeData, GitWorkflowValidationContext, GitWorkflowValidationIssue } from './gitWorkflow.types'
import type { GitOperationRequest } from '../../../shared/types'

type GitWorkflowOperationDefinitionBase<TData extends GitWorkflowNodeData> = {
  operation: TData['operation']
  labelKey: string
  descriptionKey: string
  icon: LucideIcon
  createDefaultData: () => TData
  validateConfig: (data: TData, context: GitWorkflowValidationContext) => GitWorkflowValidationIssue[]
  resolveRequest: (data: TData, context: GitWorkflowExecutionContext) => GitOperationRequest | 'wait-for-input'
  confirmation: 'none' | 'normal' | 'high'
}

function createDefaultValidationIssue(code: GitWorkflowValidationIssue['code'], message: string, nodeId?: string): GitWorkflowValidationIssue {
  return { code, level: 'error', message, ...(nodeId ? { nodeId } : {}) }
}

function isValidGitBranchName(name: string): boolean {
  if (!name || name.length > 255) return false
  if (name.startsWith('/') || name.endsWith('/')) return false
  if (name.includes('//')) return false
  if (name.includes('\\')) return false
  if (name.includes('..')) return false
  if (name.includes('@{')) return false
  if (name.endsWith('.')) return false
  if (name.endsWith('.lock')) return false
  if (/[\x00-\x20\x7f~^:?*\[]/.test(name)) return false
  if (name.split('/').some((part) => part.length === 0 || part.startsWith('.') || part.endsWith('.'))) return false
  return true
}

function validateFixedTarget(target: string | undefined, context: GitWorkflowValidationContext): GitWorkflowValidationIssue[] {
  if (!target) return [createDefaultValidationIssue('invalid-config', 'Target branch is required.')]
  if (target === context.currentBranch) return [createDefaultValidationIssue('invalid-config', 'Target branch cannot be the current branch.')]
  return []
}

export const GIT_WORKFLOW_OPERATION_DEFINITIONS = {
  fetch: {
    operation: 'fetch',
    labelKey: 'detail.gitOpFetch',
    descriptionKey: 'detail.gitOpDescFetch',
    icon: CloudDownload,
    createDefaultData: () => ({
      schemaVersion: 1 as const,
      operation: 'fetch' as const,
      requiresConfirmation: false,
      config: {},
      failurePolicy: 'pause' as const,
    }),
    validateConfig: () => [],
    resolveRequest: (_data, context) => ({
      repoRoot: '',
      operation: 'fetch',
      remoteName: undefined,
      targetBranch: undefined,
      ...(context.selectedTargetBranch ? { targetBranch: context.selectedTargetBranch } : {}),
    }),
    confirmation: 'none' as const,
  },
  pull: {
    operation: 'pull',
    labelKey: 'detail.gitOpPull',
    descriptionKey: 'detail.gitOpDescPull',
    icon: Download,
    createDefaultData: () => ({
      schemaVersion: 1 as const,
      operation: 'pull' as const,
      requiresConfirmation: true,
      config: { strategy: 'ff-only' as const },
      failurePolicy: 'pause' as const,
    }),
    validateConfig: () => [],
    resolveRequest: () => ({
      repoRoot: '',
      operation: 'pull',
    }),
    confirmation: 'normal' as const,
  },
  push: {
    operation: 'push',
    labelKey: 'detail.gitOpPush',
    descriptionKey: 'detail.gitOpDescPush',
    icon: CloudUpload,
    createDefaultData: () => ({
      schemaVersion: 1 as const,
      operation: 'push' as const,
      requiresConfirmation: true,
      config: { setUpstreamWhenMissing: true as const },
      failurePolicy: 'pause' as const,
    }),
    validateConfig: () => [],
    resolveRequest: () => ({
      repoRoot: '',
      operation: 'push',
    }),
    confirmation: 'normal' as const,
  },
  switch: {
    operation: 'switch',
    labelKey: 'detail.gitOpSwitch',
    descriptionKey: 'detail.gitOpDescSwitch',
    icon: Shuffle,
    createDefaultData: () => ({
      schemaVersion: 1 as const,
      operation: 'switch' as const,
      requiresConfirmation: true,
      config: { target: { mode: 'prompt' as const } },
      failurePolicy: 'pause' as const,
    }),
    validateConfig: (data, context) => {
      const target = data.config.target
      if (target.mode === 'prompt') return []
      const issues = validateFixedTarget(target.branch, context)
      if (issues.length > 0) return issues
      if (context.localBranches.includes(target.branch) || context.remoteBranches.includes(target.branch)) return []
      return [createDefaultValidationIssue('invalid-config', `Target branch ${target.branch} does not exist.`)]
    },
    resolveRequest: (data) => {
      const target = data.config.target
      if (target.mode !== 'fixed') return 'wait-for-input'
      return {
        repoRoot: '',
        operation: 'switch',
        targetBranch: target.branch,
      }
    },
    confirmation: 'high' as const,
  },
  merge: {
    operation: 'merge',
    labelKey: 'detail.gitOpMerge',
    descriptionKey: 'detail.gitOpDescMerge',
    icon: GitMerge,
    createDefaultData: () => ({
      schemaVersion: 1 as const,
      operation: 'merge' as const,
      requiresConfirmation: true,
      config: { source: { mode: 'prompt' as const }, noEdit: true as const },
      failurePolicy: 'pause' as const,
    }),
    validateConfig: (data, context) => {
      const source = data.config.source
      if (source.mode === 'prompt') return []
      const issues = validateFixedTarget(source.branch, context)
      if (issues.length > 0) return issues
      if (source.branch === context.currentBranch) {
        return [createDefaultValidationIssue('invalid-config', 'Source branch cannot be the current branch.')]
      }
      return []
    },
    resolveRequest: (data) => {
      const source = data.config.source
      if (source.mode !== 'fixed') return 'wait-for-input'
      return {
        repoRoot: '',
        operation: 'merge',
        targetBranch: source.branch,
      }
    },
    confirmation: 'high' as const,
  },
  commit: {
    operation: 'commit',
    labelKey: 'detail.gitOpCommit',
    descriptionKey: 'detail.commitStagedActionHint',
    icon: GitCommitHorizontal,
    createDefaultData: () => ({
      schemaVersion: 1 as const,
      operation: 'commit' as const,
      requiresConfirmation: false,
      config: { message: { mode: 'prompt' as const }, execution: 'confirm-each-run' as const },
      failurePolicy: 'pause' as const,
    }),
    validateConfig: (data) => {
      if (data.config.message.mode === 'ai') return []
      if (data.config.execution !== 'preset-direct') return []
      if (data.config.message.preset && data.config.message.preset.trim().length > 0) return []
      return [createDefaultValidationIssue('invalid-config', 'Commit message preset is required for direct execution.')]
    },
    resolveRequest: () => 'wait-for-input',
    confirmation: 'normal' as const,
  },
} as const satisfies Record<GitWorkflowNodeData['operation'], GitWorkflowOperationDefinitionBase<any>>

export function getGitWorkflowOperationDefinition(operation: GitWorkflowNodeData['operation']) {
  return GIT_WORKFLOW_OPERATION_DEFINITIONS[operation]
}

export function createGitWorkflowNodeData(operation: GitWorkflowNodeData['operation']): GitWorkflowNodeData {
  return GIT_WORKFLOW_OPERATION_DEFINITIONS[operation].createDefaultData()
}

export function validateGitWorkflowNodeConfig(data: GitWorkflowNodeData, context: GitWorkflowValidationContext): GitWorkflowValidationIssue[] {
  const definition = getGitWorkflowOperationDefinition(data.operation)
  return definition.validateConfig(data as never, context)
}
