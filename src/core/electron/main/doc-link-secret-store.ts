import { app, safeStorage } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'

type DocLinkSecretRecord = {
  ciphertext: string
  updatedAt: number
}

type DocLinkSecretMap = Record<string, DocLinkSecretRecord>

const DOC_LINK_SECRET_FILE = 'doc-link-secrets.v1.json'

function secretFilePath(): string {
  return join(app.getPath('userData'), DOC_LINK_SECRET_FILE)
}

function normalizeKey(projectId: string, linkId: string): string {
  return `${projectId.trim()}::${linkId.trim()}`
}

function readStore(): DocLinkSecretMap {
  const filePath = secretFilePath()
  if (!existsSync(filePath)) return {}
  try {
    const raw = readFileSync(filePath, 'utf-8')
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return {}
    const result: DocLinkSecretMap = {}
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!value || typeof value !== 'object') continue
      const record = value as Partial<DocLinkSecretRecord>
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

function writeStore(map: DocLinkSecretMap): void {
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

export function setDocLinkSecret(projectId: string, linkId: string, secret: string): void {
  const normalizedSecret = secret.trim()
  if (!normalizedSecret) {
    throw new Error('Secret cannot be empty.')
  }
  const key = normalizeKey(projectId, linkId)
  const map = readStore()
  map[key] = {
    ciphertext: encryptSecret(normalizedSecret),
    updatedAt: Date.now(),
  }
  writeStore(map)
}

export function getDocLinkSecret(projectId: string, linkId: string): string | null {
  const key = normalizeKey(projectId, linkId)
  const map = readStore()
  const record = map[key]
  if (!record) return null
  return decryptSecret(record.ciphertext)
}

export function deleteDocLinkSecret(projectId: string, linkId: string): void {
  const key = normalizeKey(projectId, linkId)
  const map = readStore()
  if (!Object.prototype.hasOwnProperty.call(map, key)) return
  delete map[key]
  writeStore(map)
}

