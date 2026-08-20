import { ipcRenderer } from 'electron'

type PreviewMouseGestureMessage = {
  type: 'preview:mouse-gesture'
  eventType: 'mousedown' | 'mousemove' | 'mouseup' | 'contextmenu'
  clientX: number
  clientY: number
  button: number
  buttons: number
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
  altKey: boolean
}

let rightDragActive = false
let rightDragStartX = 0
let rightDragStartY = 0

function sendToHost(event: MouseEvent): void {
  const message: PreviewMouseGestureMessage = {
    type: 'preview:mouse-gesture',
    eventType: event.type as PreviewMouseGestureMessage['eventType'],
    clientX: event.clientX,
    clientY: event.clientY,
    button: event.button,
    buttons: event.buttons,
    ctrlKey: event.ctrlKey,
    metaKey: event.metaKey,
    shiftKey: event.shiftKey,
    altKey: event.altKey,
  }
  ipcRenderer.sendToHost('preview:mouse-gesture', message)
}

window.addEventListener(
  'mousedown',
  (event) => {
    if (event.button !== 2) return
    rightDragActive = false
    rightDragStartX = event.clientX
    rightDragStartY = event.clientY
    sendToHost(event)
  },
  true,
)

window.addEventListener(
  'mousemove',
  (event) => {
    if ((event.buttons & 2) === 0) return
    if (!rightDragActive && Math.hypot(event.clientX - rightDragStartX, event.clientY - rightDragStartY) >= 8) rightDragActive = true
    sendToHost(event)
  },
  true,
)

window.addEventListener(
  'mouseup',
  (event) => {
    if (event.button === 2) sendToHost(event)
  },
  true,
)

window.addEventListener(
  'contextmenu',
  (event) => {
    if (rightDragActive) event.preventDefault()
    sendToHost(event)
    rightDragActive = false
  },
  true,
)
