import type { ChildProcess } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import type { DocxPreviewErrorReason } from '../../../shared/types'

/**
 * DOCX 高保真预览核心（18 号计划）：LibreOffice headless 转 PDF + 内容寻址缓存。
 *
 * 本模块保持纯逻辑、零 Electron 依赖：文件系统、进程执行、引擎候选、限制值
 * 全部通过构造注入，主进程侧的 Electron 接线在 docx-preview-service.ts，
 * 单测在 test/electron/project-file.docx-preview.test.mjs 注入假依赖覆盖边界。
 *
 * 资源所有权分三层：
 * - Request（preview 一次调用）：拥有自己的快照任务目录，finally 无条件回收；
 * - Job（一次实际转换）：由 inFlight 中的任务记录持有，消费者（subscribers）
 *   全部取消时才跳过，单个消费者取消不影响共享同一转换的其他请求；
 * - Artifact（产物 PDF）：以 base64 交付给 renderer（IPC 内存交付），
 *   持久缓存只是加速层——写缓存失败不影响本次预览，缓存损坏下次自动重转。
 */

/** 转换参数版本号：调整 soffice 参数/产物处理逻辑时递增，使旧缓存整体失效。 */
export const DOCX_PREVIEW_PARAM_VERSION = 1
/** 转换产物 PDF 大小上限（D6）：超限不读内存、不写缓存。 */
export const MAX_GENERATED_PDF_BYTES = 20 * 1024 * 1024
export const BASE_CONVERSION_TIMEOUT_MS = 30_000
export const CONVERSION_TIMEOUT_MS_PER_MB = 5_000
export const MAX_CONVERSION_TIMEOUT_MS = 120_000
/** kill 后等待子进程真正退出的宽限期：宽限期后放行清理，残留交启动清理兜底。 */
export const PROCESS_EXIT_GRACE_MS = 5_000
/** 队列长度上限（v2⑤）：队满拒绝新请求，不拒绝已排队请求。 */
export const DOCX_PREVIEW_QUEUE_LIMIT = 4
/** 启动清理任务目录/缓存临时文件的年龄阈值。 */
export const STALE_ARTIFACT_AGE_MS = 60 * 60 * 1000
/** 缓存文件数上限：与字节数预算并行，防止大量极小文件拖慢扫描与淘汰。 */
export const MAX_CACHE_FILE_COUNT = 64
/** Windows 下 rm 的有限重试次数（EPERM/EBUSY 常见于句柄延迟释放）。 */
const TASK_DIR_RM_ATTEMPTS = 3
const TASK_DIR_RM_RETRY_DELAY_MS = 150

export type SpawnLike = (command: string, args: string[], options: { windowsHide: boolean }) => ChildProcess

export interface FileStatLite {
  size: number
  mtimeMs: number
  isFile(): boolean
}

export interface FileSystemAdapter {
  stat(targetPath: string): Promise<FileStatLite>
  copyFile(source: string, destination: string): Promise<void>
  readFile(targetPath: string): Promise<Buffer>
  writeFile(targetPath: string, data: Buffer): Promise<void>
  rename(fromPath: string, toPath: string): Promise<void>
  mkdir(targetPath: string, options: { recursive: true }): Promise<string | undefined>
  readdir(targetPath: string): Promise<string[]>
  unlink(targetPath: string): Promise<void>
  rm(targetPath: string, options: { recursive: true; force: boolean }): Promise<void>
  utimes(targetPath: string, atime: Date, mtime: Date): Promise<void>
}

export interface EngineCandidate {
  id: string
  executablePath: string
}

export interface EngineDescriptor {
  /** 引擎标识，进入缓存 key：换安装路径或二进制被更新（size/mtime 变化）即视为换转换器。 */
  id: string
  executablePath: string
}

