import { useEffect, useState } from 'react'

export type EffectiveTheme = 'light' | 'dark'

export function readEffectiveTheme(): EffectiveTheme {
  if (typeof document === 'undefined') return 'dark'
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light'
}

export function useEffectiveTheme(): EffectiveTheme {
  const [theme, setTheme] = useState<EffectiveTheme>(() => readEffectiveTheme())

  useEffect(() => {
    const root = document.documentElement
    const syncTheme = () => {
      setTheme(root.getAttribute('data-theme') === 'dark' ? 'dark' : 'light')
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

  return theme
}
