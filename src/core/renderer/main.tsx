import { StrictMode, type ComponentType } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/500.css'
import '@fontsource/jetbrains-mono/600.css'
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

async function loadRootComponent(): Promise<ComponentType> {
  switch (window.location.hash) {
    case '#tray-panel':
      return (await import('./TrayPanelApp')).TrayPanelApp
    case '#transcript-capture':
      return (await import('./TranscriptCaptureApp')).TranscriptCaptureApp
    case '#browser-screenshot':
      return (await import('./BrowserScreenshotCaptureApp')).BrowserScreenshotCaptureApp
    case '#browser-screenshot-viewer':
      return (await import('./BrowserScreenshotViewerApp')).BrowserScreenshotViewerApp
    case '#markdown-document':
      return (await import('./AppViewWindowApp')).MarkdownDocumentWindowApp
    case '#learning-center':
      return (await import('./AppViewWindowApp')).LearningCenterWindowApp
    default:
      return (await import('./App')).App
  }
}

void (async () => {
  try {
    const RootComponent = await loadRootComponent()
    createRoot(rootElement).render(
      <StrictMode>
        <RootComponent />
      </StrictMode>,
    )
  } catch (error) {
    rootElement.textContent = `App mount failed: ${error instanceof Error ? error.message : String(error)}`
    // Keep error visible in window for fast diagnosis when DevTools is unavailable.
    console.error('[renderer.mount] failed', error)
  }
})()
