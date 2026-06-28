import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/500.css'
import '@fontsource/jetbrains-mono/600.css'
import { App } from './App'
import { TrayPanelApp } from './TrayPanelApp'
import './styles/global.css'

const rootElement = document.getElementById('root')
if (!rootElement) throw new Error('Root element not found')

if (window.location.hash === '#tray-panel') {
  document.documentElement.style.background = 'transparent'
  document.documentElement.style.backgroundColor = 'transparent'
  document.body.style.background = 'transparent'
  document.body.style.backgroundColor = 'transparent'
  rootElement.style.background = 'transparent'
}

try {
  createRoot(rootElement).render(
    <StrictMode>
      {window.location.hash === '#tray-panel' ? <TrayPanelApp /> : <App />}
    </StrictMode>
  )
} catch (error) {
  rootElement.textContent = `App mount failed: ${error instanceof Error ? error.message : String(error)}`
  // Keep error visible in window for fast diagnosis when DevTools is unavailable.
  console.error('[renderer.mount] failed', error)
}
