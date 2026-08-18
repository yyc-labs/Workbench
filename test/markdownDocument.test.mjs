import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
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
  assert.deepEqual(classifyMarkdownDocumentCompatibility('# note'), { level: 'full', reasons: [] })
  assert.equal(classifyMarkdownDocumentCompatibility('---\ntitle: note\n---\n# note').level, 'normalized')
  assert.equal(classifyMarkdownDocumentCompatibility('<section>note</section>').level, 'source-only')

  const fence = String.fromCharCode(96).repeat(3)
  const repeatedCodeBlocks = Array.from({ length: 101 }, (_, index) => fence + 'js\nconsole.log(' + (index + 1) + ')\n' + fence).join('\n')
  assert.equal(classifyMarkdownDocumentComplexity('# note').level, 'normal')
  assert.equal(classifyMarkdownDocumentComplexity(repeatedCodeBlocks).level, 'reduced')
  assert.equal(classifyMarkdownDocumentComplexity('line\n'.repeat(100_001)).level, 'source-first')
  assert.equal(inferMarkdownDocumentDisplayMode('# note'), 'preview')
  assert.equal(inferMarkdownDocumentDisplayMode('<section>note</section>'), 'preview')
})
