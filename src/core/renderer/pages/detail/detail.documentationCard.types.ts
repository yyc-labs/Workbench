import type { Dispatch, SetStateAction } from 'react'
import type { ProjectDocLink, ProjectDocLinkTag, ProjectDocTagOption } from '../../../shared/types'

export type DetailDocumentationCardProps = {
  docLinks: ProjectDocLink[]
  docTitleInput: string
  setDocTitleInput: Dispatch<SetStateAction<string>>
  docUrlInput: string
  setDocUrlInput: Dispatch<SetStateAction<string>>
  docTagInput: ProjectDocLinkTag
  setDocTagInput: Dispatch<SetStateAction<ProjectDocLinkTag>>
  docTagOptions: ReadonlyArray<ProjectDocTagOption>
  docNoteInput: string
  setDocNoteInput: Dispatch<SetStateAction<string>>
  docAccountInput: string
  setDocAccountInput: Dispatch<SetStateAction<string>>
  docSecretInput: string
  setDocSecretInput: Dispatch<SetStateAction<string>>
  docError: string | null
  setDocError: Dispatch<SetStateAction<string | null>>
  onAddDocLink: () => Promise<void>
  onAddDocTag: (label: string) => Promise<{ ok: boolean; message?: string }>
  onRenameDocTag: (value: string, label: string) => Promise<{ ok: boolean; message?: string }>
  onRemoveDocTag: (value: string) => Promise<{ ok: boolean; message?: string }>
  onUpdateDocLink: (
    linkId: string,
    title: string,
    url: string,
    tag: ProjectDocLinkTag,
    note: string,
    account: string,
    secret: string,
    clearSecret: boolean
  ) => Promise<boolean>
  onSetDefaultDocLink: (linkId: string) => Promise<void>
  onReorderDocLinks: (activeLinkId: string, overLinkId: string) => Promise<void>
  onRemoveDocLink: (linkId: string) => Promise<void>
  onCopyDocLinkAccount: (linkId: string) => Promise<boolean>
  onCopyDocLinkSecret: (linkId: string) => Promise<boolean>
  onGetDocLinkSecret: (linkId: string) => Promise<string | null>
  settingsOpen?: boolean
  setSettingsOpen?: Dispatch<SetStateAction<boolean>>
  hideCard?: boolean
}

export type DetailDocumentationTagFilter = ProjectDocLinkTag | 'all'

export type DetailDocumentationEditState = {
  linkId: string | null
  title: string
  setTitle: Dispatch<SetStateAction<string>>
  url: string
  setUrl: Dispatch<SetStateAction<string>>
  tag: ProjectDocLinkTag
  setTag: Dispatch<SetStateAction<ProjectDocLinkTag>>
  note: string
  setNote: Dispatch<SetStateAction<string>>
  account: string
  setAccount: Dispatch<SetStateAction<string>>
  secret: string
  setSecret: Dispatch<SetStateAction<string>>
  secretLoading: boolean
  clearSecret: boolean
  setClearSecret: Dispatch<SetStateAction<boolean>>
  start: (link: ProjectDocLink) => Promise<void>
  cancel: () => void
  save: () => Promise<void>
}
