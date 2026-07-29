import { useCallback, useEffect, useMemo, useState, type SetStateAction } from 'react'
import { arrayMove } from '@dnd-kit/sortable'
import type { ProjectDocLink, ProjectDocLinkKind, ProjectDocLinkSshRoute, ProjectDocLinkTag, ProjectDocTagOption, ProjectInfo } from '../../../shared/types'
import { useI18n, useLocale } from '../../i18n'
import { useAppStore } from '../../stores/appStore'
import { copyTextToClipboard } from '../code/code.clipboard'
import { buildSshDocLinkTarget, createDocLinkId, normalizeDocLinkPort, normalizeDocUrl, normalizeSshHost, parseSshShortcutInput } from './detail.aiFlow'
import { PROJECT_DOC_LINK_DEFAULT_TAG_OPTIONS, normalizeProjectDocLinkKind, projectDocLinkCopyValue, normalizeProjectDocLinkTag, projectDocLinkTagLabel } from '../../lib/projectDocLinks'

type UseProjectDocLinksOptions = {
  project: ProjectInfo | undefined
  initialSettingsOpen?: boolean
}

export type ProjectDocMenuItem = {
  url: string
  label: string
  tag?: string
  tagLabel?: string
  onOpen?: () => void | Promise<void>
  kind?: ProjectDocLinkKind
  description?: string
  copyValue?: string
  copyLabel?: string
  copyValueResolver?: () => Promise<string>
  credentialActions?: ReadonlyArray<{
    key: string
    label: string
    onCopy: () => Promise<boolean>
    icon?: 'account' | 'password'
  }>
  linkId?: string
}

function normalizeProjectDocLinkSshRoute(value: ProjectDocLinkSshRoute | string | null | undefined): ProjectDocLinkSshRoute {
  return value === 'windows' ? 'windows' : 'wsl'
}

