import { spawn } from 'node:child_process'
import { createWriteStream, existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import { ZipArchive } from 'archiver'
import { app } from 'electron'
import type { ProjectFileArchiveEntry, ProjectFileZipResult } from '../../../shared/types'
import { resolveAppResourcePath } from '../app-resource-path'
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

/** 剪贴板 worker 协议哨兵：就绪 / 单条命令成功 / 失败前缀 / 退出指令。 */
const CLIPBOARD_WORKER_READY_LINE = '__READY__'
const CLIPBOARD_WORKER_OK_LINE = '__OK__'
const CLIPBOARD_WORKER_ERROR_PREFIX = '__ERR__'
const CLIPBOARD_WORKER_EXIT_LINE = '__EXIT__'

/** READY worker 池目标容量：分配即补位，吸收连续快速复制。 */
const CLIPBOARD_READY_POOL_SIZE = 2

/**
 * PowerShell 回退 worker 脚本（编译版 ClipboardWorker.exe 缺失/启动失败时使用）：
 * STA 线程保证 Clipboard API 可用；stdin 每行一个 base64(UTF-8) 的 '\n' 分隔多文件路径。
 * SetDataObject($true) 内部已执行 flush（实验证实），显式 flush 仅作 best-effort 双保险。
 */
const CLIPBOARD_WORKER_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
  'Add-Type -AssemblyName System.Windows.Forms',
  'Add-Type -Namespace Native -Name Ole32 -MemberDefinition \'[DllImport("ole32.dll")] public static extern int OleFlushClipboard();\'',
  // 只读不写，预热 .NET 剪贴板内部懒加载。
  'try { [void][System.Windows.Forms.Clipboard]::GetDataObject() } catch {}',
  `[Console]::Out.WriteLine('${CLIPBOARD_WORKER_READY_LINE}')`,
  'while ($true) {',
  '  $line = [Console]::In.ReadLine()',
  `  if ($null -eq $line -or $line -eq '${CLIPBOARD_WORKER_EXIT_LINE}') { break }`,
  '  try {',
  '    $p = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($line))',
  '    $list = New-Object System.Collections.Specialized.StringCollection',
  '    foreach ($item in ($p -split "\n")) { if ($item) { [void]$list.Add($item) } }',
  '    $data = New-Object System.Windows.Forms.DataObject',
  '    $data.SetFileDropList($list)',
  // 写入后回读验证：剪贴板监听类程序可能在毫秒级窗口内覆盖写入，失败时重试。
  '    $verifyError = $null',
  '    for ($i = 0; $i -lt 3; $i++) {',
  '      try {',
  '        [System.Windows.Forms.Clipboard]::SetDataObject($data, $true)',
  '        if ([System.Windows.Forms.Clipboard]::ContainsFileDropList()) { $verifyError = $null; break }',
  '        $verifyError = "clipboard verify failed: FileDrop missing after write"',
  '      } catch {',
  '        $verifyError = $_.Exception.Message',
  '      }',
  '      Start-Sleep -Milliseconds 200',
  '    }',
  '    if ($verifyError) { throw $verifyError }',
  '    try { [void][Native.Ole32]::OleFlushClipboard() } catch {}',
  `    [Console]::Out.WriteLine('${CLIPBOARD_WORKER_OK_LINE}')`,
  '  } catch {',
  `    [Console]::Out.WriteLine('${CLIPBOARD_WORKER_ERROR_PREFIX}' + ($_.Exception.Message -replace '\\r|\\n', ' '))`,
  '  }',
  '}',
].join('\n')

/** worker 宿主：编译版 C# EXE 优先，PowerShell 回退。 */
type ClipboardWorkerHost = 'exe' | 'powershell'

/**
 * 剪贴板 worker：通过 stdin 逐行下发 base64(UTF-8) 的 '\n' 分隔多路径，stdout 按行回执。
 * 生命周期由池控制：每次复制后 terminate（stdin EOF → 进程退出），
 * 使剪贴板回到「owner 已退出」状态——资源管理器/桌面粘贴可用的前提。
 */
type ClipboardWorker = {
  host: ClipboardWorkerHost
  run(commandBase64: string): Promise<void>
  terminate(): void
}

function resolveClipboardWorkerExePath(): string {
  return resolveAppResourcePath('script', 'clipboard-worker', 'bin', 'ClipboardWorker.exe')
}

