import { FolderPlus } from 'lucide-react'

function HomeDragOverlay() {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center drag-overlay-border border-4 border-dashed rounded-none"
      style={{
        backgroundColor: 'color-mix(in srgb, var(--color-primary) 10%, transparent)',
        borderColor: 'color-mix(in srgb, var(--color-primary) 28%, transparent)',
      }}
    >
      <div className="text-center">
        <div
          className="quiet-control w-20 h-20 mx-auto mb-6 rounded-[28px] flex items-center justify-center"
          style={{ color: 'var(--color-primary)' }}
        >
          <FolderPlus className="w-9 h-9" strokeWidth={1.5} />
        </div>
        <p className="text-xl font-medium text-[color:var(--color-foreground)]">Drop project folders anywhere</p>
        <p className="text-sm text-[color:var(--color-muted-foreground)] mt-2">Release to add to your workspace</p>
      </div>
    </div>
  )
}

export { HomeDragOverlay }
