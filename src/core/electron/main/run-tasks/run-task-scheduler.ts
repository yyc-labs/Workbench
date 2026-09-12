import * as path from 'path'
import * as net from 'net'
import { spawn } from 'child_process'
import waitOn from 'wait-on'
import { detectProjectEnvironment } from '../../../shared/projectEnvironment'
import { collectUrlsFromText, findFirstUrl, stripAnsiEscapes } from '../../../shared/urlExtract'
import { RunTaskCycleError, parseRunTaskProcessKey, runTaskProcessKey, topoSortRunTasks } from '../../../shared/runTasks'
import type { RunTask, RunTaskProgressEvent, RunTaskState } from '../../../shared/runTasks'
import type { ProcessManager } from '../runner'

export type EmitRunTaskProgress = (event: RunTaskProgressEvent) => void
/** Opens an external terminal window running `command` in `cwd`; resolves false on failure. */
export type StartTaskInTerminal = (cwd: string, command: string) => Promise<boolean>

const DEFAULT_READINESS_TIMEOUT_MS = 60_000
const WAIT_ON_INTERVAL_MS = 500
const URL_OUTPUT_BUFFER_CHARS = 8_000
/** Upper bound of URLs collected per task so noisy output cannot grow the state forever. */
const MAX_TASK_URLS = 16
/** While stopping, probe the task's listen port this often… */
const STOP_PORT_POLL_INTERVAL_MS = 200
/** …but give up after this long and let the process-exit event settle the state. */
const STOP_PORT_GRACE_MS = 5_000
const PORT_PROBE_TIMEOUT_MS = 300
/** Output patterns hinting a starting task is actually failing (hint only — never settles the task). */
// Output patterns hinting a failing task (hint only — never settles the task).
const TASK_ERROR_HINT_PATTERNS: RegExp[] = [
  /Traceback \(most recent call last\)/,
  /\bError:\s/,
  // Python/JS style exception headers: ConnectionRefusedError:, OSError:, FileNotFoundError:, …
  /\b[A-Z][A-Za-z\d]*(?:Error|Exception)\b:/,
  // Log-level markers: "… ERROR: Application startup failed."
  /\b(?:ERROR|CRITICAL|FATAL)\b/,
  /\bEADDRINUSE\b/,
  /\bECONNREFUSED\b/,
  /npm ERR!/,
]
const ERROR_HINT_SNIPPET_MAX_CHARS = 200

interface RunTaskSessionState {
  state: RunTaskState
  url?: string
  /** All URLs collected from the task output, in detection order. */
  urls?: string[]
  error?: string
  /** Output hinted an error while starting; cleared once the task proves healthy. */
  warning?: string
  startedAt?: number
}

interface RunTaskSession {
  projectId: string
  projectPath: string
  tasks: Map<string, RunTask>
  /** Topological order (dependencies first). */
  ordered: RunTask[]
  states: Map<string, RunTaskSessionState>
  dispatches: Map<string, Promise<void>>
  disposers: Array<() => void>
  failed: boolean
}

function isProcessLikeState(state: RunTaskState): boolean {
  return state === 'starting' || state === 'ready' || state === 'running' || state === 'stopping'
}

/** Pick the primary URL: first match of readiness.primaryUrlPattern, else the first detected URL. */
function selectPrimaryTaskUrl(readiness: RunTask['readiness'], urls: string[]): string | undefined {
  const pattern = readiness?.primaryUrlPattern
  if (pattern && urls.length > 0) {
    try {
      const regex = new RegExp(pattern, 'i')
      return urls.find((url) => regex.test(url)) ?? urls[0]
    } catch {
      // Invalid user regex — fall back to the first detected URL.
    }
  }
  return urls[0]
}

/** All URLs found in a chunk of output: custom pattern matches when configured, standard http URLs otherwise. */
function collectTaskUrls(buffer: string, urlPattern?: string): string[] {
  if (urlPattern) {
    try {
      const regex = new RegExp(urlPattern, 'gi')
      const matches = stripAnsiEscapes(buffer).match(regex)
      if (matches && matches.length > 0) return [...new Set(matches)]
    } catch {
      // Invalid user regex — fall through to default extraction.
    }
  }
  return collectUrlsFromText(buffer)
}

