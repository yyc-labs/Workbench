import { useCallback, useEffect, useRef, useState } from 'react'
import type { RunStartupMode } from '../../shared/types'
import type { AppState } from '../stores/appStore.types'

const OPEN_DEV_URL_TIMEOUT_MS = 30_000

interface UseProjectDevUrlLauncherOptions {
  projectId: string
  processStatus: AppState['processes'][string]['status']
  processUrls: string[]
  runStartupMode?: RunStartupMode
  startProject: AppState['startProject']
  /** URLs published by run-task scheduler states (ready tasks). */
  extraUrls?: string[]
  /**
   * True when the config declares a primaryUrl task that has not published
   * its URL yet. While pending, no fallback URL is opened — the launcher
   * keeps waiting for the primary task instead of opening whichever task
   * became ready first.
   */
  primaryUrlPending?: boolean
  /**
   * True when run tasks are already ramping (starting/waiting). The open
   * wait continues but `start` is not invoked again, so a re-click does not
   * restart an in-flight session.
   */
  isStartPending?: boolean
  /**
   * Unified starter that goes through the run-task pipeline (start-all tasks,
   * legacy command synthesized as a default task). When provided it wins over
   * the legacy `startProject` call.
   */
  start?: () => Promise<boolean>
}

export function useProjectDevUrlLauncher({ projectId, processStatus, processUrls, runStartupMode, startProject, extraUrls = [], primaryUrlPending = false, isStartPending = false, start }: UseProjectDevUrlLauncherOptions) {
  const [pendingOpenDevUrl, setPendingOpenDevUrl] = useState(false)
  const sawRunningWhilePendingRef = useRef(false)

  const isDevRunning = processStatus === 'running'
  const isDevStopping = processStatus === 'stopping'
  const isDevReady = isDevRunning && processUrls.length > 0
  // While the primary task has not published its URL yet, hold back every
  // fallback (legacy process URLs included) so the primary link is the one
  // that gets opened. Run-task URLs are primary-first already, so they win
  // over the legacy bare-process URLs.
  const firstDevUrl = primaryUrlPending ? null : (extraUrls[0] ?? (isDevReady ? processUrls[0] : null))

  useEffect(() => {
    if (!pendingOpenDevUrl) {
      sawRunningWhilePendingRef.current = false
      return
    }

    if (processStatus === 'running') {
      sawRunningWhilePendingRef.current = true
      return
    }

    if (processStatus === 'stopping') {
      setPendingOpenDevUrl(false)
      return
    }

    if (sawRunningWhilePendingRef.current && (processStatus === 'stopped' || processStatus === 'error')) {
      setPendingOpenDevUrl(false)
    }
  }, [pendingOpenDevUrl, processStatus])

  useEffect(() => {
    if (!pendingOpenDevUrl || !firstDevUrl) return

    window.electronAPI.openExternal(firstDevUrl).catch((error) => {
      console.warn('[devUrlLauncher] openExternal failed:', firstDevUrl, error)
    })
    setPendingOpenDevUrl(false)
  }, [firstDevUrl, pendingOpenDevUrl])

  useEffect(() => {
    if (!pendingOpenDevUrl) return

    const timer = window.setTimeout(() => {
      setPendingOpenDevUrl(false)
    }, OPEN_DEV_URL_TIMEOUT_MS)

    return () => window.clearTimeout(timer)
  }, [pendingOpenDevUrl])

  const startAndOpenDevUrl = useCallback(async () => {
    if (firstDevUrl) {
      try {
        await window.electronAPI.openExternal(firstDevUrl)
      } catch (error) {
        console.warn('[devUrlLauncher] openExternal failed:', firstDevUrl, error)
      }
      return
    }

    if (isDevStopping || pendingOpenDevUrl) return

    setPendingOpenDevUrl(true)

    // Tasks already ramping — just wait for the URL, don't restart the session.
    if (isDevRunning || isStartPending) return

    try {
      const started = start ? await start() : await startProject(projectId, undefined, undefined, undefined, undefined, runStartupMode === 'terminal' ? 'silent' : undefined)
      if (!started) {
        setPendingOpenDevUrl(false)
      }
    } catch (error) {
      setPendingOpenDevUrl(false)
      throw error
    }
  }, [firstDevUrl, isDevRunning, isDevStopping, isStartPending, pendingOpenDevUrl, projectId, runStartupMode, start, startProject])

  return {
    firstDevUrl,
    isDevReady,
    pendingOpenDevUrl,
    startAndOpenDevUrl,
  }
}
