import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { stubElectronApp } from '../helpers/electron-app-stub.mjs'
import { loadTsModule } from '../helpers/load-ts-module.mjs'

// tree-service reads config for file exclusions, which touches
// `app.getPath('userData')` — stub electron before the module graph loads.
stubElectronApp(mkdtempSync(join(tmpdir(), 'project-file-electron-')))

const { getProjectFileAutoLoadDecision, listProjectDirectoryFiles, listProjectFiles } = loadTsModule('src/core/electron/main/project-file/tree-service.ts')

test('listProjectFiles keeps directories lazy without probing descendants', async () => {
  const projectPath = mkdtempSync(join(tmpdir(), 'project-file-tree-'))
  mkdirSync(join(projectPath, 'empty-dir'))
  mkdirSync(join(projectPath, 'nested-dir', 'child'), { recursive: true })
  writeFileSync(join(projectPath, 'nested-dir', 'child', 'index.ts'), 'export {}', 'utf8')

  const tree = await listProjectFiles(projectPath)
  const emptyDir = tree.nodes.find((node) => node.relativePath === 'empty-dir')
  const nestedDir = tree.nodes.find((node) => node.relativePath === 'nested-dir')

  assert.equal(tree.directoryRelativePath, null)
  assert.equal(emptyDir?.kind, 'directory')
  assert.equal(emptyDir?.isLoaded, false)
  assert.equal(emptyDir?.hasChildren, true)
  assert.equal(nestedDir?.kind, 'directory')
  assert.equal(nestedDir?.isLoaded, false)
  assert.equal(nestedDir?.hasChildren, true)

  const emptyDirChildren = await listProjectDirectoryFiles(projectPath, 'empty-dir')
  assert.deepEqual(emptyDirChildren.nodes, [])
})

test('getProjectFileAutoLoadDecision disables auto-load for large projects', async () => {
  const projectPath = mkdtempSync(join(tmpdir(), 'project-file-autoload-'))
  for (let index = 0; index <= 4000; index += 1) {
    writeFileSync(join(projectPath, `file-${index}.ts`), 'export {}', 'utf8')
  }

  const decision = await getProjectFileAutoLoadDecision(projectPath)
  assert.equal(decision.shouldAutoLoad, false)
  assert.equal(decision.reason, 'large-project')
  assert.equal(decision.limit, 4000)
  assert.ok(decision.fileCountSample > decision.limit)
})

test('getProjectFileAutoLoadDecision keeps auto-load for small projects', async () => {
  const projectPath = mkdtempSync(join(tmpdir(), 'project-file-autoload-small-'))
  writeFileSync(join(projectPath, 'index.ts'), 'export {}', 'utf8')
  writeFileSync(join(projectPath, 'README.md'), '# demo', 'utf8')

  const decision = await getProjectFileAutoLoadDecision(projectPath)
  assert.equal(decision.shouldAutoLoad, true)
  assert.equal(decision.reason, 'ok')
  assert.equal(decision.fileCountSample, 2)
})

test('getProjectFileAutoLoadDecision rescans after cache TTL expiry', async () => {
  const projectPath = mkdtempSync(join(tmpdir(), 'project-file-autoload-ttl-'))
  writeFileSync(join(projectPath, 'index.ts'), 'export {}', 'utf8')

  const first = await getProjectFileAutoLoadDecision(projectPath)
  assert.equal(first.fileCountSample, 1)

  // 缓存 TTL 内的第二次决策应命中缓存，看不到新增文件。
  writeFileSync(join(projectPath, 'extra.ts'), 'export {}', 'utf8')
  const cached = await getProjectFileAutoLoadDecision(projectPath)
  assert.equal(cached.fileCountSample, 1)

  // 快进系统时间越过 TTL（PROJECT_FILE_LIST_CACHE_TTL_MS = 15s）后应重新扫描。
  const realNow = Date.now
  try {
    Date.now = () => realNow() + 20_000
    const rescanned = await getProjectFileAutoLoadDecision(projectPath)
    assert.equal(rescanned.fileCountSample, 2)
  } finally {
    Date.now = realNow
  }
})
