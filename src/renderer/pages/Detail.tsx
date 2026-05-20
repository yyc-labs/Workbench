import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Handle,
  MarkerType,
  Position,
  type Edge as FlowEdge,
  type Node as FlowNode,
  type NodeProps,
  type NodeTypes,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import {
  ArrowUpRight,
  BookOpen,
  Bot,
  ChevronLeft,
  Code2,
  ExternalLink,
  Folder,
  FolderOpen,
  Package,
  Play,
  Plus,
  Square,
  Trash2,
} from 'lucide-react'
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

interface LatestCommitInfo {
  hash: string
  shortHash: string
  subject: string
  committedAt: string
  bullets: string[]
}

type AiFlowNodeData = {
  key: AiStepKey
  label: string
  status: AiStepStatus
  detail?: string
  index: number
  isFocused: boolean
}

type AiFlowNode = FlowNode<AiFlowNodeData, 'ai-step'>
type AiFlowEdge = FlowEdge<{ status: AiStepStatus }, 'smoothstep'>
const FLOW_NODE_WIDTH = 236
const FLOW_NODE_HEIGHT = 96
const FLOW_CANVAS_HEIGHT = 220
const FLOW_NODE_START_X = 36
const FLOW_NODE_START_Y = Math.round((FLOW_CANVAS_HEIGHT - FLOW_NODE_HEIGHT) / 2)
const FLOW_NODE_GAP_X = 278

const BASE_AI_STEPS: AiStepState[] = [
  { key: 'start', label: '启动提交任务', status: 'pending' },
  { key: 'stage', label: '暂存改动', status: 'pending' },
  { key: 'ai', label: '调用 AI 生成提交信息', status: 'pending' },
  { key: 'message', label: '确认提交信息', status: 'pending' },
  { key: 'commit', label: '执行 git commit', status: 'pending' },
  { key: 'done', label: '完成', status: 'pending' },
]

