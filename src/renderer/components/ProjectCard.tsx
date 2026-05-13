import { useNavigate } from 'react-router-dom'
import type { ProjectInfo } from '../../shared/types'
import { useAppStore } from '../stores/appStore'
import { Badge } from './ui/badge'
import { Pin, Play, Square, Folder, ExternalLink, Loader2, Trash2, FileText } from 'lucide-react'

interface ProjectCardProps {
  project: ProjectInfo
  onSelect: (id: string) => void
  index?: number
}

export function ProjectCard({ project, onSelect, index = 0 }: ProjectCardProps) {
  const navigate = useNavigate()
  const processStatus = useAppStore(
    (s) => s.processes[project.id]?.status ?? 'stopped'
  )
  const processUrl = useAppStore((s) => s.processUrls[project.id] || '')
  const startProject = useAppStore((s) => s.startProject)
  const stopProject = useAppStore((s) => s.stopProject)
  const togglePin = useAppStore((s) => s.togglePin)
  const removeProject = useAppStore((s) => s.removeProject)

  const isRunning = processStatus === 'running'
  const isDetached = processStatus === 'detached'
  const isActive = isRunning || isDetached

  return (
    <div
      className="group relative flex items-center gap-4 bg-white border border-gray-200
                 rounded-xl px-5 py-3.5 cursor-pointer
                 hover:border-gray-300 transition-all duration-150 ease-out
                 shadow-[0_1px_2px_rgba(0,0,0,0.04)]
                 hover:shadow-[0_4px_12px_rgba(0,0,0,0.06)]
                 card-enter"
      style={{ animationDelay: `${index * 40}ms` }}
      onClick={() => onSelect(project.id)}
    >
      {/* ── Left: icon ── */}
      <div className="w-9 h-9 rounded-lg bg-blue-50 flex items-center justify-center shrink-0">
        <Folder className="h-4.5 w-4.5 text-blue-600" strokeWidth={1.8} />
      </div>

      {/* ── Center: info ── */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-gray-900 truncate">
            {project.name}
          </h3>
          {/* Status dot */}
          <span
            className={`w-2 h-2 rounded-full shrink-0 ${
              isRunning ? 'bg-emerald-500' : isDetached ? 'bg-amber-500' : 'bg-gray-300'
            }`}
            title={isRunning ? 'Running' : isDetached ? 'Session Available' : 'Stopped'}
          />
        </div>
        <div className="flex items-center gap-2 mt-1">
          <p className="text-xs text-gray-500 truncate max-w-[280px]" title={project.path}>
            {project.path}
          </p>
          <Badge variant="secondary" className="text-[10px] h-5 px-1.5 capitalize font-medium shrink-0">
            {project.type}
          </Badge>
          {project.packageManager && (
            <Badge variant="secondary" className="text-[10px] h-5 px-1.5 font-medium shrink-0">
              {project.packageManager}
            </Badge>
          )}
        </div>
      </div>

      {/* ── Right: actions ── */}
      <div className="flex items-center gap-2 shrink-0">
        {/* URL */}
        {isRunning && processUrl && (
          <button
            className="flex items-center gap-1 text-xs text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg px-2.5 py-1.5 transition-colors max-w-[200px]"
            onClick={(e) => {
              e.stopPropagation()
              window.electronAPI.openExternal(processUrl)
            }}
            title={processUrl}
          >
            <ExternalLink className="h-3 w-3 shrink-0" />
            <span className="truncate">{processUrl}</span>
          </button>
        )}
        {isRunning && !processUrl && (
          <div className="flex items-center gap-1 text-xs text-gray-400 bg-gray-50 rounded-lg px-2.5 py-1.5">
            <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
            <span className="hidden sm:inline">Detecting...</span>
          </div>
        )}

        {/* Open / Stop button */}
        {isActive ? (
          <button
            className="h-8 px-3 text-xs rounded-lg border border-red-200 text-red-500 hover:bg-red-50 hover:border-red-300 flex items-center gap-1 font-medium transition-colors shrink-0"
            onClick={(e) => {
              e.stopPropagation()
              stopProject(project.id)
            }}
          >
            <Square className="h-3 w-3" />
            <span className="hidden sm:inline">Stop</span>
          </button>
        ) : (
          <button
            className="h-8 px-3 text-xs rounded-lg bg-blue-600 text-white hover:bg-blue-700 flex items-center gap-1 font-medium transition-colors shrink-0"
            onClick={(e) => {
              e.stopPropagation()
              startProject(project.id)
            }}
          >
            <Play className="h-3 w-3" />
            <span className="hidden sm:inline">Open</span>
          </button>
        )}

        {/* Details button — navigate to Detail page */}
        <button
          className="h-8 w-8 rounded-lg flex items-center justify-center text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
          title="View details"
          onClick={(e) => {
            e.stopPropagation()
            navigate(`/project/${project.id}`)
          }}
        >
          <FileText className="h-4 w-4" />
        </button>

        {/* Hover: Pin + Trash */}
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-all">
          <button
            className="p-1 rounded-md text-gray-400 hover:text-amber-500 hover:bg-amber-50 transition-colors"
            title={project.pinned ? 'Unpin' : 'Pin'}
            onClick={(e) => {
              e.stopPropagation()
              togglePin(project.id)
            }}
          >
            <Pin
              className={`h-3.5 w-3.5 ${project.pinned ? 'fill-amber-400 text-amber-400' : ''}`}
            />
          </button>
          <button
            className="p-1 rounded-md text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
            title="Remove"
            onClick={(e) => {
              e.stopPropagation()
              removeProject(project.id)
            }}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  )
}
