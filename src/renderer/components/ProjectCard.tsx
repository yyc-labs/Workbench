import type { ProjectInfo } from '../../shared/types'
import { useAppStore } from '../stores/appStore'
import { Card, CardContent } from './ui/card'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Pin, Play, Square, Folder, Clock } from 'lucide-react'

interface ProjectCardProps {
  project: ProjectInfo
  onSelect: (id: string) => void
  index?: number
}

function timeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  return `${Math.floor(days / 30)}mo ago`
}

export function ProjectCard({ project, onSelect, index = 0 }: ProjectCardProps) {
  const processStatus = useAppStore(
    (s) => s.processes[project.id]?.status ?? 'stopped'
  )
  const startProject = useAppStore((s) => s.startProject)
  const stopProject = useAppStore((s) => s.stopProject)
  const togglePin = useAppStore((s) => s.togglePin)

  const isRunning = processStatus === 'running'

  return (
    <Card
      className={`group relative bg-zinc-900 border-zinc-800 hover:-translate-y-0.5 hover:shadow-lg hover:border-amber-500/20 transition-all duration-200 card-enter ${
        isRunning
          ? 'border-l-2 border-l-green-500/60 bg-zinc-900/80'
          : ''
      }`}
      style={{ animationDelay: `${index * 50}ms` }}
    >
      {/* Pin toggle — top right */}
      <Button
        variant="ghost"
        size="icon"
        className="absolute top-2 right-2 h-6 w-6 text-zinc-500 hover:text-amber-400"
        title={project.pinned ? 'Unpin from favorites' : 'Pin to favorites'}
        onClick={(e) => {
          e.stopPropagation()
          togglePin(project.id)
        }}
      >
        <Pin
          className={`h-3.5 w-3.5 ${project.pinned ? 'fill-amber-400 text-amber-400' : ''}`}
        />
      </Button>

      <CardContent className="p-4 pt-3">
        {/* Row: status dot + project name */}
        <div className="flex items-center gap-2 mb-1 pr-6">
          <div
            className={`w-2 h-2 rounded-full shrink-0 ${
              isRunning ? 'bg-green-500' : 'bg-zinc-600'
            }`}
          />
          <h3
            className="text-sm font-semibold text-zinc-100 truncate cursor-pointer hover:text-amber-400 transition-colors"
            onClick={() => onSelect(project.id)}
          >
            {project.name}
          </h3>
        </div>

        {/* Row: path */}
        <p
          className="text-xs text-zinc-500 truncate mb-2 flex items-center gap-1"
          title={project.path}
        >
          <Folder className="h-3 w-3 shrink-0" />
          {project.path}
        </p>

        {/* Row: badges + time */}
        <div className="flex items-center gap-1.5 mb-3 flex-wrap">
          <Badge variant="secondary" className="text-[10px] h-5 px-2 capitalize">
            {project.type}
          </Badge>
          {project.packageManager && (
            <Badge variant="secondary" className="text-[10px] h-5 px-2">
              {project.packageManager}
            </Badge>
          )}
          {project.lastOpened && (
            <span className="text-[10px] text-zinc-600 ml-auto flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {timeAgo(project.lastOpened)}
            </span>
          )}
        </div>

        {/* Start / Stop button */}
        <Button
          variant={isRunning ? 'outline' : 'default'}
          size="sm"
          className={`w-full h-8 text-xs ${
            isRunning
              ? 'border-red-500/30 text-red-400 hover:bg-red-500/10 hover:border-red-500/50'
              : ''
          }`}
          onClick={() =>
            isRunning ? stopProject(project.id) : startProject(project.id)
          }
        >
          {isRunning ? (
            <Square className="h-3 w-3" />
          ) : (
            <Play className="h-3 w-3" />
          )}
          {isRunning ? 'Stop' : 'Start'}
        </Button>
      </CardContent>
    </Card>
  )
}
