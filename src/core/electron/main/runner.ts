import { spawn as spawnChild, spawnSync, type ChildProcess } from 'child_process'
import { basename } from 'path'
import type { BrowserWindow } from 'electron'
import type { IPty } from 'node-pty'
import type { BackendMode, Capability, ManagedProcessSnapshot, PtySize, TerminalInventoryEvent, TerminalInventorySnapshot } from '../../shared/types'
import { parseRunTaskProcessKey } from '../../shared/runTasks'
import { toHostAccessiblePath } from './host-path'
import { wslBridge } from './wsl-bridge'
import { tmuxManager, getSessionName } from './tmux-manager'
import { ResizeController } from './resize-controller'
import { buildWindowsAutomationShellLaunch } from './shell/windows-shell'

function resolveWindowsSystemExecutable(command: string): string {
  const trimmed = command.trim()
  const normalized = trimmed.toLowerCase()
  if (!trimmed || trimmed.includes('\\') || trimmed.includes('/')) {
    return command
  }

  const systemRoot = (process.env.SystemRoot || process.env.WINDIR || process.env.windir || 'C:\\Windows').replace(/[\\/]+$/, '')
  const system32 = `${systemRoot}\\System32`

  if (normalized === 'cmd.exe' || normalized === 'cmd') {
    return process.env.ComSpec || process.env.comspec || `${system32}\\cmd.exe`
  }
  if (normalized === 'powershell.exe' || normalized === 'powershell') {
    return `${system32}\\WindowsPowerShell\\v1.0\\powershell.exe`
  }
  if (normalized === 'wsl.exe' || normalized === 'wsl') {
    return `${system32}\\wsl.exe`
  }

  return command
}

export const IPC_CHANNELS = {
  PROCESS_OUTPUT: 'process:output',
  PROCESS_STATUS: 'process:status',
  PROCESS_EXIT: 'process:exit',
  TERMINAL_INVENTORY_CHANGED: 'terminal:inventory-changed',
} as const

/**
 * pty 兜底初始尺寸：调用方（renderer）未提供 initialSize 时使用。
 * renderer 正常会按集合面板终端区域的预测尺寸传入（见 lib/terminalViewportSize.ts），
 * 避免 shell 在默认 80x24 下先渲染 prompt、视图挂载后再 resize 触发 conpty reflow
 * 导致长路径 prompt 换行错位与输入回显位置错误。
 */
const DEFAULT_PTY_COLS = 80
const DEFAULT_PTY_ROWS = 24

interface PtyManagedProcess {
  pty: IPty
  projectId: string
  sessionName?: string
  startTime: number
  backend: 'tmux' | 'wsl-pty' | 'direct-pty'
}

interface SpawnManagedProcess {
  child: ChildProcess
  projectId: string
  startTime: number
  backend: 'spawn'
  stdoutDecoder: ProcessOutputDecoder
  stderrDecoder: ProcessOutputDecoder
}

class ProcessOutputDecoder {
  private utf8 = new TextDecoder('utf-8', { fatal: false })
  private gb18030 = new TextDecoder('gb18030', { fatal: false })
  private pending: Uint8Array = new Uint8Array(0)
  private usedGbFallback = false

  decodeChunk(chunk: Buffer): string {
    const input = this.mergePending(chunk)
    if (input.length === 0) return ''

    // Keep a short tail to avoid splitting multibyte chars across chunks.
    const holdSize = Math.min(8, input.length)
    const payload = input.subarray(0, input.length - holdSize)
    this.pending = input.subarray(input.length - holdSize)

    return this.decodeBuffer(payload)
  }

  flush(): string {
    if (this.pending.length === 0) return ''
    const tail = this.pending
    this.pending = new Uint8Array(0)
    return this.decodeBuffer(tail)
  }

  private mergePending(chunk: Buffer): Uint8Array {
    const curr = new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength)
    if (this.pending.length === 0) return curr