function createDocLinkId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `doc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function normalizeDocUrl(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null

  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  try {
    const parsed = new URL(withProtocol)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null
    }
    return parsed.toString()
  } catch {
    return null
  }
}

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
  accent: string
  statusBackground: string
  statusText: string
} {
  if (status === 'success') {
    return {
      border: 'color-mix(in srgb, var(--color-success) 28%, transparent)',
      background: 'linear-gradient(160deg, color-mix(in srgb, var(--color-success-background) 95%, transparent) 0%, color-mix(in srgb, var(--color-card) 98%, transparent) 100%)',
      accent: 'var(--color-success)',
      statusBackground: 'color-mix(in srgb, var(--color-success-background) 90%, transparent)',
      statusText: 'var(--color-success)',
    }
  }
  if (status === 'running') {
    return {
      border: 'color-mix(in srgb, var(--color-primary) 30%, transparent)',
      background: 'linear-gradient(160deg, color-mix(in srgb, var(--color-primary) 10%, transparent) 0%, color-mix(in srgb, var(--color-card) 98%, transparent) 100%)',
      accent: 'var(--color-primary)',
      statusBackground: 'color-mix(in srgb, var(--color-primary) 13%, transparent)',
      statusText: 'var(--color-primary)',
    }
  }
  if (status === 'error') {
    return {
      border: 'color-mix(in srgb, var(--color-destructive) 34%, transparent)',
      background: 'linear-gradient(160deg, color-mix(in srgb, var(--color-destructive-background) 95%, transparent) 0%, color-mix(in srgb, var(--color-card) 98%, transparent) 100%)',
      accent: 'var(--color-destructive)',
      statusBackground: 'color-mix(in srgb, var(--color-destructive-background) 90%, transparent)',
      statusText: 'var(--color-destructive)',
    }
  }
  return {
    border: 'color-mix(in srgb, var(--color-border) 85%, transparent)',
    background: 'linear-gradient(160deg, color-mix(in srgb, var(--color-background-sunken) 62%, transparent) 0%, color-mix(in srgb, var(--color-card) 98%, transparent) 100%)',
    accent: 'color-mix(in srgb, var(--color-muted-foreground) 42%, transparent)',
    statusBackground: 'color-mix(in srgb, var(--color-background-sunken) 88%, transparent)',
    statusText: 'var(--color-muted-foreground)',
  }
}

function AiFlowStepNode({ data }: NodeProps<AiFlowNode>) {
  const tone = flowNodeTone(data.status)
  return (
    <div
      className="nodrag nowheel relative flex h-full w-full flex-col overflow-hidden rounded-[18px] border px-4 py-3 transition-all duration-300"
      style={{
        borderColor: tone.border,
        background: tone.background,
        boxShadow: data.isFocused
          ? '0 12px 28px rgba(0, 0, 0, 0.12), inset 0 1px 0 rgba(255, 255, 255, 0.5)'
          : '0 6px 18px rgba(0, 0, 0, 0.08), inset 0 1px 0 rgba(255, 255, 255, 0.38)',
      }}
    >
      <span
        className="pointer-events-none absolute inset-x-0 top-0 h-[2.5px]"
        style={{ background: tone.accent, opacity: data.status === 'pending' ? 0.42 : 0.95 }}
      />
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
      <div className="mb-2 flex items-center justify-between gap-2">
        <span
          className="inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--color-muted-foreground)]"
          style={{ borderColor: 'color-mix(in srgb, var(--color-border) 86%, transparent)' }}
        >
          Step {data.index + 1}
        </span>
        <span
          className="rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.08em]"
          style={{
            color: tone.statusText,
            borderColor: tone.border,
            background: tone.statusBackground,
          }}
        >
          {stepStatusText(data.status)}
        </span>
      </div>
      <p className="truncate text-[13px] font-semibold tracking-[-0.01em] text-[color:var(--color-foreground)]" title={data.label}>
        {data.label}
      </p>
      {data.isFocused && data.detail && (
        <p className="mt-1 truncate text-[10.5px] text-[color:var(--color-muted-foreground)]" title={data.detail}>
          {data.detail}
        </p>
      )}
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

function formatCommitDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
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
  const setProjectDocLinks = useAppStore((s) => s.setProjectDocLinks)

  const [aiCommitStatus, setAiCommitStatus] = useState<AiCommitStatus>('idle')
  const [rightPaneMode, setRightPaneMode] = useState<RightPaneMode>('flow')
  const [flowSteps, setFlowSteps] = useState<AiStepState[]>(BASE_AI_STEPS)
  const [aiRawText, setAiRawText] = useState('')
  const [recentCommits, setRecentCommits] = useState<LatestCommitInfo[]>([])
  const [activeCommitHash, setActiveCommitHash] = useState<string | null>(null)
  const [quickConfigOpen, setQuickConfigOpen] = useState(false)
  const [quickSplit, setQuickSplit] = useState(Boolean(aiCommitConfig?.split ?? false))
  const [quickSplitMaxBatches, setQuickSplitMaxBatches] = useState(
    String(clampSplitMaxBatches(aiCommitConfig?.splitMaxBatches))
  )
  const [docTitleInput, setDocTitleInput] = useState('')
  const [docUrlInput, setDocUrlInput] = useState('')
  const [docError, setDocError] = useState<string | null>(null)
  const [quickConfigPos, setQuickConfigPos] = useState({ x: 0, y: 0 })
  const quickConfigRef = useRef<HTMLDivElement | null>(null)
  const quickButtonRef = useRef<HTMLButtonElement | null>(null)
  const recentCommitPanelRef = useRef<HTMLDivElement | null>(null)
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
  const docLinks = project?.docLinks ?? []
  const defaultDocLink = docLinks[0]

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
        setFlowSteps((prev) => split.reduce((acc, line) => parseAiFlowLine(line, acc), prev))
      }
    })

    const cleanupStatus = api.onAiCommitStatus(({ projectId: pid, status }) => {
      if (pid !== projectId) return
      setAiCommitStatus(status)
      if (status === 'running') {
        setFlowSteps(BASE_AI_STEPS)
        setAiRawText('')
      } else {
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
    if (!activeCommitHash) return

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as globalThis.Node
      if (recentCommitPanelRef.current?.contains(target)) return
      setActiveCommitHash(null)
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setActiveCommitHash(null)
      }
    }

    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [activeCommitHash])

  useEffect(() => {
    if (rightPaneMode !== 'flow') return
    flowInitialFocusDoneRef.current = false
  }, [rightPaneMode])

  useEffect(() => {
    if (!project?.path) {
      setRecentCommits([])
      setActiveCommitHash(null)
      return
    }

    let mounted = true
    const api = window.electronAPI as unknown as {
      getLatestCommit?: (projectPath: string) => Promise<LatestCommitInfo[]>
    }

    const loadLatestCommit = async () => {
      if (typeof api.getLatestCommit !== 'function') return
      const result = await api.getLatestCommit(project.path)
      if (!mounted) return
      setRecentCommits(result || [])
      setActiveCommitHash((prev) => ((result || []).some((item) => item.hash === prev) ? prev : null))
    }

    void loadLatestCommit()
    return () => {
      mounted = false
    }
  }, [project?.path, aiCommitStatus])

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

  const handleAddDocLink = async () => {
    if (!project) return

    const normalizedUrl = normalizeDocUrl(docUrlInput)
    if (!normalizedUrl) {
      setDocError('请输入有效的 http/https URL')
      return
    }

    const duplicate = docLinks.some((link) => link.url.toLowerCase() === normalizedUrl.toLowerCase())
    if (duplicate) {
      setDocError('该文档链接已存在')
      return
    }

    let title = docTitleInput.trim()
    if (!title) {
      try {
        title = new URL(normalizedUrl).hostname
      } catch {
        title = 'Documentation'
      }
    }

    const nextLinks = [...docLinks, { id: createDocLinkId(), title, url: normalizedUrl }]
    await setProjectDocLinks(project.id, nextLinks)
    setDocTitleInput('')
    setDocUrlInput('')
    setDocError(null)
  }

  const handleRemoveDocLink = async (linkId: string) => {
    if (!project) return
    const nextLinks = docLinks.filter((link) => link.id !== linkId)
    await setProjectDocLinks(project.id, nextLinks)
  }

  const handleSetDefaultDocLink = async (linkId: string) => {
    if (!project) return
    const index = docLinks.findIndex((link) => link.id === linkId)
    if (index <= 0) return
    const nextLinks = [docLinks[index], ...docLinks.slice(0, index), ...docLinks.slice(index + 1)]
    await setProjectDocLinks(project.id, nextLinks)
  }

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

  const flowFocusedStepKey = getFocusedStepKey(flowSteps, aiCommitStatus)
  const flowNodes = useMemo<AiFlowNode[]>(
    () =>
      flowSteps.map((step, index) => ({
        id: step.key,
        type: 'ai-step',
        position: { x: FLOW_NODE_START_X + index * FLOW_NODE_GAP_X, y: FLOW_NODE_START_Y },
        style: {
          width: FLOW_NODE_WIDTH,
          height: FLOW_NODE_HEIGHT,
        },
        data: {
          key: step.key,
          label: step.label,
          status: step.status,
          detail: step.detail,
          index,
          isFocused: step.key === flowFocusedStepKey,
        },
        draggable: false,
        selectable: false,
      })),
    [flowSteps, flowFocusedStepKey]
  )
  const flowEdges = useMemo<AiFlowEdge[]>(
    () =>
      flowSteps.slice(0, -1).map((step, index) => {
        const next = flowSteps[index + 1]
        const errored = step.status === 'error' || next.status === 'error'
        const running = step.status === 'running' || next.status === 'running'
        const reached = step.status !== 'pending' || next.status !== 'pending'
        const completed = step.status === 'success' && next.status !== 'pending'
        const edgeColor = errored
          ? 'var(--color-destructive)'
          : running
            ? 'var(--color-warning)'
            : completed
              ? 'var(--color-success)'
              : 'color-mix(in srgb, var(--color-border) 88%, transparent)'

        return {
          id: `e-${step.key}-${next.key}`,
          source: step.key,
          target: next.key,
          type: 'smoothstep',
          animated: running && !errored,
          markerEnd: {
            type: MarkerType.ArrowClosed,
            width: 18,
            height: 18,
            color: edgeColor,
          },
          style: {
            stroke: edgeColor,
            strokeWidth: running ? 2.8 : completed ? 2.4 : 1.6,
            strokeDasharray: reached ? undefined : '4 7',
            opacity: reached ? 1 : 0.72,
            transition: 'stroke 220ms ease, stroke-width 220ms ease, opacity 220ms ease',
          },
          pathOptions: { offset: 18 },
          selectable: false,
          focusable: false,
          data: {
            status: errored ? 'error' : running ? 'running' : reached ? 'success' : 'pending',
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

      <div className="min-h-0 flex-1 overflow-x-auto px-6 pb-8 pt-7 sm:px-8">
        {/* <div className="mx-auto grid h-full min-h-0 min-w-[1060px] w-full max-w-[1360px] grid-cols-[minmax(420px,0.82fr)_minmax(560px,1.18fr)] gap-6"> */}
        <div className="mx-auto grid h-full min-h-0 min-w-[1060px] w-full max-w-[1360px] grid-cols-[minmax(490px,1fr)_minmax(490px,1fr)] gap-6">
          <aside className="min-h-0 min-w-0 rounded-[24px] surface-card">
            <div className="h-full min-h-0 overflow-auto p-5">

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
                <div className="space-y-3">
                  <div
                    className="relative overflow-hidden rounded-[20px] border"
                    style={{
                      height: `${FLOW_CANVAS_HEIGHT}px`,
                      borderColor: 'color-mix(in srgb, var(--color-border) 78%, transparent)',
                      background:
                        'linear-gradient(180deg, color-mix(in srgb, var(--color-background) 97%, transparent) 0%, color-mix(in srgb, var(--color-background-sunken) 48%, transparent) 100%)',
                    }}
                  >
                    <ReactFlow
                      nodes={flowNodes}
                      edges={flowEdges}
                      nodeTypes={FLOW_NODE_TYPES}
                      fitView
                      fitViewOptions={{ padding: 0.16, minZoom: 0.8, maxZoom: 1.2 }}
                      minZoom={0.95}
                      maxZoom={0.95}
                      nodesDraggable={false}
                      nodesConnectable={false}
                      elementsSelectable={false}
                      panOnDrag={false}
                      panOnScroll={false}
                      zoomOnScroll={false}
                      zoomOnPinch={false}
                      zoomOnDoubleClick={false}
                      nodesFocusable={false}
                      edgesFocusable={false}
                      autoPanOnNodeFocus={false}
                      preventScrolling={false}
                      proOptions={{ hideAttribution: true }}
                      onInit={(instance) => {
                        flowApiRef.current = instance
                        flowViewportReadyRef.current = true
                        flowInitialFocusDoneRef.current = true
                        flowLastFocusedStepRef.current = 'start'
                        const startCenterX = FLOW_NODE_START_X + FLOW_NODE_WIDTH / 2
                        const startCenterY = FLOW_NODE_START_Y + FLOW_NODE_HEIGHT / 2
                        void instance.setCenter(startCenterX, startCenterY, {
                          zoom: 0.95,
                          duration: 0,
                        })
                      }}
                    >
                      <Background
                        variant={BackgroundVariant.Lines}
                        gap={24}
                        size={0.55}
                        color="color-mix(in srgb, var(--color-border) 80%, transparent)"
                      />
                    </ReactFlow>
                    <div className="pointer-events-none absolute inset-x-4 top-4 flex items-center justify-between">
                      <p className="text-[11px] font-medium tracking-[0.02em] text-[color:var(--color-muted-foreground)]">
                        AI Commit Flow
                      </p>
                      <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] ${statusClass}`}>
                        {statusText}
                      </span>
                    </div>
                  </div>

                  <div
                    ref={recentCommitPanelRef}
                    className="rounded-[16px] border px-4 py-3 surface-card"
                    style={{
                      borderColor: 'color-mix(in srgb, var(--color-border) 82%, transparent)',
                      background: 'color-mix(in srgb, var(--color-card) 94%, transparent)',
                    }}
                  >
                    <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--color-muted-foreground)]">
                      最近提交
                    </p>
                    {recentCommits.length > 0 ? (
                      <div className="relative isolate mt-2 space-y-2">
                        {recentCommits.map((commit) => (
                          <div
                            key={commit.hash}
                            className="group relative z-0 cursor-pointer rounded-[12px] border border-[color:var(--color-border)] bg-[color:var(--color-card)] px-3 py-2 transition-all duration-200 hover:z-40 hover:border-[color:var(--color-primary)]/35 hover:bg-[color:var(--color-background)]"
                            style={{ boxShadow: 'var(--shadow-card)' }}
                            role="button"
                            tabIndex={0}
                            onClick={() => {
                              setActiveCommitHash((prev) => (prev === commit.hash ? null : commit.hash))
                            }}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault()
                                setActiveCommitHash((prev) => (prev === commit.hash ? null : commit.hash))
                                return
                              }
                              if (event.key === 'Escape') {
                                setActiveCommitHash(null)
                              }
                            }}
                          >
                            <p
                              className="truncate text-sm font-semibold tracking-[-0.01em] text-[color:var(--color-foreground)]"
                            >
                              {commit.subject}
                            </p>
                            <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-[color:var(--color-muted-foreground)]">
                              <span className="rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-background-sunken)] px-2 py-0.5 font-mono">
                                {commit.shortHash}
                              </span>
                              <span>{formatCommitDate(commit.committedAt)}</span>
                            </div>

                            <div
                              className={`absolute -top-2 left-3 right-3 z-50 -translate-y-full transition-all duration-150 ${activeCommitHash === commit.hash
                                ? 'pointer-events-auto scale-100 opacity-100'
                                : 'pointer-events-none scale-[0.985] opacity-0'
                                }`}
                            >
                              <div
                                className="rounded-[14px] border px-3 py-2.5 backdrop-blur-xl"
                                style={{
                                  borderColor: 'color-mix(in srgb, var(--color-border) 76%, transparent)',
                                  background: 'color-mix(in srgb, var(--color-card) 82%, transparent)',
                                  boxShadow: 'var(--shadow-popover)',
                                }}
                              >
                                <p className="text-[12.5px] font-semibold tracking-[-0.01em] text-[color:var(--color-foreground)]">
                                  {commit.subject}
                                </p>
                                <p className="mt-1 text-[10.5px] text-[color:var(--color-muted-foreground)]">
                                  {commit.shortHash} · {formatCommitDate(commit.committedAt)}
                                </p>
                                {commit.bullets.length > 0 && (
                                  <div className="mt-2 space-y-1">
                                    {commit.bullets.map((line, idx) => (
                                      <div key={`${commit.hash}-b-${idx}`} className="flex items-start gap-1.5 text-[11.5px] leading-5 text-[color:var(--color-foreground)]/90">
                                        <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-[color:var(--color-muted-foreground)]/70" />
                                        <span className="min-w-0 break-words">{line.replace(/^-+\s*/, '')}</span>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-2 text-xs text-[color:var(--color-muted-foreground)]">暂无提交记录</p>
                    )}
                  </div>
                </div>
              ) : (
                <div className="max-h-[500px] overflow-auto rounded-[16px] p-4 quiet-control">
                  <pre className="whitespace-pre-wrap break-words text-[11px] leading-5 text-[color:var(--color-foreground)]/85">
                    {aiRawText || '暂无原始日志'}
                  </pre>
                </div>
              )}
            </div>
            </div>
          </aside>
          <section className="min-h-0 min-w-0 overflow-y-auto px-3 pt-1">
            <div className="space-y-6">
            <div className="relative overflow-hidden rounded-[24px] p-6 surface-card">
              {/* <div
                className="pointer-events-none absolute -right-14 -top-14 h-40 w-40 rounded-full blur-[48px]"
                style={{ background: 'color-mix(in srgb, var(--color-primary) 30%, transparent)' }}
              />
              <div
                className="pointer-events-none absolute -bottom-16 -left-10 h-40 w-40 rounded-full blur-[52px]"
                style={{ background: 'color-mix(in srgb, var(--color-success) 18%, transparent)' }}
              /> */}
              <div className="relative">
                <p className="section-label">Workspace Snapshot</p>
                <h2 className="mt-1 text-[26px] font-semibold tracking-[-0.035em] text-[color:var(--color-foreground)]">
                  {project.name}
                </h2>
                <p className="mt-1 truncate text-xs text-[color:var(--color-muted-foreground)]" title={project.path}>
                  {project.path}
                </p>

                <div className="mt-5 space-y-3">
                  {/* <InfoCard label="Path" value={project.path} icon={Folder} /> */}
                  {/* <div className="grid grid-cols-2 gap-3">
                    <InfoCard label="Type" value={project.type} icon={Code2} />
                    <InfoCard label="Package Manager" value={project.packageManager || 'npm'} icon={Package} />
                  </div> */}
                  <div className="grid grid-cols-2 gap-3">
                    <InfoCard label="Environment" value={environmentLabel} icon={FolderOpen} />
                    <InfoCard label="Dev Status" value={isRunning ? 'Running' : 'Stopped'} icon={Play} />
                  </div>
                </div>

                {(processUrls.length > 0 || defaultDocLink) && (
                  <div className="mt-5 flex flex-wrap gap-2">
                    {processUrls.length > 0 && (
                      <UrlPopover urls={processUrls}>
                        <button
                          className="quiet-control inline-flex items-center gap-1.5 rounded-full border-0 px-3 py-1.5 text-xs text-primary transition-colors hover:bg-[color:var(--color-accent)]"
                          onClick={() => window.electronAPI.openExternal(processUrls[0])}
                        >
                          <ArrowUpRight className="h-3 w-3" />
                          <span className="max-w-[220px] truncate">{processUrls[0]}</span>
                        </button>
                      </UrlPopover>
                    )}
                    {defaultDocLink && (
                      <UrlPopover items={docLinks.map((link) => ({ url: link.url, label: link.title }))}>
                        <button
                          className="quiet-control inline-flex items-center gap-1.5 rounded-full border-0 px-3 py-1.5 text-xs text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)]"
                          onClick={() => window.electronAPI.openExternal(defaultDocLink.url)}
                        >
                          <BookOpen className="h-3 w-3" />
                          <span className="max-w-[220px] truncate">Docs: {defaultDocLink.title}</span>
                        </button>
                      </UrlPopover>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-[24px] p-6 surface-card">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <p className="section-label">Documentation</p>
                  <p className="mt-1 text-xs text-[color:var(--color-muted-foreground)]">
                    Project links for docs, specs and references
                  </p>
                </div>
                <span className="rounded-full px-2.5 py-1 text-[11px] text-[color:var(--color-muted-foreground)] quiet-control">
                  {docLinks.length}
                </span>
              </div>

              <div className="grid grid-cols-1 gap-2">
                <input
                  type="text"
                  value={docTitleInput}
                  onChange={(e) => setDocTitleInput(e.target.value)}
                  placeholder="Title (optional)"
                  className="quiet-control h-10 rounded-full border-0 px-4 text-sm text-[color:var(--color-foreground)] placeholder:text-[color:var(--color-muted-foreground)] outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                <input
                  type="text"
                  value={docUrlInput}
                  onChange={(e) => setDocUrlInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void handleAddDocLink()
                  }}
                  placeholder="docs.example.com / https://..."
                  className="quiet-control h-10 rounded-full border-0 px-4 text-sm text-[color:var(--color-foreground)] placeholder:text-[color:var(--color-muted-foreground)] outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                <button
                  className="inline-flex h-10 items-center justify-center gap-1.5 rounded-full bg-primary px-4 text-sm font-medium text-white transition-colors hover:bg-primary-hover"
                  onClick={() => {
                    void handleAddDocLink()
                  }}
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add Link
                </button>
              </div>

              {docError && (
                <p className="mt-2 text-xs text-[color:var(--color-destructive)]">
                  {docError}
                </p>
              )}

              {docLinks.length === 0 ? (
                <div className="mt-5 rounded-[16px] border border-dashed border-[color:var(--color-border)] px-5 py-5 text-xs text-[color:var(--color-muted-foreground)]">
                  No documentation links yet.
                </div>
              ) : (
                <div className="mt-5 space-y-2.5">
                  {docLinks.map((link) => (
                    <div key={link.id} className="quiet-control flex items-center gap-2 rounded-[16px] px-4 py-3">
                      <button
                        className="min-w-0 flex-1 text-left"
                        onClick={() => window.electronAPI.openExternal(link.url)}
                        title={link.url}
                      >
                        <p className="truncate text-sm text-[color:var(--color-foreground)]">{link.title}</p>
                        <p className="truncate text-[11px] text-[color:var(--color-muted-foreground)]">{link.url}</p>
                      </button>
                      <button
                        className="inline-flex h-8 items-center gap-1 rounded-full px-2 text-xs text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-accent)] hover:text-primary"
                        onClick={() => window.electronAPI.openExternal(link.url)}
                      >
                        <ExternalLink className="h-3 w-3" />
                        Open
                      </button>
                      <button
                        className="inline-flex h-8 items-center gap-1 rounded-full px-2 text-xs text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)] disabled:cursor-not-allowed disabled:opacity-60"
                        onClick={() => {
                          void handleSetDefaultDocLink(link.id)
                        }}
                        disabled={docLinks[0]?.id === link.id}
                        title={docLinks[0]?.id === link.id ? 'Default link' : 'Set as default'}
                      >
                        {docLinks[0]?.id === link.id ? 'Default' : 'Set Default'}
                      </button>
                      <button
                        className="inline-flex h-8 w-8 items-center justify-center rounded-full text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-destructive-background)] hover:text-[color:var(--color-destructive)]"
                        onClick={() => {
                          void handleRemoveDocLink(link.id)
                        }}
                        title="Remove"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
