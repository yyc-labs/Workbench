import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Clock3, Search, Star, Trash2, X } from 'lucide-react'
import { useI18n } from '../../i18n'
import { inferLanguageFromRelativePath, fuzzyPathMatch } from './code.helpers'
import { DebouncedSearchInput } from './DebouncedSearchInput'

type CodeFileQuickDrawerProps = {
  open: boolean
  activeRelativePath: string | null
  filePaths: string[]
  favorites: string[]
  recents: string[]
  onClose: () => void
  onOpenFile: (relativePath: string) => void
  onToggleFavorite: (relativePath: string) => void
  onRemovePath: (relativePath: string) => void
}

const DRAWER_TRANSITION_MS = 220
const DRAWER_CONTENT_REVEAL_MS = 70

export function CodeFileQuickDrawer({ open, activeRelativePath, filePaths, favorites, recents, onClose, onOpenFile, onToggleFavorite, onRemovePath }: CodeFileQuickDrawerProps) {
  const { t } = useI18n()
  const [shouldRender, setShouldRender] = useState(open)
  const [visible, setVisible] = useState(open)
  const [contentVisible, setContentVisible] = useState(open)
  const [searchQuery, setSearchQuery] = useState('')
  const searchInputRef = useRef<HTMLInputElement>(null)
  const favoriteSet = useMemo(() => new Set(favorites), [favorites])
  const matchingFilePaths = useMemo(() => filePaths.filter((relativePath) => fuzzyPathMatch(searchQuery, relativePath)), [filePaths, searchQuery])

  useEffect(() => {
    if (open) {
      setShouldRender(true)
      setContentVisible(false)
      const enterTimer = window.setTimeout(() => setVisible(true), 16)
      const revealTimer = window.setTimeout(() => setContentVisible(true), DRAWER_CONTENT_REVEAL_MS)
      return () => {
        window.clearTimeout(enterTimer)
        window.clearTimeout(revealTimer)
      }
    }
    setContentVisible(false)
    setVisible(false)
    const closeTimer = window.setTimeout(() => setShouldRender(false), DRAWER_TRANSITION_MS)
    return () => {
      window.clearTimeout(closeTimer)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const focusTimer = window.setTimeout(() => searchInputRef.current?.focus(), DRAWER_CONTENT_REVEAL_MS)
    return () => window.clearTimeout(focusTimer)
  }, [open])

  useEffect(() => {
    if (!shouldRender) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [shouldRender, onClose])

  if (!shouldRender) return null

  return (
    <>
      {shouldRender && <button type="button" className={`fixed inset-0 z-[29] bg-[color:var(--color-background-sunken)]/46 backdrop-blur-[3px] transition-opacity duration-200 ${visible ? 'opacity-100' : 'opacity-0'}`} aria-label={t('codeWorkspace.fileDrawerBackdrop')} onClick={onClose} />}

      <aside className={`code-file-quick-drawer ${visible ? 'is-open' : ''}`}>
        <div className={`flex h-full min-h-0 flex-col transition-opacity duration-150 ${contentVisible ? 'opacity-100' : 'opacity-0'}`}>
          <div className="code-file-quick-drawer-header">
            <div className="min-w-0">
              <p className="text-xs font-semibold text-[color:var(--color-foreground)]">{t('codeWorkspace.fileDrawer')}</p>
              <p className="text-[11px] text-[color:var(--color-muted-foreground)]">{t('codeWorkspace.favoritesAndRecent')}</p>
            </div>
            <button
              type="button"
              className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-background)]/72 text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)]"
              onClick={onClose}
              title={t('common.close')}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="code-file-quick-drawer-content">
            <div className="code-file-quick-drawer-search">
              <DebouncedSearchInput
                inputRef={searchInputRef}
                leadingIcon={<Search className="h-3.5 w-3.5 shrink-0 text-[color:var(--color-muted-foreground)]" />}
                placeholder={t('codeWorkspace.fileDrawerSearchPlaceholder')}
                inputClassName="code-file-quick-drawer-search-input"
                debounceMs={80}
                onQueryChange={setSearchQuery}
              />
            </div>

            {searchQuery.trim() ? (
              <section className="code-file-quick-drawer-section">
                <div className="code-file-quick-drawer-section-title">
                  <Search className="h-3.5 w-3.5" />
                  {t('codeWorkspace.searchResults')}
                </div>
                {matchingFilePaths.length === 0 ? (
                  <p className="code-file-quick-drawer-empty">{t('codeWorkspace.noMatchingDrawerFiles')}</p>
                ) : (
                  <div className="code-file-quick-drawer-list">
                    {matchingFilePaths.map((relativePath) => {
                      const isFavorite = favoriteSet.has(relativePath)
                      return (
                        <div key={`search-${relativePath}`} className={`code-file-quick-drawer-item ${activeRelativePath === relativePath ? 'is-active' : ''}`}>
                          <button type="button" className="code-file-quick-drawer-open" onClick={() => onOpenFile(relativePath)} title={relativePath}>
                            <span className="code-file-quick-drawer-path">{relativePath}</span>
                            <span className="code-file-quick-drawer-meta">{inferLanguageFromRelativePath(relativePath)}</span>
                          </button>
                          <div className="code-file-quick-drawer-actions">
                            <button type="button" className={`code-file-quick-drawer-action ${isFavorite ? 'is-starred' : ''}`} onClick={() => onToggleFavorite(relativePath)} title={isFavorite ? t('codeWorkspace.removeFavorite') : t('codeWorkspace.addFavorite')}>
                              <Star className={`h-3.5 w-3.5 ${isFavorite ? 'fill-current' : ''}`} />
                            </button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </section>
            ) : (
              <>
                <FileDrawerSection
                  title={t('codeWorkspace.favorites')}
                  icon={<Star className="h-3.5 w-3.5" />}
                  emptyText={t('codeWorkspace.noFavoritesYet')}
                  paths={favorites}
                  activeRelativePath={activeRelativePath}
                  favoriteSet={favoriteSet}
                  onOpenFile={onOpenFile}
                  onToggleFavorite={onToggleFavorite}
                  onRemovePath={onRemovePath}
                />
                <FileDrawerSection
                  title={t('codeWorkspace.recent')}
                  icon={<Clock3 className="h-3.5 w-3.5" />}
                  emptyText={t('codeWorkspace.noRecentFilesYet')}
                  paths={recents}
                  activeRelativePath={activeRelativePath}
                  favoriteSet={favoriteSet}
                  onOpenFile={onOpenFile}
                  onToggleFavorite={onToggleFavorite}
                  onRemovePath={onRemovePath}
                />
              </>
            )}
          </div>
        </div>
      </aside>
    </>
  )
}

type FileDrawerSectionProps = {
  title: string
  icon: ReactNode
  emptyText: string
  paths: string[]
  activeRelativePath: string | null
  favoriteSet: Set<string>
  onOpenFile: (relativePath: string) => void
  onToggleFavorite: (relativePath: string) => void
  onRemovePath: (relativePath: string) => void
}

function FileDrawerSection({ title, icon, emptyText, paths, activeRelativePath, favoriteSet, onOpenFile, onToggleFavorite, onRemovePath }: FileDrawerSectionProps) {
  const { t } = useI18n()
  return (
    <section className="code-file-quick-drawer-section">
      <div className="code-file-quick-drawer-section-title">
        {icon}
        {title}
      </div>
      {paths.length === 0 ? (
        <p className="code-file-quick-drawer-empty">{emptyText}</p>
      ) : (
        <div className="code-file-quick-drawer-list">
          {paths.map((relativePath) => {
            const isFavorite = favoriteSet.has(relativePath)
            return (
              <div key={`${title}-${relativePath}`} className={`code-file-quick-drawer-item ${activeRelativePath === relativePath ? 'is-active' : ''}`}>
                <button type="button" className="code-file-quick-drawer-open" onClick={() => onOpenFile(relativePath)} title={relativePath}>
                  <span className="code-file-quick-drawer-path">{relativePath}</span>
                  <span className="code-file-quick-drawer-meta">{inferLanguageFromRelativePath(relativePath)}</span>
                </button>
                <div className="code-file-quick-drawer-actions">
                  <button type="button" className={`code-file-quick-drawer-action ${isFavorite ? 'is-starred' : ''}`} onClick={() => onToggleFavorite(relativePath)} title={isFavorite ? t('codeWorkspace.removeFavorite') : t('codeWorkspace.addFavorite')}>
                    <Star className={`h-3.5 w-3.5 ${isFavorite ? 'fill-current' : ''}`} />
                  </button>
                  <button type="button" className="code-file-quick-drawer-action is-danger" onClick={() => onRemovePath(relativePath)} title={t('codeWorkspace.deleteFromDrawer')}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
