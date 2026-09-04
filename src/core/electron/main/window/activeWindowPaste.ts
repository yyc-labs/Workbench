import { clipboard } from 'electron'
import koffi from 'koffi'

// 把一段文本「粘贴」到当前系统聚焦窗口的光标处（Windows / macOS / Linux X11）。
// 统一入口负责：备份剪贴板 → 写入文本 → 等待物理修饰键释放 → 注入粘贴组合键 →
// 等目标应用读取后，仅当剪贴板仍是我们写入的文本时才恢复原剪贴板内容。
// 平台后端只实现两个动作：waitForModifierRelease（轮询物理修饰键状态）与
// sendPasteShortcut（注入 Ctrl/Cmd+V）。文本只经 Electron clipboard 传递，
// 不经命令行参数，规避中文/特殊字符编码问题。

const KEY_RELEASE_TIMEOUT_MS = 1500
const PASTE_SETTLE_MS = 900

// 平台粘贴后端协议：各平台提供修饰键轮询与组合键注入两个原语。
type PlatformPasteBackend = {
  // 等粘贴组合键所需的物理修饰键全部释放（Windows/Linux: Ctrl+Shift，macOS: Cmd+Shift）。
  // 避免注入时叠加成 Ctrl+Shift+V / Cmd+Shift+V（在终端里语义不同）。超时返回 false。
  waitForModifierRelease: () => Promise<boolean>
  // 向系统注入粘贴组合键（Windows/Linux: Ctrl+V，macOS: Cmd+V）。
  sendPasteShortcut: () => void
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

// ---- Windows 后端：koffi 直调 user32 keybd_event / GetAsyncKeyState ----

const WIN_VK_CONTROL = 0x11
const WIN_VK_SHIFT = 0x10
const WIN_VK_V = 0x56
const WIN_KEYEVENTF_KEYUP = 0x0002

type Win32Input = {
  keybd_event: (vk: number, scan: number, flags: number, extra: number) => void
  getAsyncKeyState: (vk: number) => number
}

let win32Input: Win32Input | null | undefined

function loadWin32Input(): Win32Input | null {
  if (win32Input !== undefined) return win32Input
  try {
    const user32 = koffi.load('user32.dll')
    win32Input = {
      keybd_event: user32.func('void keybd_event(uchar bVk, uchar bScan, uint dwFlags, uintptr dwExtraInfo)'),
      getAsyncKeyState: user32.func('short GetAsyncKeyState(int vKey)'),
    }
  } catch (error) {
    console.warn('[active-window-paste] Failed to load user32 via koffi.', error)
    win32Input = null
  }
  return win32Input
}

function loadWin32Backend(): PlatformPasteBackend | null {
  const input = loadWin32Input()
  if (!input) return null
  return {
    async waitForModifierRelease() {
      const deadline = Date.now() + KEY_RELEASE_TIMEOUT_MS
      while (Date.now() < deadline) {
        if (input.getAsyncKeyState(WIN_VK_CONTROL) >= 0 && input.getAsyncKeyState(WIN_VK_SHIFT) >= 0) {
          return true
        }
        await delay(10)
      }
      return false
    },
    sendPasteShortcut() {
      input.keybd_event(WIN_VK_CONTROL, 0, 0, 0)
      input.keybd_event(WIN_VK_V, 0, 0, 0)
      input.keybd_event(WIN_VK_V, 0, WIN_KEYEVENTF_KEYUP, 0)
      input.keybd_event(WIN_VK_CONTROL, 0, WIN_KEYEVENTF_KEYUP, 0)
    },
  }
}

// ---- macOS 后端：koffi 直调 CoreGraphics CGEvent 注入 Cmd+V ----

// kCGEventSourceStateCombinedSessionState / kCGHIDEventTap
const CG_EVENT_SOURCE_COMBINED_SESSION = 0
const CG_HID_EVENT_TAP = 0
// kVK_ANSI_Command=55, kVK_ANSI_V=9；kCGEventFlagMaskCommand=0x08, kCGEventFlagMaskShift=0x02
const MAC_VK_COMMAND = 55
const MAC_VK_V = 9
const MAC_FLAG_COMMAND = 0x08
const MAC_FLAG_SHIFT = 0x02

type MacEventApi = {
  eventSourceFlagsState: (state: number) => number
  eventCreateKeyboardEvent: (source: null, virtualKey: number, keyDown: boolean) => unknown
  eventPost: (tap: number, event: unknown) => void
  eventSetFlags: (event: unknown, flags: number) => void
  release: (cf: unknown) => void
}

let macEventApi: MacEventApi | null | undefined

function loadMacEventApi(): MacEventApi | null {
  if (macEventApi !== undefined) return macEventApi
  try {
    const cg = koffi.load('/System/Library/Frameworks/ApplicationServices.framework/ApplicationServices')
    macEventApi = {
      eventSourceFlagsState: cg.func('uint64 CGEventSourceFlagsState(uint32_t stateID)'),
      eventCreateKeyboardEvent: cg.func('void *CGEventCreateKeyboardEvent(void *source, uint16_t virtualKey, bool keyDown)'),
      eventPost: cg.func('void CGEventPost(uint32_t tap, void *event)'),
      eventSetFlags: cg.func('void CGEventSetFlags(void *event, uint64_t flags)'),
      release: cg.func('void CFRelease(void *cf)'),
    }
  } catch (error) {
    console.warn('[active-window-paste] Failed to load CoreGraphics via koffi.', error)
    macEventApi = null
  }
  return macEventApi
}

function loadMacBackend(): PlatformPasteBackend | null {
  const api = loadMacEventApi()
  if (!api) return null
  return {
    async waitForModifierRelease() {
      const deadline = Date.now() + KEY_RELEASE_TIMEOUT_MS
      while (Date.now() < deadline) {
        const flags = api.eventSourceFlagsState(CG_EVENT_SOURCE_COMBINED_SESSION)
        if ((flags & MAC_FLAG_COMMAND) === 0 && (flags & MAC_FLAG_SHIFT) === 0) {
          return true
        }
        await delay(10)
      }
      return false
    },
    sendPasteShortcut() {
      const postKey = (virtualKey: number, keyDown: boolean, flags: number) => {
        const event = api.eventCreateKeyboardEvent(null, virtualKey, keyDown)
        if (!event) return
        api.eventSetFlags(event, flags)
        api.eventPost(CG_HID_EVENT_TAP, event)
        api.release(event)
      }
      postKey(MAC_VK_COMMAND, true, MAC_FLAG_COMMAND)
      postKey(MAC_VK_V, true, MAC_FLAG_COMMAND)
      postKey(MAC_VK_V, false, 0)
      postKey(MAC_VK_COMMAND, false, 0)
    },
  }
}

// ---- Linux 后端：koffi 直调 X11 XTest 注入 Ctrl+V（仅 X11，Wayland 不支持）----

const X_KEYSYM_V = 0x0076
const X_KEYSYM_CONTROL = 0xffe3
const X_KEYSYM_SHIFT = 0xffe1

type X11Input = {
  display: unknown
  keysymToKeycode: (display: unknown, keysym: number) => number
  queryKeymap: (display: unknown, keys: Buffer) => void
  fakeKeyEvent: (display: unknown, keycode: number, isPress: boolean, delay: number) => number
}

let x11Input: X11Input | null | undefined

function loadX11Input(): X11Input | null {
  if (x11Input !== undefined) return x11Input
  try {
    const x11 = koffi.load('libX11.so.6')
    const xtst = koffi.load('libXtst.so.6')
    const xOpenDisplay = x11.func('void *XOpenDisplay(const char *display_name)')
    const xKeysymToKeycode = x11.func('unsigned char XKeysymToKeycode(void *display, unsigned long keysym)')
    const xQueryKeymap = x11.func('void XQueryKeymap(void *display, _Out_ uchar keys_return[32])')
    const display = xOpenDisplay(null)
    if (!display) {
      // Wayland 或无 X server：无法注入，fail-fast。
      console.warn('[active-window-paste] XOpenDisplay failed (Wayland not supported), paste skipped.')
      x11Input = null
      return x11Input
    }
    x11Input = {
      display,
      keysymToKeycode: xKeysymToKeycode,
      queryKeymap: xQueryKeymap,
      fakeKeyEvent: xtst.func('int XTestFakeKeyEvent(void *display, unsigned int keycode, int is_press, unsigned long delay)'),
    }
  } catch (error) {
    console.warn('[active-window-paste] Failed to load X11/Xtst via koffi.', error)
    x11Input = null
  }
  return x11Input
}

function loadLinuxBackend(): PlatformPasteBackend | null {
  const input = loadX11Input()
  if (!input) return null
  // 缓存 v / Control / Shift 的 keycode，键盘布局一般不中途变化。
  const keycodes = [X_KEYSYM_V, X_KEYSYM_CONTROL, X_KEYSYM_SHIFT].map((keysym) => input.keysymToKeycode(input.display, keysym))
  if (keycodes.some((code) => !code)) {
    console.warn('[active-window-paste] Failed to resolve X11 keycodes, paste skipped.')
    return null
  }
  const [vkV, vkControl, vkShift] = keycodes
  const isKeyPressed = (keycode: number): boolean => {
    const keys = Buffer.alloc(32)
    input.queryKeymap(input.display, keys)
    return (keys[keycode >> 3] & (1 << (keycode & 7))) !== 0
  }
  return {
    async waitForModifierRelease() {
      const deadline = Date.now() + KEY_RELEASE_TIMEOUT_MS
      while (Date.now() < deadline) {
        if (!isKeyPressed(vkControl) && !isKeyPressed(vkShift)) {
          return true
        }
        await delay(10)
      }
      return false
    },
    sendPasteShortcut() {
      input.fakeKeyEvent(input.display, vkControl, true, 0)
      input.fakeKeyEvent(input.display, vkV, true, 0)
      input.fakeKeyEvent(input.display, vkV, false, 0)
      input.fakeKeyEvent(input.display, vkControl, false, 0)
    },
  }
}

// ---- 统一入口 ----

let pasteBackend: PlatformPasteBackend | null | undefined

function loadPasteBackend(): PlatformPasteBackend | null {
  if (pasteBackend !== undefined) return pasteBackend
  if (process.platform === 'win32') pasteBackend = loadWin32Backend()
  else if (process.platform === 'darwin') pasteBackend = loadMacBackend()
  else if (process.platform === 'linux') pasteBackend = loadLinuxBackend()
  else pasteBackend = null
  return pasteBackend
}

type ClipboardSnapshot = {
  hasContent: boolean
  text?: string
  html?: string
  rtf?: string
  image?: Electron.NativeImage
}

function snapshotClipboard(): ClipboardSnapshot {
  const snapshot: ClipboardSnapshot = { hasContent: false }
  try {
    const text = clipboard.readText()
    if (text) {
      snapshot.text = text
      snapshot.hasContent = true
    }
  } catch {
    // 忽略读剪贴板失败
  }
  try {
    const html = clipboard.readHTML()
    if (html) {
      snapshot.html = html
      snapshot.hasContent = true
    }
  } catch {
    // 忽略读剪贴板失败
  }
  try {
    const rtf = clipboard.readRTF()
    if (rtf) {
      snapshot.rtf = rtf
      snapshot.hasContent = true
    }
  } catch {
    // 忽略读剪贴板失败
  }
  try {
    const image = clipboard.readImage()
    if (!image.isEmpty()) {
      snapshot.image = image
      snapshot.hasContent = true
    }
  } catch {
    // 忽略读剪贴板失败
  }
  return snapshot
}

function restoreClipboard(snapshot: ClipboardSnapshot): void {
  try {
    if (!snapshot.hasContent) {
      clipboard.clear()
      return
    }
    clipboard.write({
      ...(snapshot.text ? { text: snapshot.text } : {}),
      ...(snapshot.html ? { html: snapshot.html } : {}),
      ...(snapshot.rtf ? { rtf: snapshot.rtf } : {}),
      ...(snapshot.image ? { image: snapshot.image } : {}),
    })
  } catch (error) {
    console.warn('[active-window-paste] Failed to restore clipboard.', error)
  }
}

export async function pasteTextToActiveWindow(text: string): Promise<void> {
  const backend = loadPasteBackend()
  if (!backend) {
    console.warn('[active-window-paste] No paste backend available on this platform, paste skipped.')
    return
  }

  const snapshot = snapshotClipboard()
  try {
    clipboard.writeText(text)
    await backend.waitForModifierRelease()
    backend.sendPasteShortcut()
    await delay(PASTE_SETTLE_MS)
    // 窗口期内若用户复制了新内容（剪贴板文本已不是本次写入的提示词），
    // 说明用户意图变更，不再恢复，避免覆盖新复制的内容。
    if (clipboard.readText() === text) {
      restoreClipboard(snapshot)
    }
  } catch (error) {
    console.warn('[active-window-paste] Paste to active window failed.', error)
    try {
      restoreClipboard(snapshot)
    } catch {
      // 忽略恢复失败
    }
  }
}
