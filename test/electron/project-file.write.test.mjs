import assert from 'node:assert/strict'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { stubElectronApp } from '../helpers/electron-app-stub.mjs'
import { loadTsModule } from '../helpers/load-ts-module.mjs'

// read-write-service 依赖 electron（shell）；writeProjectFile 本身不触碰 shell，stub 掉即可加载。
const scratchRoot = mkdtempSync(join(tmpdir(), 'wb-project-file-write-'))
stubElectronApp(scratchRoot)

const { writeProjectFile } = loadTsModule('src/core/electron/main/project-file/read-write-service.ts')

function makeProject() {
  const projectPath = mkdtempSync(join(tmpdir(), 'wb-project-file-write-case-'))
  mkdirSync(join(projectPath, 'docs'), { recursive: true })
  const filePath = join(projectPath, 'docs', 'note.md')
  writeFileSync(filePath, 'original content', 'utf-8')
  return { projectPath, filePath }
}

test('writeProjectFile 正常写入并返回 size / mtime', async () => {
  const { projectPath, filePath } = makeProject()
  try {
    const result = await writeProjectFile(projectPath, 'docs/note.md', 'updated content')
    assert.equal(result.relativePath, 'docs/note.md')
    assert.equal(result.size, Buffer.byteLength('updated content', 'utf-8'))
    assert.ok(result.mtimeMs > 0)
  } finally {
    rmSync(projectPath, { recursive: true, force: true })
  }
})

test('writeProjectFile 命中只读文件时报可读提示而非裸 EPERM', async () => {
  const { projectPath, filePath } = makeProject()
  try {
    // Windows 上 0o444 映射为只读属性；POSIX 上为权限位，写打开同样被拒。
    chmodSync(filePath, 0o444)
    await assert.rejects(
      () => writeProjectFile(projectPath, 'docs/note.md', 'should fail'),
      (error) => {
        assert.equal(error instanceof Error, true)
        assert.match(error.message, /read-only/)
        assert.doesNotMatch(error.message, /^EPERM:/)
        return true
      },
    )
  } finally {
    chmodSync(filePath, 0o666)
    rmSync(projectPath, { recursive: true, force: true })
  }
})
