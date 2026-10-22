import { parseQuickActionArg } from '../launchArgs'

export type QuickActionLaunchRouterDeps = {
  /** Executes the action by id; rejects on failure. */
  execute: (id: string) => Promise<unknown>
  logWarn: (message: string) => void
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Unified entry point for quick-action launch requests, covering both entry
 * paths with one code path:
 *
 * - cold start: the initial `process.argv` (captured at module top, before
 *   the window/service exist)
 * - hot start: the `second-instance` argv of a later `.lnk` double-click
 *
 * Requests that arrive before the service is ready are queued and drained by
 * markReady(). Duplicate ids collapse in the queue, and a request whose id is
 * already executing is skipped — a rapid double-click must not start the same
 * run task twice. Window focus is deliberately not part of this router: the
 * executors decide visibility themselves (silent open-project aside).
 */
export function createQuickActionLaunchRouter(deps: QuickActionLaunchRouterDeps) {
  const queue: string[] = []
  const inFlight = new Set<string>()
  let ready = false

  function dispatch(id: string): void {
    if (inFlight.has(id)) {
      deps.logWarn(`[quick-actions] Skipped duplicate launch request while action ${id} is still running.`)
      return
    }
    inFlight.add(id)
    deps
      .execute(id)
      .catch((error) => {
        deps.logWarn(`[quick-actions] Failed to execute action ${id} from launch: ${errorText(error)}`)
      })
      .finally(() => {
        inFlight.delete(id)
      })
  }

  /**
   * Parses launch argv and accepts the request. Returns true when the argv
   * carried a quick-action launch (caller stops further routing); false means
   * "not a quick-action launch" and routing continues (e.g. markdown open).
   */
  function handleArgv(argv: readonly string[]): boolean {
    const id = parseQuickActionArg(argv)
    if (!id) return false
    if (!ready) {
      if (!queue.includes(id)) queue.push(id)
      return true
    }
    dispatch(id)
    return true
  }

  /** Marks the service available and drains queued requests (each id once). */
  function markReady(): void {
    if (ready) return
    ready = true
    while (queue.length > 0) {
      const id = queue.shift()
      if (id) dispatch(id)
    }
  }

  return { handleArgv, markReady }
}

export type QuickActionLaunchRouter = ReturnType<typeof createQuickActionLaunchRouter>
