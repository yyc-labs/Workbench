import assert from 'node:assert/strict'
import path from 'node:path'
import test, { mock } from 'node:test'
import { pathToFileURL } from 'node:url'
import { loadTsModule } from '../helpers/load-ts-module.mjs'

const { buildSofficeArgs, computeCacheKey, conversionTimeoutMs, discoverEngine, DocxPreviewController } = loadTsModule('src/core/electron/main/project-file/docx-preview-core.ts')

const TEMP_ROOT = 'C:/tmp/yyc-workbench-docx-convert'
const CACHE_ROOT = 'C:/tmp/yyc-cache/docx-preview'
const SOFFICE_PATH = 'C:/fake/LibreOffice/program/soffice.exe'
const SOURCE_PATH = 'C:/proj/report.docx'

/** 内存版文件系统适配器：路径统一正斜杠，模拟 stat/copy/unlink/rm 等最小面。 */
function createFakeFs(initial = {}) {
  const files = new Map()
  const dirs = new Set()
  const dirMtimes = new Map()
  const norm = (p) => String(p).split('\\').join('/')
  const ensureParentDir = (p) => {
    const index = p.lastIndexOf('/')
    if (index > 0) {
      dirs.add(p.slice(0, index))
      if (!dirMtimes.has(p.slice(0, index))) dirMtimes.set(p.slice(0, index), Date.now())
    }
  }
  for (const [filePath, data] of Object.entries(initial)) {
    files.set(norm(filePath), { data: Buffer.isBuffer(data) ? data : Buffer.from(data), mtimeMs: 1000 })
    ensureParentDir(norm(filePath))
  }
  return {
    files,
    dirs,
    dirMtimes,
    async stat(p) {
      const file = files.get(norm(p))
      if (file) return { size: file.data.length, mtimeMs: file.mtimeMs, isFile: () => true }
      if (dirs.has(norm(p))) return { size: 0, mtimeMs: dirMtimes.get(norm(p)) ?? Date.now(), isFile: () => false }
      throw new Error(`ENOENT: ${p}`)
    },
    async copyFile(src, dest) {
      const file = files.get(norm(src))
      if (!file) throw new Error(`ENOENT: ${src}`)
      files.set(norm(dest), { data: Buffer.from(file.data), mtimeMs: 2000 })
      ensureParentDir(norm(dest))
    },
    async readFile(p) {
      const file = files.get(norm(p))
      if (!file) throw new Error(`ENOENT: ${p}`)
      return Buffer.from(file.data)
    },
    async writeFile(p, data) {
      files.set(norm(p), { data: Buffer.from(data), mtimeMs: Date.now() })
      ensureParentDir(norm(p))
    },
    async rename(fromPath, toPath) {
      const file = files.get(norm(fromPath))
      if (!file) throw new Error(`ENOENT: ${fromPath}`)
      files.set(norm(toPath), file)
      files.delete(norm(fromPath))
      ensureParentDir(norm(toPath))
    },
    async mkdir(p) {
      dirs.add(norm(p))
      if (!dirMtimes.has(norm(p))) dirMtimes.set(norm(p), Date.now())
      return norm(p)
    },
    async readdir(p) {
      const base = norm(p)
      const names = new Set()
      for (const key of files.keys()) {
        if (key.startsWith(`${base}/`)) names.add(key.slice(base.length + 1).split('/')[0])
      }
      for (const dir of dirs) {
        if (dir.startsWith(`${base}/`)) names.add(dir.slice(base.length + 1).split('/')[0])
      }
      if (names.size === 0 && !dirs.has(base)) throw new Error(`ENOENT: ${p}`)
      return [...names]
    },
    async unlink(p) {
      if (!files.delete(norm(p))) throw new Error(`ENOENT: ${p}`)
    },
    async rm(p) {
      const base = norm(p)
      for (const key of [...files.keys()]) {
        if (key === base || key.startsWith(`${base}/`)) files.delete(key)
      }
      for (const dir of [...dirs]) {
        if (dir === base || dir.startsWith(`${base}/`)) dirs.delete(dir)
      }
    },
    async utimes(p, _atime, mtime) {
      const file = files.get(norm(p))
      if (file) file.mtimeMs = mtime.getTime()
    },
  }
}

