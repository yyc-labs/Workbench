import { GitBranch, GitFork, RefreshCw } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Combobox, type ComboboxOption } from '../../components/ui/combobox'
import type { DetailGitRepositorySummary, DetailGitSnapshot } from './detail.types'
import { useI18n } from '../../i18n'

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

function repositoryLabel(
  repo: DetailGitRepositorySummary,
  t: (key: string, values?: Record<string, number | string>) => string
): string {
  return repo.relativePath === '.'
    ? `${repo.name} · ${t('detail.repositorySelectorRoot')}`
    : `${repo.relativePath} · ${repo.isNested ? t('detail.repositorySelectorNested') : t('detail.repositorySelectorRepository')}`
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
  const { t } = useI18n()
  const [query, setQuery] = useState('')
  const selectedRepository = repositories.find((repo) => repo.id === selectedRepositoryId) ?? snapshot?.repository ?? repositories[0]
  const changeCount = snapshot?.changedFileCount ?? 0
  const branchName = snapshot?.branch.current || t('detail.repositorySelectorLoading')
  const statusText = loading
    ? t('detail.repositorySelectorLoading')
    : snapshot?.isGitRepository
      ? `${branchName} · ${t('detail.repositorySelectorChanges', { count: changeCount })}`
      : t('detail.repositorySelectorNoRepository')
  const repositoryOptions = useMemo<ComboboxOption[]>(
    () => repositories.map((repo) => ({
      value: repo.id,
      label: repositoryLabel(repo, t),
      keywords: [repo.name, repo.relativePath, repo.repoRoot],
    })),
    [repositories, t]
  )

  const controlHeightClass = variant === 'inline' ? 'h-7' : 'h-8'
  const buttonMaxWidthClass = variant === 'inline' ? 'max-w-[260px]' : 'max-w-[300px]'
  const controls = (
    <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            className={`inline-flex ${controlHeightClass} ${variant === 'inline' ? 'w-7' : 'w-8'} items-center justify-center rounded-full border border-[color:var(--color-border)] text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)] disabled:cursor-not-allowed disabled:opacity-60`}
            onClick={onRefreshRepositories}
            disabled={repositoriesLoading}
            title={t('detail.repositorySelectorRefresh')}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${repositoriesLoading ? 'animate-spin' : ''}`} />
          </button>

          <Combobox
            ariaLabel={t('detail.repositorySelectorListAria')}
            value={selectedRepository?.id ?? ''}
            searchValue={query}
            onSearchValueChange={setQuery}
            options={repositoryOptions}
            onChange={onChangeRepository}
            editable="open"
            clearSearchOnClose
            disabled={repositoriesLoading}
            triggerPlaceholder={t('detail.repositorySelectorNoRepository')}
            inputPlaceholder={selectedRepository ? repositoryLabel(selectedRepository, t) : t('detail.repositorySelectorRepository')}
            toggleAriaLabel={t('detail.repositorySelectorClose')}
            emptyText={repositoriesLoading ? t('detail.repositorySelectorLoading') : t('detail.repositorySelectorNoMatch')}
            minDropdownWidth={360}
            matchTriggerWidth={false}
            className={buttonMaxWidthClass}
            inputClassName={`h-${variant === 'inline' ? '7' : '8'} rounded-full px-3 text-xs`}
            triggerClassName={`${controlHeightClass} ${buttonMaxWidthClass} bg-[color:var(--color-card)]/72 px-3 text-xs hover:border-[color:var(--color-border-hover)] hover:bg-[color:var(--color-popover)]/82`}
            contentClassName="w-[min(360px,calc(100vw-32px))]"
            renderDisplayValue={() => (
              <span className="min-w-0 flex-1 truncate text-[color:var(--color-foreground)]">
                {selectedRepository ? repositoryLabel(selectedRepository, t) : t('detail.repositorySelectorNoRepository')}
              </span>
            )}
            renderOption={(option, state) => {
              const repo = repositories.find((item) => item.id === option.value)
              if (!repo) return null
              return (
                <>
                  <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[color:var(--color-background-sunken)] text-[color:var(--color-muted-foreground)]">
                    <GitFork className="h-3.5 w-3.5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12px] font-medium">{repo.relativePath === '.' ? repo.name : repo.relativePath}</span>
                    <span className="block truncate text-[10.5px] text-[color:var(--color-muted-foreground)]">
                      {repo.relativePath === '.' ? t('detail.repositorySelectorRoot') : repo.isNested ? t('detail.repositorySelectorNested') : t('detail.repositorySelectorRepository')} · {repo.repoRoot}
                    </span>
                  </span>
                  {state.selected ? <span className="h-4 w-4 shrink-0 rounded-full bg-[color:var(--color-primary)]" /> : null}
                </>
              )
            }}
            filterOption={(option, nextQuery) => {
              const normalizedQuery = nextQuery.trim().toLowerCase()
              if (!normalizedQuery) return true
              const repo = repositories.find((item) => item.id === option.value)
              if (!repo) return false
              return (
                repo.name.toLowerCase().includes(normalizedQuery)
                || repo.relativePath.toLowerCase().includes(normalizedQuery)
                || repo.repoRoot.toLowerCase().includes(normalizedQuery)
              )
            }}
            onOpenChange={(isOpen) => {
              if (isOpen) {
                if (repositories.length <= 0 && !repositoriesLoading) {
                  onRefreshRepositories()
                }
                return
              }
              setQuery('')
            }}
          />

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
              <p className="section-label">{t('detail.repositorySelectorRepository')}</p>
              {repositoriesTruncated && (
                <span className="rounded-full bg-[color:var(--color-warning-background)] px-2 py-0.5 text-[10px] text-[color:var(--color-warning)]">
                  {t('detail.repositorySelectorTruncated')}
                </span>
              )}
            </div>
            <p className="truncate text-[11px] text-[color:var(--color-muted-foreground)]" title={selectedRepository?.repoRoot}>
              {selectedRepository ? repositoryLabel(selectedRepository, t) : t('detail.repositorySelectorNoRepository')}
            </p>
          </div>
        </div>

        {controls}
      </div>
    </section>
  )
}
