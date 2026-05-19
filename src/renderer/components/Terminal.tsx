import { useEffect, useRef, memo } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { useAppStore } from '../stores/appStore'

interface TerminalProps {
  projectId: string
  variant?: 'default' | 'soft'
}

export const Terminal = memo(function Terminal({ projectId, variant = 'default' }: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const xtermRef = useRef<XTerm | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const projectIdRef = useRef(projectId)
  projectIdRef.current = projectId
  const sendInput = useAppStore((s) => s.sendInput)

  useEffect(() => {
    if (!containerRef.current) return

    const softTheme = {
      background: '#f7f9fd',
      foreground: '#1f2937',
      cursor: '#4f46e5',
      cursorAccent: '#f7f9fd',
      selectionBackground: 'rgba(79,70,229,0.14)',
      black: '#6b7280',
      red: '#dc2626',
      green: '#16a34a',
      yellow: '#ca8a04',
      blue: '#2563eb',
      magenta: '#9333ea',
      cyan: '#0891b2',
      white: '#111827',
      brightBlack: '#94a3b8',
      brightRed: '#ef4444',
      brightGreen: '#22c55e',
      brightYellow: '#eab308',
      brightBlue: '#3b82f6',
      brightMagenta: '#a855f7',
      brightCyan: '#06b6d4',
      brightWhite: '#0f172a',
    }

    const defaultTheme = {
      background: '#282c34',
      foreground: '#d7dae0',
      cursor: '#aab2bf',
      cursorAccent: '#282c34',
      selectionBackground: 'rgba(255,255,255,0.08)',
      black: '#4b5263',
      red: '#e06c75',
      green: '#98c379',
      yellow: '#e5c07b',
      blue: '#61afef',
      magenta: '#c678dd',
      cyan: '#56b6c2',
      white: '#abb2bf',
      brightBlack: '#5c6370',
      brightRed: '#e06c75',
      brightGreen: '#98c379',
      brightYellow: '#e5c07b',
      brightBlue: '#61afef',
      brightMagenta: '#c678dd',
      brightCyan: '#56b6c2',
      brightWhite: '#ffffff',
    }

    const term = new XTerm({
      // rendererType: 'canvas',
      cursorBlink: true,
      fontSize: 13,
      lineHeight: 1.45,
      letterSpacing: 0.2,
      fontWeight: 450,
      fontWeightBold: 650,
      fontFamily: "'JetBrains Mono', 'Cascadia Code', monospace",
      allowProposedApi: true,
      convertEol: true,
      rightClickSelectsWord: true,
      macOptionIsMeta: true,
      theme: variant === 'soft' ? softTheme : defaultTheme,
    })

    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    fitAddonRef.current = fitAddon

    term.open(containerRef.current)
    term.focus()

    const existingOutput = useAppStore.getState().terminalOutputs[projectId]
    if (existingOutput) {
      term.write(existingOutput)
    } else {
      // term.writeln('Starting Claude...\r\n')
    }

    term.onData((data: string) => {
      sendInput(projectIdRef.current, data)
    })

    // Clipboard: Ctrl+Shift+C copy, Ctrl+Shift+V paste (zero-dependency)
    term.attachCustomKeyEventHandler((e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey) {
        if (e.code === 'KeyC') {
          const selection = term.getSelection()
          if (selection) {
            navigator.clipboard.writeText(selection)
          }
          return false
        }
        if (e.code === 'KeyV') {
          navigator.clipboard.readText().then((text) => {
            sendInput(projectIdRef.current, text)
          })
          return false
        }
        if (e.code === 'KeyA' && e.type === 'keydown') {
          term.selectAll()
          const selection = term.getSelection()
          if (selection) navigator.clipboard.writeText(selection)
          return false
        }
      }
      return true
    })

    term.onResize(({ cols, rows }) => {
      window.electronAPI.resizeTerminal(projectIdRef.current, cols, rows)
    })

    xtermRef.current = term

    // ── Fit debounce: 80ms ──────────────────────────────
    let fitTimer: ReturnType<typeof setTimeout>
    const scheduleFit = () => {
      clearTimeout(fitTimer)
      fitTimer = setTimeout(() => {
        fitAddon.fit()
      }, 80)
    }

    scheduleFit()

    const observer = new ResizeObserver(() => {
      scheduleFit()
    })
    observer.observe(containerRef.current)

    return () => {
      clearTimeout(fitTimer)
      observer.disconnect()
      term.dispose()
      xtermRef.current = null
    }
  }, [projectId, sendInput, variant])

  // ── Output: buffer at rAF rate ────────────────────────────
  useEffect(() => {
    let buf = ''
    let raf = 0

    const cleanup = window.electronAPI.onProcessOutput(
      ({ projectId: pid, data }) => {
        if (pid === projectId) {
          buf += data
          if (!raf) {
            raf = requestAnimationFrame(() => {
              xtermRef.current?.write(buf)
              buf = ''
              raf = 0
            })
          }
        }
      }
    )
    return () => {
      cancelAnimationFrame(raf)
      cleanup()
    }
  }, [projectId])

  // ── Status messages ───────────────────────────────────────
  useEffect(() => {
    const cleanup = window.electronAPI.onProcessStatus(
      ({ projectId: pid, status }) => {
        if (pid === projectId && xtermRef.current) {
          xtermRef.current.write(`\r\n\x1b[2m*** ${status} ***\x1b[0m\r\n`)
        }
      }
    )
    return cleanup
  }, [projectId])

  return (
    <div
      ref={containerRef}
      className="h-full w-full xterm-container"
      onClick={() => xtermRef.current?.focus()}
    />
  )
})
