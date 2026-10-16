import { Check, ChevronDown, Copy, KeyRound, Library } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { ProjectDocLink } from '../../../shared/types'
import { SharedDocLinkLibraryDialog } from '../../components/SharedDocLinkLibraryDialog'
import { useI18n } from '../../i18n'
import { projectDocLinkDedupeKey } from '../../lib/projectDocLinks'
import { useAppStore } from '../../stores/appStore'

type DetailDocumentationSharedLibrarySectionProps = {
  projectId?: string
}

/** 项目链接管理弹窗内的「共享链接库」订阅区：勾选组即时持久化；管理入口打开 SharedDocLinkLibraryDialog。 */
export function DetailDocumentationSharedLibrarySection({ projectId }: DetailDocumentationSharedLibrarySectionProps) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const [libraryDialogOpen, setLibraryDialogOpen] = useState(false)
  const [copyOpen, setCopyOpen] = useState(false)
  const [selectedLinkIds, setSelectedLinkIds] = useState<string[]>([])
  const [copyGroupId, setCopyGroupId] = useState('')
  const [copyNewGroupName, setCopyNewGroupName] = useState('')
  const [copyError, setCopyError] = useState<string | null>(null)
  const [copying, setCopying] = useState(false)
  const [copyDoneCount, setCopyDoneCount] = useState<number | null>(null)
  const sharedDocLinkGroups = useAppStore((s) => s.sharedDocLinkGroups)
  const sharedDocLinks = useAppStore((s) => s.sharedDocLinks)
  const projects = useAppStore((s) => s.projects)
  const setProjectSharedDocLinkGroups = useAppStore((s) => s.setProjectSharedDocLinkGroups)
  const createDocLinkGroup = useAppStore((s) => s.createDocLinkGroup)
  const upsertSharedDocLink = useAppStore((s) => s.upsertSharedDocLink)
  const setSharedDocLinkSecret = useAppStore((s) => s.setSharedDocLinkSecret)
  const subscribedIds = projectId ? (projects.find((project) => project.id === projectId)?.sharedDocLinkGroupIds ?? []) : []
  const privateLinks = useMemo<ProjectDocLink[]>(() => (projectId ? (projects.find((project) => project.id === projectId)?.docLinks ?? []) : []), [projectId, projects])

  const handleToggleGroup = (groupId: string, checked: boolean) => {
    if (!projectId) return
    const nextIds = checked ? [...new Set([...subscribedIds, groupId])] : subscribedIds.filter((id) => id !== groupId)
    void setProjectSharedDocLinkGroups(projectId, nextIds)
  }

  const openCopyPanel = () => {
    setCopyOpen((prev) => !prev)
    setCopyError(null)
    setCopyDoneCount(null)
    setSelectedLinkIds(privateLinks.map((link) => link.id))
  }

  const handleCopyToLibrary = async () => {
    if (!projectId || copying) return
    const targets = privateLinks.filter((link) => selectedLinkIds.includes(link.id))
    if (targets.length === 0) return
    setCopyError(null)
    setCopying(true)
    try {
      let groupId = copyGroupId
      if (!groupId && copyNewGroupName.trim()) {
        await createDocLinkGroup(copyNewGroupName.trim())
        const groups = useAppStore.getState().sharedDocLinkGroups
        groupId = groups[groups.length - 1]?.id ?? ''
        setCopyNewGroupName('')
      }
      if (!groupId) {
        setCopyError(t('documentation.sharedGroupsEmpty'))
        return
      }
      // 严格一致去重：目标组内已有同一目标的链接则跳过。
      const existingKeys = new Set(
        useAppStore
          .getState()
          .sharedDocLinks.filter((item) => item.groupId === groupId)
          .map((item) => projectDocLinkDedupeKey(item)),
      )
      let copied = 0
      let skipped = 0
      let secretFailed = false
      for (const link of targets) {
        if (existingKeys.has(projectDocLinkDedupeKey(link))) {
          skipped += 1
          continue
        }
        const knownIds = new Set(useAppStore.getState().sharedDocLinks.map((item) => item.id))
        const file = await upsertSharedDocLink({
          groupId,
          title: link.title,
          kind: link.kind,
          url: link.url,
          tag: link.tag,
          note: link.note,
          account: link.account,
          sshHost: link.sshHost,
          sshPort: link.sshPort,
          sshUsername: link.sshUsername,
          sshRoute: link.sshRoute,
          hasSecret: link.hasSecret,
        })
        copied += 1
        existingKeys.add(projectDocLinkDedupeKey(link))
        const newLinkId = file?.links.find((item) => item.groupId === groupId && !knownIds.has(item.id))?.id
        if (link.hasSecret && newLinkId) {
          try {
            const result = await window.electronAPI.getDocLinkSecret(projectId, link.id)
            if (result.secret) await setSharedDocLinkSecret(newLinkId, result.secret)
            else secretFailed = true
          } catch {
            secretFailed = true
          }
        }
      }
      // 复制即视为订阅该组，否则本项目看不到刚复制进去的链接。
      if (copied > 0 && !subscribedIds.includes(groupId)) {
        await setProjectSharedDocLinkGroups(projectId, [...new Set([...subscribedIds, groupId])])
      }
      setCopyDoneCount(copied)
      if (secretFailed) setCopyError(t('documentation.shareSecretMigrateFailed'))
      else if (copied === 0 && skipped > 0) setCopyError(t('documentation.shareAlreadyExists'))
    } catch (error) {
      setCopyError(error instanceof Error ? error.message : String(error))
    } finally {
      setCopying(false)
    }
  }

  return (
    <div className="rounded-[14px] border border-[color:var(--color-border)] px-3 py-3">
      <button type="button" className="inline-flex items-center gap-1.5 text-xs text-[color:var(--color-foreground)] transition-colors hover:text-primary" onClick={() => setOpen((prev) => !prev)}>
        <Library className="h-3.5 w-3.5" />
        {t('documentation.sharedLibrary')}
        <ChevronDown className={`h-3.5 w-3.5 text-[color:var(--color-muted-foreground)] transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="mt-3 space-y-2">
          <p className="px-1 text-[11px] text-[color:var(--color-muted-foreground)]">{t('documentation.sharedLibraryDescription')}</p>
          {sharedDocLinkGroups.length === 0 ? (
            <p className="px-1 text-[11px] text-[color:var(--color-muted-foreground)]">{t('documentation.sharedGroupsEmpty')}</p>
          ) : (
            <div className="space-y-1.5">
              {sharedDocLinkGroups.map((group) => {
                const checked = subscribedIds.includes(group.id)
                const linkCount = sharedDocLinks.filter((link) => link.groupId === group.id).length
                return (
                  <label key={group.id} className="flex items-center gap-2 rounded-[10px] px-2 py-1.5 text-xs text-[color:var(--color-foreground)] transition-colors hover:bg-[color:var(--color-accent)]">
                    <input type="checkbox" checked={checked} disabled={!projectId} onChange={(event) => handleToggleGroup(group.id, event.target.checked)} />
                    <span className="min-w-0 flex-1 truncate">{group.name}</span>
                    <span className="shrink-0 text-[11px] text-[color:var(--color-muted-foreground)]">{t('documentation.sharedLinksCount', { count: linkCount })}</span>
                  </label>
                )
              })}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              className="inline-flex h-8 items-center gap-1.5 rounded-full border border-[color:var(--color-border)] px-3 text-[11px] text-[color:var(--color-foreground)] transition-colors hover:bg-[color:var(--color-accent)] disabled:opacity-60"
              onClick={openCopyPanel}
              disabled={!projectId || privateLinks.length === 0}
              title={privateLinks.length === 0 ? t('documentation.noPrivateLinks') : t('documentation.copyFromProject')}
            >
              <Copy className="h-3.5 w-3.5" />
              {t('documentation.copyFromProject')}
            </button>
            <button type="button" className="inline-flex h-8 items-center gap-1.5 rounded-full border border-[color:var(--color-border)] px-3 text-[11px] text-[color:var(--color-foreground)] transition-colors hover:bg-[color:var(--color-accent)]" onClick={() => setLibraryDialogOpen(true)}>
              <Library className="h-3.5 w-3.5" />
              {t('documentation.manageSharedLibrary')}
            </button>
          </div>

          {copyOpen && privateLinks.length > 0 && (
            <div className="space-y-2 rounded-[12px] border border-[color:var(--color-border)] bg-[color:var(--color-background)]/50 p-2.5">
              <p className="px-1 text-[11px] text-[color:var(--color-muted-foreground)]">{t('documentation.copyFromProjectDescription')}</p>
              <div className="max-h-[140px] space-y-1 overflow-y-auto">
                {privateLinks.map((link) => (
                  <label key={link.id} className="flex items-center gap-2 rounded-[10px] px-2 py-1 text-xs text-[color:var(--color-foreground)] transition-colors hover:bg-[color:var(--color-accent)]">
                    <input
                      type="checkbox"
                      checked={selectedLinkIds.includes(link.id)}
                      onChange={(event) => {
                        setSelectedLinkIds((current) => (event.target.checked ? [...new Set([...current, link.id])] : current.filter((id) => id !== link.id)))
                      }}
                      disabled={copying}
                    />
                    <span className="min-w-0 flex-1 truncate">{link.title}</span>
                    {link.hasSecret && <KeyRound className="h-3 w-3 shrink-0 text-[color:var(--color-muted-foreground)]" />}
                  </label>
                ))}
              </div>
              <div className="max-h-[100px] space-y-1 overflow-y-auto">
                {sharedDocLinkGroups.map((group) => (
                  <label key={group.id} className="flex items-center gap-2 rounded-[10px] px-2 py-1 text-xs text-[color:var(--color-foreground)] transition-colors hover:bg-[color:var(--color-accent)]">
                    <input type="radio" name={`copy-group-${projectId}`} checked={copyGroupId === group.id} onChange={() => setCopyGroupId(group.id)} disabled={copying} />
                    <span className="min-w-0 flex-1 truncate">{group.name}</span>
                  </label>
                ))}
              </div>
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  value={copyNewGroupName}
                  onChange={(event) => setCopyNewGroupName(event.target.value)}
                  placeholder={t('documentation.groupNamePlaceholder')}
                  disabled={copying}
                  className="quiet-control block h-8 min-w-0 flex-1 rounded-full border-0 px-3 text-[11px] text-[color:var(--color-foreground)] placeholder:text-[color:var(--color-muted-foreground)] outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                <span className="shrink-0 text-[10px] text-[color:var(--color-muted-foreground)]">{t('documentation.newGroup')}</span>
              </div>
              {copyError && <p className="px-1 text-[11px] text-[color:var(--color-destructive)]">{copyError}</p>}
              {copyDoneCount !== null && !copyError && (
                <p className="inline-flex items-center gap-1 px-1 text-[11px] text-[color:var(--color-success)]">
                  <Check className="h-3 w-3" />
                  {t('documentation.copiedToLibrary', { count: copyDoneCount })}
                </p>
              )}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="inline-flex h-8 items-center rounded-full bg-primary px-3 text-xs font-medium text-white transition-colors hover:bg-primary-hover disabled:opacity-60"
                  onClick={() => {
                    void handleCopyToLibrary()
                  }}
                  disabled={copying || selectedLinkIds.length === 0 || (!copyGroupId && !copyNewGroupName.trim())}
                >
                  {t('documentation.copySelectedToLibrary')}
                </button>
                <button
                  type="button"
                  className="inline-flex h-8 items-center rounded-full border border-[color:var(--color-border)] px-3 text-xs text-[color:var(--color-foreground)] transition-colors hover:bg-[color:var(--color-accent)]"
                  onClick={() => {
                    setCopyOpen(false)
                    setCopyError(null)
                  }}
                >
                  {t('common.cancel')}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {libraryDialogOpen && <SharedDocLinkLibraryDialog open onClose={() => setLibraryDialogOpen(false)} baseZIndex={1100} />}
    </div>
  )
}
