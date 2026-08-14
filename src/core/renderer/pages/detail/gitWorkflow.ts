import type { GitWorkflowNodeData } from './gitWorkflow.types'
import type { PersistedGitWorkflowGraph } from './gitWorkflow.types'
import { createGitWorkflowGraph, createGitWorkflowNode, createGitWorkflowNodeId, loadGitWorkflowGraph, migrateLegacyGitWorkflowSteps, saveGitWorkflowGraph, validateGitWorkflowGraph } from './gitWorkflow.graph'
import type { GitWorkflowOperation, GitWorkflowRunState } from './gitWorkflow.types'

export type { GitWorkflowOperation, GitWorkflowRunState, PersistedGitWorkflowGraph }

export type GitWorkflowStep = {
  id: string
  operation: GitWorkflowOperation
}

export type PersistedGitWorkflow = {
  version: 2
  updatedAt: number
  entryNodeId: string
  nodes: Array<{
    id: string
    type: 'gitOperation'
    position: { x: number; y: number }
    data: GitWorkflowNodeData
  }>
  edges: Array<{
    id: string
    type: 'success' | 'failure'
    source: string
    sourceHandle: 'success' | 'failure'
    target: string
    targetHandle: 'input'
    data: { kind: 'success' | 'failure' }
  }>
  viewport?: {
    x: number
    y: number
    zoom: number
  }
}

export const GIT_WORKFLOW_VERSION = 2 as const

export const DEFAULT_GIT_WORKFLOW: GitWorkflowStep[] = [
  { id: 'default-fetch', operation: 'fetch' },
  { id: 'default-pull', operation: 'pull' },
  { id: 'default-merge', operation: 'merge' },
]

export function createGitWorkflowStep(operation: GitWorkflowOperation, id = `step-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`): GitWorkflowStep {
  return { id, operation }
}

export function moveGitWorkflowStep(steps: GitWorkflowStep[], index: number, direction: -1 | 1): GitWorkflowStep[] {
  const nextIndex = index + direction
  if (index < 0 || index >= steps.length || nextIndex < 0 || nextIndex >= steps.length) return steps
  const next = steps.slice()
  ;[next[index], next[nextIndex]] = [next[nextIndex], next[index]]
  return next
}

export function removeGitWorkflowStep(steps: GitWorkflowStep[], index: number): GitWorkflowStep[] {
  if (index < 0 || index >= steps.length) return steps
  return steps.filter((_, itemIndex) => itemIndex !== index)
}

export function normalizeGitWorkflowSteps(value: unknown): GitWorkflowStep[] | null {
  if (!Array.isArray(value)) return null
  const steps = value.filter((item): item is GitWorkflowStep => {
    if (!item || typeof item !== 'object') return false
    const candidate = item as Partial<GitWorkflowStep>
    return typeof candidate.id === 'string' && ['fetch', 'pull', 'push', 'switch', 'merge', 'commit'].includes(candidate.operation ?? '')
  })
  return steps.length > 0 ? steps.map((step) => ({ id: step.id, operation: step.operation })) : null
}

export function loadGitWorkflow(projectId: string): GitWorkflowStep[] {
  const graph = loadGitWorkflowGraph(projectId)
  return graph.nodes.map((node) => ({ id: node.id, operation: node.data.operation }))
}

export function saveGitWorkflow(projectId: string, steps: GitWorkflowStep[]): void {
  const graph = migrateLegacyGitWorkflowSteps(steps).graph
  saveGitWorkflowGraph(projectId, graph)
}

export { createGitWorkflowGraph, createGitWorkflowNode, createGitWorkflowNodeId, loadGitWorkflowGraph, migrateLegacyGitWorkflowSteps, saveGitWorkflowGraph, validateGitWorkflowGraph }
