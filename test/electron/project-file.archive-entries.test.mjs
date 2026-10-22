import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { stubElectronApp } from '../helpers/electron-app-stub.mjs'
import { loadTsModule } from '../helpers/load-ts-module.mjs'

// archive-service 依赖 electron app（临时目录），先打桩再加载。
stubElectronApp(mkdtempSync(join(tmpdir(), 'archive-entries-userdata-')))

const { MAX_ARCHIVE_ENTRIES, computeArchiveBaseDirectory, copyProjectEntriesToClipboard, encodeClipboardWorkerCommand, packEntriesToZip, resolveEntryRealPaths } = loadTsModule('src/core/electron/main/project-file/archive-service.ts')

function createProjectFixture() {
  const projectPath = mkdtempSync(join(tmpdir(), 'archive-entries-project-'))
  writeFileSync(join(projectPath, 'package.json'), '{}', 'utf8')
  mkdirSync(join(projectPath, 'src', 'utils'), { recursive: true })
  writeFileSync(join(projectPath, 'src', 'index.ts'), 'export const a = 1', 'utf8')
  writeFileSync(join(projectPath, 'src', 'utils', 'helper.ts'), 'export const b = 2', 'utf8')
  mkdirSync(join(projectPath, 'docs'), { recursive: true })
  writeFileSync(join(projectPath, 'docs', 'readme.md'), '# readme', 'utf8')
  mkdirSync(join(projectPath, 'src', 'a', 'b'), { recursive: true })
  writeFileSync(join(projectPath, 'src', 'a', 'b', 'c.txt'), 'nested', 'utf8')
  writeFileSync(join(projectPath, 'src', 'a', 'c.txt'), 'sibling', 'utf8')
  return projectPath
}

test('resolveEntryRealPaths walks the validation chain per entry and rejects traversal or kind mismatch', async () => {
  const projectPath = createProjectFixture()
  try {
    const resolved = await resolveEntryRealPaths(projectPath, [
      { relativePath: 'src\\utils', kind: 'directory' },
      { relativePath: 'package.json', kind: 'file' },
    ])
    assert.deepEqual(
      resolved.map((item) => item.entry.relativePath),
      ['src/utils', 'package.json'],
    )
    assert.equal(resolved[0].realPath, join(projectPath, 'src', 'utils'))
    assert.equal(resolved[1].realPath, join(projectPath, 'package.json'))

    await assert.rejects(() => resolveEntryRealPaths(projectPath, [{ relativePath: '../outside.txt', kind: 'file' }]), /Path traversal/)
    await assert.rejects(() => resolveEntryRealPaths(projectPath, [{ relativePath: 'src', kind: 'file' }]), /not a file/)
    await assert.rejects(() => resolveEntryRealPaths(projectPath, [{ relativePath: 'package.json', kind: 'directory' }]), /not a directory/)
    await assert.rejects(() => resolveEntryRealPaths(projectPath, [{ relativePath: 'src/missing.ts', kind: 'file' }]), /ENOENT|no such file/i)
  } finally {
    rmSync(projectPath, { recursive: true, force: true })
  }
})

test('packEntriesToZip keeps root-level entries at the zip root when the common base is the project root', async () => {
  const projectPath = createProjectFixture()
  const zipPath = join(mkdtempSync(join(tmpdir(), 'archive-entries-zip-')), 'mixed.zip')
  try {
    const resolved = await resolveEntryRealPaths(projectPath, [
      { relativePath: 'package.json', kind: 'file' },
      { relativePath: 'src', kind: 'directory' },
    ])
    await packEntriesToZip(resolved, zipPath)

    const zipBytes = readFileSync(zipPath)
    // zip 本地文件头魔数。
    assert.equal(zipBytes.subarray(0, 4).toString('latin1'), 'PK\u0003\u0004')
    assert.ok(zipBytes.length > 22)
    // zip 条目名以明文存储：文件条目与目录子树（src/**）都应保留项目内相对路径。
    const zipText = zipBytes.toString('latin1')
    assert.ok(zipText.includes('package.json'))
    assert.ok(zipText.includes('src/index.ts'))
    assert.ok(zipText.includes('src/utils/helper.ts'))
  } finally {
    rmSync(projectPath, { recursive: true, force: true })
    rmSync(zipPath, { force: true })
  }
})

test('computeArchiveBaseDirectory returns the longest common parent of all entries', () => {
  // 用户 2026-10-22 修订示例：src/a/b/c.txt + src/a/c → 基准 src/a → zip 内 b/c.txt + c。
  assert.equal(computeArchiveBaseDirectory(['src/a/b/c.txt', 'src/a/c']), 'src/a')
  assert.equal(computeArchiveBaseDirectory(['src/a/b/c.txt', 'src/a/c.txt']), 'src/a')
  // 单选目录：基准为父目录，目录名自身进包（src/utils → utils/**）。
  assert.equal(computeArchiveBaseDirectory(['src/utils']), 'src')
  // 单选文件：基准为父目录，只剩文件名（src/a/b/c.txt → c.txt）。
  assert.equal(computeArchiveBaseDirectory(['src/a/b/c.txt']), 'src/a/b')
  // 顶层混合 / 兄弟目录：基准为项目根。
  assert.equal(computeArchiveBaseDirectory(['a.txt', 'src/b.txt']), '')
  assert.equal(computeArchiveBaseDirectory(['src/utils', 'src/core']), 'src')
  // 目录 + 目录：目录按名进包，基准取二者父目录。
  assert.equal(computeArchiveBaseDirectory(['src/a/b', 'src/a/c']), 'src/a')
  assert.equal(computeArchiveBaseDirectory([]), '')
})