/**
 * Orchestrates run tasks as a dependency DAG on top of ProcessManager.
 * Lives in the main process so scheduling keeps working with the output
 * window closed and can use wait-on probes (tcp/http) directly.
 */
export class RunTaskScheduler {
  private sessions = new Map<string, RunTaskSession>()

  constructor(
    private getProcessManager: () => ProcessManager | null,
    private emitProgress: EmitRunTaskProgress,
    private startInTerminal?: StartTaskInTerminal,
    private getWslDistro: () => string = () => 'Ubuntu',
  ) {}

  getState(projectId: string): RunTaskProgressEvent | null {
    const session = this.sessions.get(projectId)
    if (!session) return null
    this.reconcileSession(session)
    return this.toProgressEvent(session)
  }

  /**
   * Heal missed exits: if a task is in a process-like state but its process is
   * gone (e.g. its exit watcher was disposed when a new session was created),
   * settle it as stopped. Exit-strategy tasks are skipped — a finished one-shot
   * stays 'ready' and downstream tasks must not see it as blocked.
   */
  private reconcileSession(session: RunTaskSession): void {
    const processManager = this.getProcessManager()
    if (!processManager) return
    for (const task of session.ordered) {
      const state = session.states.get(task.id)
      if (!state || !isProcessLikeState(state.state)) continue
      if (task.readiness?.strategy === 'exit' && state.state === 'ready') continue
      if (processManager.isRunning(runTaskProcessKey(session.projectId, task.id))) continue
      this.setState(session, task.id, { state: 'stopped', error: state.state === 'starting' ? 'Exited before becoming ready.' : undefined })
    }
  }

  async startAll(projectId: string, projectPath: string, tasks: RunTask[]): Promise<{ started: boolean; error?: string }> {
    if (tasks.length === 0) return { started: false, error: 'No run tasks configured.' }
    let ordered: RunTask[]
    try {
      ordered = topoSortRunTasks(tasks)
    } catch (error) {
      const message = error instanceof RunTaskCycleError ? error.message : String(error)
      return { started: false, error: message }
    }
    const processManager = this.getProcessManager()
    if (!processManager) return { started: false, error: 'Process manager unavailable.' }

    const session = this.createSession(projectId, projectPath, tasks, ordered)
    this.sessions.set(projectId, session)

    // Disabled tasks stay idle ("start all" never triggers them); tasks that
    // depend on them still run (see dispatch — disabled deps resolve directly).
    for (const task of ordered) {
      if (task.enabled === false) continue
      void this.dispatch(session, task)
    }
    await Promise.all([...session.dispatches.values()])

    if (session.failed) {
      return { started: true, error: 'One or more tasks failed during startup.' }
    }
    return { started: true }
  }

  async start(projectId: string, projectPath: string, task: RunTask): Promise<boolean> {
    const processManager = this.getProcessManager()
    if (!processManager) return false

    let session = this.sessions.get(projectId)
    if (!session) {
      // A single-task session needs no topological sort: its dependsOn list
      // is ignored (dependency orchestration belongs to "start all"), and
      // topoSort would misreport deps missing from this one-task array as a
      // dependency cycle.
      session = this.createSession(projectId, projectPath, [task], [task])
      this.sessions.set(projectId, session)
    } else if (!session.tasks.has(task.id)) {
      session.tasks.set(task.id, task)
      session.ordered.push(task)
    } else {
      // The session may still hold the definition from a previous start-all.
      // An explicit single start uses the current config — otherwise fixing a
      // broken command and retrying would run the stale one.
      session.tasks.set(task.id, task)
    }

    // Dependency orchestration ("waiting", dependency dispatch, blocked-dep
    // checks) belongs to "start all" only. A single start launches the task
    // right away — waiting on a full `mvn install` rebuild first made the
    // start button look dead.
    await this.startTaskNow(session, task)
    const state = session.states.get(task.id)?.state
    return state !== 'failed'
  }