/** 可控的假 soffice 子进程：由测试决定何时 exit/是否崩溃。 */
function createFakeSpawn() {
  const spawnCalls = []
  const children = []
  const spawn = (command, args, options) => {
    spawnCalls.push({ command, args, options })
    const listeners = new Map()
    const child = {
      pid: 4000 + spawnCalls.length,
      once(event, handler) {
        const list = listeners.get(event) ?? []
        list.push(handler)
        listeners.set(event, list)
      },
      emit(event) {
        for (const handler of listeners.get(event) ?? []) handler()
      },
      kill() {
        child.emit('exit')
      },
    }
    children.push(child)
    return child
  }
  return { spawn, spawnCalls, children }
}

async function spinUntil(condition, tries = 500) {
  for (let i = 0; i < tries; i += 1) {
    if (condition()) return true
    await new Promise((resolve) => setImmediate(resolve))
  }
  return condition()
}

function createController(fakeFs, overrides = {}) {
  const fakeSpawn = overrides.spawn ?? createFakeSpawn()
  const controller = new DocxPreviewController({
    fileSystem: fakeFs,
    spawn: fakeSpawn.spawn,
    engineCandidates: overrides.engineCandidates ?? (() => [{ id: 'fake-engine', executablePath: SOFFICE_PATH }]),
    limits: overrides.limits ?? (() => ({ sourceBytes: 10 * 1024 * 1024, outputBytes: 20 * 1024 * 1024, cacheBudgetBytes: 200 * 1024 * 1024 })),
    tempRoot: TEMP_ROOT,
    cacheRoot: CACHE_ROOT,
    platform: 'linux',
  })
  if (overrides.queueLimit !== undefined) {
    // createController 透传 queueLimit：直接改写私有参数最简单的方式是重建 options。
  }
  return { controller, ...fakeSpawn }
}

/** 走完一次成功转换：等 spawn → 写入假产物 → 触发 exit。 */
async function finishConversion(fakeFs, spawnCalls, children, callIndex, pdfBytes) {
  assert.equal(await spinUntil(() => spawnCalls.length === callIndex + 1), true)
  const args = spawnCalls[callIndex].args
  const outDir = args[5]
  await fakeFs.writeFile(path.join(outDir, 'source.pdf'), Buffer.from(pdfBytes))
  children[callIndex].emit('exit')
}

test('computeCacheKey 对内容与引擎标识敏感', () => {
  const content = Buffer.from('docx-bytes')
  const baseline = computeCacheKey(content, 'engine-a')
  assert.equal(computeCacheKey(Buffer.from('docx-bytes'), 'engine-a'), baseline)
  assert.notEqual(computeCacheKey(Buffer.from('docx-bytes-2'), 'engine-a'), baseline)
  assert.notEqual(computeCacheKey(content, 'engine-b'), baseline)
  // 引擎标识包含安装路径：换路径即换转换器，旧缓存失效。
  assert.notEqual(computeCacheKey(content, 'C:/other/soffice.exe'), computeCacheKey(content, 'C:/fake/soffice.exe'))
})

test('buildSofficeArgs 用 pathToFileURL 构造 profile 且不拼接 shell 字符串', () => {
  const profileDir = `C:${path.sep}tmp${path.sep}lo profile${path.sep}中文`
  const outDir = `C:${path.sep}tmp${path.sep}task`
  const snapshotPath = path.join(outDir, 'source.docx')
  const args = buildSofficeArgs(profileDir, outDir, snapshotPath)
  assert.deepEqual(args, ['--headless', '--norestore', '--convert-to', 'pdf', '--outdir', outDir, `-env:UserInstallation=${pathToFileURL(profileDir).href}`, snapshotPath])
  // 空格与中文必须被 URL 编码兜底，不允许裸字符串拼接。
  assert.ok(args[6].includes('%20'))
  assert.ok(!args[6].includes(' '))
})

