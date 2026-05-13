import { useEffect } from 'react'
import { MemoryRouter as Router, Routes, Route } from 'react-router-dom'
import { HomePage } from './pages/Home'
import { DetailPage } from './pages/Detail'
import { TerminalPage } from './pages/TerminalPage'
import { SettingsPage } from './pages/Settings'
import { useAppStore } from './stores/appStore'

function ProcessOutputListener() {
  const appendOutput = useAppStore((s) => s.appendOutput)
  const updateProcessStatus = useAppStore((s) => s.updateProcessStatus)
  const handleProcessExit = useAppStore((s) => s.handleProcessExit)

  useEffect(() => {
    const unsubOutput = window.electronAPI.onProcessOutput(
      ({ projectId, data }) => {
        appendOutput(projectId, data)
      }
    )
    const unsubStatus = window.electronAPI.onProcessStatus(
      ({ projectId, status }) => {
        updateProcessStatus(projectId, status)
      }
    )
    const unsubExit = window.electronAPI.onProcessExit(
      ({ projectId, code }) => {
        handleProcessExit(projectId, code)
      }
    )

    return () => {
      unsubOutput()
      unsubStatus()
      unsubExit()
    }
  }, [appendOutput, updateProcessStatus, handleProcessExit])

  return null
}

/** One-time boot init: load config, detect capability, rehydrate tmux sessions. */
function AppInit() {
  const initApp = useAppStore((s) => s.initApp)

  useEffect(() => {
    initApp()
  }, [initApp])

  return null
}

export function App() {
  return (
    <Router>
      <AppInit />
      <ProcessOutputListener />
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/project/:projectId" element={<DetailPage />} />
        <Route path="/terminal/:projectId" element={<TerminalPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Routes>
    </Router>
  )
}