test('packEntriesToZip strips the common base directory and keeps only the nearest tree structure', async () => {
  const projectPath = createProjectFixture()
  const zipPath = join(mkdtempSync(join(tmpdir(), 'archive-entries-base-')), 'stripped.zip')
  try {
    const resolved = await resolveEntryRealPaths(projectPath, [
      { relativePath: 'src/a/b/c.txt', kind: 'file' },
      { relativePath: 'src/a/c.txt', kind: 'file' },
    ])
    await packEntriesToZip(resolved, zipPath)

    const zipText = readFileSync(zipPath).toString('latin1')
    // 公共基准 src/a 之下：b/c.txt 与 c.txt；不再出现 src/a 前缀。
    assert.ok(zipText.includes('b/c.txt'))
    assert.ok(zipText.includes('c.txt'))
    assert.equal(zipText.includes('src/a/b/c.txt'), false)
    assert.equal(zipText.includes('src/a/c.txt'), false)
  } finally {
    rmSync(projectPath, { recursive: true, force: true })
    rmSync(zipPath, { force: true })
  }
})

test('packEntriesToZip keeps a single selected directory name under the common base', async () => {
  const projectPath = createProjectFixture()
  const zipPath = join(mkdtempSync(join(tmpdir(), 'archive-entries-dir-')), 'dir.zip')
  try {
    // 选中目录 + 其子文件：子文件被 prune（此处直接只给目录），zip 内应为 src/a/... 之外的最近结构。
    const resolved = await resolveEntryRealPaths(projectPath, [{ relativePath: 'src/a', kind: 'directory' }])
    await packEntriesToZip(resolved, zipPath)

    const zipText = readFileSync(zipPath).toString('latin1')
    // 基准 = src（目录自身按名进包）：条目为 a/b/c.txt、a/c.txt。
    assert.ok(zipText.includes('a/b/c.txt'))
    assert.ok(zipText.includes('a/c.txt'))
    assert.equal(zipText.includes('src/a'), false)
  } finally {
    rmSync(projectPath, { recursive: true, force: true })
    rmSync(zipPath, { force: true })
  }
})
test('packEntriesToZip rejects and leaves no half-product when the output path is unwritable', async () => {
  const projectPath = createProjectFixture()
  const missingParent = mkdtempSync(join(tmpdir(), 'archive-entries-fail-'))
  // 输出父目录不存在：createWriteStream 立即 ENOENT，走清理路径（不得崩溃、不得留半成品）。
  const zipPath = join(missingParent, 'no-such-dir', 'broken.zip')
  try {
    const resolved = await resolveEntryRealPaths(projectPath, [{ relativePath: 'package.json', kind: 'file' }])
    await assert.rejects(() => packEntriesToZip(resolved, zipPath), /ENOENT|no such file/i)
    assert.equal(existsSync(zipPath), false)
  } finally {
    rmSync(projectPath, { recursive: true, force: true })
    rmSync(missingParent, { recursive: true, force: true })
  }
})

test('copyProjectEntriesToClipboard validates entries before touching the clipboard', async () => {
  const projectPath = createProjectFixture()
  try {
    // 空数组 / 超限在剪贴板写入前抛错（不会触发真实剪贴板副作用）。
    await assert.rejects(() => copyProjectEntriesToClipboard(projectPath, []), /No entries selected/)
    const tooMany = Array.from({ length: MAX_ARCHIVE_ENTRIES + 1 }, (_unused, index) => ({ relativePath: 'f-' + index + '.ts', kind: 'file' }))
    await assert.rejects(() => copyProjectEntriesToClipboard(projectPath, tooMany), new RegExp('Too many entries selected \\(max ' + MAX_ARCHIVE_ENTRIES + '\\)'))
    // 含目录条目：主进程兜底拒绝（渲染层已条件隐藏该场景）。
    await assert.rejects(
      () =>
        copyProjectEntriesToClipboard(projectPath, [
          { relativePath: 'package.json', kind: 'file' },
          { relativePath: 'src', kind: 'directory' },
        ]),
      /only supports file entries/,
    )
    await assert.rejects(() => copyProjectEntriesToClipboard(projectPath, [{ relativePath: '../outside.txt', kind: 'file' }]), /Path traversal/)
  } finally {
    rmSync(projectPath, { recursive: true, force: true })
  }
})

test('encodeClipboardWorkerCommand round-trips multi paths through base64', () => {
  const paths = ['D:\\repo\\a.txt', 'D:\\repo\\中文路径\\b.txt', 'D:/repo/c.txt']
  const decoded = Buffer.from(encodeClipboardWorkerCommand(paths), 'base64').toString('utf-8')
  assert.equal(decoded, paths.join('\n'))
  // 空段过滤语义（worker 与 PowerShell 回退双侧一致）。
  assert.deepEqual(
    decoded.split('\n').filter((item) => item.length > 0),
    paths,
  )
  assert.equal(Buffer.from(encodeClipboardWorkerCommand(['D:\\repo\\a.txt']), 'base64').toString('utf-8'), 'D:\\repo\\a.txt')
})