  async stopTask(projectId: string, taskId: string): Promise<boolean> {
    const processManager = this.getProcessManager()
    if (!processManager) return false

    const session = this.sessions.get(projectId)
    if (!session) {
      return processManager.stop(runTaskProcessKey(projectId, taskId))
    }

    // Descendants depending (directly or transitively) on the stopped task.
    const doomed = new Set<string>([taskId])
    let changed = true
    while (changed) {
      changed = false
      for (const task of session.ordered) {
        if (doomed.has(task.id)) continue
        if ((task.dependsOn ?? []).some((dep) => doomed.has(dep))) {
          doomed.add(task.id)
          changed = true
        }
      }
    }

    // Stop in reverse topological order so dependents go first.
    for (const task of [...session.ordered].reverse()) {
      if (!doomed.has(task.id)) continue
      this.stopSessionTask(session, task)
    }
    return true
  }

  async stopAll(projectId: string): Promise<boolean> {
    const session = this.sessions.get(projectId)
    if (!session) return false
    const processManager = this.getProcessManager()
    if (!processManager) return false

    for (const task of [...session.ordered].reverse()) {
      this.stopSessionTask(session, task)
    }
    return true
  }

  // ── internals ───────────────────────────────────────────

  /**
   * Stop a single task within a session. Tasks whose process already exited
   * (one-shot commands like `docker compose up -d`) must settle immediately —
   * runner.stop() early-returns for dead processes and no exit event would
   * ever arrive, leaving the UI stuck in "stopping" forever.
   */
  private stopSessionTask(session: RunTaskSession, task: RunTask): void {
    const state = session.states.get(task.id)
    if (state && state.state === 'waiting') {
      this.setState(session, task.id, { state: 'stopped' })
      return
    }
    if (!state || !isProcessLikeState(state.state)) return

    const processManager = this.getProcessManager()
    const key = runTaskProcessKey(session.projectId, task.id)
    if (!processManager || !processManager.isRunning(key)) {
      // Process is already gone; run the optional stop command (e.g.
      // `docker compose down`) fire-and-forget and settle at once.
      this.spawnStopCommand(session, task)
      this.setState(session, task.id, { state: 'stopped' })
      return
    }

    this.setState(session, task.id, { state: 'stopping' })
    processManager.stop(key)
    // A dev server that released its port is down for good — settle on port
    // release instead of waiting for the process-exit event to crawl in.
    this.watchTaskPortRelease(session, task)
  }

  /**
   * After a stop, poll the task's listen port (from readiness config or its
   * published URL) at a short interval: as soon as nothing is listening the
   * service is gone and the task settles to 'stopped' immediately, without
   * waiting for the slower process-exit notification (taskkill on a process
   * tree, conpty teardown, …). The exit tap stays as the fallback; the
   * watcher gives up after STOP_PORT_GRACE_MS.
   */
  private watchTaskPortRelease(session: RunTaskSession, task: RunTask): void {
    const port = resolveTaskListenPort(task, session.states.get(task.id))
    if (!port) return
    const deadline = Date.now() + STOP_PORT_GRACE_MS
    const cleanup = () => clearInterval(timer)
    const timer = setInterval(() => {
      const state = session.states.get(task.id)
      if (!state || state.state !== 'stopping' || Date.now() > deadline) {
        cleanup()
        return
      }
      void isPortListening(port).then((listening) => {
        if (listening) return
        const current = session.states.get(task.id)
        if (!current || current.state !== 'stopping') return
        cleanup()
        this.setState(session, task.id, { state: 'stopped' })
      })
    }, STOP_PORT_POLL_INTERVAL_MS)
    session.disposers.push(cleanup)
  }

