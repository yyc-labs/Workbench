import { app, safeStorage } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'

type DocLinkLibrarySecretRecord = {
  ciphertext: string
  updatedAt: number
}

type DocLinkLibrarySecretMap = Record<string, DocLinkLibrarySecretRecord>

const SECRET_FILE_NAME = 'secrets.v1.json'

function secretFilePath(): string {
  return join(app.getPath('userData'), 'doc-link-library', SECRET_FILE_NAME)
}

function readStore(): DocLinkLibrarySecretMap {
  const filePath = secretFilePath()
  if (!existsSync(filePath)) return {}
  try {
    const raw = readFileSync(filePath, 'utf-8')
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return {}
    const result: DocLinkLibrarySecretMap = {}
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!value || typeof value !== 'object') continue
      const record = value as Partial<DocLinkLibrarySecretRecord>
      if (typeof record.ciphertext !== 'string' || !record.ciphertext) continue
      result[key] = {
        ciphertext: record.ciphertext,
        updatedAt: typeof record.updatedAt === 'number' ? record.updatedAt : Date.now(),
      }
    }
    return result
  } catch {
    return {}
  }
}

function writeStore(map: DocLinkLibrarySecretMap): void {
  const filePath = secretFilePath()
  const dir = dirname(filePath)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  writeFileSync(filePath, JSON.stringify(map, null, 2), 'utf-8')
}

function encryptSecret(value: string): string {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('System secure storage is unavailable.')
  }
  const encrypted = safeStorage.encryptString(value)
  return encrypted.toString('base64')
}

function decryptSecret(ciphertextBase64: string): string {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('System secure storage is unavailable.')
  }
  const encryptedBuffer = Buffer.from(ciphertextBase64, 'base64')
  return safeStorage.decryptString(encryptedBuffer)
}

/**
 * 共享链接密码存储（D5）：与私有 doc-link-secret-store 同款 safeStorage 加密，
 * 但键只用一个全局 linkId（不掺 projectId——共享秘密必须跨项目可取），
 * 文件为 <userData>/doc-link-library/secrets.v1.json（与 library.json 同目录、独立文件）。
 */
export class DocLinkLibrarySecretStore {
  set(linkId: string, secret: string): void {
    const normalizedId = linkId.trim()
    const normalizedSecret = secret.trim()
    if (!normalizedId) throw new Error('Link id is required.')
    if (!normalizedSecret) throw new Error('Secret cannot be empty.')
    const map = readStore()
    map[normalizedId] = {
      ciphertext: encryptSecret(normalizedSecret),
      updatedAt: Date.now(),
    }
    writeStore(map)
  }

  get(linkId: string): string | null {
    const normalizedId = linkId.trim()
    if (!normalizedId) return null
    const map = readStore()
    const record = map[normalizedId]
    if (!record) return null
    try {
      return decryptSecret(record.ciphertext)
    } catch (error) {
      console.warn('[doc-link-library] failed to decrypt shared link secret:', error)
      return null
    }
  }

  delete(linkId: string): void {
    const normalizedId = linkId.trim()
    if (!normalizedId) return
    const map = readStore()
    if (!Object.prototype.hasOwnProperty.call(map, normalizedId)) return
    delete map[normalizedId]
    writeStore(map)
  }
}