export interface DocxPreviewLimits {
  /** DOCX 源文件大小上限（docxPreviewLimitMb）。 */
  sourceBytes: number
  /** 转换产物 PDF 大小上限（MAX_GENERATED_PDF_BYTES）。 */
  outputBytes: number
  /** 缓存容量预算（docxPreviewCacheBudgetMb）。 */
  cacheBudgetBytes: number
}

export interface DocxPreviewControllerOptions {
  fileSystem: FileSystemAdapter
  spawn: SpawnLike
  /** 引擎候选顺序：配置覆盖路径优先，其后为默认安装位置（D2/v3）。 */
  engineCandidates: () => EngineCandidate[]
  limits: () => DocxPreviewLimits
  tempRoot: string
  cacheRoot: string
  /** 注入平台仅为了单测覆盖 tree-kill 分支。 */
  platform?: NodeJS.Platform
  queueLimit?: number
  cleanupAgeMs?: number
}

export type ConvertOutcome = { ok: true; pdf: Buffer } | { ok: false; reason: DocxPreviewErrorReason }

/** 共享转换任务：tracked 是结果 Promise，subscribers 是全部消费者（undefined 表示无取消能力的消费者）。 */
interface ConversionJob {
  subscribers: Set<string | undefined>
  tracked: Promise<ConvertOutcome>
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function noop(): undefined {
  return undefined
}

/** PDF 魔数校验：在退出码/存在/非空之外的最小有效性检查，避免把异常产物当成功。 */
export function looksLikePdf(buffer: Buffer): boolean {
  return buffer.length >= 5 && buffer.subarray(0, 5).equals(Buffer.from('%PDF-', 'ascii'))
}

/** 按顺序探测候选引擎；探测失败视为缺失并继续下一个候选。 */
export async function discoverEngine(candidates: EngineCandidate[], fileSystem: FileSystemAdapter): Promise<EngineDescriptor | null> {
  for (const candidate of candidates) {
    if (!candidate.executablePath) continue
    try {
      const stat = await fileSystem.stat(candidate.executablePath)
      if (stat.isFile()) {
        // 引擎标识带上二进制 size+mtime：LibreOffice 升级/重装后旧缓存自动失效（免跑 --version 的低成本版本指纹）。
        return { id: `${candidate.id}:${stat.size}:${Math.round(stat.mtimeMs)}`, executablePath: candidate.executablePath }
      }
    } catch {
      // 候选位置不存在属常态，继续探测下一个。
    }
  }
  return null
}

/** soffice 参数构造（v2⑥）：profile 用 pathToFileURL 构造并作为独立参数，禁止 shell 拼接。 */
export function buildSofficeArgs(profileDir: string, outDir: string, snapshotPath: string): string[] {
  return ['--headless', '--norestore', '--convert-to', 'pdf', '--outdir', outDir, `-env:UserInstallation=${pathToFileURL(profileDir).href}`, snapshotPath]
}

/** 缓存 key = sha256(快照内容 + 引擎标识 + 参数版本)：任一变化都产生新 key。 */
export function computeCacheKey(snapshot: Buffer, engineId: string): string {
  return createHash('sha256').update(snapshot).update('\0').update(engineId).update('\0').update(String(DOCX_PREVIEW_PARAM_VERSION)).digest('hex')
}

/** 超时按快照大小放宽：30s 基础值 + 5s/MB，封顶 120s。 */
export function conversionTimeoutMs(snapshotBytes: number): number {
  return Math.min(MAX_CONVERSION_TIMEOUT_MS, BASE_CONVERSION_TIMEOUT_MS + Math.ceil(snapshotBytes / (1024 * 1024)) * CONVERSION_TIMEOUT_MS_PER_MB)
}

/** Windows 下 soffice 可能派生子进程，树杀避免孤儿进程长期占用独立 profile。 */
export function killProcessTree(child: ChildProcess, platform: NodeJS.Platform, spawn: SpawnLike): void {
  try {
    if (platform === 'win32' && child.pid) {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true })
      return
    }
    child.kill('SIGKILL')
  } catch {
    // 进程可能已自行退出。
  }
}