function createClipboardWorker(host: ClipboardWorkerHost, onDead: (worker: ClipboardWorker) => void): Promise<ClipboardWorker> {
  return new Promise((resolveWorker, rejectWorker) => {
    if (host === 'exe' && !existsSync(resolveClipboardWorkerExePath())) {
      rejectWorker(new ProjectFileServiceError(`Clipboard worker exe is missing: ${resolveClipboardWorkerExePath()}`))
      return
    }
    const child =
      host === 'exe'
        ? spawn(resolveClipboardWorkerExePath(), [], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
        : spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-EncodedCommand', Buffer.from(CLIPBOARD_WORKER_SCRIPT, 'utf-16le').toString('base64')], {
            windowsHide: true,
            stdio: ['pipe', 'pipe', 'pipe'],
          })

    let resolvedWorker: ClipboardWorker | null = null
    let stdoutBuffer = ''
    let stderrTail = ''
    let pendingResolve: (() => void) | null = null
    let pendingReject: ((error: Error) => void) | null = null

    const failPending = (error: Error) => {
      if (pendingReject) {
        const reject = pendingReject
        pendingReject = null
        pendingResolve = null
        reject(error)
      }
    }
    const failWorker = (error: Error) => {
      failPending(error)
      if (resolvedWorker) {
        onDead(resolvedWorker)
      } else {
        rejectWorker(error)
      }
    }

    child.stdout.setEncoding('utf-8')
    child.stdout.on('data', (chunk: string) => {
      stdoutBuffer += chunk
      let newlineIndex = stdoutBuffer.search(/\r?\n/)
      while (newlineIndex !== -1) {
        const line = stdoutBuffer.slice(0, newlineIndex)
        stdoutBuffer = stdoutBuffer.slice(newlineIndex).replace(/^\r?\n/, '')
        newlineIndex = stdoutBuffer.search(/\r?\n/)

        if (line === CLIPBOARD_WORKER_READY_LINE && !resolvedWorker) {
          resolvedWorker = {
            host,
            run: (commandBase64) =>
              new Promise<void>((resolve, reject) => {
                if (!child.stdin.writable) {
                  reject(new ProjectFileServiceError('Clipboard worker is not available.'))
                  return
                }
                pendingResolve = resolve
                pendingReject = reject
                try {
                  child.stdin.write(`${commandBase64}\n`)
                } catch (error) {
                  pendingResolve = null
                  pendingReject = null
                  reject(error instanceof Error ? error : new ProjectFileServiceError('Failed to write clipboard command.'))
                }
              }),
            terminate: () => {
              // 结束 stdin → worker 自然退出，剪贴板保持「owner 已退出」终态。
              child.stdin.end()
            },
          }
          resolveWorker(resolvedWorker)
        } else if (line === CLIPBOARD_WORKER_OK_LINE) {
          if (pendingResolve) {
            const resolve = pendingResolve
            pendingResolve = null
            pendingReject = null
            resolve()
          }
        } else if (line.startsWith(CLIPBOARD_WORKER_ERROR_PREFIX)) {
          const message = line.slice(CLIPBOARD_WORKER_ERROR_PREFIX.length).trim()
          failPending(new ProjectFileServiceError(message || 'Failed to write clipboard.'))
        }
      }
    })
    child.stderr.setEncoding('utf-8')
    child.stderr.on('data', (chunk: string) => {
      stderrTail = `${stderrTail}${chunk}`.slice(-500)
    })
    // 父进程退出等场景下 stdin 可能触发 EPIPE，交给 exit 处理器统一善后。
    child.stdin.on('error', () => undefined)
    child.once('error', (error) => {
      failWorker(new ProjectFileServiceError(`Clipboard worker failed: ${error.message}`))
    })
    child.once('exit', (code) => {
      failWorker(new ProjectFileServiceError(`Clipboard worker exited unexpectedly (code ${code}).${stderrTail ? ` stderr: ${stderrTail.trim()}` : ''}`))
    })
  })
}

/** READY worker 池条目：worker 创建完成前为 null。 */
type ClipboardWorkerPoolEntry = {
  promise: Promise<ClipboardWorker>
  worker: ClipboardWorker | null
}

const clipboardWorkerPool: ClipboardWorkerPoolEntry[] = []
// 串行化复制请求，避免并发时 stdin 命令与 stdout 回执交错。
let clipboardTaskQueue: Promise<unknown> = Promise.resolve()

function removePoolEntry(entry: ClipboardWorkerPoolEntry): void {
  const index = clipboardWorkerPool.indexOf(entry)
  if (index !== -1) {
    clipboardWorkerPool.splice(index, 1)
  }
}

