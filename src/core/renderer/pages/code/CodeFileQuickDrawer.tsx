import { useEffect, useMemo, useState } from 'react'
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

const DRAWER_TRANSITION_MS = 220
const DRAWER_CONTENT_REVEAL_MS = 70

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
  const [shouldRender, setShouldRender] = useState(open)
  const [visible, setVisible] = useState(open)
  const [contentVisible, setContentVisible] = useState(open)
  const favoriteSet = useMemo(() => new Set(favorites), [favorites])

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
      {shouldRender && (
        <button
          type="button"
          className={`fixed inset-0 z-[29] bg-[color:var(--color-background-sunken)]/46 backdrop-blur-[3px] transition-opacity duration-200 ${
            visible ? 'opacity-100' : 'opacity-0'
          }`}
          aria-label="Close file drawer backdrop"
          onClick={onClose}
        />
      )}

      <aside className={`code-file-quick-drawer ${visible ? 'is-open' : ''}`}>
        <div className={`flex h-full min-h-0 flex-col transition-opacity duration-150 ${contentVisible ? 'opacity-100' : 'opacity-0'}`}>
          <div className="code-file-quick-drawer-header">
            <div className="min-w-0">
              <p className="text-xs font-semibold text-[color:var(--color-foreground)]">File Drawer</p>
              <p className="text-[11px] text-[color:var(--color-muted-foreground)]">Favorites and recent files</p>
            </div>
            <button
              type="button"
              className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-background)]/72 text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)]"
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
        </div>
      </aside>
    </>
  )
}
