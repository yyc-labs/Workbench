import { FolderPlus } from 'lucide-react'
import { useI18n } from '../../i18n'

function HomeDragOverlay() {
  const { t } = useI18n()

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
        <p className="text-xl font-medium text-[color:var(--color-foreground)]">{t('home.dragTitle')}</p>
        <p className="mt-2 text-sm text-[color:var(--color-muted-foreground)]">{t('home.dragDescription')}</p>
      </div>
    </div>
  )
}

export { HomeDragOverlay }
