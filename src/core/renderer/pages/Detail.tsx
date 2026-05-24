import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { arrayMove } from '@dnd-kit/sortable'
import {
  MarkerType,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import {
  ArrowUpRight,
  BookOpen,
  Bot,
  ChevronLeft,
  Code2,
  Play,
  RefreshCw,
  Settings2,
  Square,
} from 'lucide-react'
import { UrlPopover } from '../components/UrlPopover'
import { RunCommandConfigPopover } from '../components/RunCommandConfigPopover'
import { detectProjectEnvironment, projectEnvironmentLabel } from '../lib/projectEnvironment'
import { middleTruncatePath, projectDisplayName } from '../lib/projectDisplay'
import { useAppStore } from '../stores/appStore'
import type { AiCommitRunOverride, AiCommitTaskSnapshot } from '../../shared/types'
import { CodeWorkspacePanel } from './code/CodeWorkspacePanel'
import { DetailAiCommitPanel } from './detail/DetailAiCommitPanel'
import { DetailDocumentationCard } from './detail/DetailDocumentationCard'
import {
  BASE_AI_STEPS,
  FLOW_NODE_GAP_X,
  FLOW_NODE_HEIGHT,
  FLOW_NODE_START_X,
  FLOW_NODE_START_Y,
  FLOW_NODE_WIDTH,
  applyStep,
  clampMaxBullets,
  clampSplitMaxBatches,
  completePreviousSteps,
  createDocLinkId,
  formatCommitDate,
  getFocusedStepKey,
  normalizeDocUrl,
  parseAiFlowLine,
  restoreAiState,
} from './detail/detail.aiFlow'
import type {
  AiCommitStatus,
  AiFlowEdge,
  AiFlowNode,
  AiStepKey,
  AiStepState,
  LatestCommitInfo,
  RightPaneMode,
  FlowViewportApi,
} from './detail/detail.types'

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
  const themeMode = useAppStore((s) => s.config.theme)
  const startProject = useAppStore((s) => s.startProject)
  const stopProject = useAppStore((s) => s.stopProject)
  const setProjectDocLinks = useAppStore((s) => s.setProjectDocLinks)

  const [activeTab, setActiveTab] = useState<'code' | 'ai'>('code')
  const [aiCommitStatus, setAiCommitStatus] = useState<AiCommitStatus>('idle')
  const [rightPaneMode, setRightPaneMode] = useState<RightPaneMode>('flow')
  const [flowSteps, setFlowSteps] = useState<AiStepState[]>(BASE_AI_STEPS)
  const [aiRawText, setAiRawText] = useState('')
  const [recentCommits, setRecentCommits] = useState<LatestCommitInfo[]>([])
  const [activeCommitHash, setActiveCommitHash] = useState<string | null>(null)
  const [linkSettingsOpen, setLinkSettingsOpen] = useState(false)
  const [quickConfigOpen, setQuickConfigOpen] = useState(false)
  const [quickSplit, setQuickSplit] = useState(Boolean(aiCommitConfig?.split ?? false))
  const [quickSplitMaxBatches, setQuickSplitMaxBatches] = useState(
    String(clampSplitMaxBatches(aiCommitConfig?.splitMaxBatches))
  )
  const [quickMaxBullets, setQuickMaxBullets] = useState(
    String(clampMaxBullets(aiCommitConfig?.maxBullets))
  )
  const [docTitleInput, setDocTitleInput] = useState('')
  const [docUrlInput, setDocUrlInput] = useState('')
  const [docError, setDocError] = useState<string | null>(null)
  const [runConfigPos, setRunConfigPos] = useState<{ x: number; y: number } | null>(null)
  const [quickConfigPos, setQuickConfigPos] = useState({ x: 0, y: 0 })
  const quickConfigRef = useRef<HTMLDivElement | null>(null)
  const quickButtonRef = useRef<HTMLButtonElement | null>(null)
  const flowViewportReadyRef = useRef(false)
  const flowInitialFocusDoneRef = useRef(false)
  const flowLastFocusedStepRef = useRef<AiStepKey | null>(null)
  const flowApiRef = useRef<FlowViewportApi | null>(null)

  const environment = project ? detectProjectEnvironment(project.path) : 'unknown'
  const environmentLabel = project ? projectEnvironmentLabel(environment) : 'Unknown'
  const isRunning = processStatus === 'running'
  const isStopping = processStatus === 'stopping'
  const isActive = isRunning || isStopping
  const isAiEnabled = aiCommitConfig?.enabled ?? true
  const defaultSplit = Boolean(aiCommitConfig?.split ?? false)
  const defaultSplitMaxBatches = clampSplitMaxBatches(aiCommitConfig?.splitMaxBatches)
  const defaultMaxBullets = clampMaxBullets(aiCommitConfig?.maxBullets)
  const quickSplitMaxBatchesNumber = clampSplitMaxBatches(Number.parseInt(quickSplitMaxBatches.trim(), 10))
  const quickMaxBulletsNumber = clampMaxBullets(Number.parseInt(quickMaxBullets.trim(), 10))
  const docLinks = project?.docLinks ?? []
  const defaultDocLink = docLinks[0]
  const docMenuItems = docLinks.map((link) => ({ url: link.url, label: link.title }))

  if (!project || !projectId) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4">
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
      getAiCommitState?: (projectId: string) => Promise<AiCommitTaskSnapshot | null>
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

    void (async () => {
      if (typeof api.getAiCommitState !== 'function') return
      try {
        const state = await api.getAiCommitState(projectId)
        if (!state) return
        const restored = restoreAiState({ status: state.status, output: state.output })
        setAiCommitStatus(restored.status)
        setAiRawText(restored.rawText)
        setFlowSteps(restored.steps)
        if (restored.rawText) {
          useAppStore.getState().appendOutput(
            toolProcessId,
            `\r\n[AI Commit] restored persisted task (${restored.status})\r\n`
          )
        }
      } catch {
        // ignore restore failures
      }
    })()

    return () => {
      cleanupOutput()
      cleanupStatus()
    }
  }, [projectId, toolProcessId])

  useEffect(() => {
    setQuickSplit(defaultSplit)
    setQuickSplitMaxBatches(String(defaultSplitMaxBatches))
    setQuickMaxBullets(String(defaultMaxBullets))
  }, [defaultSplit, defaultSplitMaxBatches, defaultMaxBullets, projectId])

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

    const onPointerDown = () => {
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

  const handleAiCommit = async (override?: AiCommitRunOverride) => {
    if (!projectId || !project) return
    if (aiCommitStatus === 'running') return

    const api = window.electronAPI as unknown as {
      runAiCommit?: (
        projectId: string,
        projectPath: string,
        override?: AiCommitRunOverride
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
        `[AI Commit] quick override: split=${override.split ? 'on' : 'off'}, maxBatches=${override.splitMaxBatches ?? defaultSplitMaxBatches}, maxBullets=${override.maxBullets ?? defaultMaxBullets}\r\n`
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
      maxBullets: quickMaxBulletsNumber,
    }
    setQuickConfigOpen(false)
    await handleAiCommit(override)
  }

  const saveQuickConfigAsDefault = async () => {
    const nextConfig = {
      ...(aiCommitConfig || {}),
      split: quickSplit,
      splitMaxBatches: quickSplitMaxBatchesNumber,
      maxBullets: quickMaxBulletsNumber,
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

  const handleReorderDocLinks = async (activeLinkId: string, overLinkId: string) => {
    if (!project) return
    const oldIndex = docLinks.findIndex((link) => link.id === activeLinkId)
    const newIndex = docLinks.findIndex((link) => link.id === overLinkId)
    if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return
    const nextLinks = arrayMove(docLinks, oldIndex, newIndex)
    await setProjectDocLinks(project.id, nextLinks)
  }

  const handleUpdateDocLink = async (linkId: string, nextTitleInput: string, nextUrlInput: string): Promise<boolean> => {
    if (!project) return false

    const normalizedUrl = normalizeDocUrl(nextUrlInput)
    if (!normalizedUrl) {
      setDocError('请输入有效的 http/https URL')
      return false
    }

    const duplicate = docLinks.some(
      (link) => link.id !== linkId && link.url.toLowerCase() === normalizedUrl.toLowerCase()
    )
    if (duplicate) {
      setDocError('该文档链接已存在')
      return false
    }

    let title = nextTitleInput.trim()
    if (!title) {
      try {
        title = new URL(normalizedUrl).hostname
      } catch {
        title = 'Documentation'
      }
    }

    const nextLinks = docLinks.map((link) => (
      link.id === linkId
        ? { ...link, title, url: normalizedUrl }
        : link
    ))

    await setProjectDocLinks(project.id, nextLinks)
    setDocError(null)
    return true
  }

  useEffect(() => {
    if (!linkSettingsOpen) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setLinkSettingsOpen(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [linkSettingsOpen])

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
    <div className="flex h-full flex-col">
      <header className="app-chrome flex min-h-[84px] shrink-0 items-center justify-between px-8 py-4">
        <div className="flex min-w-0 items-center gap-4">
          <button
            className="rounded-full p-2 text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)]"
            onClick={() => navigate('/')}
          >
            <ChevronLeft className="h-5 w-5" strokeWidth={1.8} />
          </button>

          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold tracking-[-0.03em] text-[color:var(--color-foreground)]">{projectDisplayName(project)}</h1>
            <p className="mt-0.5 truncate text-xs text-[color:var(--color-muted-foreground)]" title={project.path}>
              {middleTruncatePath(project.path)}
            </p>
            <p className="mt-0.5 text-[11px] text-[color:var(--color-muted-foreground)]/85">Environment: {environmentLabel}</p>
          </div>

          {isActive ? (
            <div
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium ${isRunning
                ? 'bg-[color:var(--color-success-background)] text-[color:var(--color-success)]'
                : isStopping
                  ? 'bg-[color:var(--color-warning-background)] text-[color:var(--color-warning)]'
                  : 'bg-[color:var(--color-warning-background)] text-[color:var(--color-warning)]'
                }`}
            >
              {isStopping ? (
                <RefreshCw className="h-3 w-3 animate-spin" />
              ) : (
                <span className={`h-1.5 w-1.5 rounded-full ${isRunning ? 'bg-[color:var(--color-success)]' : 'bg-[color:var(--color-warning)]'}`} />
              )}
              {isRunning ? 'Running' : isStopping ? 'Stopping...' : 'Session Available'}
            </div>
          ) : (
            <span className="shrink-0 text-[11px] font-medium text-[color:var(--color-muted-foreground)]">Stopped</span>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-3">
          <div className="quiet-control flex items-center gap-1 rounded-full border border-[color:var(--color-border)] p-1">
            <button
              type="button"
              className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                activeTab === 'code'
                  ? 'bg-primary text-white'
                  : 'text-[color:var(--color-muted-foreground)] hover:text-[color:var(--color-foreground)]'
              }`}
              onClick={() => setActiveTab('code')}
            >
              <Code2 className="h-3.5 w-3.5" />
              Code
            </button>
            <button
              type="button"
              className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                activeTab === 'ai'
                  ? 'bg-primary text-white'
                  : 'text-[color:var(--color-muted-foreground)] hover:text-[color:var(--color-foreground)]'
              }`}
              onClick={() => setActiveTab('ai')}
            >
              <Bot className="h-3.5 w-3.5" />
              AI Commit
            </button>
          </div>

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

          {defaultDocLink && (
            <UrlPopover items={docMenuItems}>
              <button
                type="button"
                className="quiet-control inline-flex items-center gap-1.5 rounded-full border-0 px-3 py-1.5 text-xs text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)]"
                onClick={() => window.electronAPI.openExternal(defaultDocLink.url)}
                title={defaultDocLink.url}
              >
                <BookOpen className="h-3 w-3" />
                <span className="max-w-[180px] truncate">Docs: {defaultDocLink.title}</span>
              </button>
            </UrlPopover>
          )}

          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-full border border-[color:var(--color-border)] px-3 py-1.5 text-xs text-[color:var(--color-foreground)] transition-colors hover:bg-[color:var(--color-accent)]"
            onClick={() => setLinkSettingsOpen(true)}
          >
            <Settings2 className="h-3.5 w-3.5" />
            Link Settings
          </button>

          <button
            className={`inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium transition-all ${isActive
              ? isStopping
                ? 'border text-[color:var(--color-warning)] bg-[color:var(--color-warning-background)]'
                : 'border text-[color:var(--color-destructive)] hover:bg-[color:var(--color-destructive-background)]'
              : 'bg-primary text-white shadow-sm hover:bg-primary-hover'
              }`}
            style={
              isActive
                ? isStopping
                  ? { borderColor: 'color-mix(in srgb, var(--color-warning) 34%, transparent)' }
                  : { borderColor: 'color-mix(in srgb, var(--color-destructive) 32%, transparent)' }
                : undefined
            }
            onClick={() => (isActive ? (isStopping ? undefined : stopProject(projectId)) : startProject(projectId))}
            onContextMenu={(e) => {
              e.preventDefault()
              setRunConfigPos({ x: e.clientX, y: e.clientY })
            }}
            disabled={isStopping}
            title="左键执行当前动作，右键配置 Run 命令"
          >
            {isActive ? (
              <>
                {isStopping ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Square className="h-3.5 w-3.5" />}
                {isStopping ? 'Stopping...' : 'Stop'}
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
                const panelHeight = 320
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

          <div className="mb-3">
            <p className="mb-1 text-[11px] text-[color:var(--color-muted-foreground)]">Max bullets per commit</p>
            <div className="mb-2 flex items-center gap-1.5">
              {[8, 12, 16].map((value) => {
                const active = quickMaxBulletsNumber === value
                return (
                  <button
                    key={value}
                    type="button"
                    className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
                      active
                        ? 'bg-primary text-white'
                        : 'border border-[color:var(--color-border)] text-[color:var(--color-foreground)] hover:bg-[color:var(--color-accent)]'
                    }`}
                    onClick={() => setQuickMaxBullets(String(value))}
                  >
                    {value}
                  </button>
                )
              })}
            </div>
            <input
              type="number"
              min={1}
              max={20}
              step={1}
              value={quickMaxBullets}
              onChange={(e) => setQuickMaxBullets(e.target.value)}
              className="quiet-control h-8 w-full rounded-full border-0 px-3 text-xs text-[color:var(--color-foreground)]"
              placeholder="8"
            />
          </div>

          <div className="mb-2 text-[10px] text-[color:var(--color-muted-foreground)]">
            Default: Split {defaultSplit ? 'On' : 'Off'} · {defaultSplitMaxBatches} · Bullets {defaultMaxBullets}
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

      {runConfigPos && (
        <RunCommandConfigPopover
          project={project}
          x={runConfigPos.x}
          y={runConfigPos.y}
          onClose={() => setRunConfigPos(null)}
        />
      )}

      <div className="min-h-0 flex-1 overflow-x-auto px-6 pb-6 pt-5 sm:px-8">
        <div className="mx-auto h-full min-h-0 min-w-[1060px] w-full max-w-[1360px]">
          {activeTab === 'code' ? (
            <CodeWorkspacePanel projectId={project.id} projectPath={project.path} themeMode={themeMode} />
          ) : (
            <DetailAiCommitPanel
              rightPaneMode={rightPaneMode}
              setRightPaneMode={setRightPaneMode}
              flowNodes={flowNodes}
              flowEdges={flowEdges}
              aiRawText={aiRawText}
              statusClass={statusClass}
              statusText={statusText}
              recentCommits={recentCommits}
              activeCommitHash={activeCommitHash}
              setActiveCommitHash={setActiveCommitHash}
              flowApiRef={flowApiRef}
              flowViewportReadyRef={flowViewportReadyRef}
              flowInitialFocusDoneRef={flowInitialFocusDoneRef}
              flowLastFocusedStepRef={flowLastFocusedStepRef}
              aiCommitStatus={aiCommitStatus}
            />
          )}
        </div>
      </div>

      <DetailDocumentationCard
        docLinks={docLinks}
        docTitleInput={docTitleInput}
        setDocTitleInput={setDocTitleInput}
        docUrlInput={docUrlInput}
        setDocUrlInput={setDocUrlInput}
        docError={docError}
        onAddDocLink={handleAddDocLink}
        onUpdateDocLink={handleUpdateDocLink}
        onSetDefaultDocLink={handleSetDefaultDocLink}
        onReorderDocLinks={handleReorderDocLinks}
        onRemoveDocLink={handleRemoveDocLink}
        settingsOpen={linkSettingsOpen}
        setSettingsOpen={setLinkSettingsOpen}
        hideCard
      />
    </div>
  )
}


