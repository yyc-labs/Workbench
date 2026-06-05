import type { BrowserWindow } from 'electron'
import { spawn } from 'child_process'
import { join } from 'path'
import { StringDecoder } from 'string_decoder'
import { loadConfig } from '../config'
import { IPC } from '../ipc'
import {
  appendAiCommitTaskOutput,
  getAiCommitTask,
  upsertAiCommitTask,
} from '../ai-commit-registry'
import { resolveWslVsCodeTarget } from '../shell/openers'
import { wslBridge } from '../wsl-bridge'
import type { AiCommitRunOverride, AiCommitTaskSnapshot } from '../../../shared/types'

type AiCommitServiceDependencies = {
  getMainWindow: () => BrowserWindow | null
  getDefaultWslDistro: () => string
}

export function createAiCommitService(deps: AiCommitServiceDependencies) {
  const activeAiCommitProjects = new Set<string>()

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

  async function runAiCommit(
    projectId: string,
    projectPath: string,
    override?: AiCommitRunOverride
  ): Promise<boolean> {
    const existing = markAiCommitInterruptedIfOrphan(projectId)
    if (existing && existing.status === 'running') {
      sendAiCommitOutput(projectId, '[AI Commit] skipped: a commit task is already running for this project.\r\n')
      sendAiCommitStatus(projectId, 'running')
      return true
    }

    const now = Date.now()
    upsertAiCommitTask({
      projectId,
      projectPath,
      runId: `${now}-${Math.random().toString(36).slice(2, 8)}`,
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
    const wslTarget = process.platform === 'win32'
      ? resolveWslVsCodeTarget(projectPath, deps.getDefaultWslDistro())
      : null

    sendAiCommitStatus(projectId, 'running')
    sendAiCommitOutput(projectId, `\r\n[AI Commit] Starting in ${projectPath}\r\n`)
    sendAiCommitOutput(
      projectId,
      `[AI Commit] mode: ${splitEnabled ? `split (max batches=${splitMaxBatches})` : 'single'}, max bullets=${maxBullets}\r\n`
    )

    return new Promise<boolean>((resolve) => {
      const windowsPsArgs = [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        scriptPs1Path,
        '-All',
      ]

      if (aiCfg.enabled ?? true) {
        windowsPsArgs.push('-UseAi')
      }
      if (splitEnabled) {
        windowsPsArgs.push('-Split', '-SplitMaxBatches', String(splitMaxBatches))
      }
      windowsPsArgs.push('-MaxBullets', String(maxBullets))

      if (aiCfg.apiBaseUrl && aiCfg.apiBaseUrl.trim()) {
        windowsPsArgs.push('-ApiBaseUrl', aiCfg.apiBaseUrl.trim())
      }
      if (aiCfg.apiKey && aiCfg.apiKey.trim()) {
        windowsPsArgs.push('-ApiKey', aiCfg.apiKey.trim())
      }
      if (aiCfg.model && aiCfg.model.trim()) {
        windowsPsArgs.push('-Model', aiCfg.model.trim())
      }

      const spawnPowerShell = (command: string) =>
        spawn(command, windowsPsArgs, {
          cwd: projectPath,
          shell: false,
          stdio: ['ignore', 'pipe', 'pipe'],
        })

      const quoteBash = (value: string) => `'${quoteBashSingle(value)}'`

      const spawnWslPowerShell = () => {
        if (!wslTarget || !scriptPs1WslPath) return spawnPowerShell('pwsh')

        const wslPwshArgs = [
          '-NoProfile',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          scriptPs1WslPath,
          '-All',
        ]
        if (aiCfg.enabled ?? true) {
          wslPwshArgs.push('-UseAi')
        }
        if (splitEnabled) {
          wslPwshArgs.push('-Split', '-SplitMaxBatches', String(splitMaxBatches))
        }
        wslPwshArgs.push('-MaxBullets', String(maxBullets))
        if (aiCfg.apiBaseUrl && aiCfg.apiBaseUrl.trim()) {
          wslPwshArgs.push('-ApiBaseUrl', aiCfg.apiBaseUrl.trim())
        }
        if (aiCfg.apiKey && aiCfg.apiKey.trim()) {
          wslPwshArgs.push('-ApiKey', aiCfg.apiKey.trim())
        }
        if (aiCfg.model && aiCfg.model.trim()) {
          wslPwshArgs.push('-Model', aiCfg.model.trim())
        }

        const preferredPwsh = quoteBash(wslPwshPath)
        const quotedArgs = wslPwshArgs.map((arg) => quoteBash(arg)).join(' ')
        const command = [
          'set -euo pipefail',
          `if [ -x ${preferredPwsh} ]; then`,
          `  echo "[AI Commit] wsl pwsh cmd: ${wslPwshPath}"`,
          `  exec ${preferredPwsh} ${quotedArgs}`,
          'else',
          '  echo "[AI Commit] wsl pwsh cmd: pwsh"',
          `  exec pwsh ${quotedArgs}`,
          'fi',
        ].join('\n')

        return spawn('wsl.exe', [
          '-d',
          wslTarget.distro,
          '--cd',
          wslTarget.linuxPath,
          '--',
          'bash',
          '-lc',
          command,
        ], {
          shell: false,
          stdio: ['ignore', 'pipe', 'pipe'],
        })
      }

      let child = (() => {
        if (wslTarget) {
          return spawnWslPowerShell()
        }

        return spawnPowerShell('pwsh')
      })()

      let started = false
      let settled = false
      const allowWindowsFallback = !wslTarget
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
        flushTails()
        const ok = code === 0
        sendAiCommitOutput(projectId, `[AI Commit] finished with code ${code}\r\n`)
        sendAiCommitStatus(projectId, ok ? 'success' : 'error')
        cleanup()
        resolve(ok)
      }

      const fail = (message: string) => {
        if (settled) return
        settled = true
        sendAiCommitOutput(projectId, `[AI Commit] process error: ${message}\r\n`)
        sendAiCommitStatus(projectId, 'error')
        cleanup()
        resolve(false)
      }

      const attachStreams = () => {
        child.stdout?.on('data', (buf: Buffer) => {
          const text = stdoutDecoder.write(buf)
          if (text) {
            sendAiCommitOutput(projectId, text.replace(/\r?\n/g, '\r\n'))
          }
        })

        child.stderr?.on('data', (buf: Buffer) => {
          const text = stderrDecoder.write(buf)
          if (text) {
            sendAiCommitOutput(projectId, text.replace(/\r?\n/g, '\r\n'))
          }
        })
      }

      child.on('spawn', () => {
        started = true
        sendAiCommitOutput(projectId, `[AI Commit] shell: ${wslTarget ? 'wsl-pwsh' : 'pwsh'}\r\n`)
        attachStreams()
      })

      child.on('error', (err) => {
        if (!started && allowWindowsFallback && !switchedToWindowsPowerShell) {
          switchedToWindowsPowerShell = true
          sendAiCommitOutput(projectId, `[AI Commit] pwsh unavailable, fallback to powershell.exe (${err.message})\r\n`)
          child = spawnPowerShell('powershell.exe')
          child.on('spawn', () => {
            sendAiCommitOutput(projectId, '[AI Commit] shell: powershell.exe\r\n')
            attachStreams()
          })
          child.on('error', (fallbackErr) => {
            fail(fallbackErr.message)
          })
          child.on('close', (code) => {
            finalize(code)
          })
          return
        }

        fail(err.message)
      })

      child.on('close', (code) => {
        finalize(code)
      })
    })
  }

  function getAiCommitState(projectId: string): AiCommitTaskSnapshot | null {
    return markAiCommitInterruptedIfOrphan(projectId) ?? null
  }

  return {
    runAiCommit,
    getAiCommitState,
  }
}

export type AiCommitService = ReturnType<typeof createAiCommitService>

function quoteBashSingle(input: string): string {
  return input.replace(/'/g, "'\\''")
}