  /**
   * Watch a task's output for error patterns and surface a warning hint to
   * the renderer — the task may be failing even though no readiness timeout
   * has fired yet. Active during 'starting' and 'running' (no-readiness tasks
   * jump straight to 'running', which is still their startup window). Hint
   * only: the state still settles via readiness/exit as usual.
   */
  private registerStartingErrorHintTap(session: RunTaskSession, task: RunTask): void {
    const processManager = this.getProcessManager()
    if (!processManager) return
    const key = runTaskProcessKey(session.projectId, task.id)
    let buffer = ''
    const removeOutput = processManager.addOutputTap((pid, data) => {
      if (pid !== key) return
      const state = session.states.get(task.id)
      if (!state || (state.state !== 'starting' && state.state !== 'running')) {
        removeOutput()
        return
      }
      buffer = (buffer + data).slice(-URL_OUTPUT_BUFFER_CHARS)
      if (state.warning) return
      const snippet = extractErrorHintSnippet(buffer)
      if (snippet) this.setState(session, task.id, { warning: snippet })
    })
    session.disposers.push(removeOutput)
  }

  /**
   * Keep watching the task output after readiness so URLs published later
   * (a second dev server, a companion service, …) join the task's URL list.
   * The primary link is recomputed from readiness.primaryUrlPattern on each
   * new URL; the tap removes itself once the task settles.
   */
  private registerUrlCollectorTap(session: RunTaskSession, task: RunTask): void {
    const processManager = this.getProcessManager()
    if (!processManager) return
    const key = runTaskProcessKey(session.projectId, task.id)
    let buffer = ''
    const removeOutput = processManager.addOutputTap((pid, data) => {
      if (pid !== key) return
      const state = session.states.get(task.id)
      if (!state || (state.state !== 'ready' && state.state !== 'running')) {
        removeOutput()
        return
      }
      buffer = (buffer + data).slice(-URL_OUTPUT_BUFFER_CHARS)
      const found = collectTaskUrls(buffer, task.readiness?.urlPattern)
      const collected = [...(state.urls ?? (state.url ? [state.url] : []))]
      let changed = false
      for (const url of found) {
        if (collected.includes(url) || collected.length >= MAX_TASK_URLS) continue
        collected.push(url)
        changed = true
      }
      if (!changed) return
      this.setState(session, task.id, { url: selectPrimaryTaskUrl(task.readiness, collected), urls: [...collected] })
    })
    session.disposers.push(removeOutput)
  }

  /**
   * Watch for process exit while in a steady state so the UI flips to stopped.
   * Exit-strategy tasks are excluded: their process exiting IS the expected
   * completion and waitReady() settles the state at 'ready'.
   */
  private registerSteadyExitTap(session: RunTaskSession, task: RunTask): void {
    const processManager = this.getProcessManager()
    if (!processManager) return
    const key = runTaskProcessKey(session.projectId, task.id)
    const removeSteadyExit = processManager.addExitTap((pid, code) => {
      if (pid !== key) return
      removeSteadyExit()
      if (task.readiness?.strategy === 'exit') return
      const state = session.states.get(task.id)
      if (state && isProcessLikeState(state.state)) {
        this.setState(session, task.id, {
          state: 'stopped',
          error: code ? `Exited with code ${code}.` : undefined,
        })
      }
    })
    session.disposers.push(removeSteadyExit)
  }

  /** Fire-and-forget execution of the task's optional stopCommand (fully hidden). */ private spawnStopCommand(session: RunTaskSession, task: RunTask): void {
    const stopCommand = task.stopCommand?.trim()
    if (!stopCommand) return
    const cwd = this.resolveTaskCwd(session.projectPath, task)
    const useWsl = resolveTaskUseWsl(cwd, task.useWsl) === true && process.platform === 'win32'
    try {
      // No `detached`: on Windows it forces a new console window; windowsHide
      // alone keeps the stop command fully silent.
      if (useWsl) {
        // --cd accepts Windows paths and maps them into the distro.
        spawn('wsl.exe', ['--distribution', this.getWslDistro(), '--cd', cwd, '--exec', 'sh', '-lc', stopCommand], { windowsHide: true, stdio: 'ignore' }).unref()
      } else if (process.platform === 'win32') {
        spawn('cmd.exe', ['/d', '/s', '/c', stopCommand], { cwd, windowsHide: true, stdio: 'ignore' }).unref()
      } else {
        spawn('/bin/sh', ['-c', stopCommand], { cwd, windowsHide: true, stdio: 'ignore' }).unref()
      }
    } catch {
      // best effort — the task still settles as stopped
    }
  }

