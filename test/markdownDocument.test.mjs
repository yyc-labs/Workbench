import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { loadTsModule } from './helpers/load-ts-module.mjs'

const { parseMarkdownDocumentOpenRequest, MarkdownDocumentOpenRequestStore } = loadTsModule('src/core/electron/main/markdown-document/markdownDocumentOpenRequest.ts')
const { MarkdownDocumentRepository } = loadTsModule('src/core/electron/main/markdown-document/markdownDocumentRepository.ts')
const { classifyMarkdownDocumentCompatibility, classifyMarkdownDocumentComplexity, inferMarkdownDocumentDisplayMode } = loadTsModule('src/core/renderer/pages/markdown-document/markdownDocumentCapabilities.ts')

test('parses the last existing markdown argv candidate', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'markdown-test-'))
  const first = path.join(root, '中文 first.MD')
  const second = path.join(root, 'second.markdown')
  await writeFile(first, '# first')
  await writeFile(second, '# second')
  assert.equal(parseMarkdownDocumentOpenRequest(['electron.exe', '--hidden', first, second]), path.resolve(second))
})

test('consumes pending requests once', async () => {
  const store = new MarkdownDocumentOpenRequestStore()
  const root = await mkdtemp(path.join(os.tmpdir(), 'markdown-pending-'))
  const filePath = path.join(root, 'pending-note.md')
  await writeFile(filePath, '# pending')
  store.setFromArgv([filePath])
  assert.deepEqual(store.consume(), { path: filePath })
  assert.equal(store.consume(), null)
})

test('repository trims history', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'markdown-history-'))
  const repository = new MarkdownDocumentRepository(root)
  for (let index = 0; index < 52; index += 1) {
    const filePath = 'C:\\docs\\' + index + '.md'
    await repository.record({ path: filePath, normalizedPath: filePath.toLowerCase(), displayName: index + '.md', lastOpenedAt: index })
  }
  const history = await repository.list()
  assert.equal(history.length, 50)
  assert.equal(history[0].displayName, '51.md')
})

test('classifies markdown compatibility and complexity', () => {
  const fence = String.fromCharCode(96).repeat(3)
  assert.deepEqual(classifyMarkdownDocumentCompatibility('# note'), { level: 'full', reasons: [] })
  // frontmatter 不再参与兼容性判定：富文本模式原样保留 frontmatter，正文与元信息分离编辑。
  assert.deepEqual(classifyMarkdownDocumentCompatibility('---\ntitle: note\n---\n# note'), { level: 'full', reasons: [] })
  // normalized 级：混合围栏（``` 与 ~~~ 共存）需要归一化，但不降级到 source-only。
  assert.deepEqual(classifyMarkdownDocumentCompatibility(`${fence}js\ncode\n${fence}\n\n~~~js\ncode\n~~~`), { level: 'normalized', reasons: ['mixed-fences'] })
  assert.equal(classifyMarkdownDocumentCompatibility('<section>note</section>').level, 'source-only')

  const repeatedCodeBlocks = Array.from({ length: 101 }, (_, index) => fence + 'js\nconsole.log(' + (index + 1) + ')\n' + fence).join('\n')
  assert.equal(classifyMarkdownDocumentComplexity('# note').level, 'normal')
  assert.equal(classifyMarkdownDocumentComplexity(repeatedCodeBlocks).level, 'reduced')
  assert.equal(classifyMarkdownDocumentComplexity('line\n'.repeat(100_001)).level, 'source-first')
  assert.equal(inferMarkdownDocumentDisplayMode('# note'), 'preview')
  assert.equal(inferMarkdownDocumentDisplayMode('<section>note</section>'), 'preview')
})