export function useProjectDocLinks({ project, initialSettingsOpen = false }: UseProjectDocLinksOptions) {
  const locale = useLocale()
  const { t } = useI18n()
  const setProjectDocLinks = useAppStore((s) => s.setProjectDocLinks)
  const docLinkTagOptions = useAppStore((s) => s.config.docLinkTags ?? PROJECT_DOC_LINK_DEFAULT_TAG_OPTIONS)
  const setDocLinkTags = useAppStore((s) => s.setDocLinkTags)
  const [linkSettingsOpen, setLinkSettingsOpen] = useState(initialSettingsOpen)
  const [docKindInput, setDocKindInput] = useState<ProjectDocLinkKind>('url')
  const [docTitleInput, setDocTitleInput] = useState('')
  const [docUrlInput, setDocUrlInput] = useState('')
  const [docTagInput, setDocTagInput] = useState<ProjectDocLinkTag>('')
  const [docNoteInput, setDocNoteInput] = useState('')
  const [docAccountInput, setDocAccountInput] = useState('')
  const [docSecretInput, setDocSecretInput] = useState('')
  const [docSshHostInput, setDocSshHostInput] = useState('')
  const [docSshPortInput, setDocSshPortInput] = useState('22')
  const [docSshUsernameInput, setDocSshUsernameInput] = useState('')
  const [docSshShortcutInput, setDocSshShortcutInput] = useState('')
  const [docSshRouteInput, setDocSshRouteInput] = useState<ProjectDocLinkSshRoute>('wsl')
  const [docError, setDocError] = useState<string | null>(null)

  const docLinks = useMemo(
    () =>
      (project?.docLinks ?? []).map((link) => {
        const kind: ProjectDocLinkKind = normalizeProjectDocLinkKind(link.kind)
        const normalizedPort = normalizeDocLinkPort(link.sshPort)
        return {
          ...link,
          kind,
          url: kind === 'url' ? link.url : undefined,
          sshHost: kind === 'ssh' ? link.sshHost?.trim() || '' : undefined,
          sshPort: kind === 'ssh' ? (normalizedPort ?? 22) : undefined,
          sshUsername: kind === 'ssh' ? link.sshUsername?.trim() || link.account?.trim() || '' : undefined,
          sshRoute: kind === 'ssh' ? normalizeProjectDocLinkSshRoute(link.sshRoute) : undefined,
          account: kind === 'ssh' ? link.sshUsername?.trim() || link.account?.trim() || undefined : link.account?.trim() || undefined,
          tag: normalizeProjectDocLinkTag(link.tag, docLinkTagOptions),
        }
      }),
    [docLinkTagOptions, project?.docLinks],
  )
  const defaultDocLink = docLinks[0]

  const normalizeDocTagOptions = useCallback((input: ProjectDocTagOption[]): ProjectDocTagOption[] => {
    const deduped: ProjectDocTagOption[] = []
    const used = new Set<string>()
    for (const item of input) {
      const value = item.value.trim()
      const label = item.label.trim()
      if (!value || !label || used.has(value)) continue
      used.add(value)
      deduped.push({
        value,
        label,
        sortOrder: deduped.length,
      })
    }
    return deduped
  }, [])

  const applySshShortcutInput = useCallback((value: string) => {
    setDocSshShortcutInput(value)
    const parsed = parseSshShortcutInput(value)
    if (!parsed) return
    setDocSshUsernameInput(parsed.username)
    setDocSshHostInput(parsed.host)
    setDocSshPortInput(String(parsed.port))
  }, [])

  const handleSetDocSshShortcutInput = useCallback(
    (value: SetStateAction<string>) => {
      const nextValue = typeof value === 'function' ? value(docSshShortcutInput) : value
      applySshShortcutInput(nextValue)
    },
    [applySshShortcutInput, docSshShortcutInput],
  )

  const handleAddDocTag = useCallback(
    async (labelInput: string): Promise<{ ok: boolean; message?: string }> => {
      const label = labelInput.trim()
      if (!label) return { ok: false, message: t('documentation.addCategoryEmpty') }
      const duplicateLabel = docLinkTagOptions.some((item) => item.label.toLowerCase() === label.toLowerCase())
      if (duplicateLabel) return { ok: false, message: t('documentation.addCategoryDuplicate') }

      const base =
        label
          .toLowerCase()
          .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
          .replace(/^-+|-+$/g, '') || 'tag'
      let value = `custom-${base}`
      let serial = 2
      const used = new Set(docLinkTagOptions.map((item) => item.value))
      while (used.has(value)) {
        value = `custom-${base}-${serial}`
        serial += 1
      }

      const next = normalizeDocTagOptions([...docLinkTagOptions, { value, label, sortOrder: docLinkTagOptions.length }])
      await setDocLinkTags(next)
      return { ok: true }
    },
    [docLinkTagOptions, normalizeDocTagOptions, setDocLinkTags, t],
  )

  const handleRenameDocTag = useCallback(
    async (value: string, labelInput: string): Promise<{ ok: boolean; message?: string }> => {
      const label = labelInput.trim()
      if (!label) return { ok: false, message: t('documentation.renameCategoryEmpty') }
      const target = docLinkTagOptions.find((item) => item.value === value)
      if (!target) return { ok: false, message: t('documentation.renameCategoryMissing') }
      const duplicateLabel = docLinkTagOptions.some((item) => item.value !== value && item.label.toLowerCase() === label.toLowerCase())
      if (duplicateLabel) return { ok: false, message: t('documentation.renameCategoryDuplicate') }

      const next = normalizeDocTagOptions(docLinkTagOptions.map((item) => (item.value === value ? { ...item, label } : item)))
      await setDocLinkTags(next)
      return { ok: true }
    },
    [docLinkTagOptions, normalizeDocTagOptions, setDocLinkTags, t],
  )

  const handleRemoveDocTag = useCallback(
    async (value: string): Promise<{ ok: boolean; message?: string }> => {
      if (!docLinkTagOptions.some((item) => item.value === value)) {
        return { ok: false, message: t('documentation.removeCategoryMissing') }
      }
      if (project) {
        const hasTagInProject = docLinks.some((link) => normalizeProjectDocLinkTag(link.tag, docLinkTagOptions) === value)
        if (hasTagInProject) {
          const migrated = docLinks.map((link) => (normalizeProjectDocLinkTag(link.tag, docLinkTagOptions) === value ? { ...link, tag: undefined } : link))
          await setProjectDocLinks(project.id, migrated)
        }
      }
      const next = normalizeDocTagOptions(docLinkTagOptions.filter((item) => item.value !== value))
      await setDocLinkTags(next)
      return { ok: true }
    },
    [docLinkTagOptions, docLinks, normalizeDocTagOptions, project, setDocLinkTags, setProjectDocLinks, t],
  )

  const handleAddDocLink = useCallback(async () => {
    if (!project) return false

    let title = docTitleInput.trim()
    const note = docNoteInput.trim() || undefined
    const secret = docSecretInput.trim()
    const linkId = createDocLinkId()

    if (docKindInput === 'ssh') {
      const sshHost = normalizeSshHost(docSshHostInput)
      const sshPort = normalizeDocLinkPort(docSshPortInput) ?? 22
      const sshUsername = docSshUsernameInput.trim()
      if (!sshHost) {
        setDocError(t('documentation.invalidSshHost'))
        return false
      }
      if (!sshUsername) {
        setDocError(t('documentation.invalidSshUsername'))
        return false
      }
      const duplicate = docLinks.some((link) => link.kind === 'ssh' && link.sshHost?.toLowerCase() === sshHost.toLowerCase() && (link.sshPort ?? 22) === sshPort && (link.sshUsername ?? link.account ?? '').toLowerCase() === sshUsername.toLowerCase())
      if (duplicate) {
        setDocError(t('documentation.duplicateSsh'))
        return false
      }
      if (!title) {
        title = sshUsername
      }
      const nextLink: ProjectDocLink = {
        id: linkId,
        kind: 'ssh',
        title,
        tag: normalizeProjectDocLinkTag(docTagInput, docLinkTagOptions),
        sshHost,
        sshPort,
        sshUsername,
        sshRoute: docSshRouteInput,
        account: sshUsername,
        ...(note ? { note } : {}),
        ...(secret ? { hasSecret: true } : {}),
      }
      const nextLinks = [...docLinks, nextLink]
      await setProjectDocLinks(project.id, nextLinks)
      if (secret) {
        try {
          await window.electronAPI.setDocLinkSecret(project.id, linkId, secret)
        } catch (error) {
          setDocError(error instanceof Error ? error.message : t('documentation.saveSecretFailed'))
          return false
        }
      }
      setDocKindInput('url')
      setDocTitleInput('')
      setDocUrlInput('')
      setDocTagInput('')
      setDocNoteInput('')
      setDocAccountInput('')
      setDocSecretInput('')
      setDocSshHostInput('')
      setDocSshPortInput('22')
      setDocSshUsernameInput('')
      setDocSshShortcutInput('')
      setDocSshRouteInput('wsl')
      setDocError(null)
      return true
    }

    const normalizedUrl = normalizeDocUrl(docUrlInput)
    if (!normalizedUrl) {
      setDocError(t('documentation.invalidUrl'))
      return false
    }

    const duplicate = docLinks.some((link) => (link.kind ?? 'url') === 'url' && (link.url ?? '').toLowerCase() === normalizedUrl.toLowerCase())
    if (duplicate) {
      setDocError(t('documentation.duplicateUrl'))
      return false
    }

    if (!title) {
      try {
        title = new URL(normalizedUrl).hostname
      } catch {
        title = t('documentation.generatedTitle')
      }
    }

    const account = docAccountInput.trim() || undefined
    const nextLink: ProjectDocLink = {
      id: linkId,
      kind: 'url',
      title,
      url: normalizedUrl,
      tag: normalizeProjectDocLinkTag(docTagInput, docLinkTagOptions),
      ...(note ? { note } : {}),
      ...(account ? { account } : {}),
      ...(secret ? { hasSecret: true } : {}),
    }
    const nextLinks = [...docLinks, nextLink]
    await setProjectDocLinks(project.id, nextLinks)
    if (secret) {
      try {
        await window.electronAPI.setDocLinkSecret(project.id, linkId, secret)
      } catch (error) {
        setDocError(error instanceof Error ? error.message : t('documentation.saveSecretFailed'))
        return false
      }
    }
    setDocKindInput('url')
    setDocTitleInput('')
    setDocUrlInput('')
    setDocTagInput('')
    setDocNoteInput('')
    setDocAccountInput('')
    setDocSecretInput('')
    setDocSshHostInput('')
    setDocSshPortInput('22')
    setDocSshUsernameInput('')
    setDocSshShortcutInput('')
    setDocSshRouteInput('wsl')
    setDocError(null)
    return true
  }, [docKindInput, docTagInput, docAccountInput, docLinks, docNoteInput, docSecretInput, docSshHostInput, docSshPortInput, docSshRouteInput, docSshShortcutInput, docSshUsernameInput, docTitleInput, docUrlInput, project, setProjectDocLinks, docLinkTagOptions, t])

  const handleRemoveDocLink = useCallback(
    async (linkId: string) => {
      if (!project) return
      try {
        await window.electronAPI.deleteDocLinkSecret(project.id, linkId)
      } catch {
        // best effort
      }
      const nextLinks = docLinks.filter((link) => link.id !== linkId)
      await setProjectDocLinks(project.id, nextLinks)
    },
    [docLinks, project, setProjectDocLinks],
  )

  const handleSetDefaultDocLink = useCallback(
    async (linkId: string) => {
      if (!project) return
      const index = docLinks.findIndex((link) => link.id === linkId)
      if (index <= 0) return
      const nextLinks = [docLinks[index], ...docLinks.slice(0, index), ...docLinks.slice(index + 1)]
      await setProjectDocLinks(project.id, nextLinks)
    },
    [docLinks, project, setProjectDocLinks],
  )

  const handleReorderDocLinks = useCallback(
    async (activeLinkId: string, overLinkId: string) => {
      if (!project) return
      const oldIndex = docLinks.findIndex((link) => link.id === activeLinkId)
      const newIndex = docLinks.findIndex((link) => link.id === overLinkId)
      if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return
      const nextLinks = arrayMove(docLinks, oldIndex, newIndex)
      await setProjectDocLinks(project.id, nextLinks)
    },
    [docLinks, project, setProjectDocLinks],
  )

  const handleUpdateDocLink = useCallback(
    async (
      linkId: string,
      nextKindInput: ProjectDocLinkKind,
      nextTitleInput: string,
      nextUrlInput: string,
      nextTagInput: ProjectDocLinkTag,
      nextNoteInput: string,
      nextAccountInput: string,
      nextSshHostInput: string,
      nextSshPortInput: string,
      nextSshUsernameInput: string,
      nextSshRouteInput: ProjectDocLinkSshRoute,
      nextSecretInput: string,
      clearSecret: boolean,
    ): Promise<boolean> => {
      if (!project) return false

      let title = nextTitleInput.trim()
      const note = nextNoteInput.trim() || undefined
      const secret = nextSecretInput.trim()
      const targetLink = docLinks.find((link) => link.id === linkId)

      let normalizedUrl: string | undefined
      let account: string | undefined
      let sshHost: string | undefined
      let sshPort: number | undefined
      let sshUsername: string | undefined
      let sshRoute: ProjectDocLinkSshRoute | undefined

      if (nextKindInput === 'ssh') {
        const normalizedHost = normalizeSshHost(nextSshHostInput)
        const normalizedPort = normalizeDocLinkPort(nextSshPortInput) ?? 22
        const normalizedUsername = nextSshUsernameInput.trim()
        if (!normalizedHost) {
          setDocError(t('documentation.invalidSshHost'))
          return false
        }
        if (!normalizedUsername) {
          setDocError(t('documentation.invalidSshUsername'))
          return false
        }
        const duplicate = docLinks.some((link) => link.id !== linkId && link.kind === 'ssh' && link.sshHost?.toLowerCase() === normalizedHost.toLowerCase() && (link.sshPort ?? 22) === normalizedPort && (link.sshUsername ?? link.account ?? '').toLowerCase() === normalizedUsername.toLowerCase())
        if (duplicate) {
          setDocError(t('documentation.duplicateSsh'))
          return false
        }
        if (!title) {
          title = normalizedUsername
        }
        sshHost = normalizedHost
        sshPort = normalizedPort
        sshUsername = normalizedUsername
        sshRoute = normalizeProjectDocLinkSshRoute(nextSshRouteInput)
        account = normalizedUsername
      } else {
        const nextNormalizedUrl = normalizeDocUrl(nextUrlInput)
        if (!nextNormalizedUrl) {
          setDocError(t('documentation.invalidUrl'))
          return false
        }
        normalizedUrl = nextNormalizedUrl
        const duplicate = docLinks.some((link) => link.id !== linkId && (link.kind ?? 'url') === 'url' && (link.url ?? '').toLowerCase() === nextNormalizedUrl.toLowerCase())
        if (duplicate) {
          setDocError(t('documentation.duplicateUrl'))
          return false
        }
        if (!title && normalizedUrl) {
          try {
            title = new URL(normalizedUrl).hostname
          } catch {
            title = t('documentation.generatedTitle')
          }
        }
        account = nextAccountInput.trim() || undefined
      }

      let hasSecret = false
      if (targetLink?.hasSecret) {
        hasSecret = true
      }

      if (secret) {
        try {
          await window.electronAPI.setDocLinkSecret(project.id, linkId, secret)
          hasSecret = true
        } catch (error) {
          setDocError(error instanceof Error ? error.message : t('documentation.saveSecretFailed'))
          return false
        }
      } else if (clearSecret) {
        try {
          await window.electronAPI.deleteDocLinkSecret(project.id, linkId)
          hasSecret = false
        } catch (error) {
          setDocError(error instanceof Error ? error.message : t('documentation.clearSecretFailed'))
          return false
        }
      }

      const nextLinks = docLinks.map((link) =>
        link.id === linkId
          ? {
              ...link,
              kind: nextKindInput,
              title,
              url: nextKindInput === 'url' ? normalizedUrl : undefined,
              tag: normalizeProjectDocLinkTag(nextTagInput, docLinkTagOptions),
              ...(note ? { note } : { note: undefined }),
              ...(account ? { account } : { account: undefined }),
              ...(nextKindInput === 'ssh'
                ? {
                    sshHost,
                    sshPort,
                    sshUsername,
                    sshRoute,
                  }
                : {
                    sshHost: undefined,
                    sshPort: undefined,
                    sshUsername: undefined,
                    sshRoute: undefined,
                  }),
              ...(hasSecret ? { hasSecret: true } : { hasSecret: undefined }),
            }
          : link,
      )

      await setProjectDocLinks(project.id, nextLinks)
      setDocError(null)
      return true
    },
    [docLinks, project, setProjectDocLinks, docLinkTagOptions, t],
  )

  useEffect(() => {
    setDocTagInput((current) => normalizeProjectDocLinkTag(current, docLinkTagOptions))
  }, [docLinkTagOptions])

  const handleCopyDocLinkAccount = useCallback(
    async (linkId: string): Promise<boolean> => {
      const link = docLinks.find((item) => item.id === linkId)
      const account = (link?.kind === 'ssh' ? (link.sshUsername ?? link.account) : link?.account)?.trim()
      if (!account) return false
      try {
        await navigator.clipboard.writeText(account)
        return true
      } catch {
        return false
      }
    },
    [docLinks],
  )

  const handleCopyDocLinkSecret = useCallback(
    async (linkId: string): Promise<boolean> => {
      if (!project) return false
      try {
        const result = await window.electronAPI.getDocLinkSecret(project.id, linkId)
        const secret = result.secret?.trim()
        if (!secret) return false
        await navigator.clipboard.writeText(secret)
        return true
      } catch {
        return false
      }
    },
    [project],
  )

  const handleGetDocLinkSecret = useCallback(
    async (linkId: string): Promise<string | null> => {
      if (!project) return null
      try {
        const result = await window.electronAPI.getDocLinkSecret(project.id, linkId)
        const secret = result.secret?.trim()
        return secret || null
      } catch {
        return null
      }
    },
    [project],
  )

  const handleOpenDocLink = useCallback(
    async (link: ProjectDocLink): Promise<void> => {
      if ((link.kind ?? 'url') === 'ssh') {
        const host = link.sshHost?.trim()
        const username = (link.sshUsername ?? link.account)?.trim()
        const port = normalizeDocLinkPort(link.sshPort) ?? 22
        if (!host) {
          setDocError(t('documentation.invalidSshHost'))
          return
        }
        if (!username) {
          setDocError(t('documentation.invalidSshUsername'))
          return
        }
        let password: string | null = null
        if (project && link.hasSecret) {
          password = await handleGetDocLinkSecret(link.id)
        }
        if (normalizeProjectDocLinkSshRoute(link.sshRoute) === 'windows' && password) {
          try {
            await copyTextToClipboard(password)
          } catch {
            // Clipboard access should not prevent opening the Windows SSH terminal.
          }
        }
        const result = await window.electronAPI.openSshTerminal({
          host,
          port,
          username,
          password,
          route: normalizeProjectDocLinkSshRoute(link.sshRoute),
        })
        if (!result.ok) {
          setDocError(result.message ?? t('documentation.openSshFailed'))
          return
        }
        setDocError(null)
        if (result.message) {
          console.info('[doc-link][ssh]', result.message)
        }
        return
      }

      const target = link.url?.trim()
      if (!target) {
        setDocError(t('documentation.invalidUrl'))
        return
      }
      await window.electronAPI.openExternal(target)
      setDocError(null)
    },
    [handleGetDocLinkSecret, project, t],
  )

  const handleOpenDocMenuItem = useCallback(
    async (linkId: string): Promise<void> => {
      const link = docLinks.find((item) => item.id === linkId)
      if (!link) return
      await handleOpenDocLink(link)
    },
    [docLinks, handleOpenDocLink],
  )

  const docMenuItems = useMemo<ProjectDocMenuItem[]>(
    () =>
      docLinks.map((link) => {
        const normalizedTag = normalizeProjectDocLinkTag(link.tag, docLinkTagOptions)
        const isSsh = link.kind === 'ssh'
        const sshTarget = buildSshDocLinkTarget(link.sshHost || '', link.sshPort)
        return {
          url: link.url ?? '',
          label: isSsh ? `${t('documentation.connectSsh')} · ${link.title}` : link.title,
          tag: normalizedTag,
          tagLabel: projectDocLinkTagLabel(normalizedTag, docLinkTagOptions, locale),
          onOpen: () => handleOpenDocLink(link),
          kind: link.kind ?? 'url',
          description: isSsh ? `${link.sshUsername || link.account || ''}@${sshTarget}` : (link.url ?? ''),
          copyValue: projectDocLinkCopyValue(link),
          credentialActions: [
            ...(link.account?.trim() || link.sshUsername?.trim()
              ? [
                  {
                    key: 'account',
                    label: t('documentation.copyAccount'),
                    icon: 'account' as const,
                    onCopy: async () => await handleCopyDocLinkAccount(link.id),
                  },
                ]
              : []),
            ...(link.hasSecret
              ? [
                  {
                    key: 'password',
                    label: t('documentation.copyPassword'),
                    icon: 'password' as const,
                    onCopy: async () => await handleCopyDocLinkSecret(link.id),
                  },
                ]
              : []),
          ],
          linkId: link.id,
        }
      }),
    [docLinkTagOptions, docLinks, handleCopyDocLinkAccount, handleCopyDocLinkSecret, handleOpenDocLink, locale, t],
  )

  useEffect(() => {
    if (!linkSettingsOpen) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setLinkSettingsOpen(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [linkSettingsOpen])

  return {
    docLinks,
    defaultDocLink,
    docMenuItems,
    docKindInput,
    setDocKindInput,
    docLinkTagOptions,
    linkSettingsOpen,
    setLinkSettingsOpen,
    docTitleInput,
    setDocTitleInput,
    docUrlInput,
    setDocUrlInput,
    docTagInput,
    setDocTagInput,
    docNoteInput,
    setDocNoteInput,
    docAccountInput,
    setDocAccountInput,
    docSecretInput,
    setDocSecretInput,
    docSshHostInput,
    setDocSshHostInput,
    docSshPortInput,
    setDocSshPortInput,
    docSshUsernameInput,
    setDocSshUsernameInput,
    docSshShortcutInput,
    setDocSshShortcutInput: handleSetDocSshShortcutInput,
    docSshRouteInput,
    setDocSshRouteInput,
    docError,
    setDocError,
    handleAddDocLink,
    handleAddDocTag,
    handleRenameDocTag,
    handleRemoveDocTag,
    handleUpdateDocLink,
    handleSetDefaultDocLink,
    handleReorderDocLinks,
    handleRemoveDocLink,
    handleCopyDocLinkAccount,
    handleCopyDocLinkSecret,
    handleGetDocLinkSecret,
    handleOpenDocLink,
    handleOpenDocMenuItem,
  }
}