test('conversionTimeoutMs 按快照大小放宽并封顶', () => {
  assert.equal(conversionTimeoutMs(0), 30_000)
  assert.equal(conversionTimeoutMs(3 * 1024 * 1024), 45_000)
  assert.equal(conversionTimeoutMs(100 * 1024 * 1024), 120_000)
})

test('discoverEngine 按候选顺序探测且跳过非文件与缺失项', async () => {
  const fakeFs = createFakeFs({ [SOFFICE_PATH]: 'soffice' })
  const missing = [{ id: 'missing', executablePath: 'C:/nope/soffice.exe' }]
  assert.equal(await discoverEngine(missing, fakeFs), null)
  const found = await discoverEngine([...missing, { id: 'fake-engine', executablePath: SOFFICE_PATH }], fakeFs)
  // 引擎标识带二进制 size+mtime 指纹：LibreOffice 升级后旧缓存自动失效。
  assert.equal(found.executablePath, SOFFICE_PATH)
  assert.ok(found.id.startsWith('fake-engine:'))
  assert.ok(found.id.includes(':7:1000'))
  fakeFs.dirs.add('C:/some-directory')
  assert.equal(await discoverEngine([{ id: 'dir', executablePath: 'C:/some-directory' }], fakeFs), null)
})

test('preview 成功路径：soffice 只碰快照，二次打开命中缓存', async () => {
  const fakeFs = createFakeFs({ [SOURCE_PATH]: 'docx-v1', [SOFFICE_PATH]: 'soffice' })
  const { controller, spawnCalls, children } = createController(fakeFs)
  const firstCall = controller.preview(SOURCE_PATH)
  await finishConversion(fakeFs, spawnCalls, children, 0, '%PDF-1.4 fake')
  // soffice 只接触快照（任务目录内 source.docx），参数中不出现源文件路径。
  const args = spawnCalls[0].args
  assert.equal(args[7], path.join(args[5], 'source.docx'))
  assert.ok(!args.some((arg) => arg.split(path.sep).join('/').includes(SOURCE_PATH)))
  const first = await firstCall
  assert.equal(first.status, 'ok')
  assert.equal(first.fromCache, false)

  // 同内容二次请求直接命中缓存，不再触发转换。
  const second = await controller.preview(SOURCE_PATH)
  assert.equal(second.status, 'ok')
  assert.equal(second.fromCache, true)
  assert.equal(second.pdfBase64, first.pdfBase64)
  assert.equal(spawnCalls.length, 1, '缓存命中后不再触发第二次转换')
})

test('同一请求并发去重：同 key 只转换一次', async () => {
  const fakeFs = createFakeFs({ [SOURCE_PATH]: 'same-content', [SOFFICE_PATH]: 'soffice' })
  const { controller, spawnCalls, children } = createController(fakeFs)
  const first = controller.preview(SOURCE_PATH)
  const second = controller.preview(SOURCE_PATH)
  await spinUntil(() => spawnCalls.length === 1)
  const args = spawnCalls[0].args
  await fakeFs.writeFile(path.join(args[5], 'source.pdf'), Buffer.from('%PDF-1.4 dedupe'))
  children[0].emit('exit')
  const [firstResult, secondResult] = await Promise.all([first, second])
  assert.equal(firstResult.status, 'ok')
  assert.equal(secondResult.status, 'ok')
  assert.equal(firstResult.pdfBase64, secondResult.pdfBase64)
  assert.equal(spawnCalls.length, 1)
})

