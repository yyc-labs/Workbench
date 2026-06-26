import { useEffect, useState } from 'react'
import { useEffectiveTheme } from '../../hooks/useEffectiveTheme'
import {
  PROJECT_HEADER_COLLAPSED_STORAGE_KEY,
  TRANSCRIPT_SPLIT_QUERY,
  readProjectHeaderCollapsed,
} from './transcriptPage.utils'

export function useTranscriptPageChromeState() {
  const [projectHeaderCollapsed, setProjectHeaderCollapsed] = useState<boolean>(() => readProjectHeaderCollapsed())
  const effectiveTheme = useEffectiveTheme()
  const [isNarrowViewport, setIsNarrowViewport] = useState(
    () => window.matchMedia(TRANSCRIPT_SPLIT_QUERY).matches
  )

  useEffect(() => {
    const media = window.matchMedia(TRANSCRIPT_SPLIT_QUERY)
    const syncViewport = () => setIsNarrowViewport(media.matches)
    syncViewport()
    media.addEventListener('change', syncViewport)
    return () => media.removeEventListener('change', syncViewport)
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem(PROJECT_HEADER_COLLAPSED_STORAGE_KEY, projectHeaderCollapsed ? '1' : '0')
    } catch {
      // ignore storage errors
    }
  }, [projectHeaderCollapsed])

  useEffect(() => {
    const onToggleProjectHeader = () => {
      setProjectHeaderCollapsed((prev) => !prev)
    }
    window.addEventListener('app:toggle-project-header', onToggleProjectHeader as EventListener)
    return () => {
      window.removeEventListener('app:toggle-project-header', onToggleProjectHeader as EventListener)
    }
  }, [])

  return {
    projectHeaderCollapsed,
    setProjectHeaderCollapsed,
    effectiveTheme,
    isNarrowViewport,
  }
}
