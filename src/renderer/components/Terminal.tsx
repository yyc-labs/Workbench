import { useEffect, useRef, memo } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { useAppStore } from '../stores/appStore'

interface TerminalProps {
  projectId: string
}

export const Terminal = memo(function Terminal({ projectId }: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const xtermRef = useRef<XTerm | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const projectIdRef = useRef(projectId)
  projectIdRef.current = projectId
  const sendInput = useAppStore((s) => s.sendInput)

  useEffect(() => {
    if (!containerRef.current) return

    const term = new XTerm({
      // rendererType: 'canvas',
      cursorBlink: true,
      fontSize: 13,
      lineHeight: 1.5,
      letterSpacing: 0.3,
      fontWeight: '500',
      fontWeightBold: '700',
      fontFamily: "'Cascadia Code', 'Consolas', 'Menlo', monospace",
      allowProposedApi: true,
      convertEol: true,
      rightClickSelectsWord: true,
      macOptionIsMeta: true,
      theme: {
        background: '#2b2f36',
        foreground: '#d4d4d4',
        cursor: '#8b949e',
        cursorAccent: '#343840',
        selectionBackground: 'rgba(255,255,255,0.10)',
        black: '#585d67',
        red: '#e06c75',
        green: '#98c379',
        yellow: '#d4a85c',
        blue: '#61afef',
        magenta: '#c678dd',
        cyan: '#56b6c2',
        white: '#bbbbbb',
        brightBlack: '#6e7681',
        brightRed: '#e06c75',
        brightGreen: '#98c379',
        brightYellow: '#e5c07b',
        brightBlue: '#61afef',
        brightMagenta: '#c678dd',
        brightCyan: '#56b6c2',
        brightWhite: '#e4e4e4',
      },
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
  }, [projectId, sendInput])

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
      className="h-full w-full"
      style={{ backgroundColor: '#2b2f36' }}
      onClick={() => xtermRef.current?.focus()}
    />
  )
})
