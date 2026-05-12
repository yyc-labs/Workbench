import type { ProjectInfo } from '../../shared/types'
import { useAppStore } from '../stores/appStore'
import { Card, CardContent } from './ui/card'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Pin, Play, Square, Folder, Clock, ChevronRight } from 'lucide-react'

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
      className="group relative bg-card border shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_rgba(0,0,0,0.04)] hover:-translate-y-1 hover:shadow-[0_12px_30px_rgba(0,0,0,0.08)] transition-all duration-200 ease-out card-enter cursor-pointer"
      style={{ animationDelay: `${index * 50}ms` }}
      onClick={() => onSelect(project.id)}
    >
      {/* Pin toggle — top right */}
      <button
        className="absolute top-3 right-3 p-1 rounded-md text-muted-foreground hover:text-amber-500 hover:bg-amber-50 opacity-0 group-hover:opacity-100 transition-all"
        title={project.pinned ? 'Unpin' : 'Pin to favorites'}
        onClick={(e) => {
          e.stopPropagation()
          togglePin(project.id)
        }}
      >
        <Pin
          className={`h-3.5 w-3.5 ${project.pinned ? 'fill-amber-400 text-amber-400' : ''}`}
        />
      </button>

      <CardContent className="p-5">
        {/* Row: project icon + name + running dot */}
        <div className="flex items-center gap-2.5 mb-1.5 pr-7">
          <div className="w-8 h-8 rounded-lg bg-accent flex items-center justify-center shrink-0">
            <Folder className="h-4 w-4 text-primary" strokeWidth={1.8} />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-foreground truncate">
              {project.name}
            </h3>
          </div>
          <div
            className={`w-2 h-2 rounded-full shrink-0 ml-auto ${
              isRunning ? 'bg-green-500' : 'bg-muted-foreground/30'
            }`}
            title={isRunning ? 'Running' : 'Stopped'}
          />
        </div>

        {/* Row: path */}
        <p
          className="text-xs text-muted-foreground truncate mb-3"
          title={project.path}
        >
          {project.path}
        </p>

        {/* Row: badges + time */}
        <div className="flex items-center gap-1.5 mb-4 flex-wrap">
          <Badge variant="secondary" className="text-[10px] h-5 px-2 capitalize font-medium">
            {project.type}
          </Badge>
          {project.packageManager && (
            <Badge variant="secondary" className="text-[10px] h-5 px-2 font-medium">
              {project.packageManager}
            </Badge>
          )}
          {project.lastOpened && (
            <span className="text-[10px] text-muted-foreground/60 ml-auto flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {timeAgo(project.lastOpened)}
            </span>
          )}
        </div>

        {/* Action button */}
        {isRunning ? (
          <Button
            variant="outline"
            size="sm"
            className="w-full h-9 text-xs rounded-xl border-red-200 text-red-500 hover:bg-red-50 hover:border-red-300"
            onClick={(e) => {
              e.stopPropagation()
              stopProject(project.id)
            }}
          >
            <Square className="h-3 w-3" />
            Stop
          </Button>
        ) : (
          <Button
            size="sm"
            className="w-full h-9 text-xs rounded-xl gap-1.5"
            onClick={(e) => {
              e.stopPropagation()
              startProject(project.id)
            }}
          >
            <Play className="h-3 w-3" />
            Open
          </Button>
        )}
      </CardContent>
    </Card>
  )
}
