import { Check, ChevronDown, GitBranch, GitFork, RefreshCw } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { DetailGitRepositorySummary, DetailGitSnapshot } from './detail.types'

type DetailGitRepositorySelectorProps = {
  repositories: DetailGitRepositorySummary[]
  selectedRepositoryId: string | null
  snapshot: DetailGitSnapshot | null
  loading: boolean
  repositoriesLoading: boolean
  repositoriesTruncated: boolean
  variant?: 'section' | 'inline'
  onChangeRepository: (repoId: string) => void
  onRefreshRepositories: () => void
}

function repositoryLabel(repo: DetailGitRepositorySummary): string {
  return repo.relativePath === '.' ? `${repo.name} · 根仓库` : `${repo.relativePath} · ${repo.isNested ? '子仓库' : '仓库'}`
}

export function DetailGitRepositorySelector({
  repositories,
  selectedRepositoryId,
  snapshot,
  loading,
  repositoriesLoading,
  repositoriesTruncated,
  variant = 'section',
  onChangeRepository,
  onRefreshRepositories,
}: DetailGitRepositorySelectorProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const containerRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const selectedRepository = repositories.find((repo) => repo.id === selectedRepositoryId) ?? repositories[0]
  const changeCount = snapshot?.changedFiles.length ?? 0
  const branchName = snapshot?.branch.current || '未加载'
  const statusText = loading
    ? '加载中'
    : snapshot?.isGitRepository
      ? `${branchName} · ${changeCount} changes`
      : '未加载'
  const filteredRepositories = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    if (!normalizedQuery) return repositories
    return repositories.filter((repo) => (
      repo.name.toLowerCase().includes(normalizedQuery)
      || repo.relativePath.toLowerCase().includes(normalizedQuery)
      || repo.rootPath.toLowerCase().includes(normalizedQuery)
    ))
  }, [query, repositories])

  useEffect(() => {
    if (!open) {
      setQuery('')
      return
    }

    const frame = window.requestAnimationFrame(() => {
      inputRef.current?.focus()
    })

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (!containerRef.current?.contains(target)) setOpen(false)
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }

    window.addEventListener('mousedown', handlePointerDown)
    window.addEventListener('keydown', handleEscape)
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('mousedown', handlePointerDown)
      window.removeEventListener('keydown', handleEscape)
    }
  }, [open])

  useEffect(() => {
    if (repositories.length <= 0 || repositoriesLoading) setOpen(false)
  }, [repositories.length, repositoriesLoading])

  const controlHeightClass = variant === 'inline' ? 'h-7' : 'h-8'
  const buttonMaxWidthClass = variant === 'inline' ? 'max-w-[260px]' : 'max-w-[300px]'
  const controls = (
    <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            className={`inline-flex ${controlHeightClass} ${variant === 'inline' ? 'w-7' : 'w-8'} items-center justify-center rounded-full border border-[color:var(--color-border)] text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)] disabled:cursor-not-allowed disabled:opacity-60`}
            onClick={onRefreshRepositories}
            disabled={repositoriesLoading}
            title="重新扫描 Git 仓库列表"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${repositoriesLoading ? 'animate-spin' : ''}`} />
          </button>

          <div ref={containerRef} className="relative">
            {open ? (
              <div className={`group flex ${controlHeightClass} ${buttonMaxWidthClass} items-center gap-2 rounded-full border border-[color:var(--color-ring)]/55 bg-[color:var(--color-popover)] px-3 text-left text-xs shadow-[0_8px_22px_rgba(29,29,31,0.10)] ring-2 ring-[color:var(--color-ring)]/16`}>
                <input
                  ref={inputRef}
                  type="text"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={selectedRepository ? repositoryLabel(selectedRepository) : '搜索仓库...'}
                  className="min-w-0 flex-1 bg-transparent text-xs text-[color:var(--color-foreground)] outline-none placeholder:text-[color:var(--color-muted-foreground)]"
                  spellCheck={false}
                />
                <button
                  type="button"
                  className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)]"
                  onClick={() => setOpen(false)}
                  title="关闭仓库列表"
                >
                  <ChevronDown className="h-3.5 w-3.5 rotate-180 transition-transform" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                className={`group flex ${controlHeightClass} ${buttonMaxWidthClass} items-center gap-2 rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-card)]/72 px-3 text-left text-xs outline-none transition-all hover:border-[color:var(--color-border-hover)] hover:bg-[color:var(--color-popover)]/82 disabled:cursor-not-allowed disabled:opacity-60`}
                aria-haspopup="listbox"
                aria-expanded={open}
                onClick={() => setOpen(true)}
                disabled={repositoriesLoading || repositories.length <= 0}
                title="切换当前 Git 仓库，切换后才刷新该仓库状态"
              >
                <span className="min-w-0 flex-1 truncate text-[color:var(--color-foreground)]">
                  {selectedRepository ? repositoryLabel(selectedRepository) : '未发现仓库'}
                </span>
                <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[color:var(--color-muted-foreground)] transition-transform duration-200" />
              </button>
            )}

            {open && (
              <div
                className="absolute right-0 top-[calc(100%+8px)] z-50 w-[min(360px,calc(100vw-32px))] overflow-hidden rounded-[18px] border border-[color:var(--color-border)] bg-[color:var(--color-popover)]/96 p-1.5 text-[color:var(--color-popover-foreground)] shadow-[var(--shadow-popover)] backdrop-blur-[22px]"
                style={{ WebkitBackdropFilter: 'saturate(170%) blur(22px)' }}
                role="listbox"
                aria-label="Git 仓库"
              >
                <div className="max-h-[260px] overflow-auto">
                  {filteredRepositories.length > 0 ? (
                    filteredRepositories.map((repo) => {
                      const selected = repo.id === selectedRepository?.id
                      return (
                        <button
                          key={repo.id}
                          type="button"
                          className={`flex w-full items-center gap-2 rounded-[13px] px-2.5 py-2 text-left outline-none transition-colors ${
                            selected
                              ? 'bg-[color:var(--color-primary)]/12 text-[color:var(--color-foreground)]'
                              : 'text-[color:var(--color-foreground)] hover:bg-[color:var(--color-accent)]'
                          }`}
                          role="option"
                          aria-selected={selected}
                          onClick={() => {
                            onChangeRepository(repo.id)
                            setOpen(false)
                          }}
                        >
                          <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[color:var(--color-background-sunken)] text-[color:var(--color-muted-foreground)]">
                            <GitFork className="h-3.5 w-3.5" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[12px] font-medium">{repo.relativePath === '.' ? repo.name : repo.relativePath}</span>
                            <span className="block truncate text-[10.5px] text-[color:var(--color-muted-foreground)]">
                              {repo.relativePath === '.' ? '根仓库' : repo.isNested ? '子仓库' : '仓库'} · {repo.rootPath}
                            </span>
                          </span>
                          {selected && <Check className="h-4 w-4 shrink-0 text-[color:var(--color-primary)]" />}
                        </button>
                      )
                    })
                  ) : (
                    <p className="px-2 py-2 text-[11px] text-[color:var(--color-muted-foreground)]">未找到匹配仓库</p>
                  )}
                </div>
              </div>
            )}
          </div>

          <span className={`inline-flex ${controlHeightClass} items-center gap-1.5 rounded-full border border-[color:var(--color-border)] px-3 text-[11px] text-[color:var(--color-muted-foreground)]`}>
            <GitBranch className="h-3.5 w-3.5" />
            {statusText}
          </span>
    </div>
  )

  if (variant === 'inline') {
    return (
      <div className="flex min-w-0 items-center">
        {controls}
      </div>
    )
  }

  return (
    <section className="shrink-0 rounded-[18px] border border-[color:var(--color-border)] bg-[color:var(--color-card)]/62 px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex min-w-[240px] flex-1 items-center gap-2">
          <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[color:var(--color-background-sunken)] text-[color:var(--color-muted-foreground)]">
            <GitFork className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="section-label">Git 仓库</p>
              {repositoriesTruncated && (
                <span className="rounded-full bg-[color:var(--color-warning-background)] px-2 py-0.5 text-[10px] text-[color:var(--color-warning)]">
                  已截断
                </span>
              )}
            </div>
            <p className="truncate text-[11px] text-[color:var(--color-muted-foreground)]" title={selectedRepository?.rootPath}>
              {selectedRepository ? repositoryLabel(selectedRepository) : '未发现 Git 仓库'}
            </p>
          </div>
        </div>

        {controls}
      </div>
    </section>
  )
}