    const merged = new Uint8Array(this.pending.length + curr.length)
    merged.set(this.pending, 0)
    merged.set(curr, this.pending.length)
    return merged
  }

  private decodeBuffer(bytes: Uint8Array): string {
    if (bytes.length === 0) return ''

    if (this.usedGbFallback) {
      return this.gb18030.decode(bytes, { stream: true })
    }

    const utf8Text = this.utf8.decode(bytes, { stream: true })
    if (!utf8Text.includes('�')) {
      return utf8Text
    }

    const gbText = this.gb18030.decode(bytes, { stream: true })
    const utf8BadCount = (utf8Text.match(/�/g) || []).length
    const gbBadCount = (gbText.match(/�/g) || []).length

    if (gbBadCount < utf8BadCount) {
      this.usedGbFallback = true
      return gbText
    }

    return utf8Text
  }
}

class ProcessManager {
  private processes = new Map<string, PtyManagedProcess | SpawnManagedProcess>()
  private stopping = new Set<string>()
  private resizeCtrls = new Map<string, ResizeController>()
  private outputWindow: BrowserWindow | null = null
  private capability: Capability
  /** Direct output consumers (e.g. run-task scheduler) independent of the IPC window path. */
  private outputTaps = new Set<(processId: string, data: string) => void>()
  private exitTaps = new Set<(processId: string, code: number | null) => void>()
  /** 清单版本号：每次 Map 变化递增；快照与增量事件共用，renderer 据此丢弃旧快照。 */
  private inventoryRevision = 0

  constructor(capability: Capability) {
    this.capability = capability
  }

  addOutputTap(cb: (processId: string, data: string) => void): () => void {
    this.outputTaps.add(cb)
    return () => this.outputTaps.delete(cb)
  }

  addExitTap(cb: (processId: string, code: number | null) => void): () => void {
    this.exitTaps.add(cb)
    return () => this.exitTaps.delete(cb)
  }

  private emitOutput(processId: string, data: string): void {
    for (const tap of this.outputTaps) {
      try {
        tap(processId, data)
      } catch {
        /* consumer error must not break the process path */
      }
    }
  }

  private emitExit(processId: string, code: number | null): void {
    for (const tap of this.exitTaps) {
      try {
        tap(processId, code)
      } catch {
        /* consumer error must not break the process path */
      }
    }
  }

  updateCapability(capability: Capability): void {
    this.capability = capability
  }

  get backend(): BackendMode {
    return this.capability.backend
  }

  setOutputWindow(win: BrowserWindow | null): void {
    this.outputWindow = win
  }

  private getDefaultWslDistro(): string {
    return this.capability.wslDistro || 'Ubuntu'
  }

  // ── public API ──────────────────────────────────────────

  private isWslUncPath(pathValue: string): boolean {
    const normalized = pathValue.replace(/\\/g, '/')
    return /^\/\/(?:wsl\.localhost|wsl\$)\//i.test(normalized)
  }

  start(projectId: string, command: string, cwd: string, useWsl?: boolean, initialSize?: PtySize): boolean {
    if (this.processes.has(projectId)) return false

    try {
      return this.startResolved(projectId, command, cwd, useWsl, initialSize)
    } catch (err) {
      this.send(IPC_CHANNELS.PROCESS_OUTPUT, {
        projectId,
        data: `Error: ${err instanceof Error ? err.message : String(err)}\n`,
      })
      this.send(IPC_CHANNELS.PROCESS_STATUS, { projectId, status: 'error' })
      return false
    }
  }

  private startResolved(projectId: string, command: string, cwd: string, useWsl?: boolean, initialSize?: PtySize): boolean {
    // UNC WSL paths cannot be used as cwd for cmd.exe.
    // Force WSL backend even when UI requested host-native mode.
    const forceWslForPath = process.platform === 'win32' && this.capability.hasWsl && this.isWslUncPath(cwd)

    // Per-process environment override: Windows-native vs WSL
    if (forceWslForPath) {
      return this.startWithPty(projectId, command, cwd, initialSize)
    }
    if (useWsl === false && process.platform === 'win32') {
      return this.startHostNative(projectId, command, cwd, initialSize)
    }
    if (useWsl === true) {
      if (!this.capability.hasWsl) return false
      return this.startWithPty(projectId, command, cwd, initialSize)
    }

    switch (this.capability.backend) {
      case 'tmux':
      case 'direct-pty':
        if (process.platform === 'win32') {
          return this.startHostNative(projectId, command, cwd, initialSize)
        }
        return this.startWithPty(projectId, command, cwd, initialSize)
      default:
        return this.startWithSpawn(projectId, command, cwd)
    }
  }