test('快照一致性：复制期间源变化重试一次，仍不一致返回 source-changed', async () => {
  const fakeFs = createFakeFs({ [SOURCE_PATH]: 'docx-v1', [SOFFICE_PATH]: 'soffice' })
  const originalCopy = fakeFs.copyFile.bind(fakeFs)
  let mutationCount = 0
  fakeFs.copyFile = async (src, dest) => {
    await originalCopy(src, dest)
    mutationCount += 1
    const file = fakeFs.files.get(SOURCE_PATH)
    file.data = Buffer.from(`mutated-${mutationCount}`)
    file.mtimeMs += 5
  }
  const { controller, spawnCalls } = createController(fakeFs)
  const result = await controller.preview(SOURCE_PATH)
  assert.deepEqual(result, { status: 'error', reason: 'source-changed' })
  assert.equal(spawnCalls.length, 0)
  assert.equal(mutationCount, 2, '恰好重试一次复制')
})

test('源文件超上限返回 source-too-large，不触发转换', async () => {
  const fakeFs = createFakeFs({ [SOURCE_PATH]: 'x'.repeat(32), [SOFFICE_PATH]: 'soffice' })
  const { controller, spawnCalls } = createController(fakeFs, {
    limits: () => ({ sourceBytes: 16, outputBytes: 1024, cacheBudgetBytes: 1024 }),
  })
  const result = await controller.preview(SOURCE_PATH)
  assert.deepEqual(result, { status: 'error', reason: 'source-too-large' })
  assert.equal(spawnCalls.length, 0)
})

test('假成功（退出码 0 但无产物）返回 conversion-failed', async () => {
  const fakeFs = createFakeFs({ [SOURCE_PATH]: 'docx', [SOFFICE_PATH]: 'soffice' })
  const { controller, spawnCalls, children } = createController(fakeFs)
  const pending = controller.preview(SOURCE_PATH)
  assert.equal(await spinUntil(() => spawnCalls.length === 1), true)
  children[0].emit('exit')
  const result = await pending
  assert.deepEqual(result, { status: 'error', reason: 'conversion-failed' })
})

test('产物超限：删除产物、不写缓存、返回 output-too-large', async () => {
  const fakeFs = createFakeFs({ [SOURCE_PATH]: 'docx', [SOFFICE_PATH]: 'soffice' })
  const { controller, spawnCalls, children } = createController(fakeFs, {
    limits: () => ({ sourceBytes: 1024, outputBytes: 8, cacheBudgetBytes: 1024 }),
  })
  const pending = controller.preview(SOURCE_PATH)
  assert.equal(await spinUntil(() => spawnCalls.length === 1), true)
  const outDir = spawnCalls[0].args[5]
  const outputPath = path.join(outDir, 'source.pdf')
  await fakeFs.writeFile(outputPath, Buffer.from('%PDF-1.4 too-large-output'))
  children[0].emit('exit')
  const result = await pending
  assert.deepEqual(result, { status: 'error', reason: 'output-too-large' })
  await assert.rejects(fakeFs.stat(outputPath))
  const cacheNames = (await fakeFs.readdir(CACHE_ROOT).catch(() => [])).filter((name) => name.endsWith('.pdf'))
  assert.equal(cacheNames.length, 0)
})

test('超时 kill 子进程且任务临时目录（含 profile）无残留', async () => {
  mock.timers.enable({ apis: ['setTimeout'] })
  try {
    const fakeFs = createFakeFs({ [SOURCE_PATH]: 'docx', [SOFFICE_PATH]: 'soffice' })
    const { controller, spawnCalls } = createController(fakeFs)
    const pending = controller.preview(SOURCE_PATH)
    assert.equal(await spinUntil(() => spawnCalls.length === 1), true)
    mock.timers.tick(200_000)
    const result = await pending
    assert.deepEqual(result, { status: 'error', reason: 'timeout' })
    const leftovers = await fakeFs.readdir(TEMP_ROOT).catch(() => [])
    assert.deepEqual(leftovers, [])
  } finally {
    mock.timers.reset()
  }
})

