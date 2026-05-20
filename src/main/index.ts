import { app, BrowserWindow, ipcMain, dialog, shell, nativeTheme } from 'electron'
import { join, basename } from 'path'
import { createHash } from 'crypto'
import { spawn } from 'child_process'
import { tmpdir } from 'os'
import { writeFileSync, unlinkSync } from 'fs'
import { StringDecoder } from 'string_decoder'
import { ProcessManager } from './runner'
import { detectProject } from './detector'
import { loadConfig, updateConfig } from './config'
import { IPC } from './ipc'
import { capabilityManager } from './capability-manager'
import { tmuxManager } from './tmux-manager'
import { wslBridge } from './wsl-bridge'
import { setRuntimeEntry, listRuntimeEntries, removeRuntimeEntry } from './runtime-registry'
import type { Capability, AppConfig, RuntimeDiagnostics } from '../shared/types'

let mainWindow: BrowserWindow | null = null
let processManager: ProcessManager | null = null
let bootCapability: Capability | null = null

type ThemeMode = AppConfig['theme']

function resolveEffectiveTheme(theme: ThemeMode): 'light' | 'dark' {
  if (theme === 'system') {
    return nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
  }
  return theme
}

function getWindowBackgroundColor(theme: ThemeMode): string {
  return resolveEffectiveTheme(theme) === 'dark' ? '#09090b' : '#f5f7fb'
}

function applyWindowBackground(theme: ThemeMode): void {
  if (!mainWindow) return
  mainWindow.setBackgroundColor(getWindowBackgroundColor(theme))
}

function sendAiCommitOutput(projectId: string, data: string): void {
  mainWindow?.webContents.send(IPC.AI_COMMIT_OUTPUT, { projectId, data })
}

function sendAiCommitStatus(projectId: string, status: 'running' | 'success' | 'error'): void {
  mainWindow?.webContents.send(IPC.AI_COMMIT_STATUS, { projectId, status })
}

interface AiCommitRunOverride {
  split?: boolean
  splitMaxBatches?: number
}

