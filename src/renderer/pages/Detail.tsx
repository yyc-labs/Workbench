import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
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

const BASE_AI_STEPS: AiStepState[] = [
  { key: 'start', label: '启动提交任务', status: 'pending' },
  { key: 'stage', label: '暂存改动', status: 'pending' },
  { key: 'ai', label: '调用 AI 生成提交信息', status: 'pending' },
  { key: 'message', label: '确认提交信息', status: 'pending' },
  { key: 'commit', label: '执行 git commit', status: 'pending' },
  { key: 'done', label: '完成', status: 'pending' },
]

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
    <div className="rounded-xl border px-4 py-3 surface-card" style={{ borderColor: 'var(--color-border)' }}>
      <div className="mb-1 flex items-center gap-1.5 text-[color:var(--color-muted-foreground)]">
        <Icon className="h-3.5 w-3.5" strokeWidth={1.8} />
        <span className="text-[10px] font-medium uppercase tracking-wider">{label}</span>
      </div>
      <p className="truncate text-sm font-medium text-[color:var(--color-foreground)]" title={value}>
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

function statusDot(status: AiStepStatus): string {
  if (status === 'success') return 'bg-emerald-500'
  if (status === 'running') return 'bg-amber-500'
  if (status === 'error') return 'bg-red-500'
  return 'bg-white/20'
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
  const reattachProject = useAppStore((s) => s.reattachProject)

  const [customCommand, setCustomCommand] = useState(project?.customCommand ?? '')
  const [aiCommitStatus, setAiCommitStatus] = useState<AiCommitStatus>('idle')
  const [rightPaneMode, setRightPaneMode] = useState<RightPaneMode>('flow')
  const [flowSteps, setFlowSteps] = useState<AiStepState[]>(BASE_AI_STEPS)
  const [aiRawLines, setAiRawLines] = useState<string[]>([])
  const [aiRawText, setAiRawText] = useState('')
  const [runStartedAt, setRunStartedAt] = useState<number | null>(null)
  const [runFinishedAt, setRunFinishedAt] = useState<number | null>(null)

  const environment = project ? detectProjectEnvironment(project.path) : 'unknown'
  const environmentLabel = project ? projectEnvironmentLabel(environment) : 'Unknown'
  const isRunning = processStatus === 'running'
  const isDetached = processStatus === 'detached'
  const isActive = isRunning || isDetached
  const isAiEnabled = aiCommitConfig?.enabled ?? true

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

  const handleAiCommit = async () => {
    if (!projectId || !project) return
    if (aiCommitStatus === 'running') return

    const api = window.electronAPI as unknown as {
      runAiCommit?: (projectId: string, projectPath: string) => Promise<boolean>
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
    const ok = await api.runAiCommit(projectId, project.path)
    if (!ok) {
      setAiCommitStatus('error')
    }
  }

  const durationMs = runStartedAt ? (runFinishedAt ?? Date.now()) - runStartedAt : 0
  const statusText =
    aiCommitStatus === 'running' ? 'Running' : aiCommitStatus === 'success' ? 'Success' : aiCommitStatus === 'error' ? 'Failed' : 'Idle'
  const statusClass =
    aiCommitStatus === 'running'
      ? 'text-amber-500 border-amber-500/40 bg-amber-500/10'
      : aiCommitStatus === 'success'
        ? 'text-emerald-500 border-emerald-500/40 bg-emerald-500/10'
        : aiCommitStatus === 'error'
          ? 'text-red-500 border-red-500/40 bg-red-500/10'
          : 'text-[color:var(--color-muted-foreground)] border-[color:var(--color-border)]'

  const latestAiRaw = [...aiRawLines].reverse().find((line) => line.startsWith('{') || line.startsWith('```') || line.includes('"subject"'))

  return (
    <div className="flex h-screen flex-col">
      <header
        className="flex shrink-0 items-center justify-between border-b px-6 py-5"
        style={{
          background: 'var(--color-card)',
          borderBottomColor: 'var(--color-border)',
          backdropFilter: 'blur(18px)',
          WebkitBackdropFilter: 'blur(18px)',
        }}
      >
        <div className="flex min-w-0 items-center gap-4">
          <button
            className="rounded-lg p-1.5 text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)]"
            onClick={() => navigate('/')}
          >
            <ChevronLeft className="h-5 w-5" strokeWidth={1.8} />
          </button>

          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold tracking-tight text-[color:var(--color-foreground)]">{project.name}</h1>
            <p className="truncate text-xs text-[color:var(--color-muted-foreground)]">{project.path}</p>
            <p className="mt-0.5 text-[11px] text-[color:var(--color-muted-foreground)]/85">Environment: {environmentLabel}</p>
          </div>

          {isActive ? (
            <div
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium ${isRunning ? 'bg-emerald-500/12 text-emerald-500' : 'bg-amber-500/12 text-amber-500'
                }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${isRunning ? 'bg-emerald-500' : 'bg-amber-500'}`} />
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
                className="inline-flex items-center gap-1.5 rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-secondary)]/50 px-3 py-1.5 text-xs text-primary transition-colors hover:bg-[color:var(--color-secondary)]"
                onClick={() => window.electronAPI.openExternal(processUrls[0])}
              >
                <ArrowUpRight className="h-3 w-3" />
                <span className="max-w-[180px] truncate">{processUrls[0]}</span>
              </button>
            </UrlPopover>
          )}

          {isDetached && (
            <button
              className="inline-flex items-center gap-1.5 rounded-xl bg-amber-500 px-4 py-2 text-sm font-medium text-white shadow-sm transition-all hover:bg-amber-600"
              onClick={() => reattachProject(projectId)}
            >
              <Play className="h-3.5 w-3.5" />
              Reattach
            </button>
          )}

          <button
            className={`inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-medium transition-all ${isActive ? 'border text-red-500 hover:bg-red-500/10' : 'bg-primary text-white shadow-sm hover:bg-primary-hover'
              }`}
            style={isActive ? { borderColor: 'rgba(248, 113, 113, 0.35)' } : undefined}
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

          <button
            className={`inline-flex items-center gap-1.5 rounded-xl border px-4 py-2 text-sm font-medium transition-all ${aiCommitStatus === 'running'
              ? 'border-amber-500/40 bg-amber-500/10 text-amber-500'
              : aiCommitStatus === 'error'
                ? 'border-red-500/40 text-red-500 hover:bg-red-500/10'
                : 'border-[color:var(--color-border)] text-[color:var(--color-foreground)] hover:bg-[color:var(--color-accent)]'
              }`}
            onClick={() => void handleAiCommit()}
            disabled={aiCommitStatus === 'running'}
            title={isAiEnabled ? 'Use AI API to generate commit message and commit' : 'AI disabled in Settings, local commit message only'}
          >
            <Bot className="h-3.5 w-3.5" />
            {aiCommitStatus === 'running' ? 'AI Committing...' : 'AI Auto Commit'}
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col px-6 pb-6 pt-6">
        <div className="mb-4 flex items-center gap-2 rounded-xl border px-3 py-2 surface-card" style={{ borderColor: 'var(--color-border)' }}>
          <span className="select-none text-xs text-[color:var(--color-muted-foreground)]">$</span>
          <input
            type="text"
            value={customCommand}
            onChange={(e) => setCustomCommand(e.target.value)}
            placeholder={project.command}
            className="flex-1 border-none bg-transparent text-sm font-mono text-[color:var(--color-foreground)] outline-none placeholder:text-[color:var(--color-muted-foreground)]"
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handleSaveCommand()
            }}
          />
          {customCommand && customCommand !== project.command && (
            <button
              className="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/10 hover:text-primary"
              onClick={() => void handleSaveCommand()}
            >
              Save
            </button>
          )}
        </div>

        <div className="mb-4 space-y-3 shrink-0">
          <InfoCard label="Path" value={project.path} icon={Folder} />
          <div className="grid grid-cols-2 gap-3">
            <InfoCard label="Type" value={project.type} icon={Code2} />
            <InfoCard label="Package Manager" value={project.packageManager || 'npm'} icon={Package} />
          </div>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-2 gap-4">
          <div
            className="min-h-0 min-w-0 overflow-hidden"
            style={{
              background: '#2f333b',
              borderRadius: '20px',
              boxShadow: `
              inset 0 1px 0 rgba(255,255,255,0.04),
              0 0 0 1px rgba(255,255,255,0.03),
              0 20px 48px rgba(0,0,0,0.18)
            `,
            }}
          >
            <div className="flex items-center border-b border-white/5 px-[14px] py-[11px]">
              <span className="h-[10px] w-[10px] rounded-full bg-[#ff5f57]/70" />
              <span className="ml-[6px] h-[10px] w-[10px] rounded-full bg-[#febc2e]/70" />
              <span className="ml-[6px] h-[10px] w-[10px] rounded-full bg-[#28c840]/70" />
              <span className="ml-[10px] select-none font-mono text-[10px] font-medium uppercase tracking-widest text-white/20">
                service terminal
              </span>
            </div>
            <div
              className="xterm-container min-h-0 overflow-hidden"
              style={{
                margin: '12px',
                height: 'calc(100% - 56px)',
                borderRadius: '14px',
                background: '#282c34',
                padding: '16px 18px',
              }}
            >
              <Terminal projectId={projectId} />
            </div>
          </div>

          <div
            className="min-h-0 min-w-0 overflow-hidden"
            style={{
              background: '#2f333b',
              borderRadius: '20px',
              boxShadow: `
              inset 0 1px 0 rgba(255,255,255,0.04),
              0 0 0 1px rgba(255,255,255,0.03),
              0 20px 48px rgba(0,0,0,0.18)
            `,
            }}
          >
            <div className="flex items-center justify-between border-b border-white/5 px-[14px] py-[11px]">
              <div className="flex items-center gap-1.5">
                <span className="h-[10px] w-[10px] rounded-full bg-[#ff5f57]/70" />
                <span className="h-[10px] w-[10px] rounded-full bg-[#febc2e]/70" />
                <span className="h-[10px] w-[10px] rounded-full bg-[#28c840]/70" />
                <span className="ml-[10px] select-none font-mono text-[10px] font-medium uppercase tracking-widest text-white/20">
                  ai commit panel
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  className={`rounded-md px-2 py-1 text-[11px] ${rightPaneMode === 'flow'
                    ? 'bg-white/10 text-white'
                    : 'text-white/60 hover:bg-white/10 hover:text-white'
                    }`}
                  onClick={() => setRightPaneMode('flow')}
                >
                  流程
                </button>
                <button
                  className={`rounded-md px-2 py-1 text-[11px] ${rightPaneMode === 'raw'
                    ? 'bg-white/10 text-white'
                    : 'text-white/60 hover:bg-white/10 hover:text-white'
                    }`}
                  onClick={() => setRightPaneMode('raw')}
                >
                  原始日志
                </button>
              </div>
            </div>

            <div className="min-h-0 p-3" style={{ height: 'calc(100% - 56px)' }}>
              {rightPaneMode === 'flow' ? (
                <div className="flex h-full flex-col gap-3 overflow-auto rounded-xl bg-[#282c34] p-3">
                  <div className="flex items-center justify-between rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/80">
                    <div className="flex items-center gap-2">
                      <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] ${statusClass}`}>
                        {statusText}
                      </span>
                      <span>Tool Terminal: {toolProcessStatus === 'running' ? 'online' : toolProcessStatus}</span>
                    </div>
                    <span>{runStartedAt ? `${Math.floor(durationMs / 1000)}s` : '--'}</span>
                  </div>

                  {flowSteps.map((step) => (
                    <div key={step.key} className="rounded-lg border border-white/10 bg-white/5 px-3 py-2">
                      <div className="flex items-center gap-2 text-sm text-white">
                        <span className={`h-2.5 w-2.5 rounded-full ${statusDot(step.status)}`} />
                        <span>{step.label}</span>
                        <span className="ml-auto text-[11px] uppercase text-white/50">{step.status}</span>
                      </div>
                      {step.detail && (
                        <p className="mt-1 truncate text-[11px] text-white/60" title={step.detail}>
                          {step.detail}
                        </p>
                      )}
                    </div>
                  ))}

                  <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2">
                    <p className="text-xs text-white/70">AI 说了什么</p>
                    <pre className="mt-2 whitespace-pre-wrap break-words text-[11px] leading-5 text-white/80">
                      {latestAiRaw || '暂无 AI 原始回复'}
                    </pre>
                  </div>
                </div>
              ) : (
                <div className="h-full overflow-auto rounded-xl bg-[#282c34] p-3">
                  <pre className="whitespace-pre-wrap break-words text-[11px] leading-5 text-white/80">
                    {aiRawText || '暂无原始日志'}
                  </pre>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
