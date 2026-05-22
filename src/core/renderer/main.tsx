import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './styles/global.css'

const rootElement = document.getElementById('root')
if (!rootElement) throw new Error('Root element not found')

try {
  createRoot(rootElement).render(
    <StrictMode>
      <App />
    </StrictMode>
  )
} catch (error) {
  rootElement.textContent = `App mount failed: ${error instanceof Error ? error.message : String(error)}`
  // Keep error visible in window for fast diagnosis when DevTools is unavailable.
  console.error('[renderer.mount] failed', error)
}
