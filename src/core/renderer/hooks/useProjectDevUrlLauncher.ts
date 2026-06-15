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
}

export function useProjectDevUrlLauncher({
  projectId,
  processStatus,
  processUrls,
  runStartupMode,
  startProject,
}: UseProjectDevUrlLauncherOptions) {
  const [pendingOpenDevUrl, setPendingOpenDevUrl] = useState(false)
  const sawRunningWhilePendingRef = useRef(false)

  const isDevRunning = processStatus === 'running'
  const isDevStopping = processStatus === 'stopping'
  const isDevReady = isDevRunning && processUrls.length > 0
  const firstDevUrl = isDevReady ? processUrls[0] : null

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

    void window.electronAPI.openExternal(firstDevUrl)
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
      await window.electronAPI.openExternal(firstDevUrl)
      return
    }

    if (isDevStopping || pendingOpenDevUrl) return

    setPendingOpenDevUrl(true)

    if (isDevRunning) return

    try {
      const started = await startProject(
        projectId,
        undefined,
        undefined,
        undefined,
        undefined,
        runStartupMode === 'terminal' ? 'silent' : undefined
      )
      if (!started) {
        setPendingOpenDevUrl(false)
      }
    } catch (error) {
      setPendingOpenDevUrl(false)
      throw error
    }
  }, [firstDevUrl, isDevRunning, isDevStopping, pendingOpenDevUrl, projectId, runStartupMode, startProject])

  return {
    firstDevUrl,
    isDevReady,
    pendingOpenDevUrl,
    startAndOpenDevUrl,
  }
}