  stop(projectId: string): boolean {
    if (this.stopping.has(projectId)) return true

    const managed = this.processes.get(projectId)
    if (!managed) return false

    this.stopping.add(projectId)

    // 乐观关闭：stop 一被接受立即推 remove 事件（列表即时消失，无需等待杀死完成），
    // stopping 中的键同时对清单快照不可见（getInventorySnapshot 过滤）。
    this.emitInventoryRemove(projectId)

    const safetyPid = managed.backend === 'spawn' ? managed.child.pid : managed.pty.pid

    if (managed.backend === 'spawn') {
      // spawn 兜底后端：stopSpawn 本身已是直接强杀（win32 taskkill /t /f；
      // POSIX SIGTERM → 2s SIGKILL），这里只保留 exit 永不到来的最后安全网。
      setTimeout(() => {
        if (!this.stopping.has(projectId)) return
        if (typeof safetyPid === 'number' && Number.isFinite(safetyPid)) {
          this.killProcessTreeImmediate(safetyPid)
        }
        console.warn(`[runner] stop safety net fired for "${projectId}" (pid ${safetyPid ?? 'unknown'}); force-killed process tree`)
        this.cleanupStoppedProcess(projectId)
        this.send(IPC_CHANNELS.PROCESS_STATUS, { projectId, status: 'stopped' })
        this.send(IPC_CHANNELS.PROCESS_EXIT, { projectId, code: null })
      }, 3500)
      return this.stopSpawn(managed as SpawnManagedProcess)
    }

    this.stopPty(managed as PtyManagedProcess, safetyPid)
    return true
  }

  stopAllWithCount(): number {
    const ids = [...this.processes.keys()]
    for (const processId of ids) {
      this.stop(processId)
    }
    return ids.length
  }

  /**
   * 退出路径专用：同步强杀全部托管进程。不写 Ctrl+C、不等宽限定时器——
   * stop() 的延迟 kill 在 app.quit() 前可能来不及触发，会留下孤儿 shell。
   */
  stopAllImmediate(): void {
    for (const managed of this.processes.values()) {
      try {
        if (managed.backend === 'spawn') {
          this.stopSpawnImmediate(managed as SpawnManagedProcess)
        } else {
          this.stopPtyImmediate(managed as PtyManagedProcess)
        }
      } catch {
        /* 尽力而为，逐个继续 */
      }
    }
    this.resizeCtrls.forEach((ctrl) => ctrl.dispose())
    this.resizeCtrls.clear()
    this.processes.clear()
    this.stopping.clear()
  }

  private stopSpawnImmediate(managed: SpawnManagedProcess): void {
    const pid = managed.child.pid
    if (pid != null) this.killProcessTreeImmediate(pid)
    try {
      managed.child.kill()
    } catch {
      /* already dead */
    }
  }

  private stopPtyImmediate(managed: PtyManagedProcess): void {
    const pid = managed.pty.pid
    if (typeof pid === 'number' && Number.isFinite(pid)) this.killProcessTreeImmediate(pid)
    try {
      managed.pty.kill()
    } catch {
      /* already dead */
    }
  }

  /** 同步杀整棵进程树：Windows 用 taskkill /t /f，POSIX 杀进程组（node-pty 子进程是会话首进程）。 */
  private killProcessTreeImmediate(pid: number): void {
    try {
      if (process.platform === 'win32') {
        spawnSync('taskkill', ['/pid', String(pid), '/t', '/f'], { stdio: 'ignore', windowsHide: true })
      } else {
        try {
          process.kill(-pid, 'SIGKILL')
        } catch {
          /* 非进程组长 */
        }
        try {
          process.kill(pid, 'SIGKILL')
        } catch {
          /* already dead */
        }
      }
    } catch {
      /* ignore */
    }
  }

