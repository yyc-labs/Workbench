import { useEffect, useState } from 'react'
import type { ProcessPortInventory } from '../../../../shared/types'

export function useProcessPortInventory() {
  const [inventory, setInventory] = useState<ProcessPortInventory | null>(null)
  const [loading, setLoading] = useState(false)

  const refresh = async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const data = await window.electronAPI.listProcessPorts()
      setInventory(data)
    } finally {
      if (!silent) setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  useEffect(() => {
    const timer = window.setInterval(() => {
      void refresh(true)
    }, 5000)
    return () => {
      window.clearInterval(timer)
    }
  }, [])

  return { inventory, loading, refresh }
}
