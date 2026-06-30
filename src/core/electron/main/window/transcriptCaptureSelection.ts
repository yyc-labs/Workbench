import { spawn } from 'child_process'
import { clipboard } from 'electron'
import type {
  TranscriptCaptureInitialText,
  TranscriptCaptureInitialTextSource,
} from '../../../shared/types'

const COPY_HOTKEY_DELAY_MS = 90
const COPY_HOTKEY_SETTLE_MS = 140
const COPY_HOTKEY_TIMEOUT_MS = 1600
const WINDOWS_SELECTION_TIMEOUT_MS = 1200

const WINDOWS_SELECTION_SCRIPT = `
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$focused = [System.Windows.Automation.AutomationElement]::FocusedElement
if ($null -eq $focused) { exit 0 }
$patternObj = $null
if (-not $focused.TryGetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern, [ref]$patternObj)) { exit 0 }
$selection = ([System.Windows.Automation.TextPattern]$patternObj).GetSelection()
if ($null -eq $selection) { exit 0 }
$parts = @()
foreach ($range in $selection) {
  if ($null -eq $range) { continue }
  $text = $range.GetText(-1)
  if ($null -ne $text -and $text.Length -gt 0) {
    $parts += $text
  }
}
[Console]::Write(($parts -join [Environment]::NewLine))
`

export const emptyTranscriptCaptureInitialText: TranscriptCaptureInitialText = {
  text: '',
  source: 'empty',
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function normalizeInitialText(
  text: string,
  source: Exclude<TranscriptCaptureInitialTextSource, 'empty'>
): TranscriptCaptureInitialText {
  return {
    text,
    source: text.trim() ? source : 'empty',
  }
}

export function readTranscriptCaptureClipboardText(): TranscriptCaptureInitialText {
  try {
    return normalizeInitialText(clipboard.readText(), 'clipboard')
  } catch {
    return emptyTranscriptCaptureInitialText
  }
}

function readPrimarySelectionText(): string {
  try {
    return clipboard.readText('selection')
  } catch {
    return ''
  }
}

function runCopyHotkey(): Promise<boolean> {
  if (process.platform === 'win32') {
    return Promise.resolve(false)
  }

  if (process.platform === 'darwin') {
    return runCommand(
      'osascript',
      ['-e', 'tell application "System Events" to keystroke "c" using command down']
    )
  }

  return Promise.resolve(false)
}

function runCommand(command: string, args: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false
    let timeout: ReturnType<typeof setTimeout> | null = null
    const finish = (ok: boolean) => {
      if (settled) return
      settled = true
      if (timeout) {
        clearTimeout(timeout)
      }
      resolve(ok)
    }
    const child = spawn(command, args, {
      stdio: 'ignore',
      windowsHide: true,
    })
    timeout = setTimeout(() => {
      child.kill()
      finish(false)
    }, COPY_HOTKEY_TIMEOUT_MS)

    child.on('error', () => finish(false))
    child.on('exit', (code) => finish(code === 0))
  })
}

function runCommandText(command: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve) => {
    let settled = false
    let timeout: ReturnType<typeof setTimeout> | null = null
    const chunks: Buffer[] = []
    const finish = (text: string) => {
      if (settled) return
      settled = true
      if (timeout) {
        clearTimeout(timeout)
      }
      resolve(text)
    }
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    })
    timeout = setTimeout(() => {
      child.kill()
      finish('')
    }, timeoutMs)

    child.stdout?.on('data', (chunk: Buffer | string) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    })
    child.on('error', () => finish(''))
    child.on('exit', (code) => {
      finish(code === 0 ? Buffer.concat(chunks).toString('utf-8') : '')
    })
  })
}

async function readWindowsSelectedText(): Promise<string> {
  if (process.platform !== 'win32') return ''
  try {
    return await runCommandText(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-STA',
        '-Command',
        WINDOWS_SELECTION_SCRIPT,
      ],
      WINDOWS_SELECTION_TIMEOUT_MS
    )
  } catch {
    return ''
  }
}

export async function captureTranscriptCaptureInitialText(): Promise<TranscriptCaptureInitialText> {
  if (process.platform === 'linux') {
    const selectedText = readPrimarySelectionText()
    if (selectedText.trim()) {
      return normalizeInitialText(selectedText, 'selection')
    }
  }

  if (process.platform === 'win32') {
    const selectedText = await readWindowsSelectedText()
    if (selectedText.trim()) {
      return normalizeInitialText(selectedText, 'selection')
    }
    return readTranscriptCaptureClipboardText()
  }

  const beforeCopy = readTranscriptCaptureClipboardText()
  if (process.platform !== 'darwin') {
    return beforeCopy
  }

  await delay(COPY_HOTKEY_DELAY_MS)
  const copied = await runCopyHotkey()
  if (!copied) {
    return beforeCopy
  }

  await delay(COPY_HOTKEY_SETTLE_MS)
  const afterCopy = readTranscriptCaptureClipboardText()
  if (!afterCopy.text.trim()) {
    return beforeCopy
  }

  if (afterCopy.text !== beforeCopy.text || beforeCopy.source === 'empty') {
    return {
      text: afterCopy.text,
      source: 'selection',
    }
  }

  return afterCopy
}
