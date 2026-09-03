import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { GitOperationResult } from '../../../shared/types'
import { useI18n } from '../../i18n'
import type { AiCommitStatus } from './detail.types'
import { classifyGitOperationResult, commitGitWorkflowNodePositions, createGitWorkflowEdgeId, createGitWorkflowNode, createInitialGitWorkflowRunState, loadGitWorkflowGraph, removeGitWorkflowNode, saveGitWorkflowGraph, validateGitWorkflowGraph } from './gitWorkflow.graph'
import { getGitWorkflowOperationDefinition } from './gitWorkflow.operations'
import type { GitWorkflowEdge, GitWorkflowEdgeKind, GitWorkflowExecutionContext, GitWorkflowNode, GitWorkflowNodeData, GitWorkflowNodeOutcome, GitWorkflowRunState, GitWorkflowValidationContext, GitWorkflowValidationResult, PersistedGitWorkflowGraph } from './gitWorkflow.types'

type GitWorkflowSaveState = 'idle' | 'saving' | 'saved'

type UseGitWorkflowRunnerOptions = {
  projectId: string
  gitSnapshot: {
    repoRoot: string
    branch: {
      current: string
      localBranches: string[]
      remoteBranches: string[]
      upstream?: string
      upstreamGone: boolean
      ahead: number
      behind: number
      detached: boolean
    }
    changedFiles: Array<{ staged: boolean }>
    isGitRepository: boolean
  } | null
  onRefreshGitSnapshot: () => void | Promise<void>
  onOperationResult?: (result: GitOperationResult) => void
  aiCommit?: {
    status: AiCommitStatus
    onRun: () => void | Promise<void>
    onCancel: () => void | Promise<void>
  }
}

type PendingConfirmation = {
  nodeId: string
  title: string
  message: string
  confirmLabel: string
  cancelLabel: string
  helperText: string
  riskLevel: 'normal' | 'high'
  exactMatch?: string
}

type PendingCommit = {
  nodeId: string
  presetMessage: string
}

type RuntimeTargetPrompt = {
  nodeId: string
  operation: 'switch' | 'merge'
}

function getValidationContext(snapshot: UseGitWorkflowRunnerOptions['gitSnapshot']): GitWorkflowValidationContext {
  return {
    currentBranch: snapshot?.branch.current,
    localBranches: snapshot?.branch.localBranches ?? [],
    remoteBranches: snapshot?.branch.remoteBranches ?? [],
  }
}

function findNextNodeId(graph: PersistedGitWorkflowGraph, nodeId: string, kind: GitWorkflowEdgeKind): string | undefined {
  return graph.edges.find((edge) => edge.source === nodeId && edge.sourceHandle === kind)?.target
}

function cloneGraph(graph: PersistedGitWorkflowGraph): PersistedGitWorkflowGraph {
  return {
    ...graph,
    nodes: graph.nodes.map((node) => ({
      ...node,
      position: { ...node.position },
      data: {
        ...node.data,
        config: { ...node.data.config },
      } as GitWorkflowNodeData,
    })),
    edges: graph.edges.map((edge) => ({
      ...edge,
      data: { ...edge.data },
    })),
    ...(graph.viewport ? { viewport: { ...graph.viewport } } : {}),
  }
}

function updateNodeData(graph: PersistedGitWorkflowGraph, nodeId: string, updater: (data: GitWorkflowNodeData) => GitWorkflowNodeData): PersistedGitWorkflowGraph {
  const next = cloneGraph(graph)
  const node = next.nodes.find((item) => item.id === nodeId)
  if (!node) return graph
  node.data = updater(node.data)
  next.updatedAt = Date.now()
  return next
}

