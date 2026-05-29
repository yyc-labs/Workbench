import { useCallback, useEffect, useMemo, useState } from 'react'
import { arrayMove } from '@dnd-kit/sortable'
import type { ProjectDocLink, ProjectInfo } from '../../../shared/types'
import { useAppStore } from '../../stores/appStore'
import { createDocLinkId, normalizeDocUrl } from './detail.aiFlow'

type UseProjectDocLinksOptions = {
  project: ProjectInfo | undefined
}

export function useProjectDocLinks({ project }: UseProjectDocLinksOptions) {
  const setProjectDocLinks = useAppStore((s) => s.setProjectDocLinks)
  const [linkSettingsOpen, setLinkSettingsOpen] = useState(false)
  const [docTitleInput, setDocTitleInput] = useState('')
  const [docUrlInput, setDocUrlInput] = useState('')
  const [docNoteInput, setDocNoteInput] = useState('')
  const [docAccountInput, setDocAccountInput] = useState('')
  const [docSecretInput, setDocSecretInput] = useState('')
  const [docError, setDocError] = useState<string | null>(null)

  const docLinks = useMemo(() => project?.docLinks ?? [], [project?.docLinks])
  const defaultDocLink = docLinks[0]
  const docMenuItems = useMemo(
    () => docLinks.map((link) => ({ url: link.url, label: link.title })),
    [docLinks]
  )

  const handleAddDocLink = useCallback(async () => {
    if (!project) return

    const normalizedUrl = normalizeDocUrl(docUrlInput)
    if (!normalizedUrl) {
      setDocError('请输入有效的 http/https URL')
      return
    }

    const duplicate = docLinks.some((link) => link.url.toLowerCase() === normalizedUrl.toLowerCase())
    if (duplicate) {
      setDocError('该文档链接已存在')
      return
    }

    let title = docTitleInput.trim()
    if (!title) {
      try {
        title = new URL(normalizedUrl).hostname
      } catch {
        title = 'Documentation'
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
        setDocError(error instanceof Error ? error.message : '保存密码失败')
        return
      }
    }
    setDocTitleInput('')
    setDocUrlInput('')
    setDocNoteInput('')
    setDocAccountInput('')
    setDocSecretInput('')
    setDocError(null)
  }, [
    docAccountInput,
    docLinks,
    docNoteInput,
    docSecretInput,
    docTitleInput,
    docUrlInput,
    project,
    setProjectDocLinks,
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
    nextNoteInput: string,
    nextAccountInput: string,
    nextSecretInput: string,
    clearSecret: boolean
  ): Promise<boolean> => {
    if (!project) return false

    const normalizedUrl = normalizeDocUrl(nextUrlInput)
    if (!normalizedUrl) {
      setDocError('请输入有效的 http/https URL')
      return false
    }

    const duplicate = docLinks.some(
      (link) => link.id !== linkId && link.url.toLowerCase() === normalizedUrl.toLowerCase()
    )
    if (duplicate) {
      setDocError('该文档链接已存在')
      return false
    }

    let title = nextTitleInput.trim()
    if (!title) {
      try {
        title = new URL(normalizedUrl).hostname
      } catch {
        title = 'Documentation'
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
        setDocError(error instanceof Error ? error.message : '保存密码失败')
        return false
      }
    } else if (clearSecret) {
      try {
        await window.electronAPI.deleteDocLinkSecret(project.id, linkId)
        hasSecret = false
      } catch (error) {
        setDocError(error instanceof Error ? error.message : '清除密码失败')
        return false
      }
    }

    const nextLinks = docLinks.map((link) => (
      link.id === linkId
        ? {
          ...link,
          title,
          url: normalizedUrl,
          ...(note ? { note } : { note: undefined }),
          ...(account ? { account } : { account: undefined }),
          ...(hasSecret ? { hasSecret: true } : { hasSecret: undefined }),
        }
        : link
    ))

    await setProjectDocLinks(project.id, nextLinks)
    setDocError(null)
    return true
  }, [docLinks, project, setProjectDocLinks])

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
    linkSettingsOpen,
    setLinkSettingsOpen,
    docTitleInput,
    setDocTitleInput,
    docUrlInput,
    setDocUrlInput,
    docNoteInput,
    setDocNoteInput,
    docAccountInput,
    setDocAccountInput,
    docSecretInput,
    setDocSecretInput,
    docError,
    handleAddDocLink,
    handleUpdateDocLink,
    handleSetDefaultDocLink,
    handleReorderDocLinks,
    handleRemoveDocLink,
    handleCopyDocLinkAccount,
    handleCopyDocLinkSecret,
    handleGetDocLinkSecret,
  }
}
