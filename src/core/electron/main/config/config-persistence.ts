import { existsSync, renameSync, unlinkSync, writeFileSync } from 'fs'
import { copyFile, mkdir, readdir, rename, unlink, writeFile } from 'fs/promises'
import { basename, dirname, join } from 'path'

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

/** 每日快照保留份数（含当天）；配合单代 .bak 提供跨天恢复点，避免一次坏写入污染唯一备份 */
const DAILY_SNAPSHOT_KEEP = 7

export function dailySnapshotPath(filePath: string, date = new Date()): string {
  const stamp = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`
  return `${filePath}.daily-${stamp}`
}

/** 只保留最近 keep 份每日快照，删除更旧的；尽力而为，失败不影响主写入流程 */
export async function pruneDailySnapshots(filePath: string, keep: number = DAILY_SNAPSHOT_KEEP): Promise<void> {
  try {
    const dir = dirname(filePath)
    const prefix = `${basename(filePath)}.daily-`
    const entries = await readdir(dir)
    const stamps = entries
      .filter((name) => name.startsWith(prefix))
      .map((name) => name.slice(prefix.length))
      .filter((stamp) => /^\d{8}$/.test(stamp))
      .sort()
    for (const stamp of stamps.slice(0, Math.max(0, stamps.length - keep))) {
      await unlink(join(dir, `${prefix}${stamp}`)).catch(() => undefined)
    }
  } catch {
    // 快照清理失败静默跳过
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
      // 每天首次写入时固化当前磁盘状态为当日快照（写入前的好内容），快照不受后续坏写入影响
      const snapshotPath = dailySnapshotPath(filePath)
      if (!existsSync(snapshotPath)) {
        await copyFile(filePath, snapshotPath).catch(() => undefined)
        await pruneDailySnapshots(filePath)
      }
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