function buildExecutionRequest(node: GitWorkflowNode, snapshot: NonNullable<UseGitWorkflowRunnerOptions['gitSnapshot']>, targetValue: string | undefined, commitMessage: string | undefined) {
  const definition = getGitWorkflowOperationDefinition(node.data.operation)
  const context: GitWorkflowExecutionContext = {
    currentBranch: snapshot.branch.current,
    localBranches: snapshot.branch.localBranches,
    remoteBranches: snapshot.branch.remoteBranches,
    selectedTargetBranch: targetValue,
  }

  const resolved = definition.resolveRequest(node.data, context)
  if (resolved === 'wait-for-input') {
    if (node.data.operation === 'commit' && commitMessage) {
      return {
        repoRoot: snapshot.repoRoot,
        operation: 'commit',
        message: commitMessage,
      }
    }
    if ((node.data.operation === 'switch' || node.data.operation === 'merge') && targetValue) {
      return {
        repoRoot: snapshot.repoRoot,
        operation: node.data.operation,
        targetBranch: targetValue,
      }
    }
    return resolved
  }
  return {
    ...resolved,
    repoRoot: snapshot.repoRoot,
    ...(commitMessage ? { message: commitMessage } : {}),
  }
}

export function useGitWorkflowRunner({ projectId, gitSnapshot, onRefreshGitSnapshot, onOperationResult, aiCommit }: UseGitWorkflowRunnerOptions) {
  const { t } = useI18n()
  const [graph, setGraph] = useState<PersistedGitWorkflowGraph>(() => loadGitWorkflowGraph(projectId))
  const [runState, setRunState] = useState<GitWorkflowRunState>(createInitialGitWorkflowRunState())
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [pendingConfirmation, setPendingConfirmation] = useState<PendingConfirmation | null>(null)
  const [pendingCommit, setPendingCommit] = useState<PendingCommit | null>(null)
  const [runtimeTarget, setRuntimeTarget] = useState<RuntimeTargetPrompt | null>(null)
  const [runtimeTargetValue, setRuntimeTargetValue] = useState('')
  const [runtimeCommitMessage, setRuntimeCommitMessage] = useState('')
  const [validationResult, setValidationResult] = useState<GitWorkflowValidationResult>({ ok: true, issues: [] })
  const [saveState, setSaveState] = useState<GitWorkflowSaveState>('idle')
  const lastSavedUpdatedAtRef = useRef<number | null>(null)
  const saveGraphTimerRef = useRef<number | null>(null)
  const runNodeRef = useRef<((nodeId: string) => Promise<void>) | null>(null)
  const awaitingAiCommitNodeIdRef = useRef<string | null>(null)

  useEffect(() => {
    const loaded = loadGitWorkflowGraph(projectId)
    setGraph(loaded)
    lastSavedUpdatedAtRef.current = loaded.updatedAt
    setSaveState('idle')
    setRunState(createInitialGitWorkflowRunState())
    setSelectedNodeId(null)
    setPendingConfirmation(null)
    setPendingCommit(null)
    setRuntimeTarget(null)
    setRuntimeTargetValue('')
    setRuntimeCommitMessage('')
    awaitingAiCommitNodeIdRef.current = null
  }, [projectId])

  useEffect(() => {
    return () => {
      if (saveGraphTimerRef.current != null) window.clearTimeout(saveGraphTimerRef.current)
    }
  }, [])

  useEffect(() => {
    if (graph.updatedAt === lastSavedUpdatedAtRef.current) return
    if (saveGraphTimerRef.current != null) window.clearTimeout(saveGraphTimerRef.current)
    setSaveState('saving')
    saveGraphTimerRef.current = window.setTimeout(() => {
      saveGraphTimerRef.current = null
      saveGitWorkflowGraph(projectId, graph)
      lastSavedUpdatedAtRef.current = graph.updatedAt
      setSaveState('saved')
    }, 600)
  }, [graph, projectId])

  useEffect(() => {
    const result = validateGitWorkflowGraph(graph, getValidationContext(gitSnapshot))
    setValidationResult(result)
  }, [gitSnapshot, graph])

  const graphNodeMap = useMemo(() => new Map(graph.nodes.map((node) => [node.id, node] as const)), [graph.nodes])
  const selectedNode = useMemo(() => (selectedNodeId ? (graphNodeMap.get(selectedNodeId) ?? null) : null), [graphNodeMap, selectedNodeId])

  const branchTargetOptions = useMemo(() => {
    const local = gitSnapshot?.branch.localBranches ?? []
    const remote = gitSnapshot?.branch.remoteBranches ?? []
    return [...new Set([...local, ...remote])].sort((a, b) => a.localeCompare(b))
  }, [gitSnapshot?.branch.localBranches, gitSnapshot?.branch.remoteBranches])

  const editable = runState.status !== 'running' && runState.status !== 'waiting-for-confirmation' && runState.status !== 'waiting-for-input'

  const addNode = useCallback(
    (operation: GitWorkflowNodeData['operation'], position?: { x: number; y: number }) => {
      if (!editable) return
      setGraph((prev) => {
        const lastNode = prev.nodes[prev.nodes.length - 1]
        const nextNode = createGitWorkflowNode(
          operation,
          position ?? {
            x: (lastNode?.position.x ?? 80) + 280,
            y: lastNode?.position.y ?? 120,
          },
        )
        const nodes = [...prev.nodes, nextNode]
        return {
          ...prev,
          updatedAt: Date.now(),
          nodes,
          entryNodeId: prev.entryNodeId || nextNode.id,
        }
      })
      setSelectedNodeId(null)
    },
    [editable],
  )

  const updateNode = useCallback(
    (nodeId: string, updater: (node: GitWorkflowNode) => GitWorkflowNode) => {
      if (!editable) return
      setGraph((prev) => {
        const next = cloneGraph(prev)
        const index = next.nodes.findIndex((node) => node.id === nodeId)
        if (index < 0) return prev
        next.nodes[index] = updater(next.nodes[index])
        next.updatedAt = Date.now()
        return next
      })
    },
    [editable],
  )

  const updateNodeConfig = useCallback(
    (nodeId: string, updater: (data: GitWorkflowNodeData) => GitWorkflowNodeData) => {
      if (!editable) return
      setGraph((prev) => updateNodeData(prev, nodeId, updater))
    },
    [editable],
  )

  const deleteNode = useCallback(
    (nodeId: string) => {
      if (!editable) return
      setGraph((prev) => {
        const next = removeGitWorkflowNode(prev, nodeId)
        if (next === prev) return prev
        return next
      })
      if (selectedNodeId === nodeId) setSelectedNodeId(null)
    },
    [editable, selectedNodeId],
  )

  const deleteEdge = useCallback(
    (edgeId: string) => {
      if (!editable) return
      setGraph((prev) => {
        const edges = prev.edges.filter((edge) => edge.id !== edgeId)
        if (edges.length === prev.edges.length) return prev
        return {
          ...prev,
          updatedAt: Date.now(),
          edges,
        }
      })
    },
    [editable],
  )

  const connect = useCallback(
    (source: string, sourceHandle: GitWorkflowEdgeKind, target: string) => {
      if (!editable) return false
      setGraph((prev) => {
        const nextEdge: GitWorkflowEdge = {
          id: createGitWorkflowEdgeId(source, sourceHandle),
          type: sourceHandle,
          source,
          sourceHandle,
          target,
          targetHandle: 'input',
          data: { kind: sourceHandle },
        }
        const next = { ...cloneGraph(prev), edges: [...prev.edges.filter((edge) => edge.id !== nextEdge.id), nextEdge], updatedAt: Date.now() }
        const validation = validateGitWorkflowGraph(next, getValidationContext(gitSnapshot))
        if (!validation.ok) {
          setValidationResult(validation)
          return prev
        }
        setValidationResult(validation)
        return next
      })
      return true
    },
    [editable, gitSnapshot],
  )

  const commitNodePositions = useCallback((updates: Array<{ id: string; position: { x: number; y: number } }>) => {
    if (updates.length === 0) return
    setGraph((prev) => commitGitWorkflowNodePositions(prev, updates))
  }, [])

  const setEntryNodeId = useCallback(
    (nodeId: string) => {
      if (!editable) return
      setGraph((prev) => {
        if (prev.entryNodeId === nodeId || !prev.nodes.some((node) => node.id === nodeId)) return prev
        return {
          ...prev,
          updatedAt: Date.now(),
          entryNodeId: nodeId,
        }
      })
    },
    [editable],
  )

  const isDirty = lastSavedUpdatedAtRef.current != null && graph.updatedAt !== lastSavedUpdatedAtRef.current

  const clearPending = useCallback(() => {
    setPendingConfirmation(null)
    setPendingCommit(null)
    setRuntimeTarget(null)
    setRuntimeTargetValue('')
  }, [])

  const updateRunNodeState = useCallback((nodeId: string, patch: Partial<GitWorkflowRunState['nodeStates'][string]>) => {
    setRunState((prev) => ({
      ...prev,
      nodeStates: {
        ...prev.nodeStates,
        [nodeId]: {
          ...(prev.nodeStates[nodeId] ?? {}),
          ...patch,
          status: patch.status ?? prev.nodeStates[nodeId]?.status ?? 'idle',
        },
      },
    }))
  }, [])

  const finishWithOutcome = useCallback(
    async (nodeId: string, outcome: GitWorkflowNodeOutcome) => {
      const nextNodeId = findNextNodeId(graph, nodeId, outcome.kind === 'success' ? 'success' : 'failure')
      updateRunNodeState(nodeId, {
        status: outcome.kind === 'success' ? 'succeeded' : outcome.kind === 'cancelled' ? 'cancelled' : 'failed',
        finishedAt: Date.now(),
        ...(outcome.kind === 'success' ? { result: outcome.result, noOp: outcome.noOp } : {}),
        ...(outcome.kind === 'failure' ? { reason: outcome.reason } : {}),
        ...(outcome.kind === 'cancelled' ? { reason: outcome.reason } : {}),
      })

      try {
        await onRefreshGitSnapshot()
      } catch {
        // Snapshot refresh failure should not collapse the run state.
      }

      if (outcome.kind === 'cancelled') {
        setRunState((prev) => ({ ...prev, status: 'paused', activeNodeId: nodeId }))
        clearPending()
        return
      }
      if (outcome.kind === 'failure') {
        if (nextNodeId) {
          setRunState((prev) => ({ ...prev, status: 'running', activeNodeId: nextNodeId, activeEdgeId: createGitWorkflowEdgeId(nodeId, 'failure') }))
          await runNodeRef.current?.(nextNodeId)
          return
        }
        setRunState((prev) => ({ ...prev, status: 'paused', activeNodeId: nodeId, activeEdgeId: createGitWorkflowEdgeId(nodeId, 'failure') }))
        clearPending()
        return
      }

      if (nextNodeId) {
        setRunState((prev) => ({ ...prev, status: 'running', activeNodeId: nextNodeId, activeEdgeId: createGitWorkflowEdgeId(nodeId, 'success') }))
        await runNodeRef.current?.(nextNodeId)
        return
      }
      setRunState((prev) => ({ ...prev, status: 'completed', activeNodeId: nodeId, activeEdgeId: createGitWorkflowEdgeId(nodeId, 'success') }))
      clearPending()
    },
    [clearPending, graph, onRefreshGitSnapshot, updateRunNodeState],
  )

  const executeAiCommitNode = useCallback(
    async (nodeId: string) => {
      if (!gitSnapshot) return
      if (!aiCommit || aiCommit.status === 'running') {
        const reason = t('detail.gitWorkflowAiCommitUnavailable')
        const failedResult: GitOperationResult = {
          repoRoot: gitSnapshot.repoRoot,
          operation: 'commit',
          ok: false,
          checkedAt: Date.now(),
          command: 'ai-commit',
          output: reason,
          exitCode: null,
          error: reason,
        }
        onOperationResult?.(failedResult)
        updateRunNodeState(nodeId, { status: 'failed', finishedAt: Date.now(), reason })
        await finishWithOutcome(nodeId, { kind: 'failure', result: failedResult, reason })
        return
      }
      updateRunNodeState(nodeId, { status: 'running', startedAt: Date.now(), reason: undefined })
      setRunState((prev) => ({ ...prev, status: 'running', activeNodeId: nodeId, activeEdgeId: undefined }))
      awaitingAiCommitNodeIdRef.current = nodeId
      await aiCommit.onRun()
    },
    [aiCommit, finishWithOutcome, gitSnapshot, onOperationResult, t, updateRunNodeState],
  )

  const executeNode = useCallback(
    async (nodeId: string, targetBranch?: string, commitMessage?: string, confirmed = false) => {
      if (!gitSnapshot?.isGitRepository) {
        setRunState((prev) => ({ ...prev, status: 'failed', activeNodeId: nodeId }))
        clearPending()
        return
      }
      const node = graphNodeMap.get(nodeId)
      if (!node) {
        setRunState((prev) => ({ ...prev, status: 'failed', activeNodeId: nodeId }))
        clearPending()
        return
      }

      if (node.data.operation === 'commit' && node.data.config.message.mode === 'ai') {
        const execution = node.data.config.execution ?? 'confirm-each-run'
        if (execution === 'skip-if-no-changes' && gitSnapshot.changedFiles.length === 0) {
          const skippedResult: GitOperationResult = {
            repoRoot: gitSnapshot.repoRoot,
            operation: 'commit',
            ok: true,
            checkedAt: Date.now(),
            command: '',
            output: '',
            exitCode: null,
            skipped: true,
            skipReason: 'other',
          }
          updateRunNodeState(nodeId, { status: 'succeeded', startedAt: Date.now(), finishedAt: Date.now(), noOp: true })
          await finishWithOutcome(nodeId, { kind: 'success', result: skippedResult, noOp: true })
          return
        }
        if (node.data.requiresConfirmation && !confirmed) {
          setPendingConfirmation({
            nodeId,
            title: `COMMIT ${t('detail.operationConfirmSuffix')}`,
            message: t('detail.gitWorkflowAiCommitConfirmMessage'),
            confirmLabel: t('detail.operationConfirmExecute'),
            cancelLabel: t('common.cancel'),
            helperText: t('detail.operationConfirmHelper'),
            riskLevel: 'normal',
          })
          setRunState((prev) => ({ ...prev, status: 'waiting-for-confirmation', activeNodeId: nodeId }))
          return
        }
        await executeAiCommitNode(nodeId)
        return
      }

      updateRunNodeState(nodeId, { status: 'running', startedAt: Date.now(), reason: undefined })
      setRunState((prev) => ({ ...prev, status: 'running', activeNodeId: nodeId, activeEdgeId: undefined }))

      const definition = getGitWorkflowOperationDefinition(node.data.operation)
      const configTarget = node.data.operation === 'switch' ? node.data.config.target : node.data.operation === 'merge' ? node.data.config.source : undefined
      const targetFromRuntime = configTarget ? (configTarget.mode === 'fixed' ? configTarget.branch : targetBranch || runtimeTargetValue || undefined) : undefined
      const request = buildExecutionRequest(node, gitSnapshot, targetFromRuntime, (commitMessage ?? runtimeCommitMessage) || undefined)
      if (request === 'wait-for-input') {
        if (node.data.operation === 'commit') {
          setPendingCommit({ nodeId, presetMessage: node.data.config.message.preset ?? '' })
          setRunState((prev) => ({ ...prev, status: 'waiting-for-confirmation', activeNodeId: nodeId }))
        } else if (node.data.operation === 'switch' || node.data.operation === 'merge') {
          setRuntimeTarget({ nodeId, operation: node.data.operation })
          setRunState((prev) => ({ ...prev, status: 'waiting-for-input', activeNodeId: nodeId }))
        }
        return
      }

      if (node.data.requiresConfirmation && !confirmed) {
        const message =
          node.data.operation === 'switch'
            ? t('detail.operationConfirmSwitchMessage', { targetBranch: request.targetBranch || targetFromRuntime || '' })
            : node.data.operation === 'merge'
              ? t('detail.operationConfirmMergeMessage', { targetBranch: request.targetBranch || targetFromRuntime || '', currentBranch: gitSnapshot.branch.current })
              : node.data.operation === 'pull'
                ? t('detail.operationConfirmPullMessage', { currentBranch: gitSnapshot.branch.current })
                : node.data.operation === 'push'
                  ? t('detail.operationConfirmPushMessage', { currentBranch: gitSnapshot.branch.current })
                  : t('detail.operationConfirmFetchMessage')
        setPendingConfirmation({
          nodeId,
          title: `${definition.operation.toUpperCase()} ${t('detail.operationConfirmSuffix')}`,
          message,
          confirmLabel: t('detail.operationConfirmExecute'),
          cancelLabel: t('common.cancel'),
          helperText: t('detail.operationConfirmHelper'),
          riskLevel: definition.confirmation === 'high' ? 'high' : 'normal',
          exactMatch: definition.confirmation === 'high' && node.data.operation === 'switch' ? request.targetBranch || targetFromRuntime || '' : undefined,
        })
        setRunState((prev) => ({ ...prev, status: 'waiting-for-confirmation', activeNodeId: nodeId }))
        return
      }

      try {
        const result = await window.electronAPI.runGitOperation(request as never)
        onOperationResult?.(result)
        const outcome = classifyGitOperationResult(result)
        updateRunNodeState(nodeId, {
          status: outcome.kind === 'success' ? 'succeeded' : outcome.kind === 'cancelled' ? 'cancelled' : 'failed',
          finishedAt: Date.now(),
          result,
          ...(outcome.kind === 'success' ? { noOp: outcome.noOp } : {}),
          ...(outcome.kind === 'failure' ? { reason: outcome.reason } : {}),
          ...(outcome.kind === 'cancelled' ? { reason: outcome.reason } : {}),
        })
        await finishWithOutcome(nodeId, outcome)
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error)
        const failedResult: GitOperationResult = {
          repoRoot: gitSnapshot.repoRoot,
          operation: node.data.operation as never,
          ok: false,
          checkedAt: Date.now(),
          command: '',
          output: reason,
          exitCode: null,
          error: reason,
        }
        onOperationResult?.(failedResult)
        const outcome: GitWorkflowNodeOutcome = { kind: 'failure', result: failedResult, reason }
        await finishWithOutcome(nodeId, outcome)
      }
    },
    [clearPending, executeAiCommitNode, finishWithOutcome, gitSnapshot, graphNodeMap, onOperationResult, runtimeCommitMessage, runtimeTargetValue, t, updateRunNodeState],
  )

  const confirmPendingConfirmation = useCallback(async () => {
    if (!pendingConfirmation) return
    const nodeId = pendingConfirmation.nodeId
    const target = runtimeTargetValue || undefined
    const commitMessage = pendingCommit?.presetMessage || runtimeCommitMessage || undefined
    setPendingConfirmation(null)
    clearPending()
    await executeNode(nodeId, target, commitMessage, true)
  }, [clearPending, executeNode, pendingCommit?.presetMessage, pendingConfirmation, runtimeCommitMessage, runtimeTargetValue])

  const confirmPendingCommit = useCallback(
    async (message: string) => {
      if (!pendingCommit) return
      const nodeId = pendingCommit.nodeId
      const resolvedMessage = message || pendingCommit.presetMessage
      setPendingCommit(null)
      clearPending()
      setRuntimeCommitMessage(resolvedMessage)
      await executeNode(nodeId, undefined, resolvedMessage, true)
    },
    [clearPending, executeNode, pendingCommit],
  )

  const cancelPendingAction = useCallback(() => {
    setRunState((prev) => ({ ...prev, status: 'paused' }))
    clearPending()
  }, [clearPending])

  const runNode = useCallback(
    async (nodeId: string) => {
      const node = graphNodeMap.get(nodeId)
      if (!node || !gitSnapshot) return
      const issues = validateGitWorkflowGraph(graph, getValidationContext(gitSnapshot))
      setValidationResult(issues)
      if (!issues.ok) {
        setRunState((prev) => ({ ...prev, status: 'failed', activeNodeId: nodeId }))
        return
      }

      const nodeIssues = getGitWorkflowOperationDefinition(node.data.operation).validateConfig(node.data as never, getValidationContext(gitSnapshot))
      if (nodeIssues.length > 0) {
        updateRunNodeState(nodeId, { status: 'failed', startedAt: Date.now(), finishedAt: Date.now(), reason: nodeIssues[0]?.message || t('detail.gitWorkflowStepFailed') })
        setRunState((prev) => ({ ...prev, status: 'failed', activeNodeId: nodeId }))
        return
      }

      if (node.data.operation === 'switch' || node.data.operation === 'merge') {
        const configTarget = node.data.operation === 'switch' ? node.data.config.target : node.data.config.source
        if (configTarget.mode === 'prompt' && !runtimeTargetValue) {
          setRuntimeTarget({ nodeId, operation: node.data.operation })
          setRunState((prev) => ({ ...prev, status: 'waiting-for-input', activeNodeId: nodeId }))
          return
        }
        await executeNode(nodeId, configTarget.mode === 'fixed' ? configTarget.branch : runtimeTargetValue || undefined)
        return
      }

      if (node.data.operation === 'commit') {
        if (node.data.config.message.mode === 'ai') {
          await executeNode(nodeId, undefined, undefined, false)
          return
        }
        const execution = node.data.config.execution ?? 'confirm-each-run'
        if (execution === 'skip-if-no-changes') {
          const hasStagedChanges = gitSnapshot.changedFiles.some((file) => file.staged)
          if (!hasStagedChanges) {
            const skippedResult: GitOperationResult = {
              repoRoot: gitSnapshot.repoRoot,
              operation: 'commit',
              ok: true,
              checkedAt: Date.now(),
              command: '',
              output: '',
              exitCode: null,
              skipped: true,
              skipReason: 'other',
            }
            updateRunNodeState(nodeId, { status: 'succeeded', startedAt: Date.now(), finishedAt: Date.now(), noOp: true })
            await finishWithOutcome(nodeId, { kind: 'success', result: skippedResult, noOp: true })
            return
          }
        }
        const presetMessage = node.data.config.message.preset ?? ''
        if (execution === 'preset-direct' && presetMessage.trim().length > 0) {
          await executeNode(nodeId, undefined, presetMessage, true)
          return
        }
        setPendingCommit({ nodeId, presetMessage })
        setRunState((prev) => ({ ...prev, status: 'waiting-for-confirmation', activeNodeId: nodeId }))
        return
      }

      if (node.data.requiresConfirmation) {
        setPendingConfirmation({
          nodeId,
          title: `${getGitWorkflowOperationDefinition(node.data.operation).operation.toUpperCase()} ${t('detail.operationConfirmSuffix')}`,
          message: node.data.operation === 'pull' ? t('detail.operationConfirmPullMessage', { currentBranch: gitSnapshot.branch.current }) : node.data.operation === 'push' ? t('detail.operationConfirmPushMessage', { currentBranch: gitSnapshot.branch.current }) : t('detail.operationConfirmFetchMessage'),
          confirmLabel: t('detail.operationConfirmExecute'),
          cancelLabel: t('common.cancel'),
          helperText: t('detail.operationConfirmHelper'),
          riskLevel: getGitWorkflowOperationDefinition(node.data.operation).confirmation === 'high' ? 'high' : 'normal',
        })
        setRunState((prev) => ({ ...prev, status: 'waiting-for-confirmation', activeNodeId: nodeId }))
        return
      }

      await executeNode(nodeId)
    },
    [executeNode, finishWithOutcome, gitSnapshot, graph, graphNodeMap, runtimeTargetValue, t, updateRunNodeState],
  )

  const startWorkflow = useCallback(async (): Promise<boolean> => {
    if (!gitSnapshot) return false
    if (runState.status === 'running' || runState.status === 'validating' || runState.status === 'waiting-for-confirmation' || runState.status === 'waiting-for-input') return false
    const validation = validateGitWorkflowGraph(graph, getValidationContext(gitSnapshot))
    setValidationResult(validation)
    if (!validation.ok) {
      setRunState({ status: 'failed', activeNodeId: graph.entryNodeId, nodeStates: {} })
      return false
    }
    setRunState({ status: 'running', activeNodeId: graph.entryNodeId, nodeStates: {} })
    await runNode(graph.entryNodeId)
    return true
  }, [gitSnapshot, graph, runNode, runState.status])

  const abortWorkflow = useCallback(() => {
    if (awaitingAiCommitNodeIdRef.current && aiCommit) void aiCommit.onCancel()
    awaitingAiCommitNodeIdRef.current = null
    setRunState((prev) => ({ ...prev, status: 'paused' }))
    clearPending()
  }, [aiCommit, clearPending])

  const setRuntimeTargetForNode = useCallback((nodeId: string, value: string) => {
    setRuntimeTargetValue(value)
    setRuntimeTarget((prev) => (prev?.nodeId === nodeId ? prev : { nodeId, operation: 'switch' }))
  }, [])

  const continueRuntimeTarget = useCallback(async () => {
    if (!runtimeTarget || !runtimeTargetValue) return
    const nodeId = runtimeTarget.nodeId
    setRuntimeTarget(null)
    await executeNode(nodeId, runtimeTargetValue, undefined, false)
  }, [executeNode, runtimeTarget, runtimeTargetValue])

  useEffect(() => {
    runNodeRef.current = runNode
  }, [runNode])

  useEffect(() => {
    const nodeId = awaitingAiCommitNodeIdRef.current
    if (!nodeId || !aiCommit) return
    if (aiCommit.status !== 'success' && aiCommit.status !== 'error') return
    awaitingAiCommitNodeIdRef.current = null
    if (aiCommit.status === 'success') {
      const result: GitOperationResult = {
        repoRoot: gitSnapshot?.repoRoot ?? '',
        operation: 'commit',
        ok: true,
        checkedAt: Date.now(),
        command: 'ai-commit',
        output: '',
        exitCode: 0,
      }
      onOperationResult?.(result)
      updateRunNodeState(nodeId, { status: 'succeeded', finishedAt: Date.now() })
      void finishWithOutcome(nodeId, { kind: 'success', result })
      return
    }
    const reason = t('detail.gitWorkflowAiCommitFailed')
    const result: GitOperationResult = {
      repoRoot: gitSnapshot?.repoRoot ?? '',
      operation: 'commit',
      ok: false,
      checkedAt: Date.now(),
      command: 'ai-commit',
      output: reason,
      exitCode: null,
      error: reason,
    }
    onOperationResult?.(result)
    updateRunNodeState(nodeId, { status: 'failed', finishedAt: Date.now(), reason })
    void finishWithOutcome(nodeId, { kind: 'failure', result, reason })
  }, [aiCommit, finishWithOutcome, gitSnapshot?.repoRoot, onOperationResult, t, updateRunNodeState])

  return {
    graph,
    setGraph,
    selectedNode,
    selectedNodeId,
    setSelectedNodeId,
    validationResult,
    runState,
    branchTargetOptions,
    pendingConfirmation,
    pendingCommit,
    runtimeTarget,
    runtimeTargetValue,
    runtimeCommitMessage,
    setRuntimeCommitMessage,
    addNode,
    updateNode,
    updateNodeConfig,
    deleteNode,
    deleteEdge,
    connect,
    commitNodePositions,
    setEntryNodeId,
    saveState,
    isDirty,
    startWorkflow,
    abortWorkflow,
    confirmPendingConfirmation,
    confirmPendingCommit,
    cancelPendingAction,
    setRuntimeTargetForNode,
    continueRuntimeTarget,
  }
}

export type GitWorkflowRunnerApi = ReturnType<typeof useGitWorkflowRunner>