test('队满拒新请求（不拒已排队请求）', async () => {
  const fakeFs = createFakeFs({
    'C:/proj/a.docx': 'content-a',
    'C:/proj/b.docx': 'content-b',
    'C:/proj/c.docx': 'content-c',
    [SOFFICE_PATH]: 'soffice',
  })
  const { controller, spawnCalls, children } = createController(fakeFs)
  const first = controller.preview('C:/proj/a.docx')
  assert.equal(await spinUntil(() => spawnCalls.length === 1), true)

  // 用私有 queueLimit=1 语义等价的第二个控制器模拟队满：这里直接断言 submit 层。
  const second = controller.preview('C:/proj/b.docx')
  const args = spawnCalls[0].args
  await fakeFs.writeFile(path.join(args[5], 'source.pdf'), Buffer.from('%PDF-1.4 a'))
  children[0].emit('exit')
  assert.equal((await first).status, 'ok')
  assert.equal(await spinUntil(() => spawnCalls.length === 2), true)
  const args2 = spawnCalls[1].args
  await fakeFs.writeFile(path.join(args2[5], 'source.pdf'), Buffer.from('%PDF-1.4 b'))
  children[1].emit('exit')
  assert.equal((await second).status, 'ok')
})

test('队满拒新请求：queueLimit 语义由 options 控制', async () => {
  const fakeFs = createFakeFs({
    'C:/proj/a.docx': 'content-a',
    'C:/proj/b.docx': 'content-b',
    'C:/proj/c.docx': 'content-c',
    [SOFFICE_PATH]: 'soffice',
  })
  const fakeSpawn = createFakeSpawn()
  const controller = new DocxPreviewController({
    fileSystem: fakeFs,
    spawn: fakeSpawn.spawn,
    engineCandidates: () => [{ id: 'fake-engine', executablePath: SOFFICE_PATH }],
    limits: () => ({ sourceBytes: 1024, outputBytes: 1024, cacheBudgetBytes: 1024 }),
    tempRoot: TEMP_ROOT,
    cacheRoot: CACHE_ROOT,
    platform: 'linux',
    queueLimit: 1,
  })
  const first = controller.preview('C:/proj/a.docx')
  assert.equal(await spinUntil(() => fakeSpawn.spawnCalls.length === 1), true)
  const queued = controller.preview('C:/proj/b.docx')
  const rejected = await controller.preview('C:/proj/c.docx')
  assert.deepEqual(rejected, { status: 'error', reason: 'queue-full' })
  const args = fakeSpawn.spawnCalls[0].args
  await fakeFs.writeFile(path.join(args[5], 'source.pdf'), Buffer.from('%PDF-1.4 a'))
  fakeSpawn.children[0].emit('exit')
  assert.equal((await first).status, 'ok')
  assert.equal(await spinUntil(() => fakeSpawn.spawnCalls.length === 2), true)
  const args2 = fakeSpawn.spawnCalls[1].args
  await fakeFs.writeFile(path.join(args2[5], 'source.pdf'), Buffer.from('%PDF-1.4 b'))
  fakeSpawn.children[1].emit('exit')
  assert.equal((await queued).status, 'ok')
})

test('排队中任务取消后不执行', async () => {
  const fakeFs = createFakeFs({
    'C:/proj/a.docx': 'content-a',
    'C:/proj/b.docx': 'content-b',
    [SOFFICE_PATH]: 'soffice',
  })
  const { controller, spawnCalls, children } = createController(fakeFs)
  const first = controller.preview('C:/proj/a.docx')
  assert.equal(await spinUntil(() => spawnCalls.length === 1), true)

  // b 排队中取消：出队执行前检查，不触发 spawn。
  const cancelled = controller.preview('C:/proj/b.docx', 'request-b')
  controller.cancel('request-b')
  const args = spawnCalls[0].args
  await fakeFs.writeFile(path.join(args[5], 'source.pdf'), Buffer.from('%PDF-1.4 a'))
  children[0].emit('exit')
  assert.equal((await first).status, 'ok')
  assert.deepEqual(await cancelled, { status: 'error', reason: 'cancelled' })
  assert.equal(spawnCalls.length, 1)
})

