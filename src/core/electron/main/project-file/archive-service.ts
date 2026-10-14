import { createWriteStream, promises as fs } from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { app } from 'electron'
import { ZipArchive } from 'archiver'
import type { ProjectFileZipResult } from '../../../shared/types'
import { ensureWithinRoot, normalizeRelativeInput, ProjectFileServiceError, resolveRoot, toPosixRelativePath, validateRelativePathLooksSafe } from './shared'

/** Windows 文件名非法字符与保留名检查，zip 文件名强制为单段安全文件名。 */
function sanitizeZipFileName(input: string): string {
  const trimmed = input.trim()
  if (!trimmed) {
    throw new ProjectFileServiceError('Zip file name is required.')
  }
  if (/[\\/]/.test(trimmed)) {
    throw new ProjectFileServiceError('Zip file name must be a single file name.')
  }
  if (trimmed === '.' || trimmed === '..') {
    throw new ProjectFileServiceError('Zip file name is not allowed.')
  }
  if (/^[A-Za-z]:/.test(trimmed)) {
    throw new ProjectFileServiceError('Drive letters are not allowed in zip file name.')
  }
  if (/[<>:"|?*]/.test(trimmed) || /[\u0000-\u001f]/.test(trimmed)) {
    throw new ProjectFileServiceError('Zip file name contains invalid characters.')
  }
  const baseName = trimmed.replace(/\.zip$/i, '')
  if (!baseName || baseName === '.' || baseName === '..') {
    throw new ProjectFileServiceError('Zip file name is not allowed.')
  }
  return `${baseName}.zip`
}

/** 流式打包目录内容为 zip（不含顶层目录本身），失败时清理半成品文件（best-effort）。 */
async function packFolderToZip(folderRealPath: string, zipTargetPath: string): Promise<void> {
  const output = createWriteStream(zipTargetPath)
  // archiver v8 为 ESM 类导出：ZipArchive 即 zip 格式工厂，等价于 v7 的 archiver('zip', options)。
  const archive = new ZipArchive({ zlib: { level: 9 } })
  try {
    archive.pipe(output)
    archive.directory(folderRealPath, false)
    await archive.finalize()
    await new Promise<void>((resolve, reject) => {
      output.once('close', () => resolve())
      output.once('error', reject)
      archive.once('error', reject)
    })
  } catch (error) {
    await fs.unlink(zipTargetPath).catch(() => undefined)
    throw error
  }
}

/** 复用项目文件防护链解析目标文件夹真实路径（resolveRoot → normalize → validate → realpath → ensureWithinRoot）。 */
async function resolveFolderRealPath(projectPath: string, folderRelativePath: string): Promise<string> {
  const rootRealPath = await resolveRoot(projectPath)
  const normalizedFolder = normalizeRelativeInput(folderRelativePath)
  validateRelativePathLooksSafe(normalizedFolder)
  const folderCandidatePath = path.resolve(rootRealPath, normalizedFolder)
  const folderRealPath = await fs.realpath(folderCandidatePath)
  ensureWithinRoot(rootRealPath, folderRealPath)
  const folderStat = await fs.stat(folderRealPath)
  if (!folderStat.isDirectory()) {
    throw new ProjectFileServiceError('Selected path is not a directory.')
  }
  return folderRealPath
}

/**
 * 把项目内指定文件夹打包为 zip，产物落在该文件夹的同级目录。
 * 防护链与 read-write-service 同款：resolveRoot → normalizeRelativeInput → validateRelativePathLooksSafe → ensureWithinRoot。
 */
export async function createProjectFolderZip(projectPath: string, folderRelativePath: string, zipName: string): Promise<ProjectFileZipResult> {
  const rootRealPath = await resolveRoot(projectPath)
  const folderRealPath = await resolveFolderRealPath(projectPath, folderRelativePath)

  const finalZipName = sanitizeZipFileName(zipName)
  const baseName = finalZipName.slice(0, -'.zip'.length)

  // 输出落点：文件夹同级目录。产物在目标文件夹之外，天然不会被递归打包进自身。
  const outputDirRealPath = path.dirname(folderRealPath)
  ensureWithinRoot(rootRealPath, outputDirRealPath)

  // 同名追加序号：name.zip → name(1).zip → name(2).zip …
  let zipTargetPath = ''
  let zipFileName = ''
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    const candidateName = attempt === 0 ? `${baseName}.zip` : `${baseName}(${attempt}).zip`
    const candidatePath = path.join(outputDirRealPath, candidateName)
    try {
      await fs.access(candidatePath)
    } catch {
      zipTargetPath = candidatePath
      zipFileName = candidateName
      break
    }
  }
  if (!zipTargetPath || !zipFileName) {
    throw new ProjectFileServiceError('Unable to find an available zip file name.')
  }
  ensureWithinRoot(rootRealPath, zipTargetPath)

  await packFolderToZip(folderRealPath, zipTargetPath)

  const zipStat = await fs.stat(zipTargetPath)
  return {
    relativePath: toPosixRelativePath(path.relative(rootRealPath, zipTargetPath)),
    size: zipStat.size,
    mtimeMs: zipStat.mtimeMs,
  }
}

