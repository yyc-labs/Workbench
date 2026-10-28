import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTsModule } from '../helpers/load-ts-module.mjs'

const { extractFilePathCandidates, resolveCandidateRelativePath, inlineMessageFileLinks } = loadTsModule('src/core/renderer/lib/agentHistoryFileLinks.ts')

test('提取项目相对路径候选', () => {
  assert.deepEqual(extractFilePathCandidates('修改了 src/lib/foo.ts 和 docs/guide.md'), ['src/lib/foo.ts', 'docs/guide.md'])
})

test('提取 Windows 绝对路径候选', () => {
  assert.deepEqual(extractFilePathCandidates('见 D:\\tools\\ide-electron\\src\\index.ts 的实现'), ['D:\\tools\\ide-electron\\src\\index.ts'])
})

test('跳过代码块与行内代码中的路径', () => {
  assert.deepEqual(extractFilePathCandidates('运行 `npm run build` 后看：\n```\nsrc/hidden/inside.ts\n```'), [])
  assert.deepEqual(extractFilePathCandidates('参考 `src/inside/code.ts` 即可'), [])
})

test('过滤 URL 与无扩展名片段', () => {
  assert.deepEqual(extractFilePathCandidates('访问 https://example.com/a.png 或查看 src 目录'), [])
})

test('清理路径首尾标点', () => {
  assert.deepEqual(extractFilePathCandidates('文件是 (src/a/b.ts)，好的。'), ['src/a/b.ts'])
  assert.deepEqual(extractFilePathCandidates('入口是 **src/main/index.ts**。'), ['src/main/index.ts'])
})

test('绝对路径仅项目内转为相对路径', () => {
  assert.equal(resolveCandidateRelativePath('D:\\proj', 'D:\\proj\\src\\a.ts'), 'src/a.ts')
  assert.equal(resolveCandidateRelativePath('D:\\proj', 'D:\\other\\a.ts'), null)
  assert.equal(resolveCandidateRelativePath('D:\\proj', 'src/a.ts'), 'src/a.ts')
})

test('已验证路径内联为 session-file 链接，代码区域保持原样', () => {
  const resolved = new Map([['src/lib/foo.ts', 'src/lib/foo.ts']])
  const inlined = inlineMessageFileLinks('改好了 src/lib/foo.ts，见：\n```\nsrc/lib/foo.ts\n```', resolved)
  assert.equal(inlined, '改好了 [src/lib/foo.ts](session-file://src%2Flib%2Ffoo.ts)，见：\n```\nsrc/lib/foo.ts\n```')
})

test('未验证路径保持原文本', () => {
  const resolved = new Map([['src/exists/a.ts', 'src/exists/a.ts']])
  const inlined = inlineMessageFileLinks('src/missing/b.ts 与 src/exists/a.ts', resolved)
  assert.equal(inlined, 'src/missing/b.ts 与 [src/exists/a.ts](session-file://src%2Fexists%2Fa.ts)')
})

test('Markdown 链接整体替换为 session-file 链接，不残留中括号小括号', () => {
  const resolved = new Map([['src/core/renderer/pages/sessions/SessionRow.tsx', 'src/core/renderer/pages/sessions/SessionRow.tsx']])
  const inlined = inlineMessageFileLinks('改动在 [SessionRow.tsx](src/core/renderer/pages/sessions/SessionRow.tsx) 里', resolved)
  assert.equal(inlined, '改动在 [SessionRow.tsx](session-file://src%2Fcore%2Frenderer%2Fpages%2Fsessions%2FSessionRow.tsx) 里')
})

test('链接目标未验证时保持 Markdown 原样', () => {
  const resolved = new Map([['src/exists/a.ts', 'src/exists/a.ts']])
  const inlined = inlineMessageFileLinks('看 [other.tsx](src/missing/b.tsx) 与 [exists.ts](src/exists/a.ts)', resolved)
  assert.equal(inlined, '看 [other.tsx](src/missing/b.tsx) 与 [exists.ts](session-file://src%2Fexists%2Fa.ts)')
})
