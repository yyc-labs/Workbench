import { useCallback, useEffect, useRef, useState } from 'react'
import { captureScrollableContentToClipboard } from '../lib/scrollableContentCapture'

type CaptureStatus = 'idle' | 'running' | 'success' | 'error'

export function useScrollableContentCapture() {
  const targetRef = useRef<HTMLDivElement | null>(null)
  const contentRef = useRef<HTMLElement | null>(null)
  const [status, setStatus] = useState<CaptureStatus>('idle')
  const resetTimerRef = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (resetTimerRef.current !== null) {
        window.clearTimeout(resetTimerRef.current)
        resetTimerRef.current = null
      }
    }
  }, [])

  const capture = useCallback(async () => {
    const target = targetRef.current
    if (!target || status === 'running') return false

    if (resetTimerRef.current !== null) {
      window.clearTimeout(resetTimerRef.current)
      resetTimerRef.current = null
    }

    setStatus('running')

    try {
      await captureScrollableContentToClipboard(target, {
        contentElement: contentRef.current,
      })
      setStatus('success')
      resetTimerRef.current = window.setTimeout(() => {
        setStatus('idle')
        resetTimerRef.current = null
      }, 1600)
      return true
    } catch {
      setStatus('error')
      resetTimerRef.current = window.setTimeout(() => {
        setStatus('idle')
        resetTimerRef.current = null
      }, 2200)
      return false
    }
  }, [status])

  return {
    capture,
    contentRef,
    status,
    targetRef,
  }
}