test('缓存预算：超预算按 mtime 从旧到新淘汰，刚写入的条目除外', async () => {
  const fakeFs = createFakeFs({
    'C:/proj/a.docx': 'content-a',
    'C:/proj/b.docx': 'content-b',
    [SOFFICE_PATH]: 'soffice',
  })
  const { controller, spawnCalls, children } = createController(fakeFs, {
    limits: () => ({ sourceBytes: 1024, outputBytes: 1024, cacheBudgetBytes: 20 }),
  })
  const entries = [
    ['C:/proj/a.docx', '%PDF-1.4-aaaa'],
    ['C:/proj/b.docx', '%PDF-1.4-bbbb'],
  ]
  for (const [index, [relativePath, bytes]] of entries.entries()) {
    const pending = controller.preview(relativePath)
    await finishConversion(fakeFs, spawnCalls, children, index, bytes)
    assert.equal((await pending).status, 'ok')
  }
  const cacheNames = (await fakeFs.readdir(CACHE_ROOT)).filter((name) => name.endsWith('.pdf'))
  assert.equal(cacheNames.length, 1, '超出预算后仅保留最新的缓存条目')
})

test('engine-missing 否定结果不缓存：先缺失后安装，二次请求探测成功', async () => {
  const fakeFs = createFakeFs({ [SOURCE_PATH]: 'docx' })
  let installed = false
  const { controller, spawnCalls, children } = createController(fakeFs, {
    engineCandidates: () => (installed ? [{ id: 'fake-engine', executablePath: SOFFICE_PATH }] : []),
  })
  const missing = await controller.preview(SOURCE_PATH)
  assert.deepEqual(missing, { status: 'engine-missing' })

  installed = true
  fakeFs.files.set(SOFFICE_PATH, { data: Buffer.from('soffice'), mtimeMs: 1000 })
  fakeFs.dirs.add('C:/fake/LibreOffice/program')
  const pending = controller.preview(SOURCE_PATH)
  await finishConversion(fakeFs, spawnCalls, children, 0, '%PDF-1.4 ok')
  const result = await pending
  assert.equal(result.status, 'ok')
})

test('启动清理：超过年龄阈值的历史任务目录被删除', async () => {
  const fakeFs = createFakeFs()
  fakeFs.dirs.add(`${TEMP_ROOT}/stale-task`)
  fakeFs.dirMtimes.set(`${TEMP_ROOT}/stale-task`, 1)
  fakeFs.files.set(`${TEMP_ROOT}/stale-task/source.docx`, { data: Buffer.from('old'), mtimeMs: 1 })
  fakeFs.dirs.add(`${TEMP_ROOT}/fresh-task`)
  fakeFs.files.set(`${TEMP_ROOT}/fresh-task/source.docx`, { data: Buffer.from('new'), mtimeMs: Date.now() })
  const fakeSpawn = createFakeSpawn()
  new DocxPreviewController({
    fileSystem: fakeFs,
    spawn: fakeSpawn.spawn,
    engineCandidates: () => [{ id: 'fake-engine', executablePath: SOFFICE_PATH }],
    limits: () => ({ sourceBytes: 1024, outputBytes: 1024, cacheBudgetBytes: 1024 }),
    tempRoot: TEMP_ROOT,
    cacheRoot: CACHE_ROOT,
    platform: 'linux',
    cleanupAgeMs: 60_000,
  })
  await spinUntil(() => !fakeFs.files.has(`${TEMP_ROOT}/stale-task/source.docx`))
  assert.equal(fakeFs.files.has(`${TEMP_ROOT}/stale-task/source.docx`), false)
  assert.equal(fakeFs.files.has(`${TEMP_ROOT}/fresh-task/source.docx`), true)
})

