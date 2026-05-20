import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  Position,
  type Edge as FlowEdge,
  type Node as FlowNode,
  type NodeProps,
  type NodeTypes,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { ArrowUpRight, Bot, ChevronLeft, Code2, Folder, Package, Play, Square } from 'lucide-react'
import { Terminal } from '../components/Terminal'
import { UrlPopover } from '../components/UrlPopover'
import { detectProjectEnvironment, projectEnvironmentLabel } from '../lib/projectEnvironment'
import { useAppStore } from '../stores/appStore'

type AiCommitStatus = 'idle' | 'running' | 'success' | 'error'
type AiStepStatus = 'pending' | 'running' | 'success' | 'error'
type RightPaneMode = 'flow' | 'raw'
type AiStepKey = 'start' | 'stage' | 'ai' | 'message' | 'commit' | 'done'

interface AiStepState {
  key: AiStepKey
  label: string
  status: AiStepStatus
  detail?: string
}

type AiFlowNodeData = {
  label: string
  status: AiStepStatus
  detail?: string
  index: number
}

type AiFlowNode = FlowNode<AiFlowNodeData, 'ai-step'>
type AiFlowEdge = FlowEdge<{ status: AiStepStatus }, 'smoothstep'>
const FLOW_NODE_WIDTH = 220
const FLOW_NODE_HEIGHT = 84
const FLOW_NODE_START_X = 36
const FLOW_NODE_START_Y = 56
const FLOW_NODE_GAP_X = 260

const BASE_AI_STEPS: AiStepState[] = [
  { key: 'start', label: '启动提交任务', status: 'pending' },
  { key: 'stage', label: '暂存改动', status: 'pending' },
  { key: 'ai', label: '调用 AI 生成提交信息', status: 'pending' },
  { key: 'message', label: '确认提交信息', status: 'pending' },
  { key: 'commit', label: '执行 git commit', status: 'pending' },
  { key: 'done', label: '完成', status: 'pending' },
]

function stepStatusText(status: AiStepStatus): string {
  if (status === 'success') return 'completed'
  if (status === 'running') return 'running'
  if (status === 'error') return 'failed'
  return 'pending'
}

function getFocusedStepKey(steps: AiStepState[], commitStatus: AiCommitStatus): AiStepKey {
  const runningStep = steps.find((step) => step.status === 'running')
  if (runningStep) return runningStep.key

  const errorStep = steps.find((step) => step.status === 'error')
  if (errorStep) return errorStep.key

  if (commitStatus === 'success') return 'done'

  const latestSuccessStep = [...steps].reverse().find((step) => step.status === 'success')
  if (latestSuccessStep) return latestSuccessStep.key

  return 'start'
}

function flowNodeTone(status: AiStepStatus): {
  border: string
  background: string
  dot: string
  text: string
} {
  if (status === 'success') {
    return {
      border: 'color-mix(in srgb, var(--color-success) 34%, transparent)',
      background: 'color-mix(in srgb, var(--color-success-background) 86%, transparent)',
      dot: 'var(--color-success)',
      text: 'var(--color-success)',
    }
  }
  if (status === 'running') {
    return {
      border: 'color-mix(in srgb, var(--color-warning) 36%, transparent)',
      background: 'color-mix(in srgb, var(--color-warning-background) 88%, transparent)',
      dot: 'var(--color-warning)',
      text: 'var(--color-warning)',
    }
  }
  if (status === 'error') {
    return {
      border: 'color-mix(in srgb, var(--color-destructive) 34%, transparent)',
      background: 'color-mix(in srgb, var(--color-destructive-background) 86%, transparent)',
      dot: 'var(--color-destructive)',
      text: 'var(--color-destructive)',
    }
  }
  return {
    border: 'var(--color-border)',
    background: 'color-mix(in srgb, var(--color-background-sunken) 58%, transparent)',
    dot: 'color-mix(in srgb, var(--color-muted-foreground) 44%, transparent)',
    text: 'var(--color-muted-foreground)',
  }
}