export class DocxPreviewController {
  private readonly options: DocxPreviewControllerOptions
  /** 引擎发现的肯定结果缓存；engine-missing 为否定结果不缓存（v3），装完即生效。 */
  private engine: EngineDescriptor | null = null
  private readonly inFlight = new Map<string, ConversionJob>()
  private chain: Promise<unknown> = Promise.resolve()
  private queuedCount = 0
  private readonly cancellations = new Set<string>()
  /** 预算淘汰互斥链：多任务近同时完成时，统计→选择→删除 不交错。 */
  private evictChain: Promise<unknown> = Promise.resolve()
  private staleCleanupStarted = false

  constructor(options: DocxPreviewControllerOptions) {
    this.options = options
    void this.cleanupStaleArtifacts()
  }

  /**
   * renderer 切换文件/关闭预览时标记该请求取消（v2⑤）。
   * 单个请求取消 ≠ 任务取消：仅当共享转换的全部消费者都已取消，出队时才跳过任务；
   * 已进入转换的任务不中断，完成后正常入缓存。
   */
  cancel(requestId: string): void {
    this.cancellations.add(requestId)
  }

  /** 从绝对真实路径（防护链解析产物）执行快照 → 缓存查询 → 排队转换全流程。 */
  async preview(sourceRealPath: string, requestId?: string): Promise<{ status: 'ok'; pdfBase64: string; fromCache: boolean } | { status: 'engine-missing' } | { status: 'error'; reason: DocxPreviewErrorReason }> {
    const engine = await this.findEngine()
    if (!engine) return { status: 'engine-missing' }

    const limits = this.options.limits()
    const taskDir = path.join(this.options.tempRoot, randomUUID())
    try {
      await this.options.fileSystem.mkdir(taskDir, { recursive: true })
      // ① 快照先于一切（v2①）：哈希与转换绑定同一份输入，soffice 不接触源文件/UNC。
      const snapshot = await this.copySnapshot(sourceRealPath, taskDir, limits.sourceBytes)
      if (typeof snapshot === 'string') return { status: 'error', reason: snapshot }

      const key = computeCacheKey(snapshot, engine.id)
      const cached = await this.readCache(key)
      if (cached) return { status: 'ok', pdfBase64: cached.toString('base64'), fromCache: true }

      const outcome = await this.submit(key, requestId, () => this.convert(taskDir, snapshot.length, engine, key))
      if (outcome.ok) return { status: 'ok', pdfBase64: outcome.pdf.toString('base64'), fromCache: false }
      return { status: 'error', reason: outcome.reason }
    } finally {
      // 任务结束（成功/失败/超时/取消）删除任务目录；共享转换的请求各自删自己的目录。
      // 清理失败不掩盖原始转换结果：重试后仍失败仅告警，残留交启动清理兜底。
      await this.removeTaskDirWithRetry(taskDir)
    }
  }

  private async findEngine(): Promise<EngineDescriptor | null> {
    if (this.engine) return this.engine
    const engine = await discoverEngine(this.options.engineCandidates(), this.options.fileSystem)
    if (engine) this.engine = engine
    return engine
  }

  /** 复制快照并前后复查 stat（v2①）；不一致重试一次，耗尽返回 source-changed。 */
  private async copySnapshot(sourceRealPath: string, taskDir: string, sourceLimitBytes: number): Promise<Buffer | DocxPreviewErrorReason> {
    const snapshotPath = path.join(taskDir, 'source.docx')
    for (let attempt = 0; attempt < 2; attempt += 1) {
      let before: FileStatLite
      try {
        before = await this.options.fileSystem.stat(sourceRealPath)
      } catch {
        return 'conversion-failed'
      }
      if (before.size > sourceLimitBytes) return 'source-too-large'
      try {
        await this.options.fileSystem.copyFile(sourceRealPath, snapshotPath)
        const after = await this.options.fileSystem.stat(sourceRealPath)
        if (after.size === before.size && after.mtimeMs === before.mtimeMs) {
          return await this.options.fileSystem.readFile(snapshotPath)
        }
      } catch {
        // 复制期间读取失败按源变更处理，进入重试。
      }
    }
    return 'source-changed'
  }

