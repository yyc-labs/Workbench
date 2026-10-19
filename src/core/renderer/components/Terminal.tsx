import { useEffect, useRef, memo } from 'react'
import { Terminal as XTerm, type ITheme } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { TERMINAL_FONT_METRICS } from '../lib/terminalViewportSize'
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

/**
 * 回放只写尾部：面板是「看一眼」语义，长历史应去日志文件（设置 → 日志）。
 * 从换行边界切入，避免把半行/半个转义序列写进 xterm 造成花屏。
 */
const REPLAY_TAIL_CHARS = 30_000

function replayTail(text: string): string {
  if (text.length <= REPLAY_TAIL_CHARS) return text
  const tail = text.slice(text.length - REPLAY_TAIL_CHARS)
  const firstBreak = tail.search(/[\r\n]/)
  return firstBreak >= 0 ? tail.slice(firstBreak + 1) : tail
}

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
      // 字体规格与 lib/terminalViewportSize.ts 单一事实源：
      // 该文件按同规格预测面板视口尺寸，供 pty 启动时使用，两侧漂移会引入尺寸差。
      fontSize: TERMINAL_FONT_METRICS.fontSize,
      lineHeight: TERMINAL_FONT_METRICS.lineHeight,
      letterSpacing: TERMINAL_FONT_METRICS.letterSpacing,
      fontWeight: 450,
      fontWeightBold: 650,
      fontFamily: TERMINAL_FONT_METRICS.fontFamily,
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
    // 先按容器实际宽度同步 fit 再写输出：open 后默认 80 列，长路径 prompt 会先换行，
    // 等 80ms 防抖的 fit 生效才回流成一行（可见的分行闪烁）。
    fitAddon.fit()
    term.focus()

    const existingOutput = useAppStore.getState().terminalOutputs[projectId]
    if (existingOutput) {
      term.write(replayTail(existingOutput))
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

    const cleanup = window.electronAPI.onProcessOutput(({ projectId: pid, data }) => {
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
    })
    return () => {
      cancelAnimationFrame(raf)
      cleanup()
    }
  }, [projectId])

  // ── Status messages ───────────────────────────────────────
  useEffect(() => {
    const cleanup = window.electronAPI.onProcessStatus(({ projectId: pid, status }) => {
      if (pid === projectId && xtermRef.current) {
        xtermRef.current.write(`\r\n\x1b[2m*** ${status} ***\x1b[0m\r\n`)
      }
    })
    return cleanup
  }, [projectId])

  return <div ref={containerRef} className="h-full w-full xterm-container" onClick={() => xtermRef.current?.focus()} />
})