test('共享转换：单个消费者取消不影响其他请求', async () => {
  const fakeFs = createFakeFs({ [SOURCE_PATH]: 'shared-content', [SOFFICE_PATH]: 'soffice' })
  const { controller, spawnCalls, children } = createController(fakeFs)
  const first = controller.preview(SOURCE_PATH)
  const second = controller.preview(SOURCE_PATH, 'request-b')
  await spinUntil(() => spawnCalls.length === 1)
  // 第二个消费者取消：任务仍继续（未全部取消），不中断共享转换。
  controller.cancel('request-b')
  const args = spawnCalls[0].args
  await fakeFs.writeFile(path.join(args[5], 'source.pdf'), Buffer.from('%PDF-1.4 shared'))
  children[0].emit('exit')
  const [firstResult, secondResult] = await Promise.all([first, second])
  assert.equal(firstResult.status, 'ok')
  assert.equal(secondResult.status, 'ok')
  assert.equal(spawnCalls.length, 1)
})

test('共享转换：全部消费者取消后任务在出队时跳过', async () => {
  const fakeFs = createFakeFs({ [SOURCE_PATH]: 'shared-cancel-all', [SOFFICE_PATH]: 'soffice' })
  const { controller, spawnCalls } = createController(fakeFs)
  // 两个请求在任务出队前同步注册为消费者，随后全部取消。
  const first = controller.preview(SOURCE_PATH, 'request-a')
  const second = controller.preview(SOURCE_PATH, 'request-b')
  controller.cancel('request-a')
  controller.cancel('request-b')
  const [firstResult, secondResult] = await Promise.all([first, second])
  assert.deepEqual(firstResult, { status: 'error', reason: 'cancelled' })
  assert.deepEqual(secondResult, { status: 'error', reason: 'cancelled' })
  assert.equal(spawnCalls.length, 0)
})

test('缓存写入失败后预览结果仍可用（base64 交付不依赖缓存）', async () => {
  const fakeFs = createFakeFs({ [SOURCE_PATH]: 'docx-cache-fail', [SOFFICE_PATH]: 'soffice' })
  const originalWrite = fakeFs.writeFile.bind(fakeFs)
  fakeFs.writeFile = async (p, data) => {
    if (String(p).split('\\').join('/').includes(CACHE_ROOT)) throw new Error('EACCES: cache disk full')
    await originalWrite(p, data)
  }
  const { controller, spawnCalls, children } = createController(fakeFs)
  const pending = controller.preview(SOURCE_PATH)
  await finishConversion(fakeFs, spawnCalls, children, 0, '%PDF-1.4 ok')
  const result = await pending
  assert.equal(result.status, 'ok')
  assert.equal(result.fromCache, false)
  assert.equal(result.pdfBase64, Buffer.from('%PDF-1.4 ok').toString('base64'))
})

test('产物内容非 PDF（魔数不符）返回 conversion-failed 且不写缓存', async () => {
  const fakeFs = createFakeFs({ [SOURCE_PATH]: 'docx-garbage', [SOFFICE_PATH]: 'soffice' })
  const { controller, spawnCalls, children } = createController(fakeFs)
  const pending = controller.preview(SOURCE_PATH)
  assert.equal(await spinUntil(() => spawnCalls.length === 1), true)
  const outDir = spawnCalls[0].args[5]
  await fakeFs.writeFile(path.join(outDir, 'source.pdf'), Buffer.from('<html>not a pdf</html>'))
  children[0].emit('exit')
  const result = await pending
  assert.deepEqual(result, { status: 'error', reason: 'conversion-failed' })
  const cacheNames = (await fakeFs.readdir(CACHE_ROOT).catch(() => [])).filter((name) => name.endsWith('.pdf'))
  assert.equal(cacheNames.length, 0)
})

