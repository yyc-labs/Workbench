import type { Edge, Node } from '@xyflow/react'
import { createGitWorkflowNodeData, validateGitWorkflowNodeConfig } from './gitWorkflow.operations'
import type { GitWorkflowEdge, GitWorkflowEdgeKind, GitWorkflowGraphMigrationResult, GitWorkflowNode, GitWorkflowNodeData, GitWorkflowNodeOutcome, GitWorkflowRunState, GitWorkflowValidationContext, GitWorkflowValidationIssue, GitWorkflowValidationResult, PersistedGitWorkflowGraph } from './gitWorkflow.types'

export const GIT_WORKFLOW_STORAGE_KEY_PREFIX = 'ide-electron:git-workflow-graph:'
export const GIT_WORKFLOW_VERSION = 2 as const

const LEGACY_GIT_WORKFLOW_STORAGE_KEY_PREFIX = 'ide-electron:git-workflow:'

export function createGitWorkflowNodeId(operation: GitWorkflowNodeData['operation']) {
  return `${operation}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function createGitWorkflowEdgeId(source: string, sourceHandle: GitWorkflowEdgeKind) {
  return `${source}:${sourceHandle}`
}

export function commitGitWorkflowNodePositions(
  graph: PersistedGitWorkflowGraph,
  updates: Array<{
    id: string
    position: {
      x: number
      y: number
    }
  }>,
): PersistedGitWorkflowGraph {
  if (updates.length === 0) return graph

  const nextPositions = new Map(updates.map((update) => [update.id, update.position] as const))
  if (nextPositions.size === 0) return graph

  let hasChanges = false
  const nodes = graph.nodes.map((node) => {
    const nextPosition = nextPositions.get(node.id)
    if (!nextPosition) return node
    if (node.position.x === nextPosition.x && node.position.y === nextPosition.y) return node
    hasChanges = true
    return {
      ...node,
      position: {
        x: nextPosition.x,
        y: nextPosition.y,
      },
    }
  })

  if (!hasChanges) return graph

  return {
    ...graph,
    updatedAt: Date.now(),
    nodes,
  }
}

export function removeGitWorkflowNode(graph: PersistedGitWorkflowGraph, nodeId: string): PersistedGitWorkflowGraph {
  const nodes = graph.nodes.filter((node) => node.id !== nodeId)
  const edges = graph.edges.filter((edge) => edge.source !== nodeId && edge.target !== nodeId)
  if (nodes.length === graph.nodes.length && edges.length === graph.edges.length) return graph

  const entryNodeId = graph.entryNodeId === nodeId ? (nodes[0]?.id ?? '') : graph.entryNodeId
  return {
    ...graph,
    updatedAt: Date.now(),
    entryNodeId,
    nodes,
    edges,
  }
}

export function createGitWorkflowGraph(): PersistedGitWorkflowGraph {
  const firstNode: GitWorkflowNode = {
    id: createGitWorkflowNodeId('fetch'),
    type: 'gitOperation',
    position: { x: 80, y: 120 },
    data: createGitWorkflowNodeData('fetch'),
  }
  return {
    version: GIT_WORKFLOW_VERSION,
    updatedAt: Date.now(),
    entryNodeId: firstNode.id,
    nodes: [firstNode],
    edges: [],
  }
}

export function createGitWorkflowNode(operation: GitWorkflowNodeData['operation'], position = { x: 0, y: 0 }): GitWorkflowNode {
  return {
    id: createGitWorkflowNodeId(operation),
    type: 'gitOperation',
    position,
    data: createGitWorkflowNodeData(operation),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isGitWorkflowOperation(value: unknown): value is GitWorkflowNodeData['operation'] {
  return value === 'fetch' || value === 'pull' || value === 'push' || value === 'switch' || value === 'merge' || value === 'commit'
}

function normalizeNodeData(value: unknown): GitWorkflowNodeData | null {
  if (!isRecord(value)) return null
  if (!isGitWorkflowOperation(value.operation)) return null
  const base = createGitWorkflowNodeData(value.operation)
  const label = typeof value.label === 'string' ? value.label : base.label
  const requiresConfirmation = typeof value.requiresConfirmation === 'boolean' ? value.requiresConfirmation : base.requiresConfirmation
  const config = isRecord(value.config) ? { ...base.config, ...value.config } : base.config
  const failurePolicy = value.failurePolicy === 'follow-failure-edge' || value.failurePolicy === 'pause' ? value.failurePolicy : base.failurePolicy
  return {
    ...base,
    ...(label ? { label } : {}),
    requiresConfirmation,
    config: config as GitWorkflowNodeData['config'],
    failurePolicy,
  } as GitWorkflowNodeData
}

export function normalizeGitWorkflowGraph(value: unknown): PersistedGitWorkflowGraph | null {
  if (!isRecord(value)) return null
  if (value.version !== GIT_WORKFLOW_VERSION) return null
  if (typeof value.updatedAt !== 'number' || typeof value.entryNodeId !== 'string' || !Array.isArray(value.nodes) || !Array.isArray(value.edges)) return null

  const nodes = value.nodes
    .map((node) => {
      if (!isRecord(node)) return null
      if (typeof node.id !== 'string' || node.type !== 'gitOperation' || !isRecord(node.position)) return null
      const data = normalizeNodeData(node.data)
      if (!data) return null
      const x = typeof node.position.x === 'number' ? node.position.x : 0
      const y = typeof node.position.y === 'number' ? node.position.y : 0
      return {
        id: node.id,
        type: 'gitOperation' as const,
        position: { x, y },
        data,
      } satisfies GitWorkflowNode
    })
    .filter((node): node is GitWorkflowNode => Boolean(node))

  const edges = value.edges
    .map((edge) => {
      if (!isRecord(edge)) return null
      if (typeof edge.id !== 'string' || typeof edge.source !== 'string' || typeof edge.target !== 'string') return null
      if (edge.type !== 'success' && edge.type !== 'failure') return null
      if (edge.sourceHandle !== edge.type || edge.targetHandle !== 'input') return null
      if (!isRecord(edge.data) || edge.data.kind !== edge.type) return null
      const kind = edge.type as GitWorkflowEdgeKind
      return {
        id: edge.id,
        type: kind,
        source: edge.source,
        sourceHandle: kind,
        target: edge.target,
        targetHandle: 'input' as const,
        data: { kind },
      } satisfies GitWorkflowEdge
    })
    .filter((edge): edge is GitWorkflowEdge => Boolean(edge))

  if (nodes.length === 0) return null
  if (!nodes.some((node) => node.id === value.entryNodeId)) return null
  return {
    version: GIT_WORKFLOW_VERSION,
    updatedAt: value.updatedAt,
    entryNodeId: value.entryNodeId,
    nodes,
    edges,
    ...(isRecord(value.viewport) && typeof value.viewport.x === 'number' && typeof value.viewport.y === 'number' && typeof value.viewport.zoom === 'number' ? { viewport: { x: value.viewport.x, y: value.viewport.y, zoom: value.viewport.zoom } } : {}),
  }
}

export function migrateLegacyGitWorkflowSteps(steps: Array<{ id: string; operation: GitWorkflowNodeData['operation'] }>): GitWorkflowGraphMigrationResult {
  const nodes: GitWorkflowNode[] = []
  const edges: GitWorkflowEdge[] = []

  steps.forEach((step, index) => {
    nodes.push({
      id: step.id,
      type: 'gitOperation',
      position: { x: 80 + index * 280, y: 140 },
      data: createGitWorkflowNodeData(step.operation),
    })
    if (index > 0) {
      const prev = steps[index - 1]
      edges.push({
        id: createGitWorkflowEdgeId(prev.id, 'success'),
        type: 'success',
        source: prev.id,
        sourceHandle: 'success',
        target: step.id,
        targetHandle: 'input',
        data: { kind: 'success' },
      })
    }
  })

  return {
    migratedFromVersion: 1,
    graph: {
      version: GIT_WORKFLOW_VERSION,
      updatedAt: Date.now(),
      entryNodeId: steps[0]?.id ?? '',
      nodes,
      edges,
    },
  }
}

export function serializeGitWorkflowGraph(graph: PersistedGitWorkflowGraph): PersistedGitWorkflowGraph {
  return {
    version: GIT_WORKFLOW_VERSION,
    updatedAt: graph.updatedAt,
    entryNodeId: graph.entryNodeId,
    nodes: graph.nodes.map((node) => ({
      id: node.id,
      type: 'gitOperation',
      position: { x: node.position.x, y: node.position.y },
      data: {
        ...node.data,
        config: { ...node.data.config },
      } as GitWorkflowNodeData,
    })),
    edges: graph.edges.map((edge) => ({
      id: edge.id,
      type: edge.type,
      source: edge.source,
      sourceHandle: edge.sourceHandle,
      target: edge.target,
      targetHandle: 'input',
      data: { kind: edge.type },
    })),
    ...(graph.viewport ? { viewport: { ...graph.viewport } } : {}),
  }
}

function getLegacyStorageKey(projectId: string) {
  return `${LEGACY_GIT_WORKFLOW_STORAGE_KEY_PREFIX}${projectId}`
}

function getStorageKey(projectId: string) {
  return `${GIT_WORKFLOW_STORAGE_KEY_PREFIX}${projectId}`
}

export function loadGitWorkflowGraph(projectId: string): PersistedGitWorkflowGraph {
  const defaultGraph = createGitWorkflowGraph()
  try {
    const raw = window.localStorage.getItem(getStorageKey(projectId)) ?? window.localStorage.getItem(getLegacyStorageKey(projectId))
    if (!raw) return defaultGraph
    const parsed = JSON.parse(raw) as unknown
    const normalized = normalizeGitWorkflowGraph(parsed)
    if (normalized) return normalized

    if (isRecord(parsed) && parsed.version === 1 && Array.isArray(parsed.steps)) {
      const legacySteps = parsed.steps.filter((step): step is { id: string; operation: GitWorkflowNodeData['operation'] } => {
        return isRecord(step) && typeof step.id === 'string' && isGitWorkflowOperation(step.operation)
      })
      if (legacySteps.length > 0) {
        return migrateLegacyGitWorkflowSteps(legacySteps).graph
      }
    }
    return defaultGraph
  } catch {
    return defaultGraph
  }
}

export function saveGitWorkflowGraph(projectId: string, graph: PersistedGitWorkflowGraph): void {
  try {
    window.localStorage.setItem(getStorageKey(projectId), JSON.stringify(serializeGitWorkflowGraph({ ...graph, updatedAt: Date.now() })))
  } catch {
    // Storage may be unavailable in restricted webviews.
  }
}

export function getGitWorkflowGraphNodes(graph: PersistedGitWorkflowGraph): Node[] {
  return graph.nodes as unknown as Node[]
}

export function getGitWorkflowGraphEdges(graph: PersistedGitWorkflowGraph): Edge[] {
  return graph.edges as unknown as Edge[]
}

export function validateGitWorkflowGraph(graph: PersistedGitWorkflowGraph, context: GitWorkflowValidationContext): GitWorkflowValidationResult {
  const issues: GitWorkflowValidationIssue[] = []
  if (graph.nodes.length === 0) {
    issues.push({ code: 'empty-graph', level: 'error', message: 'Workflow graph has no nodes.' })
    return { ok: false, issues }
  }

  const nodeIds = new Set<string>()
  const nodeMap = new Map<string, GitWorkflowNode>()
  for (const node of graph.nodes) {
    if (nodeIds.has(node.id)) {
      issues.push({ code: 'duplicate-node-id', level: 'error', nodeId: node.id, message: `Duplicate node id: ${node.id}.` })
      continue
    }
    nodeIds.add(node.id)
    nodeMap.set(node.id, node)
    if (!isGitWorkflowOperation(node.data.operation)) {
      issues.push({ code: 'unknown-operation', level: 'error', nodeId: node.id, message: `Unknown operation: ${String(node.data.operation)}.` })
      continue
    }
    issues.push(...validateGitWorkflowNodeConfig(node.data, context).map((issue) => ({ ...issue, nodeId: node.id })))
  }

  if (!nodeIds.has(graph.entryNodeId)) {
    issues.push({ code: 'entry-missing', level: 'error', message: 'Entry node is missing.' })
  }

  const edgeIds = new Set<string>()
  const sourceHandles = new Set<string>()
  const adjacency = new Map<string, string[]>()
  const reachable = new Set<string>()

  for (const edge of graph.edges) {
    if (edgeIds.has(edge.id)) {
      issues.push({ code: 'duplicate-edge-id', level: 'error', edgeId: edge.id, message: `Duplicate edge id: ${edge.id}.` })
      continue
    }
    edgeIds.add(edge.id)
    const sourceNode = nodeMap.get(edge.source)
    const targetNode = nodeMap.get(edge.target)
    if (!sourceNode || !targetNode) {
      issues.push({ code: 'dangling-edge', level: 'error', edgeId: edge.id, message: `Edge ${edge.id} references a missing node.` })
      continue
    }
    if (edge.source === edge.target) {
      issues.push({ code: 'self-loop', level: 'error', edgeId: edge.id, message: `Self loop is not allowed on ${edge.id}.` })
    }
    if (edge.type !== edge.data.kind || edge.sourceHandle !== edge.type || edge.targetHandle !== 'input') {
      issues.push({ code: 'invalid-edge', level: 'error', edgeId: edge.id, message: `Edge ${edge.id} has an invalid type or handle mapping.` })
    }
    const handleKey = `${edge.source}:${edge.sourceHandle}`
    if (sourceHandles.has(handleKey)) {
      issues.push({ code: 'duplicate-source-handle', level: 'error', edgeId: edge.id, message: `Source handle ${handleKey} already has an edge.` })
    } else {
      sourceHandles.add(handleKey)
    }
    if (!adjacency.has(edge.source)) adjacency.set(edge.source, [])
    adjacency.get(edge.source)?.push(edge.target)
  }

  const visiting = new Set<string>()
  const visited = new Set<string>()
  const visit = (nodeId: string): boolean => {
    if (visiting.has(nodeId)) return true
    if (visited.has(nodeId)) return false
    visiting.add(nodeId)
    for (const next of adjacency.get(nodeId) ?? []) {
      if (visit(next)) return true
    }
    visiting.delete(nodeId)
    visited.add(nodeId)
    reachable.add(nodeId)
    return false
  }

  if (nodeIds.has(graph.entryNodeId) && visit(graph.entryNodeId)) {
    issues.push({ code: 'cycle', level: 'error', nodeId: graph.entryNodeId, message: 'Workflow graph contains a cycle.' })
  }

  for (const node of graph.nodes) {
    if (!reachable.has(node.id)) {
      issues.push({ code: 'unreachable-node', level: 'warning', nodeId: node.id, message: `Node ${node.id} is unreachable from the entry node.` })
    }
  }

  return { ok: issues.every((issue) => issue.level !== 'error'), issues }
}

export function getGitWorkflowNodeOutcome(result: GitWorkflowNodeOutcome): GitWorkflowNodeOutcome {
  return result
}

export function classifyGitOperationResult(result: { ok: boolean; skipped?: boolean; skipReason?: string | null; error?: string; output?: string }): GitWorkflowNodeOutcome {
  if (result.ok) {
    return { kind: 'success', result: result as never }
  }
  if (result.skipped) {
    if (result.skipReason === 'nothing-to-pull' || result.skipReason === 'nothing-to-push') {
      return { kind: 'success', result: result as never, noOp: true }
    }
    return {
      kind: 'failure',
      result: result as never,
      reason: result.skipReason || result.error || result.output || 'Git operation skipped.',
    }
  }
  return {
    kind: 'failure',
    result: result as never,
    reason: result.error || result.output || 'Git operation failed.',
  }
}

export function createInitialGitWorkflowRunState(): GitWorkflowRunState {
  return { status: 'idle', nodeStates: {} }
}

export function updateNodeRunState(runState: GitWorkflowRunState, nodeId: string, patch: Partial<GitWorkflowRunState['nodeStates'][string]>): GitWorkflowRunState {
  return {
    ...runState,
    nodeStates: {
      ...runState.nodeStates,
      [nodeId]: {
        ...(runState.nodeStates[nodeId] ?? {}),
        ...patch,
        status: patch.status ?? runState.nodeStates[nodeId]?.status ?? 'idle',
      },
    },
  }
}
