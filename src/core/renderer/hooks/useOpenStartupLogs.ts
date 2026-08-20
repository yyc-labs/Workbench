import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'

export function useOpenStartupLogs() {
  const navigate = useNavigate()

  return useCallback(
    (projectId: string) => {
      navigate(`/settings/logs?project=${encodeURIComponent(projectId)}`)
    },
    [navigate],
  )
}