  private createSession(projectId: string, projectPath: string, tasks: RunTask[], ordered: RunTask[]): RunTaskSession {
    const processManager = this.getProcessManager()

    // Dispose watchers of any previous session for this project, but carry
    // over tasks that are still running: without re-arming their exit
    // watchers a later exit would go unnoticed and the UI would stay "running".
    const previous = this.sessions.get(projectId)
    const carried = new Map<string, RunTaskSessionState>()
    if (previous) {
      for (const task of previous.ordered) {
        const state = previous.states.get(task.id)
        if (!state || !isProcessLikeState(state.state)) continue
        if (!processManager?.isRunning(runTaskProcessKey(projectId, task.id))) continue
        carried.set(task.id, state.state === 'starting' ? { ...state, state: 'running' } : { ...state })
      }
      this.disposeSession(previous)
    }

    const states = new Map<string, RunTaskSessionState>()
    for (const task of ordered) {
      const carriedState = carried.get(task.id)
      states.set(task.id, carriedState ? { ...carriedState } : { state: 'idle' })
    }

    const session: RunTaskSession = {
      projectId,
      projectPath,
      tasks: new Map(tasks.map((task) => [task.id, task])),
      ordered,
      states,
      dispatches: new Map(),
      disposers: [],
      failed: false,
    }

    if (processManager) {
      for (const task of ordered) {
        if (carried.has(task.id)) this.registerSteadyExitTap(session, task)
      }
    }
    return session
  }

  private disposeSession(session: RunTaskSession): void {
    for (const dispose of session.disposers) {
      try {
        dispose()
      } catch {
        /* already gone */
      }
    }
    session.disposers = []
  }

  private dispatch(session: RunTaskSession, task: RunTask): Promise<void> {
    const existing = session.dispatches.get(task.id)
    if (existing) return existing

    const promise = (async () => {
      const deps = task.dependsOn ?? []
      if (deps.length > 0) {
        this.setState(session, task.id, { state: 'waiting' })
        await Promise.all(
          deps.map((dep) => {
            const depTask = session.tasks.get(dep)
            // Disabled dependencies never start; downstream tasks proceed anyway.
            if (!depTask || depTask.enabled === false) return Promise.resolve()
            return this.dispatch(session, depTask)
          }),
        )
        const blockedDep = deps.find((dep) => {
          const depState = session.states.get(dep)
          return depState && (depState.state === 'failed' || depState.state === 'stopped' || depState.state === 'stopping')
        })
        if (blockedDep) {
          this.setState(session, task.id, {
            state: 'failed',
            error: `Dependency '${blockedDep}' did not become ready.`,
          })
          session.failed = true
          return
        }
      }
      await this.startTaskNow(session, task)
    })()

    session.dispatches.set(task.id, promise)
    promise.catch(() => {
      /* failures are recorded in session states */
    })
    return promise
  }

