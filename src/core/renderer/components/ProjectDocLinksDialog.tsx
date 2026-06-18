import { useEffect } from 'react'
import type { ProjectInfo } from '../../shared/types'
import { DetailDocumentationCard } from '../pages/detail/DetailDocumentationCard'
import { useProjectDocLinks } from '../pages/detail/useProjectDocLinks'

type ProjectDocLinksDialogProps = {
  open: boolean
  project: ProjectInfo
  onClose: () => void
}

export function ProjectDocLinksDialog({
  open,
  project,
  onClose,
}: ProjectDocLinksDialogProps) {
  const {
    docLinks,
    docKindInput,
    setDocKindInput,
    docTitleInput,
    setDocTitleInput,
    docUrlInput,
    setDocUrlInput,
    docTagInput,
    setDocTagInput,
    docLinkTagOptions,
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
    setDocSshShortcutInput,
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
    linkSettingsOpen,
    setLinkSettingsOpen,
  } = useProjectDocLinks({ project, initialSettingsOpen: open })

  useEffect(() => {
    if (!open && !linkSettingsOpen) return
    if (linkSettingsOpen) return
    onClose()
  }, [linkSettingsOpen, onClose, open])

  if (!open && !linkSettingsOpen) return null

  return (
    <DetailDocumentationCard
      docLinks={docLinks}
      docKindInput={docKindInput}
      setDocKindInput={setDocKindInput}
      docTitleInput={docTitleInput}
      setDocTitleInput={setDocTitleInput}
      docUrlInput={docUrlInput}
      setDocUrlInput={setDocUrlInput}
      docTagInput={docTagInput}
      setDocTagInput={setDocTagInput}
      docTagOptions={docLinkTagOptions}
      docNoteInput={docNoteInput}
      setDocNoteInput={setDocNoteInput}
      docAccountInput={docAccountInput}
      setDocAccountInput={setDocAccountInput}
      docSecretInput={docSecretInput}
      setDocSecretInput={setDocSecretInput}
      docSshHostInput={docSshHostInput}
      setDocSshHostInput={setDocSshHostInput}
      docSshPortInput={docSshPortInput}
      setDocSshPortInput={setDocSshPortInput}
      docSshUsernameInput={docSshUsernameInput}
      setDocSshUsernameInput={setDocSshUsernameInput}
      docSshShortcutInput={docSshShortcutInput}
      setDocSshShortcutInput={setDocSshShortcutInput}
      docSshRouteInput={docSshRouteInput}
      setDocSshRouteInput={setDocSshRouteInput}
      docError={docError}
      setDocError={setDocError}
      onAddDocLink={handleAddDocLink}
      onAddDocTag={handleAddDocTag}
      onRenameDocTag={handleRenameDocTag}
      onRemoveDocTag={handleRemoveDocTag}
      onUpdateDocLink={handleUpdateDocLink}
      onSetDefaultDocLink={handleSetDefaultDocLink}
      onReorderDocLinks={handleReorderDocLinks}
      onRemoveDocLink={handleRemoveDocLink}
      onCopyDocLinkAccount={handleCopyDocLinkAccount}
      onCopyDocLinkSecret={handleCopyDocLinkSecret}
      onGetDocLinkSecret={handleGetDocLinkSecret}
      onOpenDocLink={handleOpenDocLink}
      settingsOpen={linkSettingsOpen}
      setSettingsOpen={setLinkSettingsOpen}
      hideCard
    />
  )
}
