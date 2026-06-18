import type { Dispatch, SetStateAction } from 'react'
import type {
  ProjectDocLink,
  ProjectDocLinkKind,
  ProjectDocLinkSshRoute,
  ProjectDocLinkTag,
  ProjectDocTagOption,
} from '../../../shared/types'

export type DetailDocumentationCardProps = {
  docLinks: ProjectDocLink[]
  docKindInput: ProjectDocLinkKind
  setDocKindInput: Dispatch<SetStateAction<ProjectDocLinkKind>>
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
  docSshHostInput: string
  setDocSshHostInput: Dispatch<SetStateAction<string>>
  docSshPortInput: string
  setDocSshPortInput: Dispatch<SetStateAction<string>>
  docSshUsernameInput: string
  setDocSshUsernameInput: Dispatch<SetStateAction<string>>
  docSshShortcutInput: string
  setDocSshShortcutInput: Dispatch<SetStateAction<string>>
  docSshRouteInput: ProjectDocLinkSshRoute
  setDocSshRouteInput: Dispatch<SetStateAction<ProjectDocLinkSshRoute>>
  docError: string | null
  setDocError: Dispatch<SetStateAction<string | null>>
  onAddDocLink: () => Promise<boolean>
  onAddDocTag: (label: string) => Promise<{ ok: boolean; message?: string }>
  onRenameDocTag: (value: string, label: string) => Promise<{ ok: boolean; message?: string }>
  onRemoveDocTag: (value: string) => Promise<{ ok: boolean; message?: string }>
  onUpdateDocLink: (
    linkId: string,
    kind: ProjectDocLinkKind,
    title: string,
    url: string,
    tag: ProjectDocLinkTag,
    note: string,
    account: string,
    sshHost: string,
    sshPort: string,
    sshUsername: string,
    sshRoute: ProjectDocLinkSshRoute,
    secret: string,
    clearSecret: boolean
  ) => Promise<boolean>
  onSetDefaultDocLink: (linkId: string) => Promise<void>
  onReorderDocLinks: (activeLinkId: string, overLinkId: string) => Promise<void>
  onRemoveDocLink: (linkId: string) => Promise<void>
  onCopyDocLinkAccount: (linkId: string) => Promise<boolean>
  onCopyDocLinkSecret: (linkId: string) => Promise<boolean>
  onGetDocLinkSecret: (linkId: string) => Promise<string | null>
  onOpenDocLink: (link: ProjectDocLink) => Promise<void>
  settingsOpen?: boolean
  setSettingsOpen?: Dispatch<SetStateAction<boolean>>
  hideCard?: boolean
}

export type DetailDocumentationTagFilter = ProjectDocLinkTag | 'all'

export type DetailDocumentationEditState = {
  linkId: string | null
  kind: ProjectDocLinkKind
  setKind: Dispatch<SetStateAction<ProjectDocLinkKind>>
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
  sshHost: string
  setSshHost: Dispatch<SetStateAction<string>>
  sshPort: string
  setSshPort: Dispatch<SetStateAction<string>>
  sshUsername: string
  setSshUsername: Dispatch<SetStateAction<string>>
  sshShortcut: string
  setSshShortcut: Dispatch<SetStateAction<string>>
  sshRoute: ProjectDocLinkSshRoute
  setSshRoute: Dispatch<SetStateAction<ProjectDocLinkSshRoute>>
  secret: string
  setSecret: Dispatch<SetStateAction<string>>
  secretLoading: boolean
  clearSecret: boolean
  setClearSecret: Dispatch<SetStateAction<boolean>>
  start: (link: ProjectDocLink) => Promise<void>
  cancel: () => void
  save: () => Promise<void>
}
