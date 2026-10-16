import { Search, Users } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { ProjectInfo } from '../../shared/types'
import { useI18n } from '../i18n'
import { middleTruncatePath, projectDisplayName } from '../lib/projectDisplay'
import { useAppStore } from '../stores/appStore'
import { ModalShell } from './ModalShell'

type SharedDocLinkGroupBindingDialogProps = {
  open: boolean
  groupId: string
  groupName: string
  onClose: () => void
}

const MAX_VISIBLE_TAGS = 3

/**
 * 共享组「绑定项目」弹窗（组侧订阅视图）：
 * 勾选 = 把该组写进项目的 sharedDocLinkGroupIds（与项目侧订阅区同一字段，双向同步）。
 * 项目列表按用户配置的管理文件夹分区，标签既做行内 chips 也做顶部筛选，均来自 workspace 配置。
 */
export function SharedDocLinkGroupBindingDialog({ open, groupId, groupName, onClose }: SharedDocLinkGroupBindingDialogProps) {
  const { t } = useI18n()
  const [query, setQuery] = useState('')
  const [activeTagId, setActiveTagId] = useState('')
  const projects = useAppStore((s) => s.projects)
  const folders = useAppStore((s) => s.folders)
  const tags = useAppStore((s) => s.tags)
  const setProjectSharedDocLinkGroups = useAppStore((s) => s.setProjectSharedDocLinkGroups)

  const orderedFolders = useMemo(() => [...folders].sort((a, b) => a.sortOrder - b.sortOrder), [folders])
  const orderedTags = useMemo(() => [...tags].sort((a, b) => a.sortOrder - b.sortOrder), [tags])

  const isBound = (project: ProjectInfo) => (project.sharedDocLinkGroupIds ?? []).includes(groupId)
  const boundCount = useMemo(() => projects.filter((project) => isBound(project)).length, [projects, groupId])

  const filteredProjects = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    return projects.filter((project) => {
      if (activeTagId && !(project.tagIds ?? []).includes(activeTagId)) return false
      if (!normalizedQuery) return true
      const haystack = `${projectDisplayName(project)} ${project.name} ${project.customName ?? ''} ${project.path}`.toLowerCase()
      return haystack.includes(normalizedQuery)
    })
  }, [activeTagId, projects, query])

  const sections = useMemo(() => {
    const result: Array<{ key: string; name: string; color?: string; items: ProjectInfo[] }> = []
    for (const folder of orderedFolders) {
      const items = filteredProjects.filter((project) => project.folderId === folder.id)
      if (items.length > 0) result.push({ key: folder.id, name: folder.name, color: folder.color, items })
    }
    const unfiled = filteredProjects.filter((project) => !project.folderId || !orderedFolders.some((folder) => folder.id === project.folderId))
    if (unfiled.length > 0) result.push({ key: '__unfiled__', name: t('documentation.unfiled'), items: unfiled })
    return result
  }, [filteredProjects, orderedFolders, t])

  const handleToggle = (project: ProjectInfo, checked: boolean) => {
    const current = project.sharedDocLinkGroupIds ?? []
    const next = checked ? [...new Set([...current, groupId])] : current.filter((id) => id !== groupId)
    void setProjectSharedDocLinkGroups(project.id, next)
  }

  return (
    <ModalShell open={open} onClose={onClose} baseZIndex={1200} widthClassName="max-w-[640px]" ariaLabel={t('documentation.bindProjects')}>
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <p className="section-label mb-1 text-base">{t('documentation.bindProjects')}</p>
          <p className="text-xs text-[color:var(--color-muted-foreground)]">{t('documentation.bindProjectsDescription')}</p>
          <p className="mt-1 inline-flex items-center gap-1.5 text-xs font-medium text-[color:var(--color-foreground)]">
            <Users className="h-3.5 w-3.5" />
            {groupName}
          </p>
        </div>
      </div>

      <div className="mb-3 flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[color:var(--color-muted-foreground)]" />
          <input
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('documentation.bindProjectsSearchPlaceholder')}
            className="quiet-control block h-9 w-full rounded-full border-0 pl-8 pr-3 text-xs text-[color:var(--color-foreground)] placeholder:text-[color:var(--color-muted-foreground)] outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
        <span className="shrink-0 text-[11px] text-[color:var(--color-muted-foreground)]">{t('documentation.bindProjectsBoundCount', { count: boundCount })}</span>
      </div>

      {orderedTags.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            className={`inline-flex h-7 items-center rounded-full px-2.5 text-[11px] transition-colors ${
              activeTagId === '' ? 'bg-primary text-white' : 'border border-[color:var(--color-border)] text-[color:var(--color-muted-foreground)] hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)]'
            }`}
            onClick={() => setActiveTagId('')}
          >
            {t('documentation.all')}
          </button>
          {orderedTags.map((tag) => (
            <button
              key={tag.id}
              type="button"
              className={`inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-[11px] transition-colors ${
                activeTagId === tag.id ? 'bg-primary text-white' : 'border border-[color:var(--color-border)] text-[color:var(--color-muted-foreground)] hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)]'
              }`}
              onClick={() => setActiveTagId((current) => (current === tag.id ? '' : tag.id))}
            >
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: tag.color || 'var(--color-primary)' }} />
              {tag.name}
            </button>
          ))}
        </div>
      )}

      <div className="max-h-[46vh] space-y-3 overflow-y-auto pr-1">
        {sections.length === 0 ? (
          <p className="px-1 py-6 text-center text-xs text-[color:var(--color-muted-foreground)]">{t('documentation.bindProjectsEmpty')}</p>
        ) : (
          sections.map((section) => (
            <div key={section.key}>
              <div className="mb-1 flex items-center gap-1.5 px-1 text-[11px] font-medium text-[color:var(--color-muted-foreground)]">
                {section.color && <span className="h-2 w-2 rounded-full" style={{ background: section.color }} />}
                <span className="min-w-0 flex-1 truncate">{section.name}</span>
                <span className="shrink-0">{section.items.length}</span>
              </div>
              <div className="space-y-1">
                {section.items.map((project) => (
                  <label key={project.id} className="flex items-center gap-2 rounded-[12px] border border-[color:var(--color-border)] px-2.5 py-2 transition-colors hover:bg-[color:var(--color-accent)]/60">
                    <input type="checkbox" checked={isBound(project)} onChange={(event) => handleToggle(project, event.target.checked)} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs text-[color:var(--color-foreground)]" title={projectDisplayName(project)}>
                        {projectDisplayName(project)}
                      </p>
                      <p className="truncate text-[11px] text-[color:var(--color-muted-foreground)]" title={project.path}>
                        {middleTruncatePath(project.path)}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
                      {(project.tagIds ?? []).slice(0, MAX_VISIBLE_TAGS).map((tagId) => {
                        const tag = orderedTags.find((item) => item.id === tagId)
                        if (!tag) return null
                        return (
                          <span key={tag.id} className="inline-flex items-center gap-1 rounded-full border px-2 py-[2px] text-[10px] text-[color:var(--color-muted-foreground)]" style={{ borderColor: 'var(--color-border)' }}>
                            <span className="h-1.5 w-1.5 rounded-full" style={{ background: tag.color || 'var(--color-primary)' }} />
                            {tag.name}
                          </span>
                        )
                      })}
                      {(project.tagIds ?? []).length > MAX_VISIBLE_TAGS && <span className="text-[10px] text-[color:var(--color-muted-foreground)]">+{(project.tagIds ?? []).length - MAX_VISIBLE_TAGS}</span>}
                    </div>
                  </label>
                ))}
              </div>
            </div>
          ))
        )}
      </div>

      <div className="mt-4 flex items-center justify-end">
        <button type="button" className="inline-flex h-9 items-center rounded-full border border-[color:var(--color-border)] px-4 text-xs text-[color:var(--color-foreground)] transition-colors hover:bg-[color:var(--color-accent)]" onClick={onClose}>
          {t('common.close')}
        </button>
      </div>
    </ModalShell>
  )
}
