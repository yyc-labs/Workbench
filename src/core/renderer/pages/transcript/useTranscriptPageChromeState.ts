import { useEffect, useState } from 'react'
import {
  PROJECT_HEADER_COLLAPSED_STORAGE_KEY,
  TRANSCRIPT_SPLIT_QUERY,
  readProjectHeaderCollapsed,
} from './transcriptPage.utils'

type ThemeMode = 'light' | 'dark'

export function useTranscriptPageChromeState() {
  const [projectHeaderCollapsed, setProjectHeaderCollapsed] = useState<boolean>(() => readProjectHeaderCollapsed())
  const [effectiveTheme, setEffectiveTheme] = useState<ThemeMode>(
    () => (document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light')
  )
  const [isNarrowViewport, setIsNarrowViewport] = useState(
    () => window.matchMedia(TRANSCRIPT_SPLIT_QUERY).matches
  )

  useEffect(() => {
    const root = document.documentElement
    const syncTheme = () => {
      setEffectiveTheme(root.getAttribute('data-theme') === 'dark' ? 'dark' : 'light')
    }
    syncTheme()
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === 'attributes' && record.attributeName === 'data-theme') {
          syncTheme()
          break
        }
      }
    })
    observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] })
    return () => observer.disconnect()
  }, [])

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
