import { clipboard } from 'electron'
import koffi from 'koffi'

// 把一段文本「粘贴」到当前系统聚焦窗口的光标处（Windows 专用）。
// 实现：备份剪贴板 → 写入文本 → 用 koffi 直接调 user32 的 GetAsyncKeyState 轮询
// 等待物理 Ctrl/Shift 释放，再 keybd_event 注入 Ctrl+V（无子进程冷启动）→
// 目标应用完成读取后，仅当剪贴板仍是我们写入的文本时才恢复原剪贴板内容。
// 文本只经 Electron clipboard（CF_UNICODETEXT）传递，不经命令行参数，规避中文/特殊字符编码问题。

const KEY_RELEASE_TIMEOUT_MS = 1500
const PASTE_SETTLE_MS = 900

// Windows 虚拟键码与 keybd_event 标志。
const VK_CONTROL = 0x11
const VK_SHIFT = 0x10
const VK_V = 0x56
const KEYEVENTF_KEYUP = 0x0002

type Win32Input = {
  keybd_event: (vk: number, scan: number, flags: number, extra: number) => void
  getAsyncKeyState: (vk: number) => number
}

// lazy 单例：undefined=尚未尝试加载，null=加载失败（fail-fast，不回退旧通道）。
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

// 等物理 Ctrl/Shift 释放，避免注入时被系统解读成 Ctrl+Shift+V（在终端里语义不同）。超时返回 false。
async function waitForModifierRelease(input: Win32Input): Promise<boolean> {
  const deadline = Date.now() + KEY_RELEASE_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (input.getAsyncKeyState(VK_CONTROL) >= 0 && input.getAsyncKeyState(VK_SHIFT) >= 0) {
      return true
    }
    await delay(10)
  }
  return false
}

function sendCtrlV(input: Win32Input): void {
  input.keybd_event(VK_CONTROL, 0, 0, 0)
  input.keybd_event(VK_V, 0, 0, 0)
  input.keybd_event(VK_V, 0, KEYEVENTF_KEYUP, 0)
  input.keybd_event(VK_CONTROL, 0, KEYEVENTF_KEYUP, 0)
}

type ClipboardSnapshot = {
  hasContent: boolean
  text?: string
  html?: string
  rtf?: string
  image?: Electron.NativeImage
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
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
  if (process.platform !== 'win32') {
    console.warn('[active-window-paste] Only supported on Windows; skipped.')
    return
  }

  const input = loadWin32Input()
  if (!input) {
    console.warn('[active-window-paste] koffi/user32 unavailable, paste skipped.')
    return
  }

  const snapshot = snapshotClipboard()
  try {
    clipboard.writeText(text)
    await waitForModifierRelease(input)
    sendCtrlV(input)
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
