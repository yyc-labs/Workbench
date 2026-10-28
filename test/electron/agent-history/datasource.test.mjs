import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { loadTsModule } from '../../helpers/load-ts-module.mjs'

const localFsMod = loadTsModule('src/core/electron/main/agent-history/datasource/local-fs.ts')
const wslMod = loadTsModule('src/core/electron/main/agent-history/datasource/wsl.ts')
const registryMod = loadTsModule('src/core/electron/main/agent-history/datasource/registry.ts')
const discoveryMod = loadTsModule('src/core/electron/main/agent-history/file-discovery.ts')

function makeTempRoot() {
  return mkdtempSync(join(tmpdir(), 'agent-history-ds-'))
}

// ---------- local-fs ----------

test('local-fs: list/stat/readRange/openRead behave on real files', async () => {
  const root = makeTempRoot()
  const dir = join(root, 'bucket')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'a.jsonl'), 'line1\nline2\n')
  writeFileSync(join(dir, 'b.txt'), 'ignored')
  const ds = localFsMod.createLocalFsDataSource()

  const entries = await ds.list(dir)
  assert.equal(entries.length, 2)
  assert.ok(entries.find((e) => e.name === 'a.jsonl' && e.isFile))
  assert.ok(entries.find((e) => e.name === 'b.txt' && e.isFile))

  const stat = await ds.stat(join(dir, 'a.jsonl'))
  assert.equal(stat.sizeBytes, 12)
  assert.ok(Number.isFinite(stat.mtimeMs))
  assert.equal(await ds.stat(join(dir, 'missing.jsonl')), null)

  const head = await ds.readRange(join(dir, 'a.jsonl'), 0, 5)
  assert.equal(head.toString('utf8'), 'line1')
  // clamped beyond EOF
  const tail = await ds.readRange(join(dir, 'a.jsonl'), 100, 10)
  assert.equal(tail.length, 0)

  const stream = await ds.openRead(join(dir, 'a.jsonl'))
  const chunks = []
  for await (const c of stream) chunks.push(c)
  assert.equal(chunks.join(''), 'line1\nline2\n')

  assert.equal(ds.id, 'local-fs')
  assert.equal(ds.namespaceId, 'win32')
  assert.equal(ds.supportsWatch, true)
  assert.equal(typeof ds.watch, 'function')
})

test('local-fs: zero-byte file stat works and readRange returns empty', async () => {
  const root = makeTempRoot()
  const file = join(root, 'empty.jsonl')
  writeFileSync(file, '')
  const ds = localFsMod.createLocalFsDataSource()
  const stat = await ds.stat(file)
  assert.equal(stat.sizeBytes, 0)
  assert.equal((await ds.readRange(file, 0, 4096)).length, 0)
})

// ---------- wsl path translation (pure) ----------

test('wsl: toWslUncPath translates posix paths per distro', () => {
  const { toWslUncPath } = wslMod
  assert.equal(toWslUncPath('Ubuntu', '/home/ubuntu/.claude/projects'), '\\\\wsl.localhost\\Ubuntu\\home\\ubuntu\\.claude\\projects')
  assert.equal(toWslUncPath('ubuntu-22.04', '/home/u'), '\\\\wsl.localhost\\ubuntu-22.04\\home\\u')
  assert.equal(toWslUncPath('Ubuntu', '/'), '\\\\wsl.localhost\\Ubuntu')
  assert.equal(toWslUncPath('', '/x'), '\\\\wsl.localhost\\Ubuntu\\x')
})

test('wsl source: namespace, watch unsupported, homeDir probe (real wsl.exe when available)', async () => {
  const ds = wslMod.createWslDataSource({ distro: 'Ubuntu' })
  assert.equal(ds.id, 'wsl')
  assert.equal(ds.namespaceId, 'wsl:ubuntu')
  assert.equal(ds.supportsWatch, false)
  assert.equal(ds.watch, undefined)
  // UNC translation flows through toNativePath: stat on the UNC projects root
  // must hit the same bytes as the direct UNC path (stage 0 verified reachable).
  const unc = wslMod.toWslUncPath('Ubuntu', '/home/ubuntu/.claude/projects')
  assert.ok(unc.startsWith('\\\\wsl.localhost\\Ubuntu\\'))
  // Home probe: only assert the contract (string or null), never a specific user.
  const home = await ds.homeDir()
  assert.ok(home === null || home.startsWith('/'))
})

