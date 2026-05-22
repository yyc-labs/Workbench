import { ProjectCard } from '../../components/ProjectCard'
import { WorkspaceClassifierPanel } from '../../components/WorkspaceClassifierPanel'
import { ScrollArea } from '../../components/ui/scroll-area'
import { FolderOpen, Pin } from 'lucide-react'
import type { HomeProjectsContentProps } from './home.types'

function HomeProjectsContent({
  folders,
  tags,
  configStartupDefaultFilter,
  classifierFilter,
  classifierCounts,
  setClassifierFilter,
  reorderFolders,
  reorderTags,
  setStartupDefaultFilter,
  pinnedProjects,
  recentProjects,
  groupedRecentProjects,
  envFilteredProjectsCount,
  runningCount,
  onSelect,
  searchQuery,
  envFilter,
}: HomeProjectsContentProps) {
  return (
    <ScrollArea className="flex-1">
      <div className="content-breathe">
        <div className="mb-8 flex items-end justify-between gap-6">
          <div>
            <p className="section-label mb-2">Workspace</p>
            <h1 className="text-[28px] font-semibold tracking-[-0.035em] text-[color:var(--color-foreground)]">Projects</h1>
          </div>
          <p className="mb-1 flex items-center gap-2 text-[13px] text-[color:var(--color-muted-foreground)]">
            <span>{envFilteredProjectsCount} project{envFilteredProjectsCount !== 1 ? 's' : ''}</span>
            {runningCount > 0 && (
              <>
                <span className="text-[color:var(--color-muted-foreground)]/70">&middot;</span>
                <span className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-[color:var(--color-success)]" />
                  {runningCount} runtime{runningCount !== 1 ? 's' : ''} active
                </span>
              </>
            )}
          </p>
        </div>

        <div className="flex flex-col gap-5 md:flex-row md:items-start">
          <WorkspaceClassifierPanel
            folders={folders}
            tags={tags}
            activeFilter={classifierFilter}
            counts={classifierCounts}
            onChangeFilter={setClassifierFilter}
            onReorderFolders={reorderFolders}
            onReorderTags={reorderTags}
            startupDefaultFilter={configStartupDefaultFilter}
            onSetStartupDefaultFilter={setStartupDefaultFilter}
          />

          <div className="min-w-0 flex-1">
            {pinnedProjects.length > 0 && (
              <div className="mb-9">
                <div className="flex items-center gap-2.5 mb-3">
                  <Pin className="w-3.5 h-3.5 text-[color:var(--color-warning)]" strokeWidth={1.8} />
                  <h2 className="section-label">Pinned</h2>
                  <span className="text-[10px] text-[color:var(--color-muted-foreground)]">{pinnedProjects.length}</span>
                </div>
                <div className="flex flex-col gap-2">
                  {pinnedProjects.map((project, index) => (
                    <ProjectCard
                      key={project.id}
                      project={project}
                      folders={folders}
                      tags={tags}
                      index={index}
                      onSelect={onSelect}
                    />
                  ))}
                </div>
              </div>
            )}

            <div>
              <div className="flex items-center gap-2.5 mb-3">
                <FolderOpen className="w-3.5 h-3.5 text-[color:var(--color-muted-foreground)]" strokeWidth={1.8} />
                <h2 className="section-label">
                  {pinnedProjects.length > 0 ? 'Projects' : 'Project Groups'}
                </h2>
                <span className="text-[10px] text-[color:var(--color-muted-foreground)]">{recentProjects.length}</span>
              </div>
              {groupedRecentProjects.length > 0 ? (
                <div className="space-y-7">
                  {groupedRecentProjects.map((group) => (
                    <section key={group.key}>
                      <div className="flex items-center gap-2 mb-3">
                        <h3 className="text-[12px] font-medium text-[color:var(--color-muted-foreground)]">
                          {group.label}
                        </h3>
                        <span className="text-[10px] text-[color:var(--color-muted-foreground)]">
                          {group.projects.length}
                        </span>
                      </div>
                      <div className="flex flex-col gap-2">
                        {group.projects.map((project, index) => (
                          <ProjectCard
                            key={project.id}
                            project={project}
                            folders={folders}
                            tags={tags}
                            index={index}
                            onSelect={onSelect}
                          />
                        ))}
                      </div>
                    </section>
                  ))}
                </div>
              ) : (
                <div className="text-center py-16 text-sm text-[color:var(--color-muted-foreground)]">
                  {searchQuery || envFilter !== 'all'
                    ? 'No projects match your search/filter'
                    : 'No projects yet'}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </ScrollArea>
  )
}

export { HomeProjectsContent }
