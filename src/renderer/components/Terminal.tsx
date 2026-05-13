import { useEffect, useRef } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { useAppStore } from '../stores/appStore'

interface TerminalProps {
  projectId: string
}

export function Terminal({ projectId }: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const xtermRef = useRef<XTerm | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const projectIdRef = useRef(projectId)
  projectIdRef.current = projectId
  const sendInput = useAppStore((s) => s.sendInput)

  useEffect(() => {
    if (!containerRef.current) return

    const term = new XTerm({
      cursorBlink: true,
      fontSize: 13,
      lineHeight: 1.5,
      letterSpacing: 0.3,
      fontFamily: "'JetBrains Mono', 'Menlo', 'Monaco', 'Courier New', monospace",
      theme: {
        background: '#f6f8fc',
        foreground: '#1f2937',
        cursor: '#2563eb',
        selectionBackground: '#bfdbfe80',
        black: '#111827',
        red: '#dc2626',
        green: '#16a34a',
        yellow: '#ca8a04',
        blue: '#2563eb',
        magenta: '#7c3aed',
        cyan: '#0891b2',
        white: '#374151',
      },
      allowProposedApi: true,
      convertEol: true,
    })

    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    fitAddonRef.current = fitAddon

    term.open(containerRef.current)

    const existingOutput = useAppStore.getState().terminalOutputs[projectId]
    if (existingOutput) {
      term.write(existingOutput)
    } else {
      term.writeln('Project Launcher — Press Run to start the project.\r\n')
    }

    term.onData((data: string) => {
      sendInput(projectIdRef.current, data)
    })

    term.onResize(({ cols, rows }) => {
      window.electronAPI.resizeTerminal(projectIdRef.current, cols, rows)
    })

    xtermRef.current = term

    requestAnimationFrame(() => {
      fitAddon.fit()
    })

    const observer = new ResizeObserver(() => {
      fitAddon.fit()
    })
    observer.observe(containerRef.current)

    return () => {
      observer.disconnect()
      term.dispose()
      xtermRef.current = null
    }
  }, [projectId, sendInput])

  useEffect(() => {
    const cleanup = window.electronAPI.onProcessOutput(
      ({ projectId: pid, data }) => {
        if (pid === projectId && xtermRef.current) {
          xtermRef.current.write(data)
        }
      }
    )
    return cleanup
  }, [projectId])

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
    />
  )
}
