import '@xyflow/react/dist/style.css'
import { applyEdgeChanges, applyNodeChanges, Background, type Connection, Controls, type Edge, type EdgeChange, type EdgeTypes, type Node, type NodeChange, type NodeTypes, ReactFlow, useReactFlow } from '@xyflow/react'
import { type DragEvent, type ForwardedRef, forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { DetailAiCommitGitWorkflowEdge } from './DetailAiCommitGitWorkflowEdge'
import { DetailAiCommitGitWorkflowNode } from './DetailAiCommitGitWorkflowNode'
import { commitGitWorkflowNodePositions } from './gitWorkflow.graph'
import type { GitWorkflowEdgeKind, GitWorkflowNodeData, GitWorkflowNodeState, GitWorkflowRunState, GitWorkflowValidationResult, PersistedGitWorkflowGraph } from './gitWorkflow.types'

type FlowNodeData = GitWorkflowNodeData & {
  state?: GitWorkflowNodeState
  active?: boolean
  selected?: boolean
  validationMessages?: string[]
}

type FlowEdgeData = {
  kind: GitWorkflowEdgeKind
  active?: boolean
}

type FlowNode = Node<FlowNodeData, 'gitOperation'>
type FlowEdge = Edge<FlowEdgeData, 'customEdge'>

type WorkflowSurfaceProps = {
  graph: PersistedGitWorkflowGraph
  runState: GitWorkflowRunState
  selectedNodeId: string | null
  validationResult: GitWorkflowValidationResult
  canEdit: boolean
  onAddNode: (operation: GitWorkflowNodeData['operation'], position?: { x: number; y: number }) => void
  onConnect: (connection: Connection) => void
  onDeleteNode: (nodeId: string) => void
  onDeleteEdge: (edgeId: string) => void
  onSelectNode: (nodeId: string | null) => void
  onCommitNodePositions: (updates: Array<{ id: string; position: { x: number; y: number } }>) => void
}

export type WorkflowSurfaceHandle = {
  getGraphSnapshot: () => PersistedGitWorkflowGraph | null
}

const nodeTypes = { gitOperation: DetailAiCommitGitWorkflowNode } as unknown as NodeTypes
const edgeTypes = { customEdge: DetailAiCommitGitWorkflowEdge } as unknown as EdgeTypes

function areStringArraysEqual(left?: string[], right?: string[]) {
  if (left === right) return true
  if (!left || !right) return false
  if (left.length !== right.length) return false
  return left.every((value, index) => value === right[index])
}

function buildValidationMessagesByNodeId(validationResult: GitWorkflowValidationResult) {
  const messages = new Map<string, string[]>()
  for (const issue of validationResult.issues) {
    if (!issue.nodeId) continue
    const next = messages.get(issue.nodeId)
    const message = issue.message || issue.code
    if (next) {
      next.push(message)
      continue
    }
    messages.set(issue.nodeId, [message])
  }
  return messages
}

function buildFlowNodeData(node: PersistedGitWorkflowGraph['nodes'][number], runState: GitWorkflowRunState, selectedNodeId: string | null, validationMessagesByNodeId: Map<string, string[]>): FlowNodeData {
  return {
    ...node.data,
    state: runState.nodeStates[node.id],
    active: runState.activeNodeId === node.id,
    selected: selectedNodeId === node.id,
    validationMessages: validationMessagesByNodeId.get(node.id),
  }
}

function buildFlowNodes(graph: PersistedGitWorkflowGraph, runState: GitWorkflowRunState, selectedNodeId: string | null, validationMessagesByNodeId: Map<string, string[]>): FlowNode[] {
  return graph.nodes.map((node) => ({
    id: node.id,
    type: 'gitOperation',
    position: node.position,
    data: buildFlowNodeData(node, runState, selectedNodeId, validationMessagesByNodeId),
  }))
}

function buildFlowEdges(graph: PersistedGitWorkflowGraph, runState: GitWorkflowRunState): FlowEdge[] {
  return graph.edges.map((edge) => ({
    id: edge.id,
    type: 'customEdge',
    source: edge.source,
    target: edge.target,
    sourceHandle: edge.sourceHandle,
    targetHandle: edge.targetHandle,
    data: {
      kind: edge.type,
      active: runState.activeEdgeId === edge.id,
    },
  }))
}

function patchFlowNodes(currentNodes: FlowNode[], graph: PersistedGitWorkflowGraph, runState: GitWorkflowRunState, selectedNodeId: string | null, validationMessagesByNodeId: Map<string, string[]>) {
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node] as const))
  let changed = false
  const nextNodes = currentNodes.map((node) => {
    const graphNode = nodesById.get(node.id)
    if (!graphNode) return node
    const nextData = buildFlowNodeData(graphNode, runState, selectedNodeId, validationMessagesByNodeId)
    if (
      node.data.operation === nextData.operation &&
      node.data.label === nextData.label &&
      node.data.failurePolicy === nextData.failurePolicy &&
      node.data.config === nextData.config &&
      node.data.state === nextData.state &&
      node.data.active === nextData.active &&
      node.data.selected === nextData.selected &&
      areStringArraysEqual(node.data.validationMessages, nextData.validationMessages)
    ) {
      return node
    }
    changed = true
    return {
      ...node,
      data: nextData,
    }
  })
  return changed ? nextNodes : currentNodes
}

