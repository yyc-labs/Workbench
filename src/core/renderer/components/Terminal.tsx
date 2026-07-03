import { useEffect, useRef, memo } from 'react'
import { Terminal as XTerm, type ITheme } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { useEffectiveTheme } from '../hooks/useEffectiveTheme'
import { useAppStore } from '../stores/appStore'

interface TerminalProps {
  projectId: string
  variant?: 'default' | 'soft'
}

const LIGHT_THEME: ITheme = {
  background: '#f5f5f7',
  foreground: '#1d1d1f',
  cursor: '#0a84ff',
  cursorAccent: '#f5f5f7',
  selectionBackground: 'rgba(10,132,255,0.16)',
  black: '#6b7280',
  red: '#dc2626',
  green: '#16a34a',
  yellow: '#ca8a04',
  blue: '#0a84ff',
  magenta: '#9333ea',
  cyan: '#0891b2',
  white: '#111827',
  brightBlack: '#94a3b8',
  brightRed: '#ef4444',
  brightGreen: '#22c55e',
  brightYellow: '#eab308',
  brightBlue: '#409cff',
  brightMagenta: '#a855f7',
  brightCyan: '#06b6d4',
  brightWhite: '#0f172a',
}

const DARK_THEME: ITheme = {
  background: '#232326',
  foreground: '#e5e5ea',
  cursor: '#0a84ff',
  cursorAccent: '#232326',
  selectionBackground: 'rgba(255,255,255,0.08)',
  black: '#636366',
  red: '#ff8a85',
  green: '#76d6a2',
  yellow: '#ffd166',
  blue: '#7cb8ff',
  magenta: '#d2b8ef',
  cyan: '#91d7df',
  white: '#d1d1d6',
  brightBlack: '#8e8e93',
  brightRed: '#ffaaa6',
  brightGreen: '#94e5b9',
  brightYellow: '#ffe08f',
  brightBlue: '#a2ccff',
  brightMagenta: '#dfc9f5',
  brightCyan: '#ace3e9',
  brightWhite: '#f5f5f7',
}

const DARK_SOFT_THEME: ITheme = {
  ...DARK_THEME,
  background: '#1f2126',
  cursorAccent: '#1f2126',
}

const XTERM_SCROLLBACK_LINES = 200

function resolveTerminalTheme(theme: 'light' | 'dark', variant: 'default' | 'soft'): ITheme {
  if (theme === 'light') return LIGHT_THEME
  return variant === 'soft' ? DARK_SOFT_THEME : DARK_THEME
}

export const Terminal = memo(function Terminal({ projectId, variant = 'default' }: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const xtermRef = useRef<XTerm | null>(null)
  const projectIdRef = useRef(projectId)
  projectIdRef.current = projectId
  const sendInput = useAppStore((s) => s.sendInput)
  const effectiveTheme = useEffectiveTheme()

  useEffect(() => {
    if (!containerRef.current) return

    const initialTheme = resolveTerminalTheme(effectiveTheme, variant)
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
      scrollback: XTERM_SCROLLBACK_LINES,
      theme: initialTheme,
    })

    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)

    term.open(containerRef.current)
    containerRef.current.style.backgroundColor = initialTheme.background ?? ''
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

  useEffect(() => {
    const theme = resolveTerminalTheme(effectiveTheme, variant)
    if (xtermRef.current) {
      xtermRef.current.options.theme = { ...theme }
    }
    if (containerRef.current) {
      containerRef.current.style.backgroundColor = theme.background ?? ''
    }
  }, [effectiveTheme, variant])

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
