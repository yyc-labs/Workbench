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

/** 剪贴板 worker 协议哨兵：就绪 / 单条命令成功 / 失败前缀 / 退出指令。 */
const CLIPBOARD_WORKER_READY_LINE = '__READY__'
const CLIPBOARD_WORKER_OK_LINE = '__OK__'
const CLIPBOARD_WORKER_ERROR_PREFIX = '__ERR__'
const CLIPBOARD_WORKER_EXIT_LINE = '__EXIT__'

/**
 * 常驻 PowerShell worker 脚本：启动时一次性加载 .NET WinForms（冷启动约 1.5 秒），
 * 之后逐行读取命令执行，毫秒级响应。STA 线程保证 Clipboard API 可用；
 * 父进程退出导致 stdin EOF 后自然退出。
 *
 * 每次 SetDataObject 后必须紧跟 OleFlushClipboard：常驻进程不走旧方案的「退出即 flush」
 * 路径，不 flush 的话剪贴板处于 OLE 延迟渲染状态，而本线程阻塞在 ReadLine 上不泵消息，
 * 其他进程（资源管理器/微信）请求渲染数据时会拿到空结果。
 */
const CLIPBOARD_WORKER_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
  'Add-Type -AssemblyName System.Windows.Forms',
  'Add-Type -Namespace Native -Name Ole32 -MemberDefinition \'[DllImport("ole32.dll")] public static extern int OleFlushClipboard();\'',
  // 只读不写，预热 .NET 剪贴板内部懒加载，让首次复制也达到毫秒级。
  'try { [void][System.Windows.Forms.Clipboard]::GetDataObject() } catch {}',
  `[Console]::Out.WriteLine('${CLIPBOARD_WORKER_READY_LINE}')`,
  'while ($true) {',
  '  $line = [Console]::In.ReadLine()',
  `  if ($null -eq $line -or $line -eq '${CLIPBOARD_WORKER_EXIT_LINE}') { break }`,
  '  try {',
  '    Invoke-Expression $line',
  "    if ([Native.Ole32]::OleFlushClipboard() -ne 0) { throw 'OleFlushClipboard failed.' }",
  `    [Console]::Out.WriteLine('${CLIPBOARD_WORKER_OK_LINE}')`,
  '  } catch {',
  `    [Console]::Out.WriteLine('${CLIPBOARD_WORKER_ERROR_PREFIX}' + ($_.Exception.Message -replace '\\r|\\n', ' '))`,
  '  }',
  '}',
].join('\n')

/** 常驻剪贴板 worker：通过 stdin 逐条下发命令，stdout 按行回执。 */
type ClipboardWorker = {
  run(command: string): Promise<void>
  terminate(): void
}

let clipboardWorkerPromise: Promise<ClipboardWorker> | null = null
let clipboardWorkerGeneration = 0
// 串行化复制请求，避免并发时 stdin 命令与 stdout 回执交错。
let clipboardTaskQueue: Promise<unknown> = Promise.resolve()

function createClipboardWorker(): Promise<ClipboardWorker> {
  const generation = (clipboardWorkerGeneration += 1)
  const encoded = Buffer.from(CLIPBOARD_WORKER_SCRIPT, 'utf-16le').toString('base64')
  return new Promise((resolveWorker, rejectWorker) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-EncodedCommand', encoded], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    let workerSettled = false
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
      if (clipboardWorkerGeneration === generation) {
        clipboardWorkerPromise = null
      }
      failPending(error)
      if (!workerSettled) {
        workerSettled = true
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

        if (line === CLIPBOARD_WORKER_READY_LINE) {
          if (!workerSettled) {
            workerSettled = true
            resolveWorker({
              run: (command) =>
                new Promise<void>((resolve, reject) => {
                  if (!child.stdin.writable) {
                    reject(new ProjectFileServiceError('Clipboard worker is not available.'))
                    return
                  }
                  pendingResolve = resolve
                  pendingReject = reject
                  try {
                    child.stdin.write(`${command}\n`)
                  } catch (error) {
                    pendingResolve = null
                    pendingReject = null
                    reject(error instanceof Error ? error : new ProjectFileServiceError('Failed to write clipboard command.'))
                  }
                }),
              terminate: () => {
                // 结束 stdin → worker 的 ReadLine 返回 null → 自然退出，
                // 剪贴板回到「owner 已退出」状态（资源管理器粘贴可用的前提）。
                child.stdin.end()
              },
            })
          }
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

function getClipboardWorker(): Promise<ClipboardWorker> {
  if (!clipboardWorkerPromise) {
    const workerPromise = createClipboardWorker()
    clipboardWorkerPromise = workerPromise
    workerPromise.catch(() => {
      // 失败后清空缓存，让下次复制重新创建 worker。
      if (clipboardWorkerPromise === workerPromise) {
        clipboardWorkerPromise = null
      }
    })
  }
  return clipboardWorkerPromise
}

/**
 * 单条复制命令：与旧方案等价的 .NET SetFileDropList 写入（保持微信等聊天窗口的兼容性）。
 * 路径以 base64（纯 ASCII）下发、worker 端按 UTF-8 解码——避免中文路径被 PowerShell
 * 按控制台 ANSI 编码（GBK）误读成乱码。
 */
function buildFileDropCommand(filePath: string): string {
  const encodedPath = Buffer.from(filePath, 'utf-8').toString('base64')
  return [
    `$p = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedPath}'))`,
    '$list = New-Object System.Collections.Specialized.StringCollection',
    '[void]$list.Add($p)',
    '$data = New-Object System.Windows.Forms.DataObject',
    '$data.SetFileDropList($list)',
    '[System.Windows.Forms.Clipboard]::SetDataObject($data, $true)',
  ].join('; ')
}

/**
 * 单条复制生命周期：写入剪贴板后立刻让 worker 退出——剪贴板回到「owner 已退出」状态，
 * 与旧一次性方案完全一致（资源管理器/桌面粘贴依赖此状态；owner 存活时其 OLE IDataObject
 * 查询会被 marshal 到阻塞中的 STA 线程而失败）。随后立即预热下一个 worker，冷启动无感。
 */
async function writeFileDropToClipboard(filePath: string): Promise<void> {
  const runTask = clipboardTaskQueue.then(async () => {
    const worker = await getClipboardWorker()
    await worker.run(buildFileDropCommand(filePath))
    worker.terminate()
    clipboardWorkerPromise = null
  })
  clipboardTaskQueue = runTask.catch(() => undefined)
  await runTask
  prewarmClipboardWorker()
}

/**
 * 应用启动时预热剪贴板 worker（fire-and-forget）：把 .NET 冷启动成本挪到应用启动阶段，
 * 首次复制也能毫秒级返回。失败时静默处理，下次复制会重试创建。
 */
export function prewarmClipboardWorker(): void {
  if (process.platform !== 'win32') return
  void getClipboardWorker().catch(() => undefined)
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