function patchFlowEdges(currentEdges: FlowEdge[], graph: PersistedGitWorkflowGraph, runState: GitWorkflowRunState) {
  const edgesById = new Map(graph.edges.map((edge) => [edge.id, edge] as const))
  let changed = false
  const nextEdges = currentEdges.map((edge) => {
    const graphEdge = edgesById.get(edge.id)
    if (!graphEdge) return edge
    const nextActive = runState.activeEdgeId === graphEdge.id
    const edgeData = edge.data ?? { kind: graphEdge.type, active: false }
    if (edgeData.kind === graphEdge.type && edgeData.active === nextActive && edge.source === graphEdge.source && edge.target === graphEdge.target && edge.sourceHandle === graphEdge.sourceHandle && edge.targetHandle === graphEdge.targetHandle) {
      return edge
    }
    changed = true
    return {
      ...edge,
      source: graphEdge.source,
      target: graphEdge.target,
      sourceHandle: graphEdge.sourceHandle,
      targetHandle: graphEdge.targetHandle,
      data: {
        kind: graphEdge.type,
        active: nextActive,
      },
    }
  })
  return changed ? nextEdges : currentEdges
}

function getChangedNodePositions(graph: PersistedGitWorkflowGraph, nodes: FlowNode[]) {
  const positionsById = new Map(graph.nodes.map((node) => [node.id, node.position] as const))
  return nodes.flatMap((node) => {
    const previousPosition = positionsById.get(node.id)
    if (!previousPosition) return []
    if (previousPosition.x === node.position.x && previousPosition.y === node.position.y) return []
    return [
      {
        id: node.id,
        position: {
          x: node.position.x,
          y: node.position.y,
        },
      },
    ]
  })
}

