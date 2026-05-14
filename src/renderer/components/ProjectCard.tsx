import { useNavigate } from 'react-router-dom'
import type { ProjectInfo } from '../../shared/types'
import { useAppStore } from '../stores/appStore'
import { Badge } from './ui/badge'
import { Pin, Play, Square, Folder, ExternalLink, Trash2, FileText, Zap } from 'lucide-react'

interface ProjectCardProps {
  project: ProjectInfo
  onSelect: (id: string) => void
  index?: number
}

export function ProjectCard({ project, onSelect, index = 0 }: ProjectCardProps) {
  const navigate = useNavigate()

  const devStatus = useAppStore((s) => s.processes[project.id]?.status ?? 'stopped')
  const devUrl = useAppStore((s) => s.processUrls[project.id] || '')
  const startProject = useAppStore((s) => s.startProject)
  const stopProject = useAppStore((s) => s.stopProject)

  const session = useAppStore((s) => s.sessions[project.id])
  const isRuntimeAttached = session?.status === 'attached'
  const isRuntimeDetached = session?.status === 'detached'
  const isRuntimeActive = isRuntimeAttached || isRuntimeDetached

  const togglePin = useAppStore((s) => s.togglePin)
  const removeProject = useAppStore((s) => s.removeProject)
  const isDevRunning = devStatus === 'running'

  return (
    <div
      className="group relative flex items-center gap-4 rounded-xl px-5 py-2.5 cursor-pointer
                 transition-all duration-150 ease-out card-enter"
      style={{
        background: '#f6f6f4',
        border: '1px solid #e2e2df',
        animationDelay: `${index * 40}ms`,
      }}
      onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#d4d4cf' }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#e2e2df' }}
      onClick={() => onSelect(project.id)}
    >
      {/* Icon */}
      <div className="w-9 h-9 rounded-lg bg-blue-50 flex items-center justify-center shrink-0">
        <Folder className="h-4 w-4 text-blue-600" strokeWidth={1.8} />
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-gray-900 truncate">{project.name}</h3>
          {/* Runtime status */}
          {isRuntimeActive ? (
            <span
              className={`inline-flex items-center gap-1 text-[10px] font-medium shrink-0 ${
                isRuntimeAttached ? 'text-emerald-600' : 'text-amber-600'
              }`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  isRuntimeAttached ? 'bg-emerald-500' : 'bg-amber-500'
                }`}
              />
              {isRuntimeAttached ? 'Active' : 'Background'}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-[10px] text-gray-400 font-medium shrink-0">
              <span className="w-1.5 h-1.5 rounded-full bg-gray-300" />
              Offline
            </span>
          )}
          {isDevRunning && (
            <span className="inline-flex items-center gap-1 text-[10px] font-medium text-blue-600 shrink-0">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
              Dev
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 mt-1">
          <p className="text-xs text-gray-500 truncate max-w-[280px]" title={project.path}>{project.path}</p>
          <Badge variant="secondary" className="text-[10px] h-5 px-1.5 capitalize font-medium shrink-0 bg-[#eae9e6] text-gray-500 border-[#e2e2df]">
            {project.type}
          </Badge>
          {project.packageManager && (
            <Badge variant="secondary" className="text-[10px] h-5 px-1.5 font-medium shrink-0 bg-[#eae9e6] text-gray-500 border-[#e2e2df]">
              {project.packageManager}
            </Badge>
          )}
        </div>
        {isRuntimeActive && session && (
          <p className="text-[10px] text-gray-400 mt-0.5 flex items-center gap-1">
            <Zap className="w-2.5 h-2.5" />
            {session.sessionName}
            {isRuntimeAttached && <span className="text-blue-600/60">· Connected</span>}
          </p>
        )}
      </div>

      {/* Actions — compact grouped */}
      <div className="flex items-center gap-1 shrink-0">
        {isDevRunning && devUrl && (
          <button
            className="flex items-center gap-1 text-xs text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg px-2.5 py-1.5 transition-colors max-w-[200px]"
            onClick={(e) => { e.stopPropagation(); window.electronAPI.openExternal(devUrl) }}
            title={devUrl}
          >
            <ExternalLink className="h-3 w-3 shrink-0" />
            <span className="truncate">{devUrl}</span>
          </button>
        )}
        {isDevRunning ? (
          <button
            className="h-8 px-3 text-xs rounded-lg border border-red-200 text-red-500 hover:bg-red-50 flex items-center gap-1 font-medium transition-colors shrink-0"
            onClick={(e) => { e.stopPropagation(); stopProject(project.id) }}
          >
            <Square className="h-3 w-3" />
            <span className="hidden sm:inline">Stop</span>
          </button>
        ) : (
          <button
            className="h-8 px-3 text-xs rounded-lg bg-blue-600 text-white hover:bg-blue-700 flex items-center gap-1 font-medium transition-colors shrink-0"
            onClick={(e) => { e.stopPropagation(); startProject(project.id, undefined, undefined, false) }}
          >
            <Play className="h-3 w-3" />
            <span className="hidden sm:inline">Run</span>
          </button>
        )}
        <button
          className="h-8 w-8 rounded-lg flex items-center justify-center text-gray-400 hover:text-blue-600 hover:bg-[#eae9e6] transition-colors"
          title="View details"
          onClick={(e) => { e.stopPropagation(); navigate(`/project/${project.id}`) }}
        >
          <FileText className="h-4 w-4" />
        </button>
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-all">
          <button
            className="p-1 rounded-md text-gray-400 hover:text-amber-500 hover:bg-amber-500/10 transition-colors"
            title={project.pinned ? 'Unpin' : 'Pin'}
            onClick={(e) => { e.stopPropagation(); togglePin(project.id) }}
          >
            <Pin className={`h-3.5 w-3.5 ${project.pinned ? 'fill-amber-500 text-amber-500' : ''}`} />
          </button>
          <button
            className="p-1 rounded-md text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
            title="Remove"
            onClick={(e) => { e.stopPropagation(); removeProject(project.id) }}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  )
}