  private async startTaskNow(session: RunTaskSession, task: RunTask): Promise<void> {
    const processManager = this.getProcessManager()
    if (!processManager) {
      this.setState(session, task.id, { state: 'failed', error: 'Process manager unavailable.' })
      session.failed = true
      return
    }

    const key = runTaskProcessKey(session.projectId, task.id)

    this.registerSteadyExitTap(session, task)

    if (processManager.isRunning(key)) {
      // Leftover process from a previous session — treat as already running.
      this.setState(session, task.id, { state: 'running', startedAt: Date.now(), warning: undefined })
      return
    }

    this.setState(session, task.id, { state: 'starting', startedAt: Date.now(), url: undefined, urls: undefined, error: undefined, warning: undefined })
    this.registerStartingErrorHintTap(session, task)

    const cwd = this.resolveTaskCwd(session.projectPath, task)
    const useWsl = resolveTaskUseWsl(cwd, task.useWsl)

    // Terminal mode hands the command to an external terminal window; the
    // scheduler no longer owns the process, so readiness probing is skipped.
    if (task.startupMode === 'terminal' && this.startInTerminal) {
      const launched = await this.startInTerminal(cwd, task.command).catch(() => false)
      if (launched) {
        this.setState(session, task.id, { state: 'running', startedAt: Date.now() })
      } else {
        this.setState(session, task.id, { state: 'failed', error: 'Failed to open a terminal for this task.' })
        session.failed = true
      }
      return
    }

    let started: boolean
    try {
      started = processManager.start(key, task.command, cwd, useWsl)
    } catch {
      started = false
    }
    if (!started) {
      this.setState(session, task.id, { state: 'failed', error: 'Failed to start process.' })
      session.failed = true
      return
    }

    if (!task.readiness) {
      this.setState(session, task.id, { state: 'running', warning: undefined })
      return
    }

    try {
      const url = await this.waitReady(processManager, session, task, key)
      const urls = url ? [url] : undefined
      this.setState(session, task.id, { state: 'ready', url, urls, warning: undefined })
      if (url && task.readiness?.strategy === 'url') this.registerUrlCollectorTap(session, task)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.setState(session, task.id, { state: 'failed', error: message })
      session.failed = true
    }
  }

  /** Resolve readiness; resolves with a display URL when one is known. */
  private waitReady(processManager: ProcessManager, session: RunTaskSession, task: RunTask, key: string): Promise<string | undefined> {
    const readiness = task.readiness
    if (!readiness) return Promise.resolve(undefined)
    const timeoutMs = readiness.timeoutMs ?? DEFAULT_READINESS_TIMEOUT_MS

    if (readiness.strategy === 'delay') {
      const delayMs = Math.max(0, readiness.delayMs ?? 0)
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => resolve(undefined), delayMs)
        setTimeout(() => reject(new Error('Timed out waiting for readiness.')), timeoutMs)
        void timer
      })
    }

    if (readiness.strategy === 'http') {
      const resource = `http-get:${readiness.httpUrl}`
      return waitOn({ resources: [resource], timeout: timeoutMs, interval: WAIT_ON_INTERVAL_MS })
        .then(() => readiness.httpUrl)
        .catch(() => {
          throw new Error(`Timed out waiting for ${readiness.httpUrl} to respond.`)
        })
    }

    if (readiness.strategy === 'port') {
      const port = readiness.port as number
      const resource = `tcp:127.0.0.1:${port}`
      return waitOn({ resources: [resource], timeout: timeoutMs, interval: WAIT_ON_INTERVAL_MS })
        .then(() => `http://localhost:${port}`)
        .catch(() => {
          throw new Error(`Timed out waiting for port ${port} to start listening.`)
        })
    }

    if (readiness.strategy === 'exit') {
      return new Promise((resolve, reject) => {
        const removeExit = processManager.addExitTap((pid, code) => {
          if (pid !== key) return
          cleanup()
          if (code === 0) resolve(undefined)
          else reject(new Error(`Process exited with code ${code}.`))
        })
        const timer = setTimeout(() => {
          cleanup()
          reject(new Error('Timed out waiting for the process to exit.'))
        }, timeoutMs)
        const cleanup = () => {
          clearTimeout(timer)
          removeExit()
        }
      })
    }

    // strategy === 'url': watch the process output stream for a URL.
    return new Promise((resolve, reject) => {
      let buffer = ''
      const removeOutput = processManager.addOutputTap((pid, data) => {
        if (pid !== key) return
        buffer = (buffer + data).slice(-URL_OUTPUT_BUFFER_CHARS)
        const url = findFirstUrl(buffer, readiness.urlPattern)
        if (url) {
          cleanup()
          resolve(url)
        }
      })
      const removeExit = processManager.addExitTap((pid, code) => {
        if (pid !== key) return
        cleanup()
        reject(new Error(`Process exited with code ${code} before publishing a URL.`))
      })
      const timer = setTimeout(() => {
        cleanup()
        reject(new Error('Timed out waiting for a URL in the process output.'))
      }, timeoutMs)
      const cleanup = () => {
        clearTimeout(timer)
        removeOutput()
        removeExit()
      }
    })
  }

  private resolveTaskCwd(projectPath: string, task: RunTask): string {
    if (!task.cwd || !task.cwd.trim()) return projectPath
    const resolved = path.resolve(projectPath, task.cwd.trim())
    const normalizedRoot = path.resolve(projectPath)
    if (resolved === normalizedRoot || resolved.startsWith(normalizedRoot + path.sep)) {
      return resolved
    }
    // Escape attempt — fall back to the project root.
    return projectPath
  }

  private setState(session: RunTaskSession, taskId: string, patch: Partial<RunTaskSessionState>): void {
    const current = session.states.get(taskId) ?? { state: 'idle' as RunTaskState }
    const next: RunTaskSessionState = { ...current, ...patch }
    // A settled task no longer serves its URL — drop it so consumers never see a stale link.
    if (next.state === 'stopped' || next.state === 'failed') {
      delete next.url
      delete next.urls
    }
    session.states.set(taskId, next)
    this.emitProgress(this.toProgressEvent(session))
  }

  private toProgressEvent(session: RunTaskSession): RunTaskProgressEvent {
    const tasks: RunTaskProgressEvent['tasks'] = {}
    for (const [taskId, state] of session.states.entries()) {
      // 'idle' is a scheduler-internal placeholder (session created, task not
      // dispatched yet). Exposing it would let progress adoption and renderer
      // reconciling snap optimistic starting/waiting marks back to "not
      // started" mid-launch, making the UI flicker between started/unstarted.
      if (state.state === 'idle') continue
      tasks[taskId] = { ...state }
    }
    return { projectId: session.projectId, tasks }
  }
}