async function runAiCommit(
  projectId: string,
  projectPath: string,
  override?: AiCommitRunOverride
): Promise<boolean> {
  const config = loadConfig()
  const aiCfgRaw = config.aiCommit || {}
  const aiCfg = {
    ...aiCfgRaw,
    split: typeof override?.split === 'boolean' ? override.split : aiCfgRaw.split,
    splitMaxBatches: typeof override?.splitMaxBatches === 'number'
      ? override.splitMaxBatches
      : aiCfgRaw.splitMaxBatches,
  }
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
  const scriptPs1Path = join(__dirname, '../../skills/auto-git-commit/scripts/auto_commit.ps1')
  const scriptShPath = join(__dirname, '../../skills/auto-git-commit/scripts/auto_commit.sh')
  const wslTarget = process.platform === 'win32' ? resolveWslVsCodeTarget(projectPath) : null

  sendAiCommitStatus(projectId, 'running')
  sendAiCommitOutput(projectId, `\r\n[AI Commit] Starting in ${projectPath}\r\n`)
  sendAiCommitOutput(
    projectId,
    `[AI Commit] mode: ${splitEnabled ? `split (max batches=${splitMaxBatches})` : 'single'}\r\n`
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

    if (aiCfg.apiBaseUrl && aiCfg.apiBaseUrl.trim()) {
      windowsPsArgs.push('-ApiBaseUrl', aiCfg.apiBaseUrl.trim())
    }
    if (aiCfg.apiKey && aiCfg.apiKey.trim()) {
      windowsPsArgs.push('-ApiKey', aiCfg.apiKey.trim())
    }
    if (aiCfg.model && aiCfg.model.trim()) {
      windowsPsArgs.push('-Model', aiCfg.model.trim())
    }

    const spawnWindowsPowerShell = (cmd: string) =>
      spawn(cmd, windowsPsArgs, {
        cwd: projectPath,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
      })

    const quoteBash = (value: string) => `'${quoteBashSingle(value)}'`
    let child = (() => {
      if (wslTarget) {
        const linuxProjectPath = wslTarget.linuxPath
        const scriptShWslPath = wslBridge.toWslPath(scriptShPath)
        const wslBashParts: string[] = [
          'bash',
          quoteBash(scriptShWslPath),
          '--all',
        ]
        if (aiCfg.enabled ?? true) {
          wslBashParts.push('--use-ai')
        }
        if (aiCfg.apiBaseUrl && aiCfg.apiBaseUrl.trim()) {
          wslBashParts.push('--api-base-url', quoteBash(aiCfg.apiBaseUrl.trim()))
        }
        if (aiCfg.apiKey && aiCfg.apiKey.trim()) {
          wslBashParts.push('--api-key', quoteBash(aiCfg.apiKey.trim()))
        }
        if (aiCfg.model && aiCfg.model.trim()) {
          wslBashParts.push('--model', quoteBash(aiCfg.model.trim()))
        }
        if (splitEnabled) {
          wslBashParts.push('--split', '--split-max-batches', String(splitMaxBatches))
        }

        const wslCommand = [
          'set -euo pipefail',
          `cd ${quoteBash(linuxProjectPath)}`,
          'echo "[AI Commit] shell: wsl-bash"',
          `  ${wslBashParts.join(' ')}`,
        ].join('\n')

        return spawn(
          'wsl.exe',
          ['-d', wslTarget.distro, '--', 'bash', '-lc', wslCommand],
          {
            shell: false,
            stdio: ['ignore', 'pipe', 'pipe'],
          }
        )
      }

      return spawnWindowsPowerShell('pwsh')
    })()

    let started = false
    const allowWindowsFallback = !wslTarget
    let switchedToWindowsPowerShell = false

    const stdoutDecoder = new StringDecoder('utf8')
    const stderrDecoder = new StringDecoder('utf8')

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
      if (!wslTarget) {
        sendAiCommitOutput(projectId, '[AI Commit] shell: pwsh\r\n')
      }
      attachStreams()
    })

    child.on('error', (err) => {
      if (!started && allowWindowsFallback && !switchedToWindowsPowerShell) {
        switchedToWindowsPowerShell = true
        sendAiCommitOutput(projectId, `[AI Commit] pwsh unavailable, fallback to powershell.exe (${err.message})\r\n`)
        child = spawnWindowsPowerShell('powershell.exe')
        child.on('spawn', () => {
          sendAiCommitOutput(projectId, '[AI Commit] shell: powershell.exe\r\n')
          attachStreams()
        })
        child.on('error', (fallbackErr) => {
          sendAiCommitOutput(projectId, `[AI Commit] process error: ${fallbackErr.message}\r\n`)
          sendAiCommitStatus(projectId, 'error')
          resolve(false)
        })
        child.on('close', (code) => {
          const tailOut = stdoutDecoder.end()
          if (tailOut) {
            sendAiCommitOutput(projectId, tailOut.replace(/\r?\n/g, '\r\n'))
          }
          const tailErr = stderrDecoder.end()
          if (tailErr) {
            sendAiCommitOutput(projectId, tailErr.replace(/\r?\n/g, '\r\n'))
          }
          const ok = code === 0
          sendAiCommitOutput(projectId, `[AI Commit] finished with code ${code}\r\n`)
          sendAiCommitStatus(projectId, ok ? 'success' : 'error')
          resolve(ok)
        })
        return
      }
      sendAiCommitOutput(projectId, `[AI Commit] process error: ${err.message}\r\n`)
      sendAiCommitStatus(projectId, 'error')
      resolve(false)
    })

    child.on('close', (code) => {
      const tailOut = stdoutDecoder.end()
      if (tailOut) {
        sendAiCommitOutput(projectId, tailOut.replace(/\r?\n/g, '\r\n'))
      }
      const tailErr = stderrDecoder.end()
      if (tailErr) {
        sendAiCommitOutput(projectId, tailErr.replace(/\r?\n/g, '\r\n'))
      }
      const ok = code === 0
      sendAiCommitOutput(projectId, `[AI Commit] finished with code ${code}\r\n`)
      sendAiCommitStatus(projectId, ok ? 'success' : 'error')
      resolve(ok)
    })
  })
}

function runtimeLauncherScript(): string {
  return loadConfig().runtimeLauncherScript || '$HOME/tools/claude-code-script/start-claude-with-env.sh'
}

