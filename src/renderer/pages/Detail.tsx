import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAppStore } from '../stores/appStore'
import { Terminal } from '../components/Terminal'

export function DetailPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const navigate = useNavigate()
  const project = useAppStore((s) =>
    s.projects.find((p) => p.id === projectId)
  )
  const startProject = useAppStore((s) => s.startProject)
  const stopProject = useAppStore((s) => s.stopProject)
  const processStatus = projectId
    ? useAppStore((s) => s.processes[projectId]?.status ?? 'stopped')
    : 'stopped'
  const [customCommand, setCustomCommand] = useState(
    project?.customCommand ?? ''
  )

  if (!project || !projectId) {
    return (
      <div className="error-state">
        <h2>Project not found</h2>
        <button className="btn btn-ghost" onClick={() => navigate('/')}>
          Back to Home
        </button>
      </div>
    )
  }

  const isRunning = processStatus === 'running'

  const handleSaveCommand = async () => {
    const trimmed = customCommand.trim()
    project.customCommand = trimmed || undefined
    // Force re-render by updating the store's project reference
    setCustomCommand(trimmed)
    // Persist
    const { projects } = useAppStore.getState()
    await window.electronAPI.setConfig({
      projects: projects.map((p) => ({
        path: p.path,
        customCommand: p.customCommand,
        pinned: p.pinned,
      })),
    })
  }

  return (
    <div className="detail-page">
      <header className="detail-header">
        <button className="btn btn-ghost" onClick={() => navigate('/')}>
          &larr; Back
        </button>
        <h1>{project.name}</h1>
        <span className="project-type-badge" style={{ backgroundColor: 'var(--accent)' }}>
          {project.type}
        </span>
      </header>

      <section className="detail-info">
        <p>Path: {project.path}</p>
        <p>Default command: {project.command}</p>
        {project.packageManager && (
          <p>Package manager: {project.packageManager}</p>
        )}
      </section>

      <section className="detail-command">
        <label htmlFor="custom-command">Custom command (optional):</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            id="custom-command"
            type="text"
            value={customCommand}
            onChange={(e) => setCustomCommand(e.target.value)}
            placeholder={project.command}
          />
          <button className="btn btn-ghost" onClick={handleSaveCommand}>
            Save
          </button>
        </div>
      </section>

      <section className="detail-controls">
        <button
          className={`btn ${isRunning ? 'btn-stop' : 'btn-start'}`}
          onClick={() =>
            isRunning ? stopProject(projectId) : startProject(projectId)
          }
        >
          {isRunning ? 'Stop' : 'Start'}
        </button>
      </section>

      <section className="detail-terminal">
        <Terminal projectId={projectId} />
      </section>
    </div>
  )
}
