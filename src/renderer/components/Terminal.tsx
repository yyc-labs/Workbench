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
      fontSize: 14,
      fontFamily: "'Menlo', 'Monaco', 'Courier New', monospace",
      theme: {
        background: '#1e1e1e',
        foreground: '#d4d4d4',
        cursor: '#d4d4d4',
        selectionBackground: '#264f78',
      },
      rows: 24,
      cols: 80,
    })

    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    fitAddonRef.current = fitAddon

    term.open(containerRef.current)
    term.write('Project Launcher\r\n')
    term.write('Press Start to run the project.\r\n\r\n')

    term.onData((data: string) => {
      sendInput(projectId, data)
    })

    xtermRef.current = term

    setTimeout(() => fitAddon.fit(), 50)

    return () => {
      term.dispose()
      xtermRef.current = null
    }
  }, [projectId])

  useEffect(() => {
    const cleanup = window.electronAPI.onProcessOutput(
      ({ projectId: pid, data }) => {
        if (pid === projectId && xtermRef.current) {
          xtermRef.current.write(data)
          appendOutput(projectId, data)
        }
      }
    )
    return cleanup
  }, [projectId, appendOutput])

  useEffect(() => {
    const cleanup = window.electronAPI.onProcessStatus(
      ({ projectId: pid, status }) => {
        if (pid === projectId && xtermRef.current) {
          xtermRef.current.write(`\r\n*** Process status: ${status} ***\r\n`)
        }
      }
    )
    return cleanup
  }, [projectId])

  useEffect(() => {
    const handleResize = () => fitAddonRef.current?.fit()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  return (
    <div
      ref={containerRef}
      style={{ width: '100%', height: '100%', minHeight: '300px' }}
    />
  )
}
