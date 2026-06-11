import type { BrowserWindow } from 'electron'
import { spawn } from 'child_process'
import { join } from 'path'
import { StringDecoder } from 'string_decoder'
import { loadConfig } from '../config'
import {
  createGitCommandRunner,
  DEFAULT_GIT_OPERATION_TIMEOUT_MS,
  formatGitCommand,
  normalizeGitOperationOutput,
} from '../git/git-command'
import { IPC } from '../ipc'
import {
  appendAiCommitTaskOutput,
  getAiCommitTask,
  upsertAiCommitTask,
} from '../ai-commit-registry'
import { wslBridge } from '../wsl-bridge'
import type { AiEnvironmentController } from '../ai-environment/environment-controller'
import type {
  AiCommitRunOverride,
  AiCommitTaskSnapshot,
  AiCommitUndoCloseReason,
  AiCommitUndoResult,
  AiCommitUndoState,
} from '../../../shared/types'

type AiCommitServiceDependencies = {
  getMainWindow: () => BrowserWindow | null
  getDefaultWslDistro: () => string
  aiEnvironmentController: AiEnvironmentController
}

const AI_COMMIT_UNDO_WINDOW_MS = 30_000
const AI_COMMIT_UNDO_AUTH_GRACE_MS = 10_000
const GIT_HASH_RE = /^[0-9a-f]{40}$/i

