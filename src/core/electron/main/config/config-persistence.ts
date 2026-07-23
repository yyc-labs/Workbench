import { existsSync, renameSync, unlinkSync, writeFileSync } from 'fs'
import { copyFile, mkdir, rename, unlink, writeFile } from 'fs/promises'
import { dirname, join } from 'path'

export function corruptConfigBackupPath(filePath: string, timestamp = Date.now()): string {
  return `${filePath}.corrupt-${timestamp}.json`
}

export function backupCorruptConfigSync(filePath: string, rawContent: string, timestamp = Date.now()): string | undefined {
  const backupPath = corruptConfigBackupPath(filePath, timestamp)
  try {
    writeFileSync(backupPath, rawContent, 'utf8')
    return backupPath
  } catch {
    return undefined
  }
}

export async function atomicWriteJson(filePath: string, serialized: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true })
  const tempPath = join(dirname(filePath), `.${filePath.split(/[\\/]/).pop() || 'config'}.${process.pid}.${Date.now()}.tmp`)

  await writeFile(tempPath, serialized, 'utf8')
  const backupPath = `${filePath}.bak`
  try {
    if (existsSync(filePath)) {
      await copyFile(filePath, backupPath)
    }
    await rename(tempPath, filePath)
    return
  } catch (error) {
    // Windows does not always replace an existing file with rename(). Move the
    // old file aside first, then restore it if the replacement also fails.
    if (process.platform !== 'win32' || !existsSync(filePath)) {
      await unlink(tempPath).catch(() => undefined)
      throw error
    }
  }

  let movedExisting = false
  try {
    await unlink(backupPath).catch(() => undefined)
    await rename(filePath, backupPath)
    movedExisting = true
    await rename(tempPath, filePath)
  } catch (error) {
    if (movedExisting && !existsSync(filePath)) {
      await rename(backupPath, filePath).catch(() => undefined)
    }
    await unlink(tempPath).catch(() => undefined)
    throw error
  }
}

export function restoreConfigBackupSync(filePath: string): boolean {
  const backupPath = `${filePath}.bak`
  if (!existsSync(backupPath)) return false
  try {
    if (existsSync(filePath)) unlinkSync(filePath)
    renameSync(backupPath, filePath)
    return true
  } catch {
    return false
  }
}
