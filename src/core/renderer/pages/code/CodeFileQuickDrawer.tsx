import { useEffect, useMemo } from 'react'
import { Clock3, Star, Trash2, X } from 'lucide-react'
import { inferLanguageFromRelativePath } from './code.helpers'

type CodeFileQuickDrawerProps = {
  open: boolean
  activeRelativePath: string | null
  favorites: string[]
  recents: string[]
  onClose: () => void
  onOpenFile: (relativePath: string) => void
  onToggleFavorite: (relativePath: string) => void
  onRemovePath: (relativePath: string) => void
}

export function CodeFileQuickDrawer({
  open,
  activeRelativePath,
  favorites,
  recents,
  onClose,
  onOpenFile,
  onToggleFavorite,
  onRemovePath,
}: CodeFileQuickDrawerProps) {
  const favoriteSet = useMemo(() => new Set(favorites), [favorites])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [open, onClose])

  return (
    <>
      {open && (
        <button
          type="button"
          className="fixed inset-0 z-[29] bg-transparent"
          aria-label="Close file drawer backdrop"
          onClick={onClose}
        />
      )}

      <aside className={`code-file-quick-drawer ${open ? 'is-open' : ''}`}>
        <div className="code-file-quick-drawer-header">
          <div className="min-w-0">
            <p className="text-xs font-semibold text-[color:var(--color-foreground)]">File Drawer</p>
            <p className="text-[11px] text-[color:var(--color-muted-foreground)]">Favorites and recent files</p>
          </div>
          <button
            type="button"
            className="inline-flex h-7 w-7 items-center justify-center rounded-full text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)]"
            onClick={onClose}
            title="Close"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="code-file-quick-drawer-content">
          <section className="code-file-quick-drawer-section">
            <div className="code-file-quick-drawer-section-title">
              <Star className="h-3.5 w-3.5" />
              Favorites
            </div>
            {favorites.length === 0 ? (
              <p className="code-file-quick-drawer-empty">No favorites yet.</p>
            ) : (
              <div className="code-file-quick-drawer-list">
                {favorites.map((relativePath) => {
                  const isActive = activeRelativePath === relativePath
                  return (
                    <div key={`fav-${relativePath}`} className={`code-file-quick-drawer-item ${isActive ? 'is-active' : ''}`}>
                      <button
                        type="button"
                        className="code-file-quick-drawer-open"
                        onClick={() => onOpenFile(relativePath)}
                        title={relativePath}
                      >
                        <span className="code-file-quick-drawer-path">{relativePath}</span>
                        <span className="code-file-quick-drawer-meta">{inferLanguageFromRelativePath(relativePath)}</span>
                      </button>
                      <div className="code-file-quick-drawer-actions">
                        <button
                          type="button"
                          className="code-file-quick-drawer-action is-starred"
                          onClick={() => onToggleFavorite(relativePath)}
                          title="Remove from favorites"
                        >
                          <Star className="h-3.5 w-3.5 fill-current" />
                        </button>
                        <button
                          type="button"
                          className="code-file-quick-drawer-action is-danger"
                          onClick={() => onRemovePath(relativePath)}
                          title="Delete from drawer"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </section>

          <section className="code-file-quick-drawer-section">
            <div className="code-file-quick-drawer-section-title">
              <Clock3 className="h-3.5 w-3.5" />
              Recent
            </div>
            {recents.length === 0 ? (
              <p className="code-file-quick-drawer-empty">No recent files yet.</p>
            ) : (
              <div className="code-file-quick-drawer-list">
                {recents.map((relativePath) => {
                  const isActive = activeRelativePath === relativePath
                  const isFavorite = favoriteSet.has(relativePath)
                  return (
                    <div key={`recent-${relativePath}`} className={`code-file-quick-drawer-item ${isActive ? 'is-active' : ''}`}>
                      <button
                        type="button"
                        className="code-file-quick-drawer-open"
                        onClick={() => onOpenFile(relativePath)}
                        title={relativePath}
                      >
                        <span className="code-file-quick-drawer-path">{relativePath}</span>
                        <span className="code-file-quick-drawer-meta">{inferLanguageFromRelativePath(relativePath)}</span>
                      </button>
                      <div className="code-file-quick-drawer-actions">
                        <button
                          type="button"
                          className={`code-file-quick-drawer-action ${isFavorite ? 'is-starred' : ''}`}
                          onClick={() => onToggleFavorite(relativePath)}
                          title={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
                        >
                          <Star className={`h-3.5 w-3.5 ${isFavorite ? 'fill-current' : ''}`} />
                        </button>
                        <button
                          type="button"
                          className="code-file-quick-drawer-action is-danger"
                          onClick={() => onRemovePath(relativePath)}
                          title="Delete from drawer"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </section>
        </div>
      </aside>
    </>
  )
}