function expandWslHomePath(pathValue: string): string {
  const normalized = pathValue.trim()
  if (!normalized) return normalized

  const wslHome = bootCapability?.wslEnv?.HOME
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

function resolveWslVsCodeTarget(pathValue: string): { distro: string; linuxPath: string } | null {
  const normalized = pathValue.trim().replace(/\\/g, '/')
  if (!normalized) return null

  const uncWsl = normalized.match(/^\/\/(?:wsl\.localhost|wsl\$)\/([^/]+)\/?(.*)$/i)
  if (uncWsl) {
    const distro = uncWsl[1]
    const rest = uncWsl[2] ?? ''
    const linuxPath = rest ? `/${rest.replace(/^\/+/, '')}` : '/'
    return { distro, linuxPath }
  }

  if (normalized.startsWith('/')) {
    // /mnt/<drive>/... maps to Windows drives and should open locally.
    if (/^\/mnt\/[a-z](?:\/|$)/i.test(normalized)) {
      return null
    }
    return {
      distro: bootCapability?.wslDistro || 'Ubuntu',
      linuxPath: normalized,
    }
  }

  // Accept linux paths that miss the leading slash, e.g. "mnt/d/workspace".
  // These are Windows-mounted paths in WSL form and should open locally.
  const noLeadingSlash = normalized.replace(/^\/+/, '')
  if (/^mnt\/[a-z](?:\/|$)/i.test(noLeadingSlash)) {
    return null
  }

  return null
}

function resolveLocalVsCodePath(pathValue: string): string {
  const normalized = pathValue.trim().replace(/\\/g, '/')
  if (!normalized) return pathValue

  const noLeadingSlash = normalized.replace(/^\/+/, '')
  if (/^mnt\/[a-z](?:\/|$)/i.test(noLeadingSlash)) {
    return wslBridge.toWindowsPath(`/${noLeadingSlash}`)
  }

  return pathValue
}

function toWslAuthority(distro: string): string {
  return `wsl+${distro}`
}

function asFolderPath(pathValue: string): string {
  return pathValue.endsWith('/') ? pathValue : `${pathValue}/`
}

function spawnVsCode(args: string[], onError?: (err: Error) => void): void {
  const primaryCmd = process.platform === 'win32' ? 'code.cmd' : 'code'
  const fallbackCmd = 'code'

  const spawnWith = (cmd: string, allowFallback: boolean) => {
    const child = spawn(cmd, args, {
      detached: true,
      shell: true,
      stdio: 'ignore',
    })

    child.on('error', (err) => {
      console.error(`[open-vscode] failed command="${cmd}" args=${JSON.stringify(args)} error=${err.message}`)
      if (allowFallback && cmd !== fallbackCmd) {
        spawnWith(fallbackCmd, false)
      } else {
        onError?.(err)
      }
    })

    child.unref()
  }

  spawnWith(primaryCmd, true)
}

function spawnVsCodeViaWsl(distro: string, linuxFolder: string): void {
  const escapedPath = quoteBashSingle(linuxFolder)
  const command = `cd '${escapedPath}' && code .`
  const child = spawn(
    'wsl.exe',
    ['-d', distro, '--', 'bash', '-lc', command],
    {
      detached: true,
      windowsHide: true,
      stdio: 'ignore',
    }
  )
  child.on('error', (err) => {
    console.error(`[open-vscode] wsl fallback failed distro="${distro}" path="${linuxFolder}" error=${err.message}`)
  })
  child.unref()
}

async function diagnoseRuntime(): Promise<RuntimeDiagnostics> {
  const scriptPath = resolvedRuntimeLauncherScript()
  const issues: string[] = []
  const hasWsl = bootCapability?.hasWsl ?? false
  const hasTmux = bootCapability?.hasTmux ?? false
  const distro = bootCapability?.wslDistro
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

/** Focus a Windows Terminal window whose title contains the session name
  *   (tmux set-titles produces "{sessionName}:{windowName}" e.g. "ide-electron-69fdda:bash") */
function focusTerminalWindow(sessionName: string): void {
  const match = sessionName

  console.log(`[focusTerminalWindow] sessionName="${sessionName}" match="${match}"`)

  const ps1File = join(tmpdir(), `focus-terminal-${Date.now()}.ps1`).replace(/\\/g, '/')

  // PS script writes results to stdout — no log file, no detached-process quirks
  const ps = [
    '$ErrorActionPreference = "Stop"',
    `$match = '${match}'`,
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
    '} else {',
    '  Write-Output "NOT FOUND"',
    '}',
  ].join('\r\n')

  writeFileSync(ps1File, ps, 'utf-8')

  // Don't detach — we want stdio pipes to work. unref() lets the app exit without waiting.
  const child = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps1File], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let stdout = ''
  let stderr = ''

  child.stdout!.on('data', (d: Buffer) => { stdout += d.toString() })
  child.stderr!.on('data', (d: Buffer) => { stderr += d.toString() })

  child.on('error', (err) => {
    console.error('[focusTerminalWindow] spawn failed:', err.message)
  })

  child.on('close', (code) => {
    console.log(`[focusTerminalWindow] PS exited code=${code}`)
    if (stdout.trim()) console.log('[focusTerminalWindow PS stdout]\n', stdout.trim())
    else console.log('[focusTerminalWindow PS stdout] EMPTY')
    if (stderr.trim()) console.log('[focusTerminalWindow PS stderr]\n', stderr.trim())
    try { unlinkSync(ps1File) } catch { /* best effort */ }
  })

  child.unref()
}

function createWindow(): void {
  const config = loadConfig()

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: getWindowBackgroundColor(config.theme),
    icon: join(__dirname, '../../icon/Y.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    show: false,
  })

  mainWindow.setMenuBarVisibility(false)

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  if (processManager) {
    processManager.setOutputWindow(mainWindow)
  }

  registerIpcHandlers()

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function registerIpcHandlers(): void {
  ipcMain.handle(IPC.DETECT_DIRECTORY, (_event, dirPath: string) => {
    return detectProject(dirPath)
  })

  ipcMain.handle(
    IPC.PROCESS_START,
    (_event, projectId: string, command: string, cwd: string, useWsl?: boolean) => {
      return processManager?.start(projectId, command, cwd, useWsl) ?? false
    }
  )

  ipcMain.handle(IPC.PROCESS_STOP, (_event, projectId: string) => {
    return processManager?.stop(projectId) ?? false
  })

  ipcMain.handle(
    IPC.PROCESS_INPUT,
    (_event, projectId: string, data: string) => {
      processManager?.sendInput(projectId, data)
      return true
    }
  )

  ipcMain.handle(IPC.PROCESS_RESIZE, (_event, projectId: string, cols: number, rows: number) => {
    processManager?.resize(projectId, cols, rows)
    return true
  })

  ipcMain.handle(IPC.CONFIG_GET, () => {
    return loadConfig()
  })

  ipcMain.on(IPC.CONFIG_GET_THEME_SYNC, (event) => {
    event.returnValue = loadConfig().theme
  })

  ipcMain.handle(
    IPC.CONFIG_SET,
    (_event, partial: Record<string, unknown>) => {
      const updated = updateConfig(
        partial as Partial<AppConfig> & { startupDefaultTagId?: string }
      )
      if (Object.prototype.hasOwnProperty.call(partial, 'theme')) {
        applyWindowBackground(updated.theme)
      }
      return updated
    }
  )

  ipcMain.handle(IPC.AI_COMMIT_RUN, async (_event, projectId: string, projectPath: string, override?: AiCommitRunOverride) => {
    return runAiCommit(projectId, projectPath, override)
  })

  ipcMain.handle(IPC.SHELL_OPEN_EXTERNAL, (_event, url: string) => {
    return shell.openExternal(url)
  })

  ipcMain.handle(IPC.SHELL_OPEN_FOLDER, async (_event, folderPath: string) => {
    const err = await shell.openPath(folderPath)
    if (err) throw new Error(`Failed to open folder: ${err}`)
  })

  ipcMain.handle(IPC.SHELL_OPEN_VSCODE, (_event, folderPath: string) => {
    const wslTarget = resolveWslVsCodeTarget(folderPath)
    if (wslTarget) {
      const distro = wslTarget.distro
      const linuxFolder = asFolderPath(wslTarget.linuxPath)

      // Prefer official WSL remote syntax from Windows CLI:
      //   code --remote wsl+<distro> <path in WSL>
      // Fallback path for edge cases remains folder-uri.
      const remoteArgs = ['--remote', toWslAuthority(distro), linuxFolder]
      spawnVsCode(remoteArgs, () => {
        spawnVsCodeViaWsl(distro, linuxFolder)
      })
      return
    }

    const localPath = resolveLocalVsCodePath(folderPath)
    spawnVsCode([localPath])
  })

  ipcMain.handle(IPC.DIALOG_SELECT_DIRECTORY, async () => {
    if (!mainWindow) return null
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
    })
    if (!result.canceled && result.filePaths.length > 0) {
      return result.filePaths[0]
    }
    return null
  })

  // ── Runtime Manager ──────────────────────────────────────

  ipcMain.handle(
    IPC.RUNTIME_START,
    async (_event, projectId: string, projectPath: string, cli?: 'claude' | 'codex') => {
      const diag = await diagnoseRuntime()
      if (diag.issues.length > 0) {
        console.error('[runtime:start] diagnostics failed:', diag.issues.join(' | '))
        return false
      }

      const distro = bootCapability?.wslDistro || 'Ubuntu'
      const wslPath = wslBridge.toWslPath(projectPath)

      // Match the script's session naming: basename + first 6 chars of MD5(path)
      const md5 = createHash('md5').update(wslPath).digest('hex').slice(0, 6)
      const sessionName = `${basename(projectPath)}-${md5}`

      // Build CLI tool flag for the launcher script
      const cliFlag = cli === 'codex' ? ' --cli codex' : ''
      const launcher = quoteBashSingle(resolvedRuntimeLauncherScript())

      return new Promise<boolean>((resolve) => {
        const child = spawn(
          'wsl.exe',
          [
            '-d',
            distro,
            '--',
            'bash',
            '-lc',
            `'${launcher}'${cliFlag} '${quoteBashSingle(wslPath)}'`
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

          resolve(true)
        })

        child.unref()
      })
    }
  )

  ipcMain.handle(IPC.SHELL_OPEN_TERMINAL, async (_event, sessionName: string, statusHint?: string) => {
    console.log(`[open-terminal] sessionName="${sessionName}" statusHint=${statusHint ?? 'none'}`)

    // Fast path: renderer already knows session is attached — skip WSL checks entirely
    if (statusHint === 'attached') {
      console.log('[open-terminal] fast path — skipping WSL, focusing directly')
      focusTerminalWindow(sessionName)
      return true
    }

    // Slow path: check tmux session existence and client count via WSL
    const exists = await tmuxManager.sessionExists(sessionName)
    console.log(`[open-terminal] sessionExists=${exists}`)
    if (!exists) return false

    const clients = await tmuxManager.countClients(sessionName)
    console.log(`[open-terminal] clients=${clients}`)
    if (clients > 0) {
      focusTerminalWindow(sessionName)
      return true
    }

    const distro = bootCapability?.wslDistro || 'Ubuntu'

    return new Promise<boolean>((resolve) => {
      const child = spawn('wt.exe', [
        'wsl', '-d', distro,
        '--', 'bash', '-c',
        `exec tmux attach-session -t '${sessionName}'`
      ], {
        detached: true,
        stdio: 'ignore',
      })

      child.on('error', (err) => {
        console.error('[runtime:open-terminal] spawn failed:', err.message)
        resolve(false)
      })

      child.on('close', () => resolve(true))

      child.unref()
    })
  })

  ipcMain.handle(IPC.RUNTIME_LIST_ENTRIES, () => {
    return listRuntimeEntries()
  })

  ipcMain.handle(IPC.RUNTIME_DIAGNOSTICS, async () => {
    return diagnoseRuntime()
  })

  // ── WSL / tmux ──────────────────────────────────────────

  ipcMain.handle(IPC.WSL_GET_CAPABILITY, () => {
    return bootCapability
  })

  ipcMain.handle(IPC.TMUX_LIST_SESSIONS, () => {
    return tmuxManager.listLauncherSessions()
  })

  ipcMain.handle(IPC.TMUX_KILL_SESSION, (_event, sessionName: string) => {
    return tmuxManager.killSession(sessionName)
  })

}