function AiFlowStepNode({ data }: NodeProps<AiFlowNode>) {
  const tone = flowNodeTone(data.status)
  return (
    <div
      className="nodrag nowheel w-[220px] rounded-[14px] border px-3.5 py-3 shadow-sm"
      style={{
        borderColor: tone.border,
        background: tone.background,
      }}
    >
      <Handle
        type="target"
        position={Position.Left}
        isConnectable={false}
        className="!h-2 !w-2 !border-0 !bg-transparent !opacity-0"
      />
      <Handle
        type="source"
        position={Position.Right}
        isConnectable={false}
        className="!h-2 !w-2 !border-0 !bg-transparent !opacity-0"
      />
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--color-muted-foreground)]">
          Step {data.index + 1}
        </span>
        <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em]" style={{ color: tone.text }}>
          {stepStatusText(data.status)}
        </span>
      </div>
      <div className="flex items-start gap-2.5">
        <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: tone.dot }} />
        <div className="min-w-0">
          <p className="truncate text-[12px] font-medium text-[color:var(--color-foreground)]" title={data.label}>
            {data.label}
          </p>
          {data.detail && (
            <p className="mt-1 truncate text-[10px] text-[color:var(--color-muted-foreground)]" title={data.detail}>
              {data.detail}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

const FLOW_NODE_TYPES: NodeTypes = {
  'ai-step': AiFlowStepNode,
}

function InfoCard({
  label,
  value,
  icon: Icon,
}: {
  label: string
  value: string
  icon: React.ComponentType<{ className?: string; strokeWidth?: string | number }>
}) {
  return (
    <div className="rounded-[16px] px-4 py-3 quiet-control">
      <div className="mb-2 flex items-center gap-1.5 text-[color:var(--color-muted-foreground)]">
        <Icon className="h-3.5 w-3.5" strokeWidth={1.8} />
        <span className="section-label">{label}</span>
      </div>
      <p className="truncate text-[13px] font-medium text-[color:var(--color-foreground)]" title={value}>
        {value}
      </p>
    </div>
  )
}

function stepRank(status: AiStepStatus): number {
  if (status === 'error') return 3
  if (status === 'success') return 2
  if (status === 'running') return 1
  return 0
}

function mergeStepStatus(current: AiStepStatus, next: AiStepStatus): AiStepStatus {
  return stepRank(next) >= stepRank(current) ? next : current
}

function applyStep(
  steps: AiStepState[],
  key: AiStepKey,
  status: AiStepStatus,
  detail?: string
): AiStepState[] {
  return steps.map((step) => {
    if (step.key !== key) return step
    return {
      ...step,
      status: mergeStepStatus(step.status, status),
      detail: detail ?? step.detail,
    }
  })
}

function completePreviousSteps(steps: AiStepState[], untilKey: AiStepKey): AiStepState[] {
  const index = steps.findIndex((s) => s.key === untilKey)
  if (index <= 0) return steps
  return steps.map((step, i) => {
    if (i >= index) return step
    if (step.status === 'pending' || step.status === 'running') {
      return { ...step, status: 'success' }
    }
    return step
  })
}

function parseAiFlowLine(rawLine: string, steps: AiStepState[]): AiStepState[] {
  const line = rawLine.trim()
  let next = steps

  if (!line) return next

  if (line.includes('[AI Commit] Starting')) {
    next = applyStep(next, 'start', 'running', line)
  }
  if (line.includes('git add')) {
    next = completePreviousSteps(next, 'stage')
    next = applyStep(next, 'stage', 'running', line)
  }
  if (line.includes('staged file count')) {
    next = applyStep(next, 'stage', 'success', line)
  }
  if (line.includes('stage: split plan generation') || line.includes('[split-plan]')) {
    next = completePreviousSteps(next, 'ai')
    next = applyStep(next, 'ai', 'running', line)
  }
  if (line.includes('split plan:') || line.includes('plan generated:')) {
    next = applyStep(next, 'ai', 'success', line)
  }
  if (line.includes('stage: apply split plan') || line.includes('[split-apply] batch')) {
    next = completePreviousSteps(next, 'commit')
    next = applyStep(next, 'commit', 'running', line)
  }
  if (line.includes('[split-apply] Done.')) {
    next = applyStep(next, 'commit', 'success', line)
  }
  if (line.includes('stage: AI message generation') || line.includes('Calling AI API')) {
    next = completePreviousSteps(next, 'ai')
    next = applyStep(next, 'ai', 'running', line)
  }
  if (line.includes('[ai] raw response:') || line.includes('[ai] final subject=')) {
    next = applyStep(next, 'ai', 'success')
    next = completePreviousSteps(next, 'message')
    next = applyStep(next, 'message', 'running', line)
  }
  if (line.includes('[auto-commit] Commit message:')) {
    next = applyStep(next, 'message', 'success')
  }
  if (line.includes('[auto-commit] git commit')) {
    next = completePreviousSteps(next, 'commit')
    next = applyStep(next, 'commit', 'running', line)
  }
  if (line.includes('[auto-commit] Done.')) {
    next = applyStep(next, 'commit', 'success')
    next = completePreviousSteps(next, 'done')
    next = applyStep(next, 'done', 'success', line)
  }
  if (line.includes('[AI Commit] finished with code 0')) {
    next = applyStep(next, 'done', 'success', line)
  }
  if (line.includes('failed') || line.includes('error') || line.includes('Error:') || line.includes('Exception')) {
    const runningStep = [...next].reverse().find((s) => s.status === 'running')
    if (runningStep) {
      next = applyStep(next, runningStep.key, 'error', line)
    } else {
      next = applyStep(next, 'done', 'error', line)
    }
  }

  return next
}

function clampSplitMaxBatches(value: number | undefined): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return 4
  return Math.max(1, Math.min(12, Math.trunc(value)))
}

function extractLatestAiSpeech(lines: string[]): string {
  const aiLines = lines.filter((line) => line.startsWith('[ai]'))
  if (aiLines.length > 0) {
    return aiLines.slice(-8).join('\n')
  }
  const fallbackJson = [...lines].reverse().find(
    (line) => line.startsWith('{') || line.startsWith('```') || line.includes('"subject"')
  )
  return fallbackJson || ''
}

export function DetailPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const navigate = useNavigate()
  const project = useAppStore((s) => s.projects.find((p) => p.id === projectId))
  const processStatus = projectId ? useAppStore((s) => s.processes[projectId]?.status ?? 'stopped') : 'stopped'
  const processUrls = projectId ? useAppStore((s) => s.processUrls[projectId] || []) : ([] as string[])
  const toolProcessId = useMemo(() => (projectId ? `${projectId}::toolbox` : ''), [projectId])
  const toolProcessStatus = toolProcessId
    ? useAppStore((s) => s.processes[toolProcessId]?.status ?? 'stopped')
    : 'stopped'
  const aiCommitConfig = useAppStore((s) => s.config.aiCommit)
  const startProject = useAppStore((s) => s.startProject)
  const stopProject = useAppStore((s) => s.stopProject)

  const [customCommand, setCustomCommand] = useState(project?.customCommand ?? '')
  const [aiCommitStatus, setAiCommitStatus] = useState<AiCommitStatus>('idle')
  const [rightPaneMode, setRightPaneMode] = useState<RightPaneMode>('flow')
  const [flowSteps, setFlowSteps] = useState<AiStepState[]>(BASE_AI_STEPS)
  const [aiRawLines, setAiRawLines] = useState<string[]>([])
  const [aiRawText, setAiRawText] = useState('')
  const [runStartedAt, setRunStartedAt] = useState<number | null>(null)
  const [runFinishedAt, setRunFinishedAt] = useState<number | null>(null)
  const [quickConfigOpen, setQuickConfigOpen] = useState(false)
  const [quickSplit, setQuickSplit] = useState(Boolean(aiCommitConfig?.split ?? false))
  const [quickSplitMaxBatches, setQuickSplitMaxBatches] = useState(
    String(clampSplitMaxBatches(aiCommitConfig?.splitMaxBatches))
  )
  const [quickConfigPos, setQuickConfigPos] = useState({ x: 0, y: 0 })
  const quickConfigRef = useRef<HTMLDivElement | null>(null)
  const quickButtonRef = useRef<HTMLButtonElement | null>(null)
  const flowViewportReadyRef = useRef(false)
  const flowInitialFocusDoneRef = useRef(false)
  const flowLastFocusedStepRef = useRef<AiStepKey | null>(null)
  const flowApiRef = useRef<{
    setCenter: (
      x: number,
      y: number,
      options?: {
        zoom?: number
        duration?: number
        interpolate?: 'smooth' | 'linear'
        ease?: (t: number) => number
      }
    ) => Promise<boolean>
  } | null>(null)

  const environment = project ? detectProjectEnvironment(project.path) : 'unknown'
  const environmentLabel = project ? projectEnvironmentLabel(environment) : 'Unknown'
  const isRunning = processStatus === 'running'
  const isActive = isRunning
  const isAiEnabled = aiCommitConfig?.enabled ?? true
  const defaultSplit = Boolean(aiCommitConfig?.split ?? false)
  const defaultSplitMaxBatches = clampSplitMaxBatches(aiCommitConfig?.splitMaxBatches)
  const quickSplitMaxBatchesNumber = clampSplitMaxBatches(Number.parseInt(quickSplitMaxBatches.trim(), 10))

  if (!project || !projectId) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4">
        <h2 className="text-lg font-semibold text-[color:var(--color-foreground)]">Project not found</h2>
        <button
          className="inline-flex items-center gap-1.5 text-sm text-primary transition-colors hover:text-primary"
          onClick={() => navigate('/')}
        >
          <ChevronLeft className="h-4 w-4" strokeWidth={1.8} />
          Back to Home
        </button>
      </div>
    )
  }

  const handleSaveCommand = async () => {
    const trimmed = customCommand.trim()
    project.customCommand = trimmed || undefined
    setCustomCommand(trimmed)
    const { projects } = useAppStore.getState()
    await window.electronAPI.setConfig({
      projects: projects.map((p) => ({
        path: p.path,
        customCommand: p.customCommand,
        pinned: p.pinned,
        lastOpened: p.lastOpened,
        cli: p.cli,
        docLinks: p.docLinks ?? [],
        folderId: p.folderId,
        tagIds: p.tagIds ?? [],
      })),
    })
  }

  useEffect(() => {
    if (!projectId || !toolProcessId || !project) return
    if (toolProcessStatus !== 'stopped') return
    const toolCommand = environment === 'ubuntu' ? 'exec bash -i' : 'powershell -NoLogo -NoExit'
    const useWsl = environment === 'ubuntu'
    void startProject(projectId, toolCommand, toolProcessId, useWsl)
  }, [projectId, project, toolProcessId, toolProcessStatus, environment, startProject])

  useEffect(() => {
    if (!toolProcessId) return
    return () => {
      void stopProject(toolProcessId)
    }
  }, [toolProcessId, stopProject])

  useEffect(() => {
    if (!projectId || !toolProcessId) return
    const api = window.electronAPI as unknown as {
      onAiCommitOutput?: (cb: (d: { projectId: string; data: string }) => void) => () => void
      onAiCommitStatus?: (cb: (d: { projectId: string; status: 'running' | 'success' | 'error' }) => void) => () => void
    }

    if (typeof api.onAiCommitOutput !== 'function' || typeof api.onAiCommitStatus !== 'function') {
      useAppStore.getState().appendOutput(
        toolProcessId,
        '\r\n[AI Commit] preload API is outdated, please restart Electron app process.\r\n'
      )
      return
    }

    const cleanupOutput = api.onAiCommitOutput(({ projectId: pid, data }) => {
      if (pid !== projectId) return
      useAppStore.getState().appendOutput(toolProcessId, data)
      setAiRawText((prev) => prev + data)
      const split = data.replace(/\r/g, '').split('\n').map((line) => line.trim()).filter(Boolean)
      if (split.length > 0) {
        setAiRawLines((prev) => {
          const next = [...prev, ...split]
          return next.slice(-300)
        })
        setFlowSteps((prev) => split.reduce((acc, line) => parseAiFlowLine(line, acc), prev))
      }
    })

    const cleanupStatus = api.onAiCommitStatus(({ projectId: pid, status }) => {
      if (pid !== projectId) return
      setAiCommitStatus(status)
      if (status === 'running') {
        setFlowSteps(BASE_AI_STEPS)
        setAiRawLines([])
        setAiRawText('')
        setRunStartedAt(Date.now())
        setRunFinishedAt(null)
      } else {
        setRunFinishedAt(Date.now())
        if (status === 'success') {
          setFlowSteps((prev) => applyStep(completePreviousSteps(prev, 'done'), 'done', 'success'))
        }
        if (status === 'error') {
          setFlowSteps((prev) => {
            const running = [...prev].reverse().find((s) => s.status === 'running')
            if (running) return applyStep(prev, running.key, 'error')
            return applyStep(prev, 'done', 'error')
          })
        }
      }
    })

    return () => {
      cleanupOutput()
      cleanupStatus()
    }
  }, [projectId, toolProcessId])

  useEffect(() => {
    setQuickSplit(defaultSplit)
    setQuickSplitMaxBatches(String(defaultSplitMaxBatches))
  }, [defaultSplit, defaultSplitMaxBatches, projectId])

  useEffect(() => {
    if (!quickConfigOpen) return

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as globalThis.Node
      if (quickConfigRef.current?.contains(target)) return
      if (quickButtonRef.current?.contains(target)) return
      setQuickConfigOpen(false)
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setQuickConfigOpen(false)
      }
    }

    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [quickConfigOpen])

  useEffect(() => {
    if (rightPaneMode !== 'flow') return
    flowInitialFocusDoneRef.current = false
  }, [rightPaneMode])

  const handleAiCommit = async (override?: { split?: boolean; splitMaxBatches?: number }) => {
    if (!projectId || !project) return
    if (aiCommitStatus === 'running') return

    const api = window.electronAPI as unknown as {
      runAiCommit?: (
        projectId: string,
        projectPath: string,
        override?: { split?: boolean; splitMaxBatches?: number }
      ) => Promise<boolean>
    }

    if (typeof api.runAiCommit !== 'function') {
      useAppStore.getState().appendOutput(
        toolProcessId,
        '\r\n[AI Commit] runAiCommit API is unavailable, please restart Electron app process.\r\n'
      )
      setAiCommitStatus('error')
      return
    }

    setAiCommitStatus('running')
    setRightPaneMode('flow')
    useAppStore.getState().appendOutput(
      toolProcessId,
      `\r\n[AI Commit] trigger: ${isAiEnabled ? 'AI enabled' : 'AI disabled (fallback local message)'}\r\n`
    )
    if (override) {
      useAppStore.getState().appendOutput(
        toolProcessId,
        `[AI Commit] quick override: split=${override.split ? 'on' : 'off'}, maxBatches=${override.splitMaxBatches ?? defaultSplitMaxBatches}\r\n`
      )
    }
    const ok = await api.runAiCommit(projectId, project.path, override)
    if (!ok) {
      setAiCommitStatus('error')
    }
  }

  const runWithQuickConfig = async () => {
    const override = {
      split: quickSplit,
      splitMaxBatches: quickSplitMaxBatchesNumber,
    }
    setQuickConfigOpen(false)
    await handleAiCommit(override)
  }

  const saveQuickConfigAsDefault = async () => {
    const nextConfig = {
      ...(aiCommitConfig || {}),
      split: quickSplit,
      splitMaxBatches: quickSplitMaxBatchesNumber,
    }
    await useAppStore.getState().setAiCommitConfig(nextConfig)
    setQuickConfigOpen(false)
  }

  const durationMs = runStartedAt ? (runFinishedAt ?? Date.now()) - runStartedAt : 0
  const statusText =
    aiCommitStatus === 'running' ? 'Running' : aiCommitStatus === 'success' ? 'Success' : aiCommitStatus === 'error' ? 'Failed' : 'Idle'
  const statusClass =
    aiCommitStatus === 'running'
      ? 'text-[color:var(--color-warning)] bg-[color:var(--color-warning-background)]'
      : aiCommitStatus === 'success'
        ? 'text-[color:var(--color-success)] bg-[color:var(--color-success-background)]'
        : aiCommitStatus === 'error'
          ? 'text-[color:var(--color-destructive)] bg-[color:var(--color-destructive-background)]'
          : 'text-[color:var(--color-muted-foreground)] border-[color:var(--color-border)]'

  const latestAiRaw = extractLatestAiSpeech(aiRawLines)
  const flowCompletedCount = flowSteps.filter((s) => s.status === 'success').length
  const flowNodes = useMemo<AiFlowNode[]>(
    () =>
      flowSteps.map((step, index) => ({
        id: step.key,
        type: 'ai-step',
        position: { x: FLOW_NODE_START_X + index * FLOW_NODE_GAP_X, y: FLOW_NODE_START_Y },
        data: {
          label: step.label,
          status: step.status,
          detail: step.detail,
          index,
        },
        draggable: false,
        selectable: false,
      })),
    [flowSteps]
  )
  const flowEdges = useMemo<AiFlowEdge[]>(
    () =>
      flowSteps.slice(0, -1).map((step, index) => {
        const next = flowSteps[index + 1]
        const active = step.status === 'success' || step.status === 'running'
        const errored = step.status === 'error'
        return {
          id: `e-${step.key}-${next.key}`,
          source: step.key,
          target: next.key,
          type: 'smoothstep',
          animated: active && !errored,
          markerEnd: {
            type: MarkerType.ArrowClosed,
            width: 18,
            height: 18,
            color: errored
              ? 'var(--color-destructive)'
              : active
                ? 'var(--color-primary)'
                : 'color-mix(in srgb, var(--color-border) 90%, transparent)',
          },
          style: {
            stroke: errored
              ? 'var(--color-destructive)'
              : active
                ? 'var(--color-primary)'
                : 'color-mix(in srgb, var(--color-border) 90%, transparent)',
            strokeWidth: active ? 2.2 : 1.6,
            opacity: active ? 1 : 0.72,
          },
          pathOptions: { offset: 18 },
          selectable: false,
          focusable: false,
          data: {
            status: errored ? 'error' : active ? 'running' : 'pending',
          },
        }
      }),
    [flowSteps]
  )

  useEffect(() => {
    if (rightPaneMode !== 'flow') return
    const api = flowApiRef.current
    if (!api || !flowViewportReadyRef.current) return

    if (!flowInitialFocusDoneRef.current) {
      flowInitialFocusDoneRef.current = true
      flowLastFocusedStepRef.current = 'start'
      const startCenterX = FLOW_NODE_START_X + FLOW_NODE_WIDTH / 2
      const startCenterY = FLOW_NODE_START_Y + FLOW_NODE_HEIGHT / 2
      void api.setCenter(startCenterX, startCenterY, {
        zoom: 0.95,
        duration: 520,
        interpolate: 'smooth',
      })
      return
    }

    const targetStepKey = getFocusedStepKey(flowSteps, aiCommitStatus)
    if (flowLastFocusedStepRef.current === targetStepKey) return

    const targetIndex = flowSteps.findIndex((step) => step.key === targetStepKey)
    if (targetIndex < 0) return

    flowLastFocusedStepRef.current = targetStepKey
    const centerX = FLOW_NODE_START_X + targetIndex * FLOW_NODE_GAP_X + FLOW_NODE_WIDTH / 2
    const centerY = FLOW_NODE_START_Y + FLOW_NODE_HEIGHT / 2
    void api.setCenter(centerX, centerY, {
      zoom: 0.95,
      duration: 700,
      interpolate: 'smooth',
      ease: (t) => 1 - (1 - t) * (1 - t) * (1 - t),
    })
  }, [flowSteps, aiCommitStatus, rightPaneMode])

  return (
    <div className="flex h-screen flex-col">
      <header className="app-chrome flex min-h-[84px] shrink-0 items-center justify-between px-8 py-4">
        <div className="flex min-w-0 items-center gap-4">
          <button
            className="rounded-full p-2 text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)]"
            onClick={() => navigate('/')}
          >
            <ChevronLeft className="h-5 w-5" strokeWidth={1.8} />
          </button>

          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold tracking-[-0.03em] text-[color:var(--color-foreground)]">{project.name}</h1>
            <p className="mt-0.5 truncate text-xs text-[color:var(--color-muted-foreground)]">{project.path}</p>
            <p className="mt-0.5 text-[11px] text-[color:var(--color-muted-foreground)]/85">Environment: {environmentLabel}</p>
          </div>

          {isActive ? (
            <div
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium ${isRunning
                ? 'bg-[color:var(--color-success-background)] text-[color:var(--color-success)]'
                : 'bg-[color:var(--color-warning-background)] text-[color:var(--color-warning)]'
                }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${isRunning ? 'bg-[color:var(--color-success)]' : 'bg-[color:var(--color-warning)]'}`} />
              {isRunning ? 'Running' : 'Session Available'}
            </div>
          ) : (
            <span className="shrink-0 text-[11px] font-medium text-[color:var(--color-muted-foreground)]">Stopped</span>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-3">
          {isRunning && processUrls.length > 0 && (
            <UrlPopover urls={processUrls}>
              <button
                className="quiet-control inline-flex items-center gap-1.5 rounded-full border-0 px-3 py-1.5 text-xs text-primary transition-colors hover:bg-[color:var(--color-accent)]"
                onClick={() => window.electronAPI.openExternal(processUrls[0])}
              >
                <ArrowUpRight className="h-3 w-3" />
                <span className="max-w-[180px] truncate">{processUrls[0]}</span>
              </button>
            </UrlPopover>
          )}

          <button
            className={`inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium transition-all ${isActive
              ? 'border text-[color:var(--color-destructive)] hover:bg-[color:var(--color-destructive-background)]'
              : 'bg-primary text-white shadow-sm hover:bg-primary-hover'
              }`}
            style={
              isActive
                ? { borderColor: 'color-mix(in srgb, var(--color-destructive) 32%, transparent)' }
                : undefined
            }
            onClick={() => (isActive ? stopProject(projectId) : startProject(projectId))}
          >
            {isActive ? (
              <>
                <Square className="h-3.5 w-3.5" />
                Stop
              </>
            ) : (
              <>
                <Play className="h-3.5 w-3.5" />
                Run
              </>
            )}
          </button>

          <div className="relative">
            <button
              ref={quickButtonRef}
              className={`inline-flex items-center gap-1.5 rounded-full border px-4 py-2 text-sm font-medium transition-all ${aiCommitStatus === 'running'
                ? 'bg-[color:var(--color-warning-background)] text-[color:var(--color-warning)]'
                : aiCommitStatus === 'error'
                  ? 'text-[color:var(--color-destructive)] hover:bg-[color:var(--color-destructive-background)]'
                  : 'border-[color:var(--color-border)] text-[color:var(--color-foreground)] hover:bg-[color:var(--color-accent)]'
                }`}
              style={
                aiCommitStatus === 'running'
                  ? { borderColor: 'color-mix(in srgb, var(--color-warning) 34%, transparent)' }
                  : aiCommitStatus === 'error'
                    ? { borderColor: 'color-mix(in srgb, var(--color-destructive) 34%, transparent)' }
                    : undefined
              }
              onClick={() => void handleAiCommit()}
              onContextMenu={(e) => {
                e.preventDefault()
                if (aiCommitStatus === 'running') return
                const panelWidth = 260
                const panelHeight = 220
                const x = Math.max(8, Math.min(e.clientX, window.innerWidth - panelWidth - 8))
                const y = Math.max(8, Math.min(e.clientY, window.innerHeight - panelHeight - 8))
                setQuickConfigPos({ x, y })
                setQuickConfigOpen(true)
              }}
              disabled={aiCommitStatus === 'running'}
              title={isAiEnabled ? 'Left click: run commit. Right click: quick config.' : 'AI disabled in Settings, local commit message only'}
            >
              <Bot className="h-3.5 w-3.5" />
              {aiCommitStatus === 'running' ? 'AI Committing...' : 'AI Auto Commit'}
            </button>
          </div>
        </div>
      </header>

      {quickConfigOpen && (
        <div
          ref={quickConfigRef}
          className="fixed z-[120] w-[260px] rounded-[16px] border p-3 shadow-xl surface-card"
          style={{
            left: `${quickConfigPos.x}px`,
            top: `${quickConfigPos.y}px`,
            borderColor: 'var(--color-border)',
          }}
        >
          <div className="mb-3 flex items-center justify-between">
            <p className="text-xs font-semibold text-[color:var(--color-foreground)]">Quick AI Commit Config</p>
            <button
              className="rounded-full px-2 py-0.5 text-[11px] text-[color:var(--color-muted-foreground)] hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)]"
              onClick={() => setQuickConfigOpen(false)}
            >
              Close
            </button>
          </div>

          <label className="mb-2 flex items-center gap-2 text-xs text-[color:var(--color-foreground)]">
            <input
              type="checkbox"
              checked={quickSplit}
              onChange={(e) => setQuickSplit(e.target.checked)}
            />
            Enable split commit
          </label>

          <div className="mb-3">
            <p className="mb-1 text-[11px] text-[color:var(--color-muted-foreground)]">Split max batches (1-12)</p>
            <input
              type="number"
              min={1}
              max={12}
              step={1}
              value={quickSplitMaxBatches}
              disabled={!quickSplit}
              onChange={(e) => setQuickSplitMaxBatches(e.target.value)}
              className="quiet-control h-8 w-full rounded-full border-0 px-3 text-xs text-[color:var(--color-foreground)]"
            />
          </div>

          <div className="mb-2 text-[10px] text-[color:var(--color-muted-foreground)]">
            Default: Split {defaultSplit ? 'On' : 'Off'} · {defaultSplitMaxBatches}
          </div>

          <div className="flex items-center gap-2">
            <button
              className="flex-1 rounded-full bg-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-hover"
              onClick={() => void runWithQuickConfig()}
              disabled={aiCommitStatus === 'running'}
            >
              Run This Time
            </button>
            <button
              className="rounded-full border border-[color:var(--color-border)] px-3 py-1.5 text-xs text-[color:var(--color-foreground)] hover:bg-[color:var(--color-accent)]"
              onClick={() => void saveQuickConfigAsDefault()}
            >
              Save Default
            </button>
          </div>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-x-auto px-8 pb-8 pt-8">
        <div className="grid h-full min-h-0 min-w-[1100px] grid-cols-[minmax(580px,0.92fr)_minmax(520px,1.08fr)] gap-6">
          <section
            className="min-h-0 min-w-0 overflow-hidden"
            style={{
              background: 'var(--color-terminal-surface)',
              borderRadius: '22px',
              boxShadow: `
                inset 0 1px 0 rgba(255,255,255,0.04),
                0 0 0 1px rgba(255,255,255,0.03),
                0 14px 34px rgba(0,0,0,0.14)
              `,
            }}
          >
            <div className="flex items-center border-b border-white/5 px-[14px] py-[11px]">
              <span className="h-[10px] w-[10px] rounded-full bg-[#f08c8c]/80" />
              <span className="ml-[6px] h-[10px] w-[10px] rounded-full bg-[#e3bb7e]/80" />
              <span className="ml-[6px] h-[10px] w-[10px] rounded-full bg-[#82c2a8]/80" />
              <span className="ml-[10px] select-none font-mono text-[10px] font-medium uppercase tracking-[0.2em] text-white/35">
                service terminal
              </span>
            </div>
            <div className="min-h-0 p-4" style={{ height: 'calc(100% - 56px)' }}>
              <div
                className="xterm-container h-full min-h-0 overflow-hidden rounded-[18px]"
                style={{
                  background: 'var(--color-terminal-inner)',
                  padding: '16px 18px',
                }}
              >
                <Terminal projectId={projectId} />
              </div>
            </div>
          </section>

          <aside className="min-h-0 min-w-0 overflow-auto rounded-[22px] p-5 surface-card">
            <div className="mb-5 flex items-center gap-3 rounded-full px-4 py-3 quiet-control">
              <span className="select-none text-xs text-[color:var(--color-muted-foreground)]">$</span>
              <input
                type="text"
                value={customCommand}
                onChange={(e) => setCustomCommand(e.target.value)}
                placeholder={project.command}
                className="min-w-0 flex-1 border-none bg-transparent font-mono text-sm text-[color:var(--color-foreground)] outline-none placeholder:text-[color:var(--color-muted-foreground)]"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleSaveCommand()
                }}
              />
              {customCommand && customCommand !== project.command && (
                <button
                  className="shrink-0 rounded-full px-3 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/10 hover:text-primary"
                  onClick={() => void handleSaveCommand()}
                >
                  Save
                </button>
              )}
            </div>

            <div className="mb-5 space-y-3">
              <InfoCard label="Path" value={project.path} icon={Folder} />
              <div className="grid grid-cols-2 gap-3">
                <InfoCard label="Type" value={project.type} icon={Code2} />
                <InfoCard label="Package Manager" value={project.packageManager || 'npm'} icon={Package} />
              </div>
            </div>

            <div className="mb-4 flex items-center justify-between">
              <div>
                <p className="section-label">
                  AI Commit
                </p>
                <p className="mt-0.5 text-xs text-[color:var(--color-muted-foreground)]">
                  Process timeline and diagnostics
                </p>
              </div>
              <div className="quiet-control flex items-center gap-1 rounded-full border-0 p-1">
                <button
                  className={`rounded-full px-3 py-1 text-[11px] font-medium transition-colors ${rightPaneMode === 'flow'
                    ? 'bg-primary text-white'
                    : 'text-[color:var(--color-muted-foreground)] hover:text-[color:var(--color-foreground)]'
                    }`}
                  onClick={() => setRightPaneMode('flow')}
                >
                  流程
                </button>
                <button
                  className={`rounded-full px-3 py-1 text-[11px] font-medium transition-colors ${rightPaneMode === 'raw'
                    ? 'bg-primary text-white'
                    : 'text-[color:var(--color-muted-foreground)] hover:text-[color:var(--color-foreground)]'
                    }`}
                  onClick={() => setRightPaneMode('raw')}
                >
                  原始日志
                </button>
              </div>
            </div>

            <div>
              {rightPaneMode === 'flow' ? (
                <div className="flex flex-col gap-3">
                  <div
                    className="rounded-[16px] border px-4 py-3"
                    style={{
                      borderColor: 'color-mix(in srgb, var(--color-primary) 28%, transparent)',
                      background: 'color-mix(in srgb, var(--color-primary) 11%, transparent)',
                    }}
                  >
                    <div className="flex flex-wrap items-start gap-x-2 gap-y-1.5">
                      <span className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] ${statusClass}`}>
                        {statusText}
                      </span>
                      <span className="min-w-0 whitespace-normal break-all text-[11px] text-[color:var(--color-foreground)]/85">
                        Tool Terminal: {toolProcessStatus === 'running' ? 'online' : toolProcessStatus}
                      </span>
                      <span className="inline-flex items-center rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-background-sunken)] px-2 py-0.5 text-[11px] text-[color:var(--color-muted-foreground)]">
                        Steps: {flowCompletedCount}/{flowSteps.length}
                      </span>
                    </div>
                    <div className="mt-2 text-[11px] text-[color:var(--color-muted-foreground)]">
                      Duration: {runStartedAt ? `${Math.floor(durationMs / 1000)}s` : '--'}
                    </div>
                  </div>

                  <div
                    className="relative h-[260px] overflow-hidden rounded-[18px] border"
                    style={{
                      borderColor: 'color-mix(in srgb, var(--color-border) 88%, transparent)',
                      background: 'color-mix(in srgb, var(--color-card) 90%, transparent)',
                    }}
                  >
                    <ReactFlow
                      nodes={flowNodes}
                      edges={flowEdges}
                      nodeTypes={FLOW_NODE_TYPES}
                      fitView
                      fitViewOptions={{ padding: 0.25, minZoom: 0.85, maxZoom: 1.2 }}
                      minZoom={0.5}
                      maxZoom={1.5}
                      nodesDraggable={false}
                      nodesConnectable={false}
                      elementsSelectable={false}
                      panOnDrag
                      panOnScroll
                      zoomOnScroll
                      zoomOnPinch
                      zoomOnDoubleClick={false}
                      preventScrolling={false}
                      proOptions={{ hideAttribution: true }}
                      onInit={(instance) => {
                        flowApiRef.current = instance
                        flowViewportReadyRef.current = true
                        flowInitialFocusDoneRef.current = false
                      }}
                    >
                      <Background
                        variant={BackgroundVariant.Dots}
                        gap={18}
                        size={1.2}
                        color="color-mix(in srgb, var(--color-border) 95%, transparent)"
                      />
                      <Controls
                        showInteractive={false}
                        style={{
                          background: 'var(--color-card)',
                          borderColor: 'var(--color-border)',
                          boxShadow: 'var(--shadow-card)',
                        }}
                      />
                    </ReactFlow>
                  </div>

                  <div
                    className="rounded-[16px] border px-4 py-3"
                    style={{
                      borderColor: 'color-mix(in srgb, var(--color-primary) 26%, transparent)',
                      background: 'color-mix(in srgb, var(--color-primary) 8%, transparent)',
                    }}
                  >
                    <p className="text-xs font-medium text-[color:var(--color-foreground)]">AI 说了什么</p>
                    <pre
                      className="mt-2 whitespace-pre-wrap break-words rounded-[14px] border p-3 text-[11px] leading-5 text-[color:var(--color-foreground)]/90"
                      style={{ borderColor: 'var(--color-border)', background: 'var(--color-card)' }}
                    >
                      {latestAiRaw || '暂无 AI 原始回复'}
                    </pre>
                  </div>
                </div>
              ) : (
                <div className="max-h-[560px] overflow-auto rounded-[16px] p-4 quiet-control">
                  <pre className="whitespace-pre-wrap break-words text-[11px] leading-5 text-[color:var(--color-foreground)]/85">
                    {aiRawText || '暂无原始日志'}
                  </pre>
                </div>
              )}
            </div>
          </aside>
        </div>
      </div>
    </div>
  )
}
