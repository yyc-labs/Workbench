import { useCallback, useEffect, useMemo, useState } from 'react'
import { arrayMove } from '@dnd-kit/sortable'
import type { ProjectDocLink, ProjectDocLinkTag, ProjectDocTagOption, ProjectInfo } from '../../../shared/types'
import { useI18n, useLocale } from '../../i18n'
import { useAppStore } from '../../stores/appStore'
import { createDocLinkId, normalizeDocUrl } from './detail.aiFlow'
import {
  PROJECT_DOC_LINK_DEFAULT_TAG_OPTIONS,
  normalizeProjectDocLinkTag,
  projectDocLinkTagLabel,
} from '../../lib/projectDocLinks'

type UseProjectDocLinksOptions = {
  project: ProjectInfo | undefined
  initialSettingsOpen?: boolean
}

export function useProjectDocLinks({
  project,
  initialSettingsOpen = false,
}: UseProjectDocLinksOptions) {
  const locale = useLocale()
  const { t } = useI18n()
  const setProjectDocLinks = useAppStore((s) => s.setProjectDocLinks)
  const docLinkTagOptions = useAppStore((s) => s.config.docLinkTags ?? PROJECT_DOC_LINK_DEFAULT_TAG_OPTIONS)
  const setDocLinkTags = useAppStore((s) => s.setDocLinkTags)
  const [linkSettingsOpen, setLinkSettingsOpen] = useState(initialSettingsOpen)
  const [docTitleInput, setDocTitleInput] = useState('')
  const [docUrlInput, setDocUrlInput] = useState('')
  const [docTagInput, setDocTagInput] = useState<ProjectDocLinkTag>('')
  const [docNoteInput, setDocNoteInput] = useState('')
  const [docAccountInput, setDocAccountInput] = useState('')
  const [docSecretInput, setDocSecretInput] = useState('')
  const [docError, setDocError] = useState<string | null>(null)

  const docLinks = useMemo(
    () => (project?.docLinks ?? []).map((link) => ({ ...link, tag: normalizeProjectDocLinkTag(link.tag, docLinkTagOptions) })),
    [docLinkTagOptions, project?.docLinks]
  )
  const defaultDocLink = docLinks[0]
  const docMenuItems = useMemo(
    () => docLinks.map((link) => {
      const normalizedTag = normalizeProjectDocLinkTag(link.tag, docLinkTagOptions)
      return {
        url: link.url,
        label: link.title,
        tag: normalizedTag,
        tagLabel: projectDocLinkTagLabel(normalizedTag, docLinkTagOptions, locale),
      }
    }),
    [docLinkTagOptions, docLinks, locale]
  )

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

  const handleAddDocTag = useCallback(async (labelInput: string): Promise<{ ok: boolean; message?: string }> => {
    const label = labelInput.trim()
    if (!label) return { ok: false, message: t('documentation.addCategoryEmpty') }
    const duplicateLabel = docLinkTagOptions.some((item) => item.label.toLowerCase() === label.toLowerCase())
    if (duplicateLabel) return { ok: false, message: t('documentation.addCategoryDuplicate') }

    const base = label
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

    const next = normalizeDocTagOptions([
      ...docLinkTagOptions,
      { value, label, sortOrder: docLinkTagOptions.length },
    ])
    await setDocLinkTags(next)
    return { ok: true }
  }, [docLinkTagOptions, normalizeDocTagOptions, setDocLinkTags, t])

  const handleRenameDocTag = useCallback(async (
    value: string,
    labelInput: string
  ): Promise<{ ok: boolean; message?: string }> => {
    const label = labelInput.trim()
    if (!label) return { ok: false, message: t('documentation.renameCategoryEmpty') }
    const target = docLinkTagOptions.find((item) => item.value === value)
    if (!target) return { ok: false, message: t('documentation.renameCategoryMissing') }
    const duplicateLabel = docLinkTagOptions.some(
      (item) => item.value !== value && item.label.toLowerCase() === label.toLowerCase()
    )
    if (duplicateLabel) return { ok: false, message: t('documentation.renameCategoryDuplicate') }

    const next = normalizeDocTagOptions(
      docLinkTagOptions.map((item) => (item.value === value ? { ...item, label } : item))
    )
    await setDocLinkTags(next)
    return { ok: true }
  }, [docLinkTagOptions, normalizeDocTagOptions, setDocLinkTags, t])

  const handleRemoveDocTag = useCallback(async (
    value: string
  ): Promise<{ ok: boolean; message?: string }> => {
    if (!docLinkTagOptions.some((item) => item.value === value)) {
      return { ok: false, message: t('documentation.removeCategoryMissing') }
    }
    if (project) {
      const hasTagInProject = docLinks.some((link) => normalizeProjectDocLinkTag(link.tag, docLinkTagOptions) === value)
      if (hasTagInProject) {
        const migrated = docLinks.map((link) => (
          normalizeProjectDocLinkTag(link.tag, docLinkTagOptions) === value
            ? { ...link, tag: undefined }
            : link
        ))
        await setProjectDocLinks(project.id, migrated)
      }
    }
    const next = normalizeDocTagOptions(docLinkTagOptions.filter((item) => item.value !== value))
    await setDocLinkTags(next)
    return { ok: true }
  }, [docLinkTagOptions, docLinks, normalizeDocTagOptions, project, setDocLinkTags, setProjectDocLinks, t])

  const handleAddDocLink = useCallback(async () => {
    if (!project) return

    const normalizedUrl = normalizeDocUrl(docUrlInput)
    if (!normalizedUrl) {
      setDocError(t('documentation.invalidUrl'))
      return
    }

    const duplicate = docLinks.some((link) => link.url.toLowerCase() === normalizedUrl.toLowerCase())
    if (duplicate) {
      setDocError(t('documentation.duplicateUrl'))
      return
    }

    let title = docTitleInput.trim()
    if (!title) {
      try {
        title = new URL(normalizedUrl).hostname
      } catch {
        title = t('documentation.generatedTitle')
      }
    }

    const note = docNoteInput.trim() || undefined
    const account = docAccountInput.trim() || undefined
    const secret = docSecretInput.trim()
    const linkId = createDocLinkId()
    const nextLink: ProjectDocLink = {
      id: linkId,
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
        return
      }
    }
    setDocTitleInput('')
    setDocUrlInput('')
    setDocTagInput('')
    setDocNoteInput('')
    setDocAccountInput('')
    setDocSecretInput('')
    setDocError(null)
  }, [
    docTagInput,
    docAccountInput,
    docLinks,
    docNoteInput,
    docSecretInput,
    docTitleInput,
    docUrlInput,
    project,
    setProjectDocLinks,
    docLinkTagOptions,
    t,
  ])

  const handleRemoveDocLink = useCallback(async (linkId: string) => {
    if (!project) return
    try {
      await window.electronAPI.deleteDocLinkSecret(project.id, linkId)
    } catch {
      // best effort
    }
    const nextLinks = docLinks.filter((link) => link.id !== linkId)
    await setProjectDocLinks(project.id, nextLinks)
  }, [docLinks, project, setProjectDocLinks])

  const handleSetDefaultDocLink = useCallback(async (linkId: string) => {
    if (!project) return
    const index = docLinks.findIndex((link) => link.id === linkId)
    if (index <= 0) return
    const nextLinks = [docLinks[index], ...docLinks.slice(0, index), ...docLinks.slice(index + 1)]
    await setProjectDocLinks(project.id, nextLinks)
  }, [docLinks, project, setProjectDocLinks])

  const handleReorderDocLinks = useCallback(async (activeLinkId: string, overLinkId: string) => {
    if (!project) return
    const oldIndex = docLinks.findIndex((link) => link.id === activeLinkId)
    const newIndex = docLinks.findIndex((link) => link.id === overLinkId)
    if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return
    const nextLinks = arrayMove(docLinks, oldIndex, newIndex)
    await setProjectDocLinks(project.id, nextLinks)
  }, [docLinks, project, setProjectDocLinks])

  const handleUpdateDocLink = useCallback(async (
    linkId: string,
    nextTitleInput: string,
    nextUrlInput: string,
    nextTagInput: ProjectDocLinkTag,
    nextNoteInput: string,
    nextAccountInput: string,
    nextSecretInput: string,
    clearSecret: boolean
  ): Promise<boolean> => {
    if (!project) return false

    const normalizedUrl = normalizeDocUrl(nextUrlInput)
    if (!normalizedUrl) {
      setDocError(t('documentation.invalidUrl'))
      return false
    }

    const duplicate = docLinks.some(
      (link) => link.id !== linkId && link.url.toLowerCase() === normalizedUrl.toLowerCase()
    )
    if (duplicate) {
      setDocError(t('documentation.duplicateUrl'))
      return false
    }

    let title = nextTitleInput.trim()
    if (!title) {
      try {
        title = new URL(normalizedUrl).hostname
      } catch {
        title = t('documentation.generatedTitle')
      }
    }

    const note = nextNoteInput.trim() || undefined
    const account = nextAccountInput.trim() || undefined
    const secret = nextSecretInput.trim()

    let hasSecret = false
    const targetLink = docLinks.find((link) => link.id === linkId)
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

    const nextLinks = docLinks.map((link) => (
      link.id === linkId
        ? {
          ...link,
          title,
          url: normalizedUrl,
          tag: normalizeProjectDocLinkTag(nextTagInput, docLinkTagOptions),
          ...(note ? { note } : { note: undefined }),
          ...(account ? { account } : { account: undefined }),
          ...(hasSecret ? { hasSecret: true } : { hasSecret: undefined }),
        }
        : link
    ))

    await setProjectDocLinks(project.id, nextLinks)
    setDocError(null)
    return true
  }, [docLinks, project, setProjectDocLinks, docLinkTagOptions, t])

  useEffect(() => {
    setDocTagInput((current) => normalizeProjectDocLinkTag(current, docLinkTagOptions))
  }, [docLinkTagOptions])

  const handleCopyDocLinkAccount = useCallback(async (linkId: string): Promise<boolean> => {
    const link = docLinks.find((item) => item.id === linkId)
    const account = link?.account?.trim()
    if (!account) return false
    try {
      await navigator.clipboard.writeText(account)
      return true
    } catch {
      return false
    }
  }, [docLinks])

  const handleCopyDocLinkSecret = useCallback(async (linkId: string): Promise<boolean> => {
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
  }, [project])

  const handleGetDocLinkSecret = useCallback(async (linkId: string): Promise<string | null> => {
    if (!project) return null
    try {
      const result = await window.electronAPI.getDocLinkSecret(project.id, linkId)
      const secret = result.secret?.trim()
      return secret || null
    } catch {
      return null
    }
  }, [project])

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
  }
}