  sendInput(projectId: string, data: string): void {
    const managed = this.processes.get(projectId)
    if (!managed) return

    if (managed.backend === 'spawn') {
      ;(managed as SpawnManagedProcess).child.stdin?.write(data)
    } else {
      ;(managed as PtyManagedProcess).pty.write(data)
    }
  }

  resize(projectId: string, cols: number, rows: number): void {
    const ctrl = this.resizeCtrls.get(projectId)
    if (ctrl) {
      ctrl.emit({ cols, rows })
    }
  }

  isRunning(projectId: string): boolean {
    return this.processes.has(projectId)
  }

  /**
   * 原始清单（含 stopping 中的进程）。与 getInventorySnapshot 的有意差异：
   * float key 分配必须看到正在死掉的进程，否则会复用其 key 撞上 start 重键拒绝。
   */
  listManagedProcesses(): ManagedProcessSnapshot[] {
    const result: ManagedProcessSnapshot[] = []

    for (const [processId, managed] of this.processes.entries()) {
      result.push(this.toManagedSnapshot(processId, managed))
    }

    return result
  }

  /** 轻量清单快照：只读内存 Map（不查 WSL/tmux），带版本号供 renderer 建立基线。 */
  getInventorySnapshot(): TerminalInventorySnapshot {
    const managedProcesses: ManagedProcessSnapshot[] = []
    for (const [processId, managed] of this.processes.entries()) {
      // 停止中（stop 入口已推 remove）的键对清单不可见：
      // 否则停止窗口内的快照会把正在关闭的终端「复活」。
      if (this.stopping.has(processId)) continue
      managedProcesses.push(this.toManagedSnapshot(processId, managed))
    }
    return { revision: this.inventoryRevision, managedProcesses }
  }

  private toManagedSnapshot(processId: string, managed: PtyManagedProcess | SpawnManagedProcess): ManagedProcessSnapshot {
    // Run-task keys look like `${projectId}::run::<taskId>` — report the bare
    // projectId so consumers can group a project's processes together.
    const projectId = parseRunTaskProcessKey(processId)?.projectId ?? managed.projectId
    if (managed.backend === 'spawn') {
      const spawnManaged = managed as SpawnManagedProcess
      return {
        processId,
        projectId,
        backend: spawnManaged.backend,
        pid: spawnManaged.child.pid ?? null,
        startTime: spawnManaged.startTime,
      }
    }

    const ptyManaged = managed as PtyManagedProcess
    return {
      processId,
      projectId,
      backend: ptyManaged.backend,
      pid: null,
      startTime: ptyManaged.startTime,
      sessionName: ptyManaged.sessionName,
    }
  }

  /** 进程 Map 变化 → 推送增量清单事件（upsert/remove），renderer 不再轮询整张清单。 */
  private emitInventoryChange(event: { type: 'upsert'; process: ManagedProcessSnapshot } | { type: 'remove'; processKey: string }): void {
    this.inventoryRevision += 1
    this.send(IPC_CHANNELS.TERMINAL_INVENTORY_CHANGED, { ...event, revision: this.inventoryRevision } as TerminalInventoryEvent)
  }

  private emitInventoryUpsert(processId: string): void {
    const managed = this.processes.get(processId)
    if (!managed) return
    this.emitInventoryChange({ type: 'upsert', process: this.toManagedSnapshot(processId, managed) })
  }

  private emitInventoryRemove(processId: string): void {
    this.emitInventoryChange({ type: 'remove', processKey: processId })
  }

  // ── PTY helpers ─────────────────────────────────────────

  private getPtySpawn(): (cmd: string, args: string[], opts: Record<string, unknown>) => IPty {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('node-pty').spawn
  }

