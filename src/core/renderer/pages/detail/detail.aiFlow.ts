import { getCurrentLocale } from '../../i18n'
import type { AiCommitRestoreResult, AiCommitStatus, AiStepKey, AiStepState, AiStepStatus } from './detail.types'

export const FLOW_NODE_WIDTH = 236
export const FLOW_NODE_HEIGHT = 96
export const FLOW_CANVAS_HEIGHT = 220
export const FLOW_NODE_START_X = 36
export const FLOW_NODE_START_Y = Math.round((FLOW_CANVAS_HEIGHT - FLOW_NODE_HEIGHT) / 2)
export const FLOW_NODE_GAP_X = 278

export function createBaseAiSteps(): AiStepState[] {
  const locale = getCurrentLocale()
  const isZh = locale === 'zh-CN'
  return [
    { key: 'start', label: isZh ? '启动提交任务' : 'Start commit task', status: 'pending' },
    { key: 'stage', label: isZh ? '暂存改动' : 'Stage changes', status: 'pending' },
    { key: 'ai', label: isZh ? '调用 AI 生成提交信息' : 'Generate commit message with AI', status: 'pending' },
    { key: 'message', label: isZh ? '确认提交信息' : 'Confirm commit message', status: 'pending' },
    { key: 'commit', label: isZh ? '执行 git commit' : 'Run git commit', status: 'pending' },
    { key: 'done', label: isZh ? '完成' : 'Done', status: 'pending' },
  ]
}

export const BASE_AI_STEPS: AiStepState[] = createBaseAiSteps()

export function createDocLinkId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `doc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function normalizeDocUrl(value: string): string | null {
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

function stepRank(status: AiStepStatus): number {
  if (status === 'error') return 3
  if (status === 'success') return 2
  if (status === 'running') return 1
  return 0
}

function mergeStepStatus(current: AiStepStatus, next: AiStepStatus): AiStepStatus {
  return stepRank(next) >= stepRank(current) ? next : current
}

export function applyStep(
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

export function completePreviousSteps(steps: AiStepState[], untilKey: AiStepKey): AiStepState[] {
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

export function parseAiFlowLine(rawLine: string, steps: AiStepState[]): AiStepState[] {
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
    next = applyStep(next, 'commit', 'success', line)
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

export function clampSplitMaxBatches(value: number | undefined): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return 4
  return Math.max(1, Math.min(12, Math.trunc(value)))
}

export function clampMaxBullets(value: number | undefined): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return 8
  return Math.max(1, Math.min(20, Math.trunc(value)))
}

export function formatCommitDate(value: string): string {
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

export function parseFlowStepsFromOutput(output: string): AiStepState[] {
  const lines = output
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  if (lines.length === 0) return BASE_AI_STEPS
  return lines.reduce((steps, line) => parseAiFlowLine(line, steps), BASE_AI_STEPS)
}

export function restoreAiState(snapshot: AiCommitRestoreResult): {
  status: AiCommitStatus
  rawText: string
  steps: AiStepState[]
} {
  const rawText = snapshot.output || ''
  let steps = parseFlowStepsFromOutput(rawText)
  if (snapshot.status === 'success') {
    steps = applyStep(completePreviousSteps(steps, 'done'), 'done', 'success')
  } else if (snapshot.status === 'error') {
    const running = [...steps].reverse().find((s) => s.status === 'running')
    steps = running ? applyStep(steps, running.key, 'error') : applyStep(steps, 'done', 'error')
  }
  return {
    status: snapshot.status,
    rawText,
    steps,
  }
}

export function getFocusedStepKey(steps: AiStepState[], commitStatus: AiCommitStatus): AiStepKey {
  const runningStep = steps.find((step) => step.status === 'running')
  if (runningStep) return runningStep.key

  const errorStep = steps.find((step) => step.status === 'error')
  if (errorStep) return errorStep.key

  if (commitStatus === 'success') return 'done'

  const latestSuccessStep = [...steps].reverse().find((step) => step.status === 'success')
  if (latestSuccessStep) return latestSuccessStep.key

  return 'start'
}
