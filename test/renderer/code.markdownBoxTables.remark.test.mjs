import assert from 'node:assert/strict'
import test from 'node:test'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import { loadTsModule } from '../helpers/load-ts-module.mjs'

const { remarkBoxDrawingTables } = loadTsModule('src/core/renderer/pages/code/code.markdownBoxTables.ts')

test('remarkBoxDrawingTables transforms indented code-block box tables into markdown tables', async () => {
  const source = [
    '# getAi4sDevUrl(relativePath) 的所有入参',
    '',
    '    ┌───┬──────────────────────────────────────────────────┬────────────────────────────────────────────────────────────┐',
    '    │   │ 入参 relativePath                                │ 使用组件                                                   │',
    '    ├───┼──────────────────────────────────────────────────┼────────────────────────────────────────────────────────────┤',
    '    │ 1 │ GaLKQioiGjnofR4X3HjwrN_anarci_api_smoke.fasta    │ ANARCIInference                                            │',
    '    │ 2 │ data/ESM-IF1/5YH2.pdb                            │ ESMIF1Inference                                            │',
    '    │ 3 │ data/ESM-IF1/5YH2_mutated_seqs.fasta             │ ESMIF1Inference                                            │',
    '    │ 4 │ V7f5PkhoqMsttG6kmCxCC9_5YH2_mutated_seqs.fasta   │ ESMIF1Inference                                            │',
    '    │ 5 │ PuzTaNFb4mxWfcgHrKoTpJ_some_proteins_small.fasta │ ESMFoldInference (用2次)                                   │',
    '    │ 6 │ data/Freesasa/1ubq.pdb                           │ FreeSASAInference                                          │',
    '    │ 7 │ 动态变量 trimmed（用户输入的 URL，非字面量）     │ AlphaFold3Inference / Boltz2Inference (ensureFullUrl 函数) │',
    '    └───┴──────────────────────────────────────────────────┴────────────────────────────────────────────────────────────┘',
  ].join('\n')

  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkBoxDrawingTables)

  const tree = processor.parse(source)
  await processor.run(tree, { value: source })

  assert.equal(tree.children[1]?.type, 'table')
  assert.deepEqual(tree.children[1]?.children?.map((row) => (
    row.children?.map((cell) => (
      cell.children?.map((child) => child.value ?? '').join('') ?? ''
    )) ?? []
  )), [
    ['', '入参 relativePath', '使用组件'],
    ['1', 'GaLKQioiGjnofR4X3HjwrN_anarci_api_smoke.fasta', 'ANARCIInference'],
    ['2', 'data/ESM-IF1/5YH2.pdb', 'ESMIF1Inference'],
    ['3', 'data/ESM-IF1/5YH2_mutated_seqs.fasta', 'ESMIF1Inference'],
    ['4', 'V7f5PkhoqMsttG6kmCxCC9_5YH2_mutated_seqs.fasta', 'ESMIF1Inference'],
    ['5', 'PuzTaNFb4mxWfcgHrKoTpJ_some_proteins_small.fasta', 'ESMFoldInference (用2次)'],
    ['6', 'data/Freesasa/1ubq.pdb', 'FreeSASAInference'],
    ['7', '动态变量 trimmed（用户输入的 URL，非字面量）', 'AlphaFold3Inference / Boltz2Inference (ensureFullUrl 函数)'],
  ])
})