export function createAiCommitService(deps: AiCommitServiceDependencies) {
  const activeAiCommitProjects = new Set<string>()
  const gitCommandRunner = createGitCommandRunner({
    getDefaultWslDistro: () => deps.getDefaultWslDistro(),
  })

  function sendAiCommitOutput(projectId: string, data: string): void {
    appendAiCommitTaskOutput(projectId, data)
    deps.getMainWindow()?.webContents.send(IPC.AI_COMMIT_OUTPUT, { projectId, data })
  }

  function sendAiCommitStatus(projectId: string, status: 'running' | 'success' | 'error'): void {
    const current = getAiCommitTask(projectId)
    if (current) {
      const now = Date.now()
      upsertAiCommitTask({
        ...current,
        status,
        updatedAt: now,
        finishedAt: status === 'running' ? undefined : now,
      })
    }
    deps.getMainWindow()?.webContents.send(IPC.AI_COMMIT_STATUS, { projectId, status })
  }

  function markAiCommitInterruptedIfOrphan(projectId: string): AiCommitTaskSnapshot | undefined {
    const task = getAiCommitTask(projectId)
    if (!task) return undefined
    if (task.status !== 'running') return task
    if (activeAiCommitProjects.has(projectId)) return task

    const now = Date.now()
    const interruptedLine = '[AI Commit] previous task interrupted: app process exited before completion.\r\n'
    const next = upsertAiCommitTask({
      ...task,
      status: 'error',
      output: `${task.output || ''}${interruptedLine}`,
      updatedAt: now,
      finishedAt: now,
    })

    deps.getMainWindow()?.webContents.send(IPC.AI_COMMIT_OUTPUT, { projectId, data: interruptedLine })
    deps.getMainWindow()?.webContents.send(IPC.AI_COMMIT_STATUS, { projectId, status: 'error' as const })
    return next
  }

  async function readGitHead(repoRoot: string): Promise<string | undefined> {
    const result = await gitCommandRunner.runGitCommand(repoRoot, ['rev-parse', '--verify', 'HEAD'])
    if (result.code !== 0) return undefined
    const head = result.stdout.replace(/\r/g, '').trim()
    return GIT_HASH_RE.test(head) ? head : undefined
  }

  async function countUndoCommits(
    repoRoot: string,
    beforeHead: string | undefined,
    afterHead: string
  ): Promise<number> {
    const revisionRange = beforeHead ? `${beforeHead}..${afterHead}` : afterHead
    const result = await gitCommandRunner.runGitCommand(repoRoot, ['rev-list', '--count', revisionRange])
    if (result.code !== 0) return 0
    const count = Number.parseInt(result.stdout.replace(/\r/g, '').trim(), 10)
    return Number.isFinite(count) ? Math.max(0, count) : 0
  }

  async function createUndoState(
    repoRoot: string,
    runId: string,
    beforeHead: string | undefined
  ): Promise<AiCommitUndoState | undefined> {
    const afterHead = await readGitHead(repoRoot)
    if (!afterHead || afterHead === beforeHead) return undefined

    const commitCount = await countUndoCommits(repoRoot, beforeHead, afterHead)
    if (commitCount <= 0) return undefined

    const now = Date.now()
    return {
      repoRoot,
      runId,
      beforeHead,
      afterHead,
      commitCount,
      status: 'available',
      createdAt: now,
      expiresAt: now + AI_COMMIT_UNDO_WINDOW_MS,
    }
  }

  function undoStatusForCloseReason(reason: AiCommitUndoCloseReason): AiCommitUndoState['status'] {
    if (reason === 'expired') return 'expired'
    if (reason === 'undone') return 'undone'
    return 'closed'
  }

  function getUndoEffectiveExpiresAt(undo: AiCommitUndoState): number {
    if (
      Number.isFinite(undo.authStartedAt)
      && Number.isFinite(undo.authExpiresAt)
      && (undo.authStartedAt as number) <= undo.expiresAt
      && (undo.authExpiresAt as number) > undo.expiresAt
    ) {
      return undo.authExpiresAt as number
    }
    return undo.expiresAt
  }

  function closeAiCommitUndo(
    projectId: string,
    reason: AiCommitUndoCloseReason = 'manual'
  ): AiCommitTaskSnapshot | null {
    const task = getAiCommitTask(projectId)
    if (!task) return null
    if (!task.undo || task.undo.status !== 'available') return task

    const now = Date.now()
    return upsertAiCommitTask({
      ...task,
      undo: {
        ...task.undo,
        status: undoStatusForCloseReason(reason),
        authStartedAt: undefined,
        authExpiresAt: undefined,
        closedAt: now,
        closeReason: reason,
      },
      undoSuppressedAt: now,
      undoSuppressedReason: reason,
      updatedAt: now,
    })
  }

  function expireAiCommitUndoIfNeeded(task: AiCommitTaskSnapshot | undefined): AiCommitTaskSnapshot | undefined {
    if (!task?.undo || task.undo.status !== 'available') return task
    if (getUndoEffectiveExpiresAt(task.undo) > Date.now()) return task
    return closeAiCommitUndo(task.projectId, 'expired') ?? task
  }

  function beginAiCommitUndoAuth(projectId: string): AiCommitTaskSnapshot | null {
    const task = expireAiCommitUndoIfNeeded(getAiCommitTask(projectId))
    if (!task?.undo || task.undo.status !== 'available') return task ?? null

    const now = Date.now()
    const effectiveExpiresAt = getUndoEffectiveExpiresAt(task.undo)
    if (
      Number.isFinite(task.undo.authStartedAt)
      && Number.isFinite(task.undo.authExpiresAt)
      && effectiveExpiresAt > now
    ) {
      return task
    }

    if (task.undo.expiresAt <= now) {
      return closeAiCommitUndo(projectId, 'expired') ?? task
    }

    return upsertAiCommitTask({
      ...task,
      undo: {
        ...task.undo,
        authStartedAt: now,
        authExpiresAt: task.undo.expiresAt + AI_COMMIT_UNDO_AUTH_GRACE_MS,
      },
      updatedAt: now,
    })
  }

  function cancelAiCommitUndoAuth(projectId: string): AiCommitTaskSnapshot | null {
    const task = getAiCommitTask(projectId)
    if (!task?.undo || task.undo.status !== 'available') return task ?? null

    const now = Date.now()
    if (task.undo.expiresAt <= now) {
      return closeAiCommitUndo(projectId, 'expired') ?? task
    }

    if (!Number.isFinite(task.undo.authStartedAt) && !Number.isFinite(task.undo.authExpiresAt)) {
      return task
    }

    return upsertAiCommitTask({
      ...task,
      undo: {
        ...task.undo,
        authStartedAt: undefined,
        authExpiresAt: undefined,
      },
      updatedAt: now,
    })
  }

  async function runAiCommit(
    projectId: string,
    repoRoot: string,
    override?: AiCommitRunOverride
  ): Promise<boolean> {
    const existing = markAiCommitInterruptedIfOrphan(projectId)
    if (existing && existing.status === 'running') {
      sendAiCommitOutput(projectId, '[AI Commit] skipped: a commit task is already running for this project.\r\n')
      sendAiCommitStatus(projectId, 'running')
      return true
    }

    const now = Date.now()
    const runId = `${now}-${Math.random().toString(36).slice(2, 8)}`
    const beforeHead = await readGitHead(repoRoot)
    upsertAiCommitTask({
      projectId,
      repoRoot,
      runId,
      status: 'running',
      output: '',
      startedAt: now,
      updatedAt: now,
      override,
    })
    activeAiCommitProjects.add(projectId)

    const config = loadConfig()
    const aiCfgRaw = config.aiCommit || {}
    const aiCfg = {
      ...aiCfgRaw,
      split: typeof override?.split === 'boolean' ? override.split : aiCfgRaw.split,
      splitMaxBatches: typeof override?.splitMaxBatches === 'number'
        ? override.splitMaxBatches
        : aiCfgRaw.splitMaxBatches,
      maxBullets: typeof override?.maxBullets === 'number'
        ? override.maxBullets
        : aiCfgRaw.maxBullets,
    }
    const wslPwshPath = (aiCfg.wslPwshPath || '').replace(/[\r\n]/g, '').trim() || '/snap/bin/pwsh'
    const splitEnabled = Boolean(aiCfg.split)
    const splitMaxBatches = Math.max(
      1,
      Math.min(
        12,
        Number.isFinite(aiCfg.splitMaxBatches)
          ? Math.trunc(aiCfg.splitMaxBatches as number)
          : 4
      )
    )
    const maxBullets = Math.max(
      1,
      Math.min(
        20,
        Number.isFinite(aiCfg.maxBullets)
          ? Math.trunc(aiCfg.maxBullets as number)
          : 8
      )
    )
    const scriptPs1Path = join(__dirname, '../../script/auto-git-commit/auto_commit.ps1')
    const scriptPs1WslPath = process.platform === 'win32' ? wslBridge.toWslPath(scriptPs1Path) : null

    sendAiCommitStatus(projectId, 'running')
    sendAiCommitOutput(projectId, `\r\n[AI Commit] Starting in ${repoRoot}\r\n`)
    sendAiCommitOutput(
      projectId,
      `[AI Commit] mode: ${splitEnabled ? `split (max batches=${splitMaxBatches})` : 'single'}, max bullets=${maxBullets}\r\n`
    )

    return new Promise<boolean>((resolve) => {
      let launchPlanPromise = deps.aiEnvironmentController.resolveAiCommitLaunch({
        repoRoot,
        scriptPath: scriptPs1Path,
        scriptWslPath: scriptPs1WslPath,
        aiCommitConfig: {
          ...aiCfg,
          enabled: aiCfg.enabled ?? true,
          apiBaseUrl: aiCfg.apiBaseUrl?.trim(),
          apiKey: aiCfg.apiKey?.trim(),
          model: aiCfg.model?.trim(),
          wslPwshPath,
          split: splitEnabled,
          splitMaxBatches,
          maxBullets,
        },
      })
      let child = null as ReturnType<typeof spawn> | null

      let started = false
      let settled = false
      const allowWindowsFallback = process.platform === 'win32'
      let switchedToWindowsPowerShell = false

      const stdoutDecoder = new StringDecoder('utf8')
      const stderrDecoder = new StringDecoder('utf8')

      const cleanup = () => {
        activeAiCommitProjects.delete(projectId)
      }

      const flushTails = () => {
        const tailOut = stdoutDecoder.end()
        if (tailOut) {
          sendAiCommitOutput(projectId, tailOut.replace(/\r?\n/g, '\r\n'))
        }
        const tailErr = stderrDecoder.end()
        if (tailErr) {
          sendAiCommitOutput(projectId, tailErr.replace(/\r?\n/g, '\r\n'))
        }
      }

      const finalize = (code: number | null) => {
        if (settled) return
        settled = true
        void (async () => {
          flushTails()
          const ok = code === 0
          sendAiCommitOutput(projectId, `[AI Commit] finished with code ${code}\r\n`)

          if (ok) {
            try {
              const undo = await createUndoState(repoRoot, runId, beforeHead)
              const current = getAiCommitTask(projectId)
              if (undo && current?.runId === runId) {
                upsertAiCommitTask({
                  ...current,
                  undo,
                  updatedAt: Date.now(),
                })
                sendAiCommitOutput(
                  projectId,
                  `[AI Commit] undo available for ${undo.commitCount} commit${undo.commitCount > 1 ? 's' : ''} (30s, +10s while confirming).\r\n`
                )
              }
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error)
              sendAiCommitOutput(projectId, `[AI Commit] undo inspection failed: ${message}\r\n`)
            }
          }

          sendAiCommitStatus(projectId, ok ? 'success' : 'error')
          cleanup()
          resolve(ok)
        })()
      }

      const fail = (message: string) => {
        if (settled) return
        settled = true
        sendAiCommitOutput(projectId, `[AI Commit] process error: ${message}\r\n`)
        sendAiCommitStatus(projectId, 'error')
        cleanup()
        resolve(false)
      }

      const attachStreams = (proc: ReturnType<typeof spawn>) => {
        proc.stdout?.on('data', (buf: Buffer) => {
          const text = stdoutDecoder.write(buf)
          if (text) {
            sendAiCommitOutput(projectId, text.replace(/\r?\n/g, '\r\n'))
          }
        })

        proc.stderr?.on('data', (buf: Buffer) => {
          const text = stderrDecoder.write(buf)
          if (text) {
            sendAiCommitOutput(projectId, text.replace(/\r?\n/g, '\r\n'))
          }
        })
      }

      void launchPlanPromise.then((plan) => {
        child = spawn(plan.command, plan.args, {
          cwd: plan.cwd,
          shell: plan.shell ?? false,
          stdio: ['ignore', 'pipe', 'pipe'],
          env: plan.env ? { ...process.env, ...plan.env } : process.env,
        })

        child.on('spawn', () => {
          started = true
          sendAiCommitOutput(projectId, `[AI Commit] shell: ${plan.outputLabel}\r\n`)
          attachStreams(child!)
        })

        child.on('error', (err) => {
          if (!started && allowWindowsFallback && !switchedToWindowsPowerShell) {
            switchedToWindowsPowerShell = true
            sendAiCommitOutput(projectId, `[AI Commit] pwsh unavailable, fallback to powershell.exe (${err.message})\r\n`)
            child = spawn('powershell.exe', [
              '-NoProfile',
              '-ExecutionPolicy',
              'Bypass',
              '-File',
              scriptPs1Path,
              '-All',
              ...(aiCfg.enabled ?? true ? ['-UseAi'] : []),
              ...(splitEnabled ? ['-Split', '-SplitMaxBatches', String(splitMaxBatches)] : []),
              '-MaxBullets',
              String(maxBullets),
              ...(aiCfg.apiBaseUrl && aiCfg.apiBaseUrl.trim() ? ['-ApiBaseUrl', aiCfg.apiBaseUrl.trim()] : []),
              ...(aiCfg.apiKey && aiCfg.apiKey.trim() ? ['-ApiKey', aiCfg.apiKey.trim()] : []),
              ...(aiCfg.model && aiCfg.model.trim() ? ['-Model', aiCfg.model.trim()] : []),
            ], {
              cwd: repoRoot,
              shell: false,
              stdio: ['ignore', 'pipe', 'pipe'],
            })
            child.on('spawn', () => {
              sendAiCommitOutput(projectId, '[AI Commit] shell: powershell.exe\r\n')
              attachStreams(child!)
            })
            child.on('error', (fallbackErr) => fail(fallbackErr.message))
            child.on('close', (code) => finalize(code))
            return
          }

          fail(err.message)
        })

        child.on('close', (code) => {
          finalize(code)
        })
      }).catch((error) => {
        fail(error instanceof Error ? error.message : String(error))
      })
    })
  }

  function getAiCommitState(projectId: string): AiCommitTaskSnapshot | null {
    return expireAiCommitUndoIfNeeded(markAiCommitInterruptedIfOrphan(projectId)) ?? null
  }

  async function undoAiCommit(projectId: string): Promise<AiCommitUndoResult> {
    const checkedAt = Date.now()
    const task = expireAiCommitUndoIfNeeded(getAiCommitTask(projectId))
    const repoRoot = task?.undo?.repoRoot || task?.repoRoot || ''
    const fail = (
      message: string,
      command = '',
      output = message,
      exitCode: number | null = null
    ): AiCommitUndoResult => ({
      projectId,
      repoRoot,
      ok: false,
      checkedAt,
      command,
      output,
      exitCode,
      error: message,
      undo: task?.undo,
    })

    if (!task?.undo) {
      return fail('No AI commit undo is available.')
    }

    const undo = task.undo
    if (undo.status !== 'available') {
      return fail('AI commit undo is no longer available.')
    }

    if (getUndoEffectiveExpiresAt(undo) <= Date.now()) {
      const closed = closeAiCommitUndo(projectId, 'expired')
      return {
        ...fail('AI commit undo window expired.'),
        undo: closed?.undo,
      }
    }

    const currentHead = await readGitHead(undo.repoRoot)
    if (currentHead !== undo.afterHead) {
      const closed = closeAiCommitUndo(projectId, 'head-changed')
      const message = 'Current HEAD changed after AI commit; undo was closed.'
      sendAiCommitOutput(projectId, `[AI Commit] undo skipped: ${message}\r\n`)
      return {
        ...fail(message),
        undo: closed?.undo,
      }
    }

    const args = undo.beforeHead
      ? ['reset', '--soft', undo.beforeHead]
      : ['update-ref', '-d', 'HEAD']
    const command = formatGitCommand(args)
    sendAiCommitOutput(projectId, `[AI Commit] undo: ${command}\r\n`)

    const execution = await gitCommandRunner.runGitCommand(undo.repoRoot, args, {
      timeoutMs: DEFAULT_GIT_OPERATION_TIMEOUT_MS,
    })
    const output = normalizeGitOperationOutput(execution.stdout, execution.stderr, {
      stdoutLimit: execution.stdoutLimit,
      stderrLimit: execution.stderrLimit,
    })

    if (execution.code !== 0) {
      sendAiCommitOutput(projectId, `[AI Commit] undo failed: ${output}\r\n`)
      return fail(output, command, output, execution.code)
    }

    const closed = closeAiCommitUndo(projectId, 'undone')
    sendAiCommitOutput(
      projectId,
      `[AI Commit] undo complete: returned before ${undo.commitCount} commit${undo.commitCount > 1 ? 's' : ''}.\r\n`
    )

    return {
      projectId,
      repoRoot: undo.repoRoot,
      ok: true,
      checkedAt,
      command,
      output,
      exitCode: execution.code,
      undo: closed?.undo,
    }
  }

  return {
    runAiCommit,
    getAiCommitState,
    beginAiCommitUndoAuth,
    cancelAiCommitUndoAuth,
    undoAiCommit,
    closeAiCommitUndo,
  }
}

export type AiCommitService = ReturnType<typeof createAiCommitService>
