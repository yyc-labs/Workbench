import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron'
import { join, basename } from 'path'
import { createHash } from 'crypto'
import { spawn } from 'child_process'
import { tmpdir } from 'os'
import { writeFileSync, unlinkSync } from 'fs'
import { ProcessManager } from './runner'
import { detectProject } from './detector'
import { loadConfig, updateConfig } from './config'
import { IPC } from './ipc'
import { capabilityManager } from './capability-manager'
import { tmuxManager } from './tmux-manager'
import { wslBridge } from './wsl-bridge'
import { setRuntimeEntry, listRuntimeEntries, removeRuntimeEntry } from './runtime-registry'
import type { Capability } from '../shared/types'

let mainWindow: BrowserWindow | null = null
let processManager: ProcessManager | null = null
let bootCapability: Capability | null = null

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
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
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

  ipcMain.handle(
    IPC.CONFIG_SET,
    (_event, partial: Record<string, unknown>) => {
      return updateConfig(partial as Partial<{ projects: never; theme: 'system' | 'light' | 'dark' }>)
    }
  )

  ipcMain.handle(IPC.SHELL_OPEN_EXTERNAL, (_event, url: string) => {
    return shell.openExternal(url)
  })

  ipcMain.handle(IPC.SHELL_OPEN_FOLDER, async (_event, folderPath: string) => {
    const err = await shell.openPath(folderPath)
    if (err) throw new Error(`Failed to open folder: ${err}`)
  })

  ipcMain.handle(IPC.SHELL_OPEN_VSCODE, (_event, folderPath: string) => {
    spawn('code', [folderPath], { detached: true, shell: true, stdio: 'ignore' }).unref()
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
    async (_event, projectId: string, projectPath: string) => {
      const distro = bootCapability?.wslDistro || 'Ubuntu'
      const wslPath = wslBridge.toWslPath(projectPath)

      // Match the script's session naming: basename + first 6 chars of MD5(path)
      const md5 = createHash('md5').update(wslPath).digest('hex').slice(0, 6)
      const sessionName = `${basename(projectPath)}-${md5}`

      return new Promise<boolean>((resolve) => {
        const child = spawn(
          'wsl.exe',
          [
            '-d',
            distro,
            '--',
            'bash',
            '-lc',
            `$HOME/tools/claude-code-script/start-claude-with-env.sh '${wslPath}'`
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

  ipcMain.handle(IPC.TMUX_REHYDRATE, () => {
    return tmuxManager.rehydrate()
  })
}

// ── before-quit ───────────────────────────────────────────

let isQuitting = false

app.on('before-quit', async (e) => {
  if (isQuitting) return
  e.preventDefault()
  isQuitting = true

  // Kill tmux sessions first (async, but we don't await — best-effort)
  tmuxManager.killAllLauncherSessions()

  processManager?.stopAll()

  setTimeout(() => {
    app.quit()
  }, 1500)
})

// ── startup ──────────────────────────────────────────────

app.whenReady().then(async () => {
  // P0 1: One-time capability probe
  await capabilityManager.init()
  bootCapability = capabilityManager.get()

  // P0 2: Rehydrate tmux sessions if available
  if (bootCapability.backend === 'tmux') {
    await tmuxManager.rehydrate()
  }

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