function createClipboardWorkerPoolEntry(): ClipboardWorkerPoolEntry {
  const entry: ClipboardWorkerPoolEntry = { promise: Promise.reject(new Error('uninitialized')), worker: null }
  // 标记 entry.promise 已接管，避免内部占位 rejection 触发 unhandled rejection。
  entry.promise.catch(() => undefined)
  const t0 = Date.now()
  const onDead = (dead: ClipboardWorker) => {
    if (entry.worker === dead) {
      removePoolEntry(entry)
    }
  }

  const exePath = resolveClipboardWorkerExePath()
  const create = existsSync(exePath) ? () => createClipboardWorker('exe', onDead) : () => createClipboardWorker('powershell', onDead)

  entry.promise = create().catch((error) => {
    // EXE 缺失/启动失败时回退 PowerShell 宿主，功能不变只是变慢。
    console.warn('[clipboard-worker] primary host failed, falling back to powershell:', error.message)
    return createClipboardWorker('powershell', onDead)
  })
  entry.promise
    .then((worker) => {
      entry.worker = worker
      console.log(`[clipboard-worker] ready in ${Date.now() - t0}ms (host=${worker.host})`)
    })
    .catch(() => removePoolEntry(entry))
  clipboardWorkerPool.push(entry)
  return entry
}

/** 补满 READY worker 池。失败静默：复制时会重试创建。 */
function refillClipboardWorkerPool(): void {
  while (clipboardWorkerPool.length < CLIPBOARD_READY_POOL_SIZE) {
    createClipboardWorkerPoolEntry()
  }
}

/** 从池中取 worker：优先已就绪实例，取走后立即补位（吸收连续快速复制）。 */
async function acquireClipboardWorker(): Promise<ClipboardWorker> {
  refillClipboardWorkerPool()
  const readyIndex = clipboardWorkerPool.findIndex((entry) => entry.worker !== null)
  if (readyIndex !== -1) {
    const [entry] = clipboardWorkerPool.splice(readyIndex, 1)
    refillClipboardWorkerPool()
    return entry.worker as ClipboardWorker
  }
  // 无就绪实例：等待最早创建的那个完成启动。
  const entry = clipboardWorkerPool.shift()
  if (!entry) {
    throw new ProjectFileServiceError('No clipboard worker slot available.')
  }
  const worker = await entry.promise
  refillClipboardWorkerPool()
  return worker
}

/**
 * worker 协议编码：'\n' 分隔多路径 → base64。
 * 保持纯 ASCII 传输，避免中文路径被控制台 ANSI 编码（GBK）误读；
 * Windows 路径不含换行符，'\n' 分隔无歧义；worker 与 PowerShell 回退双侧按同一协议解码。
 */
export function encodeClipboardWorkerCommand(filePaths: string[]): string {
  return Buffer.from(filePaths.join('\n'), 'utf-8').toString('base64')
}

/**
 * 单次复制生命周期：从池中取 worker → 下发 base64 多路径命令 → terminate。
 * 复制后 worker 立即退出，剪贴板保持「owner 已退出 + 数据已 flush」的兼容终态；
 * 池在分配时已同步补位，冷启动成本被后台预热吸收。
 */
async function writeFileDropToClipboard(filePaths: string[]): Promise<void> {
  if (filePaths.length === 0) {
    throw new ProjectFileServiceError('No file path to copy to clipboard.')
  }
  const runTask = clipboardTaskQueue.then(async () => {
    const worker = await acquireClipboardWorker()
    const command = encodeClipboardWorkerCommand(filePaths)
    const t0 = Date.now()
    await worker.run(command)
    console.log(`[clipboard-worker] copy completed in ${Date.now() - t0}ms (host=${worker.host}, files=${filePaths.length})`)
    worker.terminate()
  })
  clipboardTaskQueue = runTask.catch(() => undefined)
  await runTask
}

/**
 * 应用启动时把 READY worker 池补满（fire-and-forget）：把 worker 冷启动成本挪到
 * 应用启动阶段，首次复制也能毫秒级返回。
 */
export function prewarmClipboardWorker(): void {
  if (process.platform !== 'win32') return
  refillClipboardWorkerPool()
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
    await writeFileDropToClipboard([zipTargetPath])
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

  await writeFileDropToClipboard([fileRealPath])
  return { name: path.basename(fileRealPath), size: fileStat.size }
}

/** 批量打包/复制条目上限（D4）：防 IPC 超大数组与误操作全选；两个批量动作共用。 */
export const MAX_ARCHIVE_ENTRIES = 500

