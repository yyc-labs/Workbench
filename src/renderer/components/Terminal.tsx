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
  const sendInput = useAppStore((s) => s.sendInput)
  const appendOutput = useAppStore((s) => s.appendOutput)

  useEffect(() => {
    if (!containerRef.current) return

    const term = new XTerm({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: "'JetBrains Mono', 'Menlo', 'Monaco', 'Courier New', monospace",
      theme: {
        background: '#0d1117',
        foreground: '#e6edf3',
        cursor: '#e6edf3',
        selectionBackground: '#264f78',
      },
      allowProposedApi: true,
      convertEol: true,
    })

    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    fitAddonRef.current = fitAddon

    term.open(containerRef.current)

    // Replay existing logs captured before this Terminal mounted (e.g. from Home page)
    const existingOutput = useAppStore.getState().terminalOutputs[projectId]
    if (existingOutput) {
      term.write(existingOutput)
    } else {
      term.writeln('Project Launcher — Press Run to start the project.\r\n')
    }

    term.onData((data: string) => {
      sendInput(projectId, data)
    })

    xtermRef.current = term

    // Initial fit: requestAnimationFrame ensures flex layout has settled
    requestAnimationFrame(() => {
      fitAddon.fit()
    })

    // ResizeObserver: re-fit when container changes size (flex, panel resize, etc.)
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
          const normalized = data.replace(/\r?\n/g, '\r\n')
          xtermRef.current.write(normalized)
          appendOutput(projectId, normalized)
        }
      }
    )
    return cleanup
  }, [projectId, appendOutput])

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