  /** 串行执行（并发 1）+ 同 key 合并（in-flight dedupe）+ 队满拒新（v2⑤）。 */
  private submit(key: string, requestId: string | undefined, factory: () => Promise<ConvertOutcome>): Promise<ConvertOutcome> {
    const existing = this.inFlight.get(key)
    if (existing) {
      // 共享转换：后来者只登记为消费者，不创建新任务、不占队列额度。
      existing.subscribers.add(requestId)
      return existing.tracked
    }
    const queueLimit = this.options.queueLimit ?? DOCX_PREVIEW_QUEUE_LIMIT
    if (this.queuedCount >= queueLimit) return Promise.resolve({ ok: false, reason: 'queue-full' })

    const subscribers = new Set<string | undefined>([requestId])
    const job = async (): Promise<ConvertOutcome> => {
      // 出队执行前检查取消：只有全部消费者都已取消才跳过；undefined 消费者视为永不取消。
      let allCancelled = subscribers.size > 0
      for (const id of subscribers) {
        if (id === undefined || !this.cancellations.has(id)) {
          allCancelled = false
          break
        }
      }
      if (allCancelled) {
        for (const id of subscribers) {
          if (id !== undefined) this.cancellations.delete(id)
        }
        return { ok: false, reason: 'cancelled' }
      }
      return factory()
    }
    this.queuedCount += 1
    const promise = this.chain.then(async () => {
      this.queuedCount -= 1
      return job()
    })
    const tracked = promise.finally(() => {
      if (this.inFlight.get(key)?.tracked === tracked) this.inFlight.delete(key)
    })
    this.inFlight.set(key, { subscribers, tracked })
    this.chain = promise.then(noop, noop)
    return tracked
  }

  private async convert(taskDir: string, snapshotBytes: number, engine: EngineDescriptor, key: string): Promise<ConvertOutcome> {
    const snapshotPath = path.join(taskDir, 'source.docx')
    const outputPath = path.join(taskDir, 'source.pdf')
    const profileDir = path.join(taskDir, 'lo-profile')
    const args = buildSofficeArgs(profileDir, taskDir, snapshotPath)

    let child: ChildProcess
    try {
      child = this.options.spawn(engine.executablePath, args, { windowsHide: true })
    } catch {
      return { ok: false, reason: 'conversion-failed' }
    }
    if (!child.pid) return { ok: false, reason: 'conversion-failed' }

    // 独立的退出等待器：超时分支在 kill 之后仍要等进程真正退出，才能放行上层 finally 删任务目录。
    const exitDone = new Promise<void>((resolve) => {
      child.once('exit', () => resolve())
      child.once('error', () => resolve())
    })
    const platform = this.options.platform ?? process.platform
    const exited = await new Promise<'exit' | 'timeout' | 'error'>((resolve) => {
      let settled = false
      const settle = (value: 'exit' | 'timeout' | 'error') => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(value)
      }
      const timer = setTimeout(() => {
        // 先 settle 再 kill：kill 触发的 exit 事件不得覆盖 timeout 判定。
        settle('timeout')
        killProcessTree(child, platform, this.options.spawn)
      }, conversionTimeoutMs(snapshotBytes))
      child.once('error', () => settle('error'))
      child.once('exit', () => settle('exit'))
    })
    if (exited === 'timeout') {
      // 进程回收顺序：确认超时 → 已 kill → 等退出（或宽限期到）→ 才返回并触发目录清理。
      await Promise.race([exitDone, delay(PROCESS_EXIT_GRACE_MS)])
      return { ok: false, reason: 'timeout' }
    }
    if (exited === 'error') return { ok: false, reason: 'conversion-failed' }