/** IPC 边界校验：条目必须是非空数组、数量在上限内、每项含安全 relativePath 与合法 kind。 */
function normalizeArchiveEntries(entries: readonly ProjectFileArchiveEntry[]): ProjectFileArchiveEntry[] {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new ProjectFileServiceError('No entries selected.')
  }
  if (entries.length > MAX_ARCHIVE_ENTRIES) {
    throw new ProjectFileServiceError(`Too many entries selected (max ${MAX_ARCHIVE_ENTRIES}).`)
  }
  return entries.map((entry) => {
    if (!entry || typeof entry.relativePath !== 'string' || !entry.relativePath.trim()) {
      throw new ProjectFileServiceError('Entry relative path is required.')
    }
    if (entry.kind !== 'file' && entry.kind !== 'directory') {
      throw new ProjectFileServiceError('Entry kind must be file or directory.')
    }
    return { relativePath: entry.relativePath, kind: entry.kind }
  })
}

/** 逐条过防护链解析真实路径（目录/文件分别校验类型）；返回规范化后的条目供 zip 命名使用。 */
export async function resolveEntryRealPaths(projectPath: string, entries: readonly ProjectFileArchiveEntry[]): Promise<{ entry: ProjectFileArchiveEntry; realPath: string }[]> {
  const rootRealPath = await resolveRoot(projectPath)
  const resolved: { entry: ProjectFileArchiveEntry; realPath: string }[] = []
  for (const entry of entries) {
    const normalized = normalizeRelativeInput(entry.relativePath)
    validateRelativePathLooksSafe(normalized)
    const candidatePath = path.resolve(rootRealPath, normalized)
    const realPath = await fs.realpath(candidatePath)
    ensureWithinRoot(rootRealPath, realPath)
    const stat = await fs.stat(realPath)
    if (entry.kind === 'directory') {
      if (!stat.isDirectory()) {
        throw new ProjectFileServiceError('Selected path is not a directory.')
      }
    } else if (!stat.isFile()) {
      throw new ProjectFileServiceError('Selected path is not a file.')
    }
    resolved.push({ entry: { relativePath: normalized, kind: entry.kind }, realPath })
  }
  return resolved
}

/**
 * 批量 zip 的公共基准目录（用户 2026-10-22 修订：只保留最近的树状结构）：
 * 取所有条目「所在目录」的最长公共前缀——每个条目都严格位于基准之下、按自身名字保留，
 * zip 根即该基准。例：src/a/b/c.txt + src/a/c → 基准 src/a → zip 内 b/c.txt + c；
 * 单选目录 src/utils → 基准 src → zip 内 utils/**（目录名不丢）；单选文件 src/a/b/c.txt → 基准 src/a/b → c.txt。
 */
export function computeArchiveBaseDirectory(entryPaths: readonly string[]): string {
  let base: string | null = null
  for (const entryPath of entryPaths) {
    // 文件取父目录；目录取父目录（目录自身作为条目按名进包，内容挂在其名字下）。
    const separatorIndex = entryPath.lastIndexOf('/')
    const containingDir = separatorIndex === -1 ? '' : entryPath.slice(0, separatorIndex)
    if (base === null) {
      base = containingDir
      continue
    }
    if (containingDir === base) continue
    const baseSegments = base === '' ? [] : base.split('/')
    const dirSegments = containingDir === '' ? [] : containingDir.split('/')
    const commonSegments: string[] = []
    const limit = Math.min(baseSegments.length, dirSegments.length)
    for (let index = 0; index < limit; index += 1) {
      if (baseSegments[index] !== dirSegments[index]) break
      commonSegments.push(baseSegments[index])
    }
    base = commonSegments.join('/')
  }
  return base ?? ''
}

/**
 * 混合流式打包：目录 archive.directory(real, rel)（整棵子树落在 rel/ 下），文件 archive.file(real, { name: rel })；
 * rel = 条目相对公共基准目录的路径（只保留最近的树状结构）；失败清理半成品（与 packFolderToZip 同款）。
 */