  /** Build WSL shell args: ['-d', <distro>, '-e', <shell>, <-lc|-c>, <cmd>] */
  private wslShellArgs(cmd: string): string[] {
    const distro = this.capability.wslDistro || 'Ubuntu'
    const shell = this.capability.wslShell || 'bash'
    const useLoginShell = !this.capability.wslEnv && shell === 'bash'
    const flag = shell === 'bash' ? (useLoginShell ? '-ilc' : '-lc') : '-c'
    return ['-d', distro, '-e', shell, flag, cmd]
  }

  /** Build shell export chain from captured WSL environment.
   *  Filters out shell-internal vars (_ , PWD, SHLVL, etc.) that are
   *  harmless to export but add noise.  Single quotes with escape. */
  private wslEnvPrefix(): string {
    const env = this.capability.wslEnv
    if (!env) return ''
    const parts: string[] = []
    for (const [k, v] of Object.entries(env)) {
      if (['_', 'PWD', 'OLDPWD', 'SHLVL', 'TERM'].includes(k)) continue
      parts.push(`export ${k}='${v.replace(/'/g, "'\\''")}'`)
    }
    return parts.join(' && ') + ' && '
  }

  // ── backend: host-native (Windows cmd-first shell fallback) ───────────

  private startHostNative(projectId: string, command: string, cwd: string, initialSize?: PtySize): boolean {
    const hostCwd = toHostAccessiblePath(cwd, this.getDefaultWslDistro())
    if (!this.capability.hasPty) {
      return this.startWithSpawn(projectId, command, hostCwd)
    }
    const ptySpawn = this.getPtySpawn()
    const launch = buildWindowsAutomationShellLaunch(command)
    try {
      const pty = ptySpawn(resolveWindowsSystemExecutable(launch.shell.command), launch.args, {
        name: 'xterm-color',
        cols: initialSize?.cols ?? DEFAULT_PTY_COLS,
        rows: initialSize?.rows ?? DEFAULT_PTY_ROWS,
        cwd: hostCwd,
        env: process.env as Record<string, string>,
      })
      return this.finalizePtyStart(projectId, pty, 'direct-pty')
    } catch {
      return this.startWithSpawn(projectId, command, hostCwd)
    }
  }

  // ── backend: tmux ───────────────────────────────────────

  private startWithTmux(projectId: string, command: string, cwd: string, initialSize?: PtySize): boolean {
    const projectName = basename(cwd)
    const sessionName = getSessionName(projectId, projectName)
    const wslPath = wslBridge.toWslPath(cwd)
    const ptySpawn = this.getPtySpawn()

    // Use tmux -A (attach-or-create): single step, no race condition.
    // When command is non-empty: creates new session if needed, then attaches.
    // When command is empty: only attaches to existing session (reattach flow).
    // Prepend captured WSL env so the tmux session inherits PATH, API keys,
    // proxy settings etc. even though the shell is non-interactive.
    const hasCommand = command && command.trim().length > 0
    const wrappedCommand = hasCommand ? this.wslEnvPrefix() + command : command
    const attachCmd = hasCommand ? tmuxManager.attachOrCreateCommand(sessionName, wrappedCommand, wslPath) : tmuxManager.attachOrCreateCommand(sessionName)

    const pty = ptySpawn('wsl.exe', this.wslShellArgs(attachCmd), {
      name: 'xterm-color',
      cols: initialSize?.cols ?? DEFAULT_PTY_COLS,
      rows: initialSize?.rows ?? DEFAULT_PTY_ROWS,
    })

    const result = this.finalizePtyStart(projectId, pty, 'tmux')
    if (result) {
      const managed = this.processes.get(projectId) as PtyManagedProcess
      managed.sessionName = sessionName
      // finalizePtyStart 里的首条 upsert 尚未带上 sessionName，这里补发修正版。
      this.emitInventoryUpsert(projectId)
    }
    return result
  }

  // ── backend: wsl-pty | direct-pty ──────────────────────

