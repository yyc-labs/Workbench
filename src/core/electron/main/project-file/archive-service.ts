import { createWriteStream, existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { app } from 'electron'
import { ZipArchive } from 'archiver'
import type { ProjectFileZipResult } from '../../../shared/types'
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
 * STA 线程保证 Clipboard API 可用；stdin 每行一个 base64(UTF-8) 文件路径。
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
  '    [void]$list.Add($p)',
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
 * 剪贴板 worker：通过 stdin 逐行下发 base64(UTF-8) 路径，stdout 按行回执。
 * 生命周期由池控制：每次复制后 terminate（stdin EOF → 进程退出），
 * 使剪贴板回到「owner 已退出」状态——资源管理器/桌面粘贴可用的前提。
 */
type ClipboardWorker = {
  host: ClipboardWorkerHost
  run(filePathBase64: string): Promise<void>
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
            run: (filePathBase64) =>
              new Promise<void>((resolve, reject) => {
                if (!child.stdin.writable) {
                  reject(new ProjectFileServiceError('Clipboard worker is not available.'))
                  return
                }
                pendingResolve = resolve
                pendingReject = reject
                try {
                  child.stdin.write(`${filePathBase64}\n`)
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
 * 单条复制生命周期：从池中取 worker → 下发 base64 路径 → terminate。
 * 路径以 base64（纯 ASCII）传输，避免中文路径被控制台 ANSI 编码（GBK）误读。
 * 复制后 worker 立即退出，剪贴板保持「owner 已退出 + 数据已 flush」的兼容终态；
 * 池在分配时已同步补位，冷启动成本被后台预热吸收。
 */
async function writeFileDropToClipboard(filePath: string): Promise<void> {
  const runTask = clipboardTaskQueue.then(async () => {
    const worker = await acquireClipboardWorker()
    const command = Buffer.from(filePath, 'utf-8').toString('base64')
    const t0 = Date.now()
    await worker.run(command)
    console.log(`[clipboard-worker] copy completed in ${Date.now() - t0}ms (host=${worker.host})`)
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
    await writeFileDropToClipboard(zipTargetPath)
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

  await writeFileDropToClipboard(fileRealPath)
  return { name: path.basename(fileRealPath), size: fileStat.size }
}