export async function packEntriesToZip(resolvedEntries: readonly { entry: ProjectFileArchiveEntry; realPath: string }[], zipTargetPath: string): Promise<void> {
  const archiveBase = computeArchiveBaseDirectory(resolvedEntries.map((item) => item.entry.relativePath))
  const toArchivePath = (relativePath: string): string => {
    const posixPath = toPosixRelativePath(relativePath)
    return archiveBase === '' ? posixPath : toPosixRelativePath(path.posix.relative(archiveBase, posixPath))
  }

  const output = createWriteStream(zipTargetPath)
  // archiver v8 为 ESM 类导出：ZipArchive 即 zip 格式工厂，等价于 v7 的 archiver('zip', options)。
  const archive = new ZipArchive({ zlib: { level: 9 } })
  // 流错误监听同步挂载：输出目录被删/磁盘满等场景下 error 早于 finalize 完成触发，
  // 延迟挂载会撞上 Node 的 unhandled 'error' 直接崩溃；额外 catch 占位避免善后路径上的 unhandled rejection。
  const streamSettled = new Promise<void>((resolve, reject) => {
    output.once('close', () => resolve())
    output.once('error', reject)
    archive.once('error', reject)
  })
  streamSettled.catch(() => undefined)
  try {
    archive.pipe(output)
    for (const { entry, realPath } of resolvedEntries) {
      const archivePath = toArchivePath(entry.relativePath)
      if (entry.kind === 'directory') {
        archive.directory(realPath, archivePath)
      } else {
        archive.file(realPath, { name: archivePath })
      }
    }
    await archive.finalize()
    await streamSettled
  } catch (error) {
    await fs.unlink(zipTargetPath).catch(() => undefined)
    throw error
  }
}

/** D8：默认临时 zip 名 {项目名}-selected.zip（项目名做文件名安全化，空则回退 selected.zip）。 */
function defaultSelectedZipName(projectPath: string): string {
  const projectName = path.basename(projectPath.replace(/[\\/]+$/, '')).trim()
  const safeName = projectName.replace(/[<>:"|?*\u0000-\u001f\\/]/g, '').replace(/\.zip$/i, '')
  return safeName ? `${safeName}-selected.zip` : 'selected.zip'
}

/**
 * 批量「复制 zip 到剪贴板」：多选条目（文件 + 目录混合）打包为 zip 后以 CF_HDROP 写入剪贴板。
 * 完全复刻 copyProjectFolderZipToClipboard 的临时目录流程：不落项目盘、每次清空旧产物、用完即删。
 * zip 内结构保留项目内相对路径；仅支持 Windows 宿主（WSL 项目同为主进程打包，不受影响）。
 */
export async function copyProjectEntriesZipToClipboard(projectPath: string, entries: readonly ProjectFileArchiveEntry[], zipName?: string): Promise<{ name: string; size: number }> {
  if (process.platform !== 'win32') {
    throw new ProjectFileServiceError('Copy zip to clipboard is only supported on Windows.')
  }

  const normalizedEntries = normalizeArchiveEntries(entries)
  const resolvedEntries = await resolveEntryRealPaths(projectPath, normalizedEntries)
  const finalZipName = zipName ? sanitizeZipFileName(zipName) : defaultSelectedZipName(projectPath)

  const tempDirPath = path.join(app.getPath('temp'), ZIP_CLIPBOARD_TEMP_DIRNAME)
  await fs.mkdir(tempDirPath, { recursive: true })
  // 清理本目录旧产物：剪贴板始终只引用最新一份 zip。
  const staleEntries = await fs.readdir(tempDirPath).catch(() => [] as string[])
  for (const entry of staleEntries) {
    await fs.unlink(path.join(tempDirPath, entry)).catch(() => undefined)
  }

  const zipTargetPath = path.join(tempDirPath, finalZipName)
  await packEntriesToZip(resolvedEntries, zipTargetPath)

  try {
    await writeFileDropToClipboard([zipTargetPath])
  } catch (error) {
    await fs.unlink(zipTargetPath).catch(() => undefined)
    throw error
  }

  const zipStat = await fs.stat(zipTargetPath)
  return { name: finalZipName, size: zipStat.size }
}

/**
 * 批量「复制文件」：多选文件（调用方保证全为 file，主进程兜底拒绝目录）以 CF_HDROP 一次性写入剪贴板。
 * 仅支持 Windows 宿主（WSL 项目同为主进程直接读取文件，不受影响）。
 */
export async function copyProjectEntriesToClipboard(projectPath: string, entries: readonly ProjectFileArchiveEntry[]): Promise<{ name: string; count: number }> {
  if (process.platform !== 'win32') {
    throw new ProjectFileServiceError('Copy files to clipboard is only supported on Windows.')
  }

  const normalizedEntries = normalizeArchiveEntries(entries)
  const resolvedEntries = await resolveEntryRealPaths(projectPath, normalizedEntries)
  if (resolvedEntries.some((item) => item.entry.kind !== 'file')) {
    throw new ProjectFileServiceError('Copy files to clipboard only supports file entries.')
  }

  await writeFileDropToClipboard(resolvedEntries.map((item) => item.realPath))
  return { name: path.basename(resolvedEntries[0].realPath), count: resolvedEntries.length }
}
