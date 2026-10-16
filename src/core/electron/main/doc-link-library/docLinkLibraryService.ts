import { randomUUID } from 'node:crypto'
import type { DocLinkLibraryFile, SharedDocLink, SharedDocLinkGroup, UpsertSharedDocLinkInput } from '../../../shared/types'
import type { DocLinkLibraryRepository } from './docLinkLibraryRepository'
import type { DocLinkLibrarySecretStore } from './docLinkLibrarySecretStore'

/** 共享链接库 domain：组/链接 CRUD + 秘密 set/get/delete（含 hasSecret 同步与级联清理）+ 写串行化。 */
export class DocLinkLibraryService {
  private writeQueue: Promise<void> = Promise.resolve()

  constructor(
    private readonly repository: DocLinkLibraryRepository,
    private readonly secretStore: DocLinkLibrarySecretStore,
  ) {}

  async list(): Promise<DocLinkLibraryFile> {
    return this.repository.read()
  }

  async createGroup(name: string): Promise<DocLinkLibraryFile> {
    const trimmed = name.trim()
    if (!trimmed) throw new Error('Group name is required.')
    return this.enqueue(async () => {
      const file = await this.repository.read()
      const group: SharedDocLinkGroup = {
        id: randomUUID(),
        name: trimmed,
        sortOrder: file.groups.reduce((max, item) => Math.max(max, item.sortOrder), 0) + 1,
      }
      return this.repository.write({ ...file, groups: [...file.groups, group] })
    })
  }

  async renameGroup(groupId: string, name: string): Promise<DocLinkLibraryFile> {
    const trimmed = name.trim()
    if (!trimmed) throw new Error('Group name is required.')
    return this.enqueue(async () => {
      const file = await this.repository.read()
      if (!file.groups.some((group) => group.id === groupId)) throw new Error('Group not found.')
      return this.repository.write({
        ...file,
        groups: file.groups.map((group) => (group.id === groupId ? { ...group, name: trimmed } : group)),
      })
    })
  }

  async removeGroup(groupId: string): Promise<DocLinkLibraryFile> {
    return this.enqueue(async () => {
      const file = await this.repository.read()
      // 级联删除组内 links 及其秘密；不触碰任何项目的 sharedDocLinkGroupIds（悬空订阅由合并纯函数静默忽略）。
      const removedLinkIds = file.links.filter((link) => link.groupId === groupId).map((link) => link.id)
      for (const linkId of removedLinkIds) {
        this.secretStore.delete(linkId)
      }
      return this.repository.write({
        ...file,
        groups: file.groups.filter((group) => group.id !== groupId),
        links: file.links.filter((link) => link.groupId !== groupId),
      })
    })
  }

  async upsertLink(input: UpsertSharedDocLinkInput): Promise<DocLinkLibraryFile> {
    const title = input.title?.trim()
    if (!title) throw new Error('Link title is required.')
    if ((input.kind ?? 'url') === 'ssh' && !input.sshHost?.trim()) throw new Error('SSH host is required.')
    if ((input.kind ?? 'url') === 'url' && !input.url?.trim()) throw new Error('Link URL is required.')
    return this.enqueue(async () => {
      const file = await this.repository.read()
      if (!file.groups.some((group) => group.id === input.groupId)) throw new Error('Group not found.')
      if (input.id) {
        const existing = file.links.find((link) => link.id === input.id)
        if (!existing) throw new Error('Link not found.')
        const nextLink: SharedDocLink = {
          ...existing,
          ...input,
          id: input.id,
          title,
          createdAt: existing.createdAt,
        }
        return this.repository.write({
          ...file,
          links: file.links.map((link) => (link.id === input.id ? nextLink : link)),
        })
      }
      const nextLink: SharedDocLink = {
        ...input,
        id: randomUUID(),
        title,
        createdAt: Date.now(),
      }
      return this.repository.write({ ...file, links: [...file.links, nextLink] })
    })
  }

  async removeLink(linkId: string): Promise<DocLinkLibraryFile> {
    return this.enqueue(async () => {
      this.secretStore.delete(linkId)
      const file = await this.repository.read()
      return this.repository.write({
        ...file,
        links: file.links.filter((link) => link.id !== linkId),
      })
    })
  }

  async reorderLinks(groupId: string, orderedLinkIds: string[]): Promise<DocLinkLibraryFile> {
    return this.enqueue(async () => {
      const file = await this.repository.read()
      const inGroup = file.links.filter((link) => link.groupId === groupId)
      const ordered = orderedLinkIds.map((id) => inGroup.find((link) => link.id === id)).filter((link): link is SharedDocLink => Boolean(link))
      const orderedIds = new Set(ordered.map((link) => link.id))
      const remaining = inGroup.filter((link) => !orderedIds.has(link.id))
      const nextInGroup = [...ordered, ...remaining]
      const nextInGroupIds = new Set(nextInGroup.map((link) => link.id))
      const links: SharedDocLink[] = []
      let cursor = 0
      for (const link of file.links) {
        if (link.groupId === groupId && nextInGroupIds.has(link.id)) {
          links.push(nextInGroup[cursor])
          cursor += 1
        } else {
          links.push(link)
        }
      }
      return this.repository.write({ ...file, links })
    })
  }

  /** 保存共享链接密码；内部同步该链接的 hasSecret 标记（renderer 无需二次 upsert）。 */
  async setLinkSecret(linkId: string, secret: string): Promise<void> {
    const trimmedId = linkId.trim()
    if (!trimmedId) throw new Error('Link id is required.')
    this.secretStore.set(trimmedId, secret)
    await this.enqueue(async () => {
      const file = await this.repository.read()
      if (!file.links.some((link) => link.id === trimmedId)) return file
      return this.repository.write({ ...file, links: file.links.map((link) => (link.id === trimmedId ? { ...link, hasSecret: true } : link)) })
    })
  }

  async getLinkSecret(linkId: string): Promise<string | null> {
    return this.secretStore.get(linkId.trim())
  }

  /** 清除共享链接密码；内部同步 hasSecret 标记。 */
  async deleteLinkSecret(linkId: string): Promise<void> {
    const trimmedId = linkId.trim()
    this.secretStore.delete(trimmedId)
    await this.enqueue(async () => {
      const file = await this.repository.read()
      if (!file.links.some((link) => link.id === trimmedId)) return file
      return this.repository.write({ ...file, links: file.links.map((link) => (link.id === trimmedId ? { ...link, hasSecret: false } : link)) })
    })
  }

  /** 写操作串行化：单文件单进程，防多窗口并发写坏（read-modify-write 整体入队）。 */
  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.writeQueue.then(() => operation())
    this.writeQueue = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }
}
