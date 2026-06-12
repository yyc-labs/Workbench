import { spawn } from 'child_process'
import { writeFileSync, unlinkSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { loadConfig } from '../config'
import {
  listRuntimeEntries as listRegistryRuntimeEntries,
  removeRuntimeEntry,
  setRuntimeEntry,
} from '../runtime-registry'
import type { ProcessManager } from '../runner'
import { tmuxManager } from '../tmux-manager'
import type { AiEnvironmentController } from '../ai-environment/environment-controller'
import type {
  Capability,
  RuntimeDiagnostics,
  RuntimeSessionInfo,
  TerminalProcessInventory,
  TerminalStopAllResult,
} from '../../../shared/types'

type RuntimeStateChangedPayload = {
  reason: string
  projectId?: string
  sessionName?: string
}

type RuntimeServiceDependencies = {
  getCapability: () => Capability | null
  getProcessManager: () => ProcessManager | null
  aiEnvironmentController: AiEnvironmentController
  emitRuntimeStateChanged: (payload: RuntimeStateChangedPayload) => void
}

function isWindows(): boolean {
  return process.platform === 'win32'
}

function isWindowsWslTmuxMode(mode?: RuntimeSessionInfo['mode'] | RuntimeDiagnostics['mode']): boolean {
  return mode === 'windows-wsl'
}

function isPosixTmuxMode(mode?: RuntimeSessionInfo['mode'] | RuntimeDiagnostics['mode']): boolean {
  return mode === 'linux-native' || mode === 'macos-native'
}

function openPosixTmuxTerminal(sessionName: string): Promise<boolean> {
  if (process.platform === 'darwin') {
    return new Promise((resolve) => {
      const child = spawn('open', ['-a', 'Terminal', '--args', 'tmux', 'attach-session', '-t', sessionName], {
        detached: true,
        stdio: 'ignore',
      })
      child.on('error', () => resolve(false))
      child.on('spawn', () => {
        child.unref()
        resolve(true)
      })
    })
  }

  return new Promise((resolve) => {
    const child = spawn('x-terminal-emulator', ['-e', 'tmux', 'attach-session', '-t', sessionName], {
      detached: true,
      stdio: 'ignore',
    })
    child.on('error', () => resolve(false))
    child.on('spawn', () => {
      child.unref()
      resolve(true)
    })
  })
}

function focusTerminalWindow(sessionName: string): Promise<boolean> {
  if (!isWindows()) return Promise.resolve(false)

  const ps1File = join(tmpdir(), `focus-terminal-${Date.now()}.ps1`).replace(/\\/g, '/')
  const ps = [
    'param([string]$match)',
    '$ErrorActionPreference = "Stop"',
    '',
    'Add-Type -TypeDefinition @\'',
    'using System;',
    'using System.Runtime.InteropServices;',
    'using System.Text;',
    'public class TF {',
    '  [DllImport("user32.dll")]',
    '  public static extern bool EnumWindows(EnumWinProc lpEnumFunc, IntPtr lParam);',
    '  [DllImport("user32.dll")]',
    '  public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);',
    '  [DllImport("user32.dll")]',
    '  public static extern bool IsIconic(IntPtr hWnd);',
    '  [DllImport("user32.dll")]',
    '  public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);',
    '  [DllImport("user32.dll")]',
    '  public static extern bool SetForegroundWindow(IntPtr hWnd);',
    '  [DllImport("user32.dll")]',
    '  public static extern bool BringWindowToTop(IntPtr hWnd);',
    '  public delegate bool EnumWinProc(IntPtr hWnd, IntPtr lParam);',
    '}',
    '\'@',
    '$found = [IntPtr]::Zero',
    '$cb = [TF+EnumWinProc]{ param($h,$l)',
    '  $sb = New-Object System.Text.StringBuilder 256',
    '  [TF]::GetWindowText($h, $sb, 256) | Out-Null',
    '  $title = $sb.ToString()',
    '  if ($title.Contains($match)) { $script:found = $h; return $false }',
    '  return $true',
    '}',
    '[TF]::EnumWindows($cb, [IntPtr]::Zero)',
    'if ($script:found -ne [IntPtr]::Zero) {',
    '  if ([TF]::IsIconic($script:found)) { [TF]::ShowWindow($script:found, 9) | Out-Null }',
    '  [TF]::BringWindowToTop($script:found) | Out-Null',
    '  [TF]::SetForegroundWindow($script:found) | Out-Null',
    '  exit 0',
    '}',
    'exit 2',
  ].join('\r\n')

  writeFileSync(ps1File, ps, 'utf-8')
  return new Promise<boolean>((resolve) => {
    const child = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps1File, sessionName], {
      stdio: ['ignore', 'ignore', 'ignore'],
    })
    let settled = false
    const finish = (ok: boolean) => {
      if (settled) return
      settled = true
      try { unlinkSync(ps1File) } catch { /* noop */ }
      resolve(ok)
    }
    child.on('error', () => finish(false))
    child.on('close', (code) => finish(code === 0))
  })
}