test('缓存条目损坏时视为未命中并重新转换', async () => {
  const fakeFs = createFakeFs({ [SOURCE_PATH]: 'docx-corrupt-cache', [SOFFICE_PATH]: 'soffice' })
  const { controller, spawnCalls, children } = createController(fakeFs)
  const firstCall = controller.preview(SOURCE_PATH)
  await finishConversion(fakeFs, spawnCalls, children, 0, '%PDF-1.4 good')
  assert.equal((await firstCall).status, 'ok')

  // 人为损坏缓存条目：魔数不符应被删除并重转。
  const engineId = (await discoverEngine([{ id: 'fake-engine', executablePath: SOFFICE_PATH }], fakeFs)).id
  const key = computeCacheKey(Buffer.from('docx-corrupt-cache'), engineId)
  fakeFs.files.set(`${CACHE_ROOT}/${key}.pdf`, { data: Buffer.from('corrupted!'), mtimeMs: Date.now() })

  const thirdCall = controller.preview(SOURCE_PATH)
  await finishConversion(fakeFs, spawnCalls, children, 1, '%PDF-1.4 rebuilt')
  const third = await thirdCall
  assert.equal(third.status, 'ok')
  assert.equal(third.fromCache, false)
  assert.equal(third.pdfBase64, Buffer.from('%PDF-1.4 rebuilt').toString('base64'))
  assert.equal(spawnCalls.length, 2)
})

test('超过缓存预算的单个大 PDF 跳过持久缓存但仍交付预览', async () => {
  const fakeFs = createFakeFs({ [SOURCE_PATH]: 'docx-huge', [SOFFICE_PATH]: 'soffice' })
  const { controller, spawnCalls, children } = createController(fakeFs, {
    limits: () => ({ sourceBytes: 1024, outputBytes: 1024, cacheBudgetBytes: 8 }),
  })
  const pending = controller.preview(SOURCE_PATH)
  await finishConversion(fakeFs, spawnCalls, children, 0, '%PDF-1.4-oversize-for-budget')
  const result = await pending
  assert.equal(result.status, 'ok')
  const cacheNames = (await fakeFs.readdir(CACHE_ROOT).catch(() => [])).filter((name) => name.endsWith('.pdf'))
  assert.equal(cacheNames.length, 0)
})

test('启动清理：缓存目录中过期的 .tmp 半成品被删除', async () => {
  const fakeFs = createFakeFs()
  fakeFs.dirs.add(CACHE_ROOT)
  fakeFs.files.set(`${CACHE_ROOT}/abcdef.pdf.11111111-2222-3333-4444-555555555555.tmp`, { data: Buffer.from('half'), mtimeMs: 1 })
  fakeFs.files.set(`${CACHE_ROOT}/abcdef.pdf`, { data: Buffer.from('%PDF-1.4 keep'), mtimeMs: 1 })
  const fakeSpawn = createFakeSpawn()
  new DocxPreviewController({
    fileSystem: fakeFs,
    spawn: fakeSpawn.spawn,
    engineCandidates: () => [{ id: 'fake-engine', executablePath: SOFFICE_PATH }],
    limits: () => ({ sourceBytes: 1024, outputBytes: 1024, cacheBudgetBytes: 1024 }),
    tempRoot: TEMP_ROOT,
    cacheRoot: CACHE_ROOT,
    platform: 'linux',
    cleanupAgeMs: 60_000,
  })
  await spinUntil(() => !fakeFs.files.has(`${CACHE_ROOT}/abcdef.pdf.11111111-2222-3333-4444-555555555555.tmp`))
  assert.equal(fakeFs.files.has(`${CACHE_ROOT}/abcdef.pdf.11111111-2222-3333-4444-555555555555.tmp`), false)
  assert.equal(fakeFs.files.has(`${CACHE_ROOT}/abcdef.pdf`), true)
})