// ── before-quit ───────────────────────────────────────────

let isQuitting = false

app.on('before-quit', async (e) => {
  if (isQuitting) return
  e.preventDefault()
  isQuitting = true

  const { runtimeKeepAliveOnQuit = false } = loadConfig()
  const runtimeEntries = listRuntimeEntries()

  if (!runtimeKeepAliveOnQuit) {
    // Only clean sessions associated with this app registry; avoid touching unrelated tmux sessions.
    const ownSessionNames = runtimeEntries.map((entry) => entry.sessionName).filter(Boolean)
    try {
      await tmuxManager.killSessions(ownSessionNames)
    } catch (err) {
      console.error('[before-quit] failed to clean app runtime sessions:', err)
    }

    // Drop registry entries on graceful exit to avoid stale mappings on next boot.
    for (const entry of runtimeEntries) {
      removeRuntimeEntry(entry.projectId)
    }
  }

  processManager?.stopAll()

  setTimeout(() => {
    app.quit()
  }, 1500)
})

// ── startup ──────────────────────────────────────────────

app.whenReady().then(async () => {
  nativeTheme.on('updated', () => {
    const { theme } = loadConfig()
    if (theme === 'system') {
      applyWindowBackground(theme)
    }
  })

  // P0 1: One-time capability probe
  await capabilityManager.init()
  bootCapability = capabilityManager.get()

  // Create ProcessManager with capability injected
  processManager = new ProcessManager(bootCapability)

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