export function createRuntimeService(deps: RuntimeServiceDependencies) {
  const getCapability = () => deps.getCapability()
  const getProcessManager = () => deps.getProcessManager()

  async function diagnoseRuntime(): Promise<RuntimeDiagnostics> {
    return deps.aiEnvironmentController.diagnoseRuntime()
  }

  async function startRuntime(
    projectId: string,
    projectPath: string,
    cli?: 'claude' | 'codex'
  ): Promise<boolean> {
    const diagnostics = await diagnoseRuntime()
    if (diagnostics.issues.length > 0 && diagnostics.mode !== 'windows-native') {
      console.error('[runtime:start] diagnostics failed:', diagnostics.issues.join(' | '))
      return false
    }

    const plan = await deps.aiEnvironmentController.resolveRuntimeLaunch({
      projectId,
      projectPath,
      cli: cli === 'codex' ? 'codex' : 'claude',
    })

    return new Promise<boolean>((resolve) => {
      const child = spawn(plan.startCommand, plan.startArgs, {
        cwd: plan.cwd,
        detached: plan.detached,
        windowsHide: plan.windowsHide,
        shell: plan.shell ?? false,
        stdio: 'ignore',
        env: plan.env ? { ...process.env, ...plan.env } : process.env,
      })

      child.on('error', (err) => {
        console.error('[runtime:start] spawn failed:', err.message)
        resolve(false)
      })

      child.on('spawn', () => {
        const startedAt = Date.now()
        if (plan.supportsManagedSessions) {
          setRuntimeEntry({
            projectId,
            sessionName: plan.sessionName,
            createdAt: startedAt,
            lastOpened: startedAt,
            mode: plan.mode,
            pid: child.pid ?? null,
            pidStartedAt: child.pid != null ? startedAt : null,
          })
        } else {
          removeRuntimeEntry(projectId)
        }
        deps.emitRuntimeStateChanged({ reason: 'runtime-started', projectId, sessionName: plan.sessionName })
        if (plan.detached) {
          child.unref()
        }
        resolve(true)
      })
    })
  }

  async function openRuntimeTerminal(sessionName: string, statusHint?: string): Promise<boolean> {
    const diagnostics = await diagnoseRuntime()
    let sessionMode: RuntimeSessionInfo['mode'] | undefined
    try {
      sessionMode = (await deps.aiEnvironmentController.listRuntimeSessions())
        .find((item) => item.sessionName === sessionName)
        ?.mode
    } catch {
      // Ignore lookup failures and fall back to the configured provider mode.
    }

    const resolvedMode = sessionMode ?? diagnostics.mode

    if (isWindowsWslTmuxMode(resolvedMode)) {
      if (statusHint === 'attached') {
        const focused = await focusTerminalWindow(sessionName)
        if (focused) {
          deps.emitRuntimeStateChanged({ reason: 'terminal-focused', sessionName })
          return true
        }
      }

      const exists = await tmuxManager.sessionExists(sessionName)
      if (!exists) return false
      const distro = getCapability()?.wslDistro || 'Ubuntu'
      return new Promise<boolean>((resolve) => {
        const child = spawn('wt.exe', [
          'wsl', '-d', distro,
          '--', 'bash', '-c',
          `exec tmux attach-session -t '${sessionName}'`,
        ], {
          detached: true,
          stdio: 'ignore',
        })
        child.on('error', () => resolve(false))
        child.on('close', () => {
          deps.emitRuntimeStateChanged({ reason: 'terminal-opened', sessionName })
          resolve(true)
        })
        child.unref()
      })
    }

    if (diagnostics.mode === 'windows-native') {
      return false
    }

    if (isPosixTmuxMode(resolvedMode)) {
      const opened = await openPosixTmuxTerminal(sessionName)
      if (opened) {
        deps.emitRuntimeStateChanged({ reason: 'terminal-opened', sessionName })
      }
      return opened
    }

    return false
  }

  function listRuntimeEntries() {
    return listRegistryRuntimeEntries()
  }

  async function listRuntimeSessions(): Promise<RuntimeSessionInfo[]> {
    return deps.aiEnvironmentController.listRuntimeSessions()
  }

  async function killTmuxSession(sessionName: string): Promise<boolean> {
    const ok = await deps.aiEnvironmentController.stopRuntimeSession(sessionName)
    if (ok) {
      deps.emitRuntimeStateChanged({ reason: 'runtime-stopped', sessionName })
      const runtimeEntries = listRegistryRuntimeEntries()
      const matched = runtimeEntries.find((entry) => entry.sessionName === sessionName)
      if (matched) {
        removeRuntimeEntry(matched.projectId)
      }
    }
    return ok
  }

  async function listTerminalInventory(): Promise<TerminalProcessInventory> {
    const managedProcesses = getProcessManager()?.listManagedProcesses() ?? []
    const runtimeSessions = await deps.aiEnvironmentController.listRuntimeSessions()
    const tmuxSessions = runtimeSessions
      .filter((item) => item.mode === 'windows-wsl' || item.mode === 'linux-native' || item.mode === 'macos-native')
      .map((item) => ({
        sessionName: item.sessionName,
        projectId: item.projectId,
        createdAt: item.createdAt,
        status: item.status,
      }))
    return {
      checkedAt: Date.now(),
      managedProcesses,
      runtimeSessions,
      tmuxSessions,
    }
  }

  async function stopAllTerminals(): Promise<TerminalStopAllResult> {
    const managedStopped = getProcessManager()?.stopAllWithCount() ?? 0
    const runtimeSessions = await deps.aiEnvironmentController.listRuntimeSessions()
    let tmuxKilled = 0
    let tmuxSkipped = 0
    for (const session of runtimeSessions) {
      const ok = await deps.aiEnvironmentController.stopRuntimeSession(session.sessionName)
      if (ok) tmuxKilled += 1
      else tmuxSkipped += 1
    }

    if (managedStopped > 0 || tmuxKilled > 0) {
      deps.emitRuntimeStateChanged({ reason: 'terminal-stop-all' })
    }

    return {
      managedStopped,
      tmuxKilled,
      tmuxSkipped,
    }
  }

  async function cleanupOnBeforeQuit(): Promise<void> {
    const { runtimeKeepAliveOnQuit = false } = loadConfig()
    const runtimeEntries = listRegistryRuntimeEntries()
    if (!runtimeKeepAliveOnQuit) {
      for (const entry of runtimeEntries) {
        try {
          await deps.aiEnvironmentController.stopRuntimeSession(entry.sessionName)
        } catch (error) {
          console.error('[before-quit] failed to stop runtime session:', error)
        }
        removeRuntimeEntry(entry.projectId)
      }
      if (runtimeEntries.length > 0) {
        deps.emitRuntimeStateChanged({ reason: 'runtime-registry-cleared' })
      }
    }
  }

  return {
    diagnoseRuntime,
    startRuntime,
    openRuntimeTerminal,
    listRuntimeEntries,
    listRuntimeSessions,
    killTmuxSession,
    listTerminalInventory,
    stopAllTerminals,
    cleanupOnBeforeQuit,
  }
}

export type RuntimeService = ReturnType<typeof createRuntimeService>