/** 剪贴板 zip 的临时目录名（固定子目录，每次复制前清空旧产物）。 */
const ZIP_CLIPBOARD_TEMP_DIRNAME = 'yyc-workbench-zip-clipboard'

/** 用 PowerShell .NET Clipboard 以 CF_HDROP（文件）格式写入剪贴板。-EncodedCommand 规避路径空格/中文的引号问题。 */
function runClipboardFileDropScript(filePath: string): Promise<void> {
  const script = [
    'Add-Type -AssemblyName System.Windows.Forms',
    '$list = New-Object System.Collections.Specialized.StringCollection',
    `[void]$list.Add('${filePath.replace(/'/g, "''")}')`,
    '$data = New-Object System.Windows.Forms.DataObject',
    '$data.SetFileDropList($list)',
    '[System.Windows.Forms.Clipboard]::SetDataObject($data, $true)',
  ].join('\n')
  const encoded = Buffer.from(script, 'utf-16le').toString('base64')

  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-EncodedCommand', encoded], {
      windowsHide: true,
      stdio: 'ignore',
    })
    let settled = false
    const fail = (error: Error) => {
      if (settled) return
      settled = true
      reject(error)
    }
    child.once('error', fail)
    child.once('exit', (code) => {
      if (settled) return
      settled = true
      if (code === 0) resolve()
      else reject(new ProjectFileServiceError('Failed to copy zip to clipboard.'))
    })
  })
}

/**
 * 「复制 zip 到剪贴板」：项目内不落任何文件，zip 打包到系统临时目录后
 * 以 Windows 标准文件格式（CF_HDROP）写入剪贴板——粘贴到资源管理器 / 聊天窗口
 * 得到的就是该 zip 文件本身。仅支持 Windows 宿主（WSL 项目同为主进程打包，不受影响）。
 */
export async function copyProjectFolderZipToClipboard(projectPath: string, folderRelativePath: string, zipName: string): Promise<{ name: string; size: number }> {
  if (process.platform !== 'win32') {
    throw new ProjectFileServiceError('Copy zip to clipboard is only supported on Windows.')
  }

  const folderRealPath = await resolveFolderRealPath(projectPath, folderRelativePath)
  const finalZipName = sanitizeZipFileName(zipName)

  const tempDirPath = path.join(app.getPath('temp'), ZIP_CLIPBOARD_TEMP_DIRNAME)
  await fs.mkdir(tempDirPath, { recursive: true })
  // 清理本目录旧产物：剪贴板始终只引用最新一份 zip。
  const staleEntries = await fs.readdir(tempDirPath).catch(() => [] as string[])
  for (const entry of staleEntries) {
    await fs.unlink(path.join(tempDirPath, entry)).catch(() => undefined)
  }

  const zipTargetPath = path.join(tempDirPath, finalZipName)
  await packFolderToZip(folderRealPath, zipTargetPath)

  try {
    await runClipboardFileDropScript(zipTargetPath)
  } catch (error) {
    await fs.unlink(zipTargetPath).catch(() => undefined)
    throw error
  }

  const zipStat = await fs.stat(zipTargetPath)
  return { name: finalZipName, size: zipStat.size }
}

/**
 * 「复制文件到剪贴板」：以 Windows 标准文件格式（CF_HDROP）把项目内文件写入剪贴板——
 * 粘贴到资源管理器 / 聊天窗口得到的是文件本身，而非文本内容。
 * 仅支持 Windows 宿主（WSL 项目同为主进程直接读取文件，不受影响）。
 */
export async function copyProjectFileToClipboard(projectPath: string, fileRelativePath: string): Promise<{ name: string; size: number }> {
  if (process.platform !== 'win32') {
    throw new ProjectFileServiceError('Copy file to clipboard is only supported on Windows.')
  }

  const rootRealPath = await resolveRoot(projectPath)
  const normalizedFile = normalizeRelativeInput(fileRelativePath)
  validateRelativePathLooksSafe(normalizedFile)
  const fileCandidatePath = path.resolve(rootRealPath, normalizedFile)
  const fileRealPath = await fs.realpath(fileCandidatePath)
  ensureWithinRoot(rootRealPath, fileRealPath)
  const fileStat = await fs.stat(fileRealPath)
  if (!fileStat.isFile()) {
    throw new ProjectFileServiceError('Selected path is not a file.')
  }

  await runClipboardFileDropScript(fileRealPath)
  return { name: path.basename(fileRealPath), size: fileStat.size }
}