export const DetailAiCommitGitWorkflowSurface = forwardRef(function DetailAiCommitGitWorkflowSurface({ graph, runState, selectedNodeId, validationResult, canEdit, onAddNode, onConnect, onDeleteNode, onDeleteEdge, onSelectNode, onCommitNodePositions }: WorkflowSurfaceProps, ref: ForwardedRef<WorkflowSurfaceHandle>) {
  const { screenToFlowPosition } = useReactFlow()
  const validationMessagesByNodeId = useMemo(() => buildValidationMessagesByNodeId(validationResult), [validationResult])
  const [nodes, setNodes] = useState<FlowNode[]>(() => buildFlowNodes(graph, runState, selectedNodeId, validationMessagesByNodeId))
  const [edges, setEdges] = useState<FlowEdge[]>(() => buildFlowEdges(graph, runState))
  const stateRef = useRef({ graph, runState, selectedNodeId, validationResult })
  const nodesRef = useRef(nodes)

  useEffect(() => {
    nodesRef.current = nodes
  }, [nodes])

  useEffect(() => {
    const previous = stateRef.current
    stateRef.current = { graph, runState, selectedNodeId, validationResult }

    if (previous.graph !== graph) {
      setNodes(buildFlowNodes(graph, runState, selectedNodeId, validationMessagesByNodeId))
      setEdges(buildFlowEdges(graph, runState))
      return
    }

    if (previous.runState !== runState || previous.selectedNodeId !== selectedNodeId || previous.validationResult !== validationResult) {
      setNodes((current) => patchFlowNodes(current, graph, runState, selectedNodeId, validationMessagesByNodeId))
      setEdges((current) => patchFlowEdges(current, graph, runState))
    }
  }, [graph, runState, selectedNodeId, validationResult, validationMessagesByNodeId])

  useImperativeHandle(
    ref,
    () => ({
      getGraphSnapshot: () => {
        const updates = getChangedNodePositions(graph, nodesRef.current)
        if (updates.length === 0) return graph
        return commitGitWorkflowNodePositions(graph, updates)
      },
    }),
    [graph],
  )

  const handleDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault()
      const operation = event.dataTransfer.getData('application/x-git-workflow-operation') || event.dataTransfer.getData('text/plain')
      if (!operation) return
      const position = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      })
      onAddNode(operation as GitWorkflowNodeData['operation'], {
        x: position.x - 110,
        y: position.y - 70,
      })
    },
    [onAddNode, screenToFlowPosition],
  )

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      const removedNodeIds = changes.filter((change): change is Extract<NodeChange, { type: 'remove' }> => change.type === 'remove').map((change) => change.id)
      setNodes((current) => {
        const next = applyNodeChanges(changes, current) as FlowNode[]
        nodesRef.current = next
        return next
      })

      if (removedNodeIds.length > 0) {
        for (const nodeId of removedNodeIds) {
          onDeleteNode(nodeId)
        }
      }
    },
    [onDeleteNode],
  )

  const onNodeDragStop = useCallback(
    (_event: unknown, _node: FlowNode) => {
      const updates = getChangedNodePositions(graph, nodesRef.current)
      if (updates.length > 0) onCommitNodePositions(updates)
    },
    [graph, onCommitNodePositions],
  )

  const onEdgesChange = (changes: EdgeChange[]) => {
    setEdges((current) => applyEdgeChanges(changes, current) as FlowEdge[])
    const removedEdgeIds = changes.filter((change): change is Extract<EdgeChange, { type: 'remove' }> => change.type === 'remove').map((change) => change.id)
    for (const edgeId of removedEdgeIds) {
      onDeleteEdge(edgeId)
    }
  }

  const handleConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target || connection.sourceHandle == null || connection.targetHandle == null) return
      onConnect({
        source: connection.source,
        sourceHandle: connection.sourceHandle === 'failure' ? 'failure' : 'success',
        target: connection.target,
        targetHandle: 'input',
      })
    },
    [onConnect],
  )

  return (
    <section className="min-h-0 overflow-hidden rounded-[18px] border border-[color:var(--color-border)] bg-[color:var(--color-background)]" aria-label="Git workflow canvas" onDrop={handleDrop} onDragOver={(event) => event.preventDefault()}>
      <ReactFlow<FlowNode, FlowEdge>
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={handleConnect}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        fitViewOptions={{ maxZoom: 1 }}
        nodesDraggable={canEdit}
        elementsSelectable
        onNodeClick={(_event, node) => onSelectNode(node.id)}
        onPaneClick={() => onSelectNode(null)}
        onNodeDragStop={onNodeDragStop}
        className="workflow-canvas"
      >
        <Background gap={24} size={1} />
        <Controls />
      </ReactFlow>
    </section>
  )
})
