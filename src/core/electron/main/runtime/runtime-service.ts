import { spawn } from 'child_process'
import { createHash } from 'crypto'
import { writeFileSync, unlinkSync } from 'fs'
import { tmpdir } from 'os'
import { basename, join } from 'path'
import { loadConfig } from '../config'
import { listRuntimeEntries as listRegistryRuntimeEntries, removeRuntimeEntry, setRuntimeEntry } from '../runtime-registry'
import type { ProcessManager } from '../runner'
import { tmuxManager } from '../tmux-manager'
import { wslBridge } from '../wsl-bridge'
import type {
  Capability,
  RuntimeDiagnostics,
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
  emitRuntimeStateChanged: (payload: RuntimeStateChangedPayload) => void
}

export function createRuntimeService(deps: RuntimeServiceDependencies) {
  const getCapability = () => deps.getCapability()
  const getProcessManager = () => deps.getProcessManager()

  function runtimeLauncherScript(): string {
    return loadConfig().runtimeLauncherScript || '$HOME/tools/claude-code-script/start-claude-with-env.sh'
  }

  function expandWslHomePath(pathValue: string): string {
    const normalized = pathValue.trim()
    if (!normalized) return normalized

    const wslHome = getCapability()?.wslEnv?.HOME
    if (!wslHome) return normalized

    if (normalized === '~') return wslHome
    if (normalized.startsWith('~/')) return `${wslHome}/${normalized.slice(2)}`
    if (normalized === '$HOME') return wslHome
    if (normalized.startsWith('$HOME/')) return `${wslHome}/${normalized.slice(6)}`
    if (normalized === '${HOME}') return wslHome
    if (normalized.startsWith('${HOME}/')) return `${wslHome}/${normalized.slice(8)}`

    return normalized
  }

  function resolvedRuntimeLauncherScript(): string {
    return expandWslHomePath(runtimeLauncherScript())
  }

  function quoteBashSingle(input: string): string {
    return input.replace(/'/g, "'\\''")
  }

  function normalizeRuntimeCli(cli?: 'claude' | 'codex'): 'claude' | 'codex' {
    return cli === 'codex' ? 'codex' : 'claude'
  }

  function buildRuntimeSessionName(projectPath: string, cli?: 'claude' | 'codex'): string {
    const normalizedCli = normalizeRuntimeCli(cli)
    const wslPath = wslBridge.toWslPath(projectPath)
    if (normalizedCli === 'codex') {
      const legacyMd5 = createHash('md5').update(wslPath).digest('hex').slice(0, 6)
      return `${basename(projectPath)}-${legacyMd5}`
    }
    const cliAwareMd5 = createHash('md5')
      .update(`${normalizedCli}:${wslPath}`)
      .digest('hex')
      .slice(0, 6)
    return `${basename(projectPath)}-${normalizedCli}-${cliAwareMd5}`
  }

  async function diagnoseRuntime(): Promise<RuntimeDiagnostics> {
    const scriptPath = resolvedRuntimeLauncherScript()
    const issues: string[] = []
    const capability = getCapability()
    const hasWsl = capability?.hasWsl ?? false
    const hasTmux = capability?.hasTmux ?? false
    const distro = capability?.wslDistro
    let launcherScriptExists = false
    let launcherScriptExecutable = false

    if (!hasWsl) {
      issues.push('WSL is not available')
    }
    if (!hasTmux) {
      issues.push('tmux is not available in WSL')
    }

    if (hasWsl) {
      try {
        const escaped = quoteBashSingle(scriptPath)
        const flags = await wslBridge.exec(
          `[ -e '${escaped}' ] && [ -x '${escaped}' ] && echo EXISTS_EXEC || ([ -e '${escaped}' ] && echo EXISTS_NOEXEC) || echo MISSING`
        )
        if (flags.includes('EXISTS_EXEC')) {
          launcherScriptExists = true
          launcherScriptExecutable = true
        } else if (flags.includes('EXISTS_NOEXEC')) {
          launcherScriptExists = true
          launcherScriptExecutable = false
          issues.push(`Runtime launcher script is not executable: ${scriptPath}`)
        } else {
          issues.push(`Runtime launcher script not found: ${scriptPath}`)
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        issues.push(`Failed to check launcher script: ${msg}`)
      }
    }

    return {
      checkedAt: Date.now(),
      hasWsl,
      hasTmux,
      distro,
      launcherScript: scriptPath,
      launcherScriptExists,
      launcherScriptExecutable,
      issues,
    }
  }

  function focusTerminalWindow(sessionName: string): Promise<boolean> {
    console.log(`[focusTerminalWindow] sessionName="${sessionName}"`)

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
      '  [DllImport("user32.dll")]',
      '  public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);',
      '  public delegate bool EnumWinProc(IntPtr hWnd, IntPtr lParam);',
      '}',
      '\'@',
      '',
      'Write-Output "match=$match"',
      'Write-Output "Enumerating windows..."',
      '$found = [IntPtr]::Zero',
      '',
      '$cb = [TF+EnumWinProc]{ param($h,$l)',
      '  $sb = New-Object System.Text.StringBuilder 256',
      '  [TF]::GetWindowText($h, $sb, 256) | Out-Null',
      '  $title = $sb.ToString()',
      '  if ($title.Length -gt 0) { Write-Output "hwnd=$h title=$title" }',
      '  if ($title.Contains($match)) { $script:found = $h; Write-Output "MATCHED hwnd=$h"; return $false }',
      '  return $true',
      '}',
      '',
      '[TF]::EnumWindows($cb, [IntPtr]::Zero)',
      '',
      'if ($script:found -ne [IntPtr]::Zero) {',
      '  $iconic = [TF]::IsIconic($script:found)',
      '  Write-Output "found hwnd=$($script:found) iconic=$iconic"',
      '  if ($iconic) { [TF]::ShowWindow($script:found, 9) | Out-Null; Write-Output "ShowWindow(SW_RESTORE)" }',
      '  [TF]::BringWindowToTop($script:found) | Out-Null; Write-Output "BringWindowToTop done"',
      '  [TF]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero)',
      '  [TF]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)',
      '  $fg = [TF]::SetForegroundWindow($script:found)',
      '  Write-Output "SetForegroundWindow=$fg"',
      '  exit 0',
      '} else {',
      '  Write-Output "NOT FOUND"',
      '  exit 2',
      '}',
    ].join('\r\n')

    writeFileSync(ps1File, ps, 'utf-8')

    return new Promise<boolean>((resolve) => {
      const child = spawn(
        'powershell',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps1File, sessionName],
        {
          stdio: ['ignore', 'pipe', 'pipe'],
        }
      )

      let stdout = ''
      let stderr = ''
      let settled = false

      const finish = (ok: boolean) => {
        if (settled) return
        settled = true
        try { unlinkSync(ps1File) } catch { /* best effort */ }
        resolve(ok)
      }

      child.stdout?.on('data', (d: Buffer) => { stdout += d.toString() })
      child.stderr?.on('data', (d: Buffer) => { stderr += d.toString() })

      child.on('error', (err) => {
        console.error('[focusTerminalWindow] spawn failed:', err.message)
        finish(false)
      })

      child.on('close', (code) => {
        console.log(`[focusTerminalWindow] PS exited code=${code}`)
        if (stdout.trim()) console.log('[focusTerminalWindow PS stdout]\n', stdout.trim())
        else console.log('[focusTerminalWindow PS stdout] EMPTY')
        if (stderr.trim()) console.log('[focusTerminalWindow PS stderr]\n', stderr.trim())
        finish(code === 0)
      })
    })
  }

  async function startRuntime(
    projectId: string,
    projectPath: string,
    cli?: 'claude' | 'codex'
  ): Promise<boolean> {
    const diag = await diagnoseRuntime()
    if (diag.issues.length > 0) {
      console.error('[runtime:start] diagnostics failed:', diag.issues.join(' | '))
      return false
    }

    const distro = getCapability()?.wslDistro || 'Ubuntu'
    const wslPath = wslBridge.toWslPath(projectPath)
    const resolvedCli = normalizeRuntimeCli(cli)
    const sessionName = buildRuntimeSessionName(projectPath, resolvedCli)
    const cliFlag = ` --cli ${resolvedCli}`
    const launcher = quoteBashSingle(resolvedRuntimeLauncherScript())
    const command = `'${launcher}'${cliFlag} '${quoteBashSingle(wslPath)}'`

    return new Promise<boolean>((resolve) => {
      const child = spawn(
        'wsl.exe',
        [
          '-d',
          distro,
          '--',
          'bash',
          '-ilc',
          command,
        ],
        {
          detached: true,
          windowsHide: true,
          stdio: 'ignore',
        }
      )

      child.on('error', (err) => {
        console.error('[runtime:start] spawn failed:', err.message)
        resolve(false)
      })

      child.on('spawn', () => {
        setRuntimeEntry({
          projectId,
          sessionName,
          createdAt: Date.now(),
          lastOpened: Date.now(),
        })
        deps.emitRuntimeStateChanged({ reason: 'runtime-started', projectId, sessionName })
        resolve(true)
      })

      child.unref()
    })
  }

  async function openRuntimeTerminal(sessionName: string, statusHint?: string): Promise<boolean> {
    console.log(`[open-terminal] sessionName="${sessionName}" statusHint=${statusHint ?? 'none'}`)

    if (statusHint === 'attached') {
      console.log('[open-terminal] fast path — skipping WSL, focusing directly')
      const focused = await focusTerminalWindow(sessionName)
      if (focused) {
        deps.emitRuntimeStateChanged({ reason: 'terminal-focused', sessionName })
        return true
      }
      console.warn('[open-terminal] focus fast path failed, falling back to tmux attach')
    }

    const exists = await tmuxManager.sessionExists(sessionName)
    console.log(`[open-terminal] sessionExists=${exists}`)
    if (!exists) return false

    const clients = await tmuxManager.countClients(sessionName)
    console.log(`[open-terminal] clients=${clients}`)
    if (clients > 0) {
      const focused = await focusTerminalWindow(sessionName)
      if (focused) {
        deps.emitRuntimeStateChanged({ reason: 'terminal-focused', sessionName })
        return true
      }
      console.warn('[open-terminal] existing client focus failed, opening a new terminal window')
    }

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

      child.on('error', (err) => {
        console.error('[runtime:open-terminal] spawn failed:', err.message)
        resolve(false)
      })

      child.on('close', () => {
        deps.emitRuntimeStateChanged({ reason: 'terminal-opened', sessionName })
        resolve(true)
      })

      child.unref()
    })
  }

  function listRuntimeEntries() {
    return listRegistryRuntimeEntries()
  }

  async function killTmuxSession(sessionName: string): Promise<boolean> {
    const ok = await tmuxManager.killSession(sessionName)
    if (ok) {
      deps.emitRuntimeStateChanged({ reason: 'tmux-killed', sessionName })
    }
    return ok
  }

  async function listTerminalInventory(): Promise<TerminalProcessInventory> {
    const managedProcesses = getProcessManager()?.listManagedProcesses() ?? []
    const tmuxSessions = getCapability()?.hasTmux
      ? await tmuxManager.listLauncherSessions()
      : []
    return {
      checkedAt: Date.now(),
      managedProcesses,
      tmuxSessions,
    }
  }

  async function stopAllTerminals(): Promise<TerminalStopAllResult> {
    const managedStopped = getProcessManager()?.stopAllWithCount() ?? 0
    const allTmuxSessions = getCapability()?.hasTmux
      ? await tmuxManager.listLauncherSessions()
      : []
    const tmuxSessionNames = allTmuxSessions.map((s) => s.sessionName).filter(Boolean)

    if (tmuxSessionNames.length === 0) {
      const result = {
        managedStopped,
        tmuxKilled: 0,
        tmuxSkipped: 0,
      }
      if (managedStopped > 0) {
        deps.emitRuntimeStateChanged({ reason: 'terminal-stop-all' })
      }
      return result
    }

    await tmuxManager.killSessions(tmuxSessionNames)
    const after = getCapability()?.hasTmux ? await tmuxManager.listLauncherSessions() : []
    const afterSet = new Set(after.map((s) => s.sessionName))
    let tmuxKilled = 0
    let tmuxSkipped = 0
    for (const name of tmuxSessionNames) {
      if (afterSet.has(name)) tmuxSkipped += 1
      else tmuxKilled += 1
    }

    const result = {
      managedStopped,
      tmuxKilled,
      tmuxSkipped,
    }
    if (managedStopped > 0 || tmuxKilled > 0) {
      deps.emitRuntimeStateChanged({ reason: 'terminal-stop-all' })
    }
    return result
  }

  async function cleanupOnBeforeQuit(): Promise<void> {
    const { runtimeKeepAliveOnQuit = false } = loadConfig()
    const runtimeEntries = listRegistryRuntimeEntries()

    if (!runtimeKeepAliveOnQuit) {
      const ownSessionNames = runtimeEntries.map((entry) => entry.sessionName).filter(Boolean)
      try {
        await tmuxManager.killSessions(ownSessionNames)
      } catch (err) {
        console.error('[before-quit] failed to clean app runtime sessions:', err)
      }

      for (const entry of runtimeEntries) {
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
    killTmuxSession,
    listTerminalInventory,
    stopAllTerminals,
    cleanupOnBeforeQuit,
  }
}

export type RuntimeService = ReturnType<typeof createRuntimeService>