// ---------- registry routing ----------

test('registry: windows context → local-fs, wsl context → per-distro wsl source (cached)', () => {
  const registry = registryMod.createAgentHistoryDataSourceRegistry()
  const win = { projectId: 'p1', nativePath: 'D:\\work', executionEnvironment: 'windows' }
  const wsl = { projectId: 'p2', nativePath: '\\\\wsl.localhost\\Ubuntu\\home\\u', executionEnvironment: 'wsl', wslDistro: 'Ubuntu', posixPath: '/home/u' }
  const wslAlt = { projectId: 'p3', nativePath: '/home/u2', executionEnvironment: 'wsl', posixPath: '/home/u2' }

  const a = registry.getFor(win)
  const b = registry.getFor(win)
  assert.equal(a, b)
  assert.equal(a.id, 'local-fs')

  const c = registry.getFor(wsl)
  const d = registry.getFor({ ...wsl, projectId: 'p2b' })
  assert.equal(c, d)
  assert.equal(c.id, 'wsl')
  assert.equal(c.namespaceId, 'wsl:ubuntu')
  assert.notEqual(a, c)

  // Missing distro on a plain-linux project → default distro ('Ubuntu')
  const e = registry.getFor(wslAlt)
  assert.equal(e.namespaceId, 'wsl:ubuntu')

  const custom = registryMod.createAgentHistoryDataSourceRegistry({ getDefaultWslDistro: () => 'Debian' })
  assert.equal(custom.getFor(wslAlt).namespaceId, 'wsl:debian')
})

// ---------- traversal layered on a data source ----------

test('file-discovery over a data source: recursion, truncation, symlink skip, zero-byte skip', async () => {
  const root = makeTempRoot()
  const inner = join(root, 'sessions', '2026', '10')
  mkdirSync(inner, { recursive: true })
  writeFileSync(join(inner, 'a.jsonl'), 'x')
  writeFileSync(join(root, 'sessions', 'b.jsonl'), 'x')
  writeFileSync(join(root, 'sessions', 'empty.jsonl'), '')
  writeFileSync(join(root, 'sessions', 'note.txt'), 'x')
  const outside = join(root, 'outside.jsonl')
  writeFileSync(outside, 'x')
  try {
    symlinkSync(outside, join(inner, 'link.jsonl'), 'file')
  } catch {
    // Windows without symlink privilege: skip the link assertions.
  }
  const ds = localFsMod.createLocalFsDataSource()

  const flat = await discoveryMod.listJsonlSessionFiles(ds, join(root, 'sessions'), { maxFiles: 100 })
  assert.equal(flat.files.length, 1)
  assert.equal(flat.truncated, false)

  const recursive = await discoveryMod.listJsonlSessionFiles(ds, join(root, 'sessions'), { maxFiles: 100, recursive: true })
  assert.equal(recursive.files.length, 2)

  const truncated = await discoveryMod.listJsonlSessionFiles(ds, join(root, 'sessions'), { maxFiles: 1, recursive: true })
  assert.equal(truncated.files.length, 1)
  assert.equal(truncated.truncated, true)

  // Missing dir yields an empty listing without error.
  const missing = await discoveryMod.listJsonlSessionFiles(ds, join(root, 'nope'), { maxFiles: 10, recursive: true })
  assert.deepEqual(missing.files, [])
})

// ---------- architecture assertion: providers never import node:fs ----------

test('architecture: agent-history providers contain no direct node:fs access', async () => {
  const { readFileSync } = await import('node:fs')
  const { resolve } = await import('node:path')
  const repoRoot = resolve(import.meta.dirname, '../../..')
  const files = ['src/core/electron/main/agent-history/providers/claude/provider.ts', 'src/core/electron/main/agent-history/providers/codebuddy/provider.ts', 'src/core/electron/main/agent-history/providers/codex/provider.ts', 'src/core/electron/main/agent-history/providers/shared/jsonl-parser.ts']
  for (const rel of files) {
    const src = readFileSync(resolve(repoRoot, rel), 'utf8')
    assert.ok(!/from 'node:fs'/.test(src) && !/from 'node:fs\/promises'/.test(src) && !/require\('node:fs'\)/.test(src), rel + ' must not touch node:fs directly (plan 20 D7)')
    assert.ok(!/createReadStream/.test(src), rel + ' must not create streams directly')
  }
})