/** Resolve the execution backend from an explicit flag or the cwd shape. */
export function resolveTaskUseWsl(cwd: string, explicitUseWsl?: boolean): boolean | undefined {
  if (typeof explicitUseWsl === 'boolean') return explicitUseWsl
  const environment = detectProjectEnvironment(cwd)
  if (environment === 'ubuntu') return true
  if (environment === 'windows') return false
  return undefined
}

/** TCP port a URL points at; undefined for default ports or unparsable input. */
function parseUrlPort(url?: string): number | undefined {
  if (!url) return undefined
  try {
    const port = new URL(url).port
    return port ? Number(port) : undefined
  } catch {
    return undefined
  }
}

/** First output line matching a known error pattern, trimmed for display. */
function extractErrorHintSnippet(buffer: string): string | undefined {
  for (const line of buffer.split(/\r?\n/)) {
    if (!TASK_ERROR_HINT_PATTERNS.some((pattern) => pattern.test(line))) continue
    const snippet = line.trim()
    if (!snippet) continue
    return snippet.length > ERROR_HINT_SNIPPET_MAX_CHARS ? `${snippet.slice(0, ERROR_HINT_SNIPPET_MAX_CHARS)}…` : snippet
  }
  return undefined
}

/** The port this task is expected to listen on, if we can know one. */
function resolveTaskListenPort(task: RunTask, state?: RunTaskSessionState): number | null {
  const candidates = [task.readiness?.strategy === 'port' ? task.readiness.port : undefined, parseUrlPort(state?.url), parseUrlPort(task.readiness?.strategy === 'http' ? task.readiness.httpUrl : undefined)]
  for (const port of candidates) {
    if (typeof port === 'number' && port > 0) return port
  }
  return null
}

/** True when something accepts TCP connections on 127.0.0.1:port. */
function isPortListening(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket()
    const done = (result: boolean) => {
      socket.destroy()
      resolve(result)
    }
    socket.setTimeout(PORT_PROBE_TIMEOUT_MS)
    socket.once('connect', () => done(true))
    socket.once('timeout', () => done(false))
    socket.once('error', () => done(false))
    socket.connect(port, '127.0.0.1')
  })
}

// Re-exported for consumers that only import the scheduler module.
export { RunTaskCycleError, parseRunTaskProcessKey, runTaskProcessKey }