  private startWithPty(projectId: string, command: string, cwd: string, initialSize?: PtySize): boolean {
    const ptySpawn = this.getPtySpawn()
    let pty: IPty

    if (process.platform === 'win32' && this.capability.hasWsl) {
      // Route through WSL when available — used by Claude and other Linux tools.
      // Converts Windows paths to WSL paths on the fly.
      const wslPath = wslBridge.toWslPath(cwd)
      const escapedCmd = command.replace(/'/g, "'\\''")
      const shellCmd = `${this.wslEnvPrefix()}cd '${wslPath}' && exec bash -lc '${escapedCmd}'`
      pty = ptySpawn(resolveWindowsSystemExecutable('wsl.exe'), this.wslShellArgs(shellCmd), {
        name: 'xterm-color',
        cols: initialSize?.cols ?? DEFAULT_PTY_COLS,
        rows: initialSize?.rows ?? DEFAULT_PTY_ROWS,
      })
    } else {
      // direct-pty (Linux/macOS)
      pty = ptySpawn('/bin/bash', ['-lc', command], {
        name: 'xterm-color',
        cols: initialSize?.cols ?? DEFAULT_PTY_COLS,
        rows: initialSize?.rows ?? DEFAULT_PTY_ROWS,
        cwd,
        env: process.env as Record<string, string>,
      })
    }

    const backendTag: 'wsl-pty' | 'direct-pty' = process.platform === 'win32' && this.capability.hasWsl ? 'wsl-pty' : 'direct-pty'
    return this.finalizePtyStart(projectId, pty, backendTag)
  }

  private finalizePtyStart(projectId: string, pty: IPty, backend: 'tmux' | 'wsl-pty' | 'direct-pty'): boolean {
    const managed: PtyManagedProcess = { pty, projectId, startTime: Date.now(), backend }
    this.processes.set(projectId, managed)

    // Resize controller
    const resizeCtrl = new ResizeController()
    resizeCtrl.onResize((size: PtySize) => {
      try {
        pty.resize(size.cols, size.rows)
      } catch {
        /* ignore */
      }
    })
    this.resizeCtrls.set(projectId, resizeCtrl)

    pty.onData((data: string) => {
      this.emitOutput(projectId, data)
      this.send(IPC_CHANNELS.PROCESS_OUTPUT, { projectId, data })
    })

    pty.onExit(({ exitCode }: { exitCode: number }) => {
      // stop() 入口已推过 remove（乐观关闭）；只有自然死亡才需要在这里推。
      const stopWasRequested = this.stopping.has(projectId)
      const wasRegistered = this.processes.has(projectId)
      this.cleanupStoppedProcess(projectId)
      if (wasRegistered && !stopWasRequested) this.emitInventoryRemove(projectId)
      this.send(IPC_CHANNELS.PROCESS_STATUS, { projectId, status: 'stopped' })
      this.send(IPC_CHANNELS.PROCESS_EXIT, { projectId, code: exitCode })
      this.emitExit(projectId, exitCode)
    })

    this.emitInventoryUpsert(projectId)
    this.send(IPC_CHANNELS.PROCESS_STATUS, { projectId, status: 'running' })
    return true
  }

  // ── backend: spawn fallback ─────────────────────────────

  private startWithSpawn(projectId: string, command: string, cwd: string): boolean {
    const hostCwd = process.platform === 'win32' ? toHostAccessiblePath(cwd, this.getDefaultWslDistro()) : cwd
    const child = spawnChild(command, {
      cwd: hostCwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: true,
      env: { ...process.env },
    })

    const stdoutDecoder = new ProcessOutputDecoder()
    const stderrDecoder = new ProcessOutputDecoder()
    const managed: SpawnManagedProcess = { child, projectId, startTime: Date.now(), backend: 'spawn', stdoutDecoder, stderrDecoder }
    this.processes.set(projectId, managed)

    // 'spawn' 事件后才拿得到真实 pid；同步发射的 upsert 会缺 pid。
    child.on('spawn', () => {
      this.emitInventoryUpsert(projectId)
    })

    child.stdout?.on('data', (data: Buffer) => {
      const text = stdoutDecoder.decodeChunk(data)
      if (text) {
        this.emitOutput(projectId, text)
        this.send(IPC_CHANNELS.PROCESS_OUTPUT, { projectId, data: text })
      }
    })

    child.stderr?.on('data', (data: Buffer) => {
      const text = stderrDecoder.decodeChunk(data)
      if (text) {
        this.emitOutput(projectId, text)
        this.send(IPC_CHANNELS.PROCESS_OUTPUT, { projectId, data: text })
      }
    })

    child.on('exit', (code) => {
      // stop() 入口已推过 remove（乐观关闭）；只有自然死亡才需要在这里推。
      const stopWasRequested = this.stopping.has(projectId)
      const wasRegistered = this.processes.has(projectId)
      const stdoutTail = stdoutDecoder.flush()
      if (stdoutTail) {
        this.emitOutput(projectId, stdoutTail)
        this.send(IPC_CHANNELS.PROCESS_OUTPUT, { projectId, data: stdoutTail })
      }
      const stderrTail = stderrDecoder.flush()
      if (stderrTail) {
        this.emitOutput(projectId, stderrTail)
        this.send(IPC_CHANNELS.PROCESS_OUTPUT, { projectId, data: stderrTail })
      }
      this.cleanupStoppedProcess(projectId)
      if (wasRegistered && !stopWasRequested) this.emitInventoryRemove(projectId)
      this.send(IPC_CHANNELS.PROCESS_STATUS, { projectId, status: 'stopped' })
      this.send(IPC_CHANNELS.PROCESS_EXIT, { projectId, code })
      this.emitExit(projectId, code)
    })

    child.on('error', (err) => {
      const stopWasRequested = this.stopping.has(projectId)
      const wasRegistered = this.processes.has(projectId)
      const stdoutTail = stdoutDecoder.flush()
      if (stdoutTail) this.send(IPC_CHANNELS.PROCESS_OUTPUT, { projectId, data: stdoutTail })
      const stderrTail = stderrDecoder.flush()
      if (stderrTail) this.send(IPC_CHANNELS.PROCESS_OUTPUT, { projectId, data: stderrTail })
      this.cleanupStoppedProcess(projectId)
      if (wasRegistered && !stopWasRequested) this.emitInventoryRemove(projectId)
      this.send(IPC_CHANNELS.PROCESS_OUTPUT, { projectId, data: `Error: ${err.message}\n` })
      this.send(IPC_CHANNELS.PROCESS_STATUS, { projectId, status: 'error' })
    })

    this.send(IPC_CHANNELS.PROCESS_STATUS, { projectId, status: 'running' })
    return true
  }

  // ── stop helpers ────────────────────────────────────────

  private stopSpawn(managed: SpawnManagedProcess): boolean {
    const pid = managed.child.pid
    if (pid == null) {
      // stop() 入口已推过 remove；这里只做清理与补发事件。
      this.cleanupStoppedProcess(managed.projectId)
      this.send(IPC_CHANNELS.PROCESS_STATUS, { projectId: managed.projectId, status: 'stopped' })
      this.send(IPC_CHANNELS.PROCESS_EXIT, { projectId: managed.projectId, code: null })
      return true
    }

    try {
      if (process.platform === 'win32') {
        const killer = spawnChild('taskkill', ['/pid', String(pid), '/t', '/f'], { stdio: 'ignore' })
        killer.on('error', () => {
          try {
            managed.child.kill()
          } catch {
            /* dead */
          }
        })
      } else {
        try {
          process.kill(-pid, 'SIGTERM')
        } catch {
          /* already dead */
        }
        setTimeout(() => {
          try {
            process.kill(-pid, 'SIGKILL')
          } catch {
            /* already dead */
          }
        }, 2000)
      }
    } catch {
      try {
        managed.child.kill()
      } catch {
        /* already dead */
      }
    }
    return true
  }

  /**
   * pty 停止时序——按「kill 能否打到进程」分 A/B 两套（2026-10-18 决策）：
   *
   * A 套 direct-pty（Windows 原生）：整棵树都在同一个 ConPTY 上，kill pid 可达全部进程，
   *   短 grace + 强杀即可：\x03 + exit\r → 300ms 强杀 → 1200ms 重试。
   * B 套 wsl-pty / tmux（WSL）：真正的进程在 WSL2 Linux 侧，Windows 侧 kill 打不到
   *   （pty.pid 是 wsl.exe，Linux 子进程对 taskkill 不可见），pty 输入是唯一可达通道：
   *   \x03（+exit\r，tmux 除外）→ 500ms kill wsl.exe → 1500ms 重试。
   *   tmux 的强杀语义是 detach（杀 attach 的 wsl.exe），会话保活不受影响。
   *
   * 两套共享「乐观关闭」：stop() 入口已推 remove 事件，这里只负责真正杀死与清理。
   */
  private stopPty(managed: PtyManagedProcess, safetyPid: number | undefined): void {
    const { pty, projectId, backend } = managed

    // 优雅通道：前台进程组 SIGINT（WSL 内进程只吃这个）；dev server 有机会 flush。
    try {
      pty.write('\x03')
    } catch {
      /* dead */
    }
    if (backend !== 'tmux') {
      // 交互 shell 在提示符下对 Ctrl+C 无响应（readline 吃掉 SIGINT），exit\r 让
      // 空闲 shell 直接退出——集合面板里最常见的关闭对象。
      // tmux 后端不能写：exit 会在 attach 的会话里真执行，杀会话 = 破坏隐藏保活。
      try {
        pty.write('exit\r')
      } catch {
        /* dead */
      }
    }

    const windowsNativeTree = backend === 'direct-pty'
    const graceMs = windowsNativeTree ? 300 : 500
    const retryMs = windowsNativeTree ? 1200 : 1500

    // 强杀：grace 内没退出（Ctrl+C 被吞 / 空闲 shell 没走到 exit）时杀整棵树。
    setTimeout(() => {
      if (!this.stopping.has(projectId)) return
      this.forceKillPty(managed, safetyPid)
    }, graceMs)

    // 重试 + 清理：强杀后退出事件仍没来（ConPTY onExit 挂死，O6 的原始场景）。
    setTimeout(() => {
      if (!this.stopping.has(projectId)) return
      this.forceKillPty(managed, safetyPid)
      console.warn(`[runner] stop safety net fired for "${projectId}" (pid ${safetyPid ?? 'unknown'}); force-killed process tree`)
      this.cleanupStoppedProcess(projectId)
      this.send(IPC_CHANNELS.PROCESS_STATUS, { projectId, status: 'stopped' })
      this.send(IPC_CHANNELS.PROCESS_EXIT, { projectId, code: null })
    }, retryMs)
  }

  /**
   * pty 强杀。Windows 上 node-pty 的 kill(signal) 必抛
   * 「Signals not supported on windows.」（windowsTerminal.js:150），曾导致 1500ms
   * 「SIGTERM 强杀」在 Windows 上全程是抛异常的死代码——必须走无信号 kill
   * （杀 ConPTY 控制台进程列表）或 taskkill /t /f；POSIX 走 SIGTERM。
   */
  private forceKillPty(managed: PtyManagedProcess, safetyPid: number | undefined): void {
    if (process.platform !== 'win32') {
      try {
        managed.pty.kill('SIGTERM')
      } catch {
        /* already dead */
      }
      return
    }
    try {
      managed.pty.kill()
    } catch {
      /* already dead */
    }
    if (typeof safetyPid === 'number' && Number.isFinite(safetyPid)) {
      this.killProcessTreeImmediate(safetyPid)
    }
  }

  /** 停止/退出后的统一清理：stopping 标记、resize 控制器、进程 Map 条目。 */
  private cleanupStoppedProcess(projectId: string): void {
    this.stopping.delete(projectId)
    this.resizeCtrls.get(projectId)?.dispose()
    this.resizeCtrls.delete(projectId)
    this.processes.delete(projectId)
  }

  // ── IPC ─────────────────────────────────────────────────

  private send(channel: string, data: unknown): void {
    const win = this.outputWindow
    if (!win || win.isDestroyed()) {
      this.outputWindow = null
      return
    }

    const { webContents } = win
    if (webContents.isDestroyed()) {
      this.outputWindow = null
      return
    }

    webContents.send(channel, data)
  }
}

export { ProcessManager }
