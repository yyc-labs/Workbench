import { ExternalLink, Plus, Trash2 } from 'lucide-react'
import type { Dispatch, SetStateAction } from 'react'
import type { ProjectDocLink } from '../../../shared/types'

type DetailDocumentationCardProps = {
  docLinks: ProjectDocLink[]
  docTitleInput: string
  setDocTitleInput: Dispatch<SetStateAction<string>>
  docUrlInput: string
  setDocUrlInput: Dispatch<SetStateAction<string>>
  docError: string | null
  onAddDocLink: () => Promise<void>
  onSetDefaultDocLink: (linkId: string) => Promise<void>
  onRemoveDocLink: (linkId: string) => Promise<void>
}

function DetailDocumentationCard({
  docLinks,
  docTitleInput,
  setDocTitleInput,
  docUrlInput,
  setDocUrlInput,
  docError,
  onAddDocLink,
  onSetDefaultDocLink,
  onRemoveDocLink,
}: DetailDocumentationCardProps) {
  return (
    <div className="rounded-[24px] p-6 surface-card">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <p className="section-label">Documentation</p>
          <p className="mt-1 text-xs text-[color:var(--color-muted-foreground)]">
            Project links for docs, specs and references
          </p>
        </div>
        <span className="rounded-full px-2.5 py-1 text-[11px] text-[color:var(--color-muted-foreground)] quiet-control">
          {docLinks.length}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-2">
        <input
          type="text"
          value={docTitleInput}
          onChange={(e) => setDocTitleInput(e.target.value)}
          placeholder="Title (optional)"
          className="quiet-control h-10 rounded-full border-0 px-4 text-sm text-[color:var(--color-foreground)] placeholder:text-[color:var(--color-muted-foreground)] outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <input
          type="text"
          value={docUrlInput}
          onChange={(e) => setDocUrlInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void onAddDocLink()
          }}
          placeholder="docs.example.com / https://..."
          className="quiet-control h-10 rounded-full border-0 px-4 text-sm text-[color:var(--color-foreground)] placeholder:text-[color:var(--color-muted-foreground)] outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <button
          className="inline-flex h-10 items-center justify-center gap-1.5 rounded-full bg-primary px-4 text-sm font-medium text-white transition-colors hover:bg-primary-hover"
          onClick={() => {
            void onAddDocLink()
          }}
        >
          <Plus className="h-3.5 w-3.5" />
          Add Link
        </button>
      </div>

      {docError && (
        <p className="mt-2 text-xs text-[color:var(--color-destructive)]">
          {docError}
        </p>
      )}

      {docLinks.length === 0 ? (
        <div className="mt-5 rounded-[16px] border border-dashed border-[color:var(--color-border)] px-5 py-5 text-xs text-[color:var(--color-muted-foreground)]">
          No documentation links yet.
        </div>
      ) : (
        <div className="mt-5 space-y-2.5">
          {docLinks.map((link) => (
            <div key={link.id} className="quiet-control flex items-center gap-2 rounded-[16px] px-4 py-3">
              <button
                className="min-w-0 flex-1 text-left"
                onClick={() => window.electronAPI.openExternal(link.url)}
                title={link.url}
              >
                <p className="truncate text-sm text-[color:var(--color-foreground)]">{link.title}</p>
                <p className="truncate text-[11px] text-[color:var(--color-muted-foreground)]">{link.url}</p>
              </button>
              <button
                className="inline-flex h-8 items-center gap-1 rounded-full px-2 text-xs text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-accent)] hover:text-primary"
                onClick={() => window.electronAPI.openExternal(link.url)}
              >
                <ExternalLink className="h-3 w-3" />
                Open
              </button>
              <button
                className="inline-flex h-8 items-center gap-1 rounded-full px-2 text-xs text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)] disabled:cursor-not-allowed disabled:opacity-60"
                onClick={() => {
                  void onSetDefaultDocLink(link.id)
                }}
                disabled={docLinks[0]?.id === link.id}
                title={docLinks[0]?.id === link.id ? 'Default link' : 'Set as default'}
              >
                {docLinks[0]?.id === link.id ? 'Default' : 'Set Default'}
              </button>
              <button
                className="inline-flex h-8 w-8 items-center justify-center rounded-full text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-destructive-background)] hover:text-[color:var(--color-destructive)]"
                onClick={() => {
                  void onRemoveDocLink(link.id)
                }}
                title="Remove"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export { DetailDocumentationCard }
