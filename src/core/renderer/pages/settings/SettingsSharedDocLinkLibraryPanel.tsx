import { SharedDocLinkLibraryContent } from '../../components/SharedDocLinkLibraryDialog'
import { useI18n } from '../../i18n'

/**
 * 设置页「共享链接库」：内嵌完整管理（组/链接/绑定均可编辑）。
 * 链接排序采用与工作区分类面板一致的行内原位位移拖拽（无浮层，不受页面滚动影响）。
 */
export function SettingsSharedDocLinkLibraryPanel() {
  const { t } = useI18n()
  return (
    <section className="flex h-full min-h-0 flex-col space-y-4">
      <p className="section-label mb-3">{t('settings.sections.docLinkLibrary')}</p>
      <div>
        <h2 className="text-[28px] font-semibold tracking-[-0.04em] text-[color:var(--color-foreground)]">{t('documentation.sharedLibrary')}</h2>
        <p className="text-sm leading-6 text-[color:var(--color-muted-foreground)] mt-2">{t('documentation.sharedLibraryDescription')}</p>
      </div>
      <div className="flex min-h-[420px] flex-1 flex-col rounded-[20px] border border-[color:var(--color-border)] surface-card p-4">
        <SharedDocLinkLibraryContent variant="panel" />
      </div>
    </section>
  )
}