    // 产物校验：存在且非空；超限删除且不读内存、不写缓存（v2③/D6）。
    let outputStat: FileStatLite
    try {
      outputStat = await this.options.fileSystem.stat(outputPath)
    } catch {
      return { ok: false, reason: 'conversion-failed' }
    }
    if (!outputStat.isFile() || outputStat.size === 0) return { ok: false, reason: 'conversion-failed' }
    if (outputStat.size > this.options.limits().outputBytes) {
      await this.options.fileSystem.unlink(outputPath).catch(noop)
      return { ok: false, reason: 'output-too-large' }
    }

    let pdf: Buffer
    try {
      pdf = await this.options.fileSystem.readFile(outputPath)
    } catch {
      return { ok: false, reason: 'output-missing' }
    }
    if (!looksLikePdf(pdf)) return { ok: false, reason: 'conversion-failed' }
    await this.writeCache(key, pdf)
    return { ok: true, pdf }
  }

  /** 任务目录删除（Windows EPERM/EBUSY 常见于句柄延迟释放）：有限重试，最终失败仅告警。 */
  private async removeTaskDirWithRetry(taskDir: string): Promise<void> {
    for (let attempt = 0; attempt < TASK_DIR_RM_ATTEMPTS; attempt += 1) {
      try {
        await this.options.fileSystem.rm(taskDir, { recursive: true, force: true })
        return
      } catch {
        await delay(TASK_DIR_RM_RETRY_DELAY_MS * (attempt + 1))
      }
    }
    // 只记录目录名（taskId），不记录文档路径（缓存隐私）。
    console.warn(`[docx-preview] task dir cleanup failed after retries: ${path.basename(taskDir)}`)
  }

  private cachePath(key: string): string {
    return path.join(this.options.cacheRoot, `${key}.pdf`)
  }

  private async readCache(key: string): Promise<Buffer | null> {
    try {
      const pdf = await this.options.fileSystem.readFile(this.cachePath(key))
      if (!looksLikePdf(pdf)) {
        // 缓存条目损坏：删除并视为未命中，本次请求直接重转。
        await this.options.fileSystem.unlink(this.cachePath(key)).catch(noop)
        return null
      }
      // touch 最近访问时间，供预算淘汰按 mtime 从旧到新淘汰（D5）。
      const now = new Date()
      await this.options.fileSystem.utimes(this.cachePath(key), now, now).catch(noop)
      return pdf
    } catch {
      return null
    }
  }

  /** 临时文件 + rename 原子写入，随后触发预算淘汰。缓存写入失败不影响本次预览返回。 */
  private async writeCache(key: string, pdf: Buffer): Promise<void> {
    const budgetBytes = this.options.limits().cacheBudgetBytes
    if (pdf.length > budgetBytes) {
      // 单个产物超过预算：写入只会让缓存永久超标，直接跳过持久缓存（产物仍以 base64 交付）。
      console.warn(`[docx-preview] pdf exceeds cache budget, skip caching: ${Math.round(pdf.length / (1024 * 1024))}MB`)
      return
    }
    try {
      await this.options.fileSystem.mkdir(this.options.cacheRoot, { recursive: true })
      const tempPath = `${this.cachePath(key)}.${randomUUID()}.tmp`
      await this.options.fileSystem.writeFile(tempPath, pdf)
      await this.options.fileSystem.rename(tempPath, this.cachePath(key))
      await this.evictCacheBudget(key)
    } catch {
      // 缓存为加速层，失败可容忍，但不应在诊断层完全不可见。
      console.warn(`[docx-preview] cache write failed: ${key.slice(0, 8)}…`)
    }
  }

  /** 预算淘汰入口：互斥链串行化，多任务近同时完成时统计→选择→删除不交错。 */
  private evictCacheBudget(justWrittenKey: string): Promise<void> {
    const run = this.evictChain.then(() => this.evictCacheBudgetInternal(justWrittenKey))
    this.evictChain = run.then(noop, noop)
    return run
  }

  /** 简单预算淘汰（D5）：按 mtime 从旧到新，刚写入的条目除外；字节数与文件数双上限。 */
  private async evictCacheBudgetInternal(justWrittenKey: string): Promise<void> {
    const budgetBytes = this.options.limits().cacheBudgetBytes
    let entries: Array<{ name: string; size: number; mtimeMs: number }>
    try {
      const names = await this.options.fileSystem.readdir(this.options.cacheRoot)
      entries = []
      for (const name of names) {
        if (!name.endsWith('.pdf')) continue
        try {
          const stat = await this.options.fileSystem.stat(path.join(this.options.cacheRoot, name))
          if (stat.isFile()) entries.push({ name, size: stat.size, mtimeMs: stat.mtimeMs })
        } catch {
          // 并发删除，忽略。
        }
      }
    } catch {
      return
    }
    let totalBytes = entries.reduce((sum, entry) => sum + entry.size, 0)
    let remainingCount = entries.length
    if (totalBytes <= budgetBytes && remainingCount <= MAX_CACHE_FILE_COUNT) return
    entries.sort((a, b) => a.mtimeMs - b.mtimeMs)
    for (const entry of entries) {
      if (totalBytes <= budgetBytes && remainingCount <= MAX_CACHE_FILE_COUNT) break
      if (entry.name === `${justWrittenKey}.pdf`) continue
      try {
        await this.options.fileSystem.unlink(path.join(this.options.cacheRoot, entry.name))
        totalBytes -= entry.size
        remainingCount -= 1
      } catch {
        // 已被并发删除，忽略（不计入 remainingCount 变化，下轮清理重试）。
      }
    }
  }

  /** 启动时清理异常残留：tempRoot 的任务目录（按目录年龄）+ cacheRoot 的 .tmp 半成品（按文件年龄）。 */
  private async cleanupStaleArtifacts(): Promise<void> {
    if (this.staleCleanupStarted) return
    this.staleCleanupStarted = true
    const ageMs = this.options.cleanupAgeMs ?? STALE_ARTIFACT_AGE_MS
    const now = Date.now()
    await this.cleanStaleTaskDirs(now, ageMs)
    await this.cleanStaleCacheTempFiles(now, ageMs)
  }

  private async cleanStaleTaskDirs(now: number, ageMs: number): Promise<void> {
    let names: string[]
    try {
      names = await this.options.fileSystem.readdir(this.options.tempRoot)
    } catch {
      return
    }
    for (const name of names) {
      const dirPath = path.join(this.options.tempRoot, name)
      try {
        const stat = await this.options.fileSystem.stat(dirPath)
        if (!stat.isFile() && now - stat.mtimeMs > ageMs) await this.options.fileSystem.rm(dirPath, { recursive: true, force: true })
      } catch {
        // 残留清理为 best-effort。
      }
    }
  }

  private async cleanStaleCacheTempFiles(now: number, ageMs: number): Promise<void> {
    let names: string[]
    try {
      names = await this.options.fileSystem.readdir(this.options.cacheRoot)
    } catch {
      return
    }
    for (const name of names) {
      // 严格命名规则：<key>.pdf.<uuid>.tmp —— 只清理自己产生的半成品命名。
      if (!name.endsWith('.tmp') || !name.includes('.pdf.')) continue
      const filePath = path.join(this.options.cacheRoot, name)
      try {
        const stat = await this.options.fileSystem.stat(filePath)
        if (stat.isFile() && now - stat.mtimeMs > ageMs) await this.options.fileSystem.unlink(filePath)
      } catch {
        // 残留清理为 best-effort。
      }
    }
  }
}
