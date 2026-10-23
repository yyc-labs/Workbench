import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTsModule } from '../helpers/load-ts-module.mjs'

const { parseGitForEachRefBranches } = loadTsModule('src/core/electron/main/git/git-snapshot.ts')

function refRecord(refname, upstream = '', head = '') {
  return `${refname}\x00${'a'.repeat(40)}\x00${upstream}\x00${head}\x1e`
}

test('解析本地与远程分支并过滤 /HEAD', () => {
  const raw = [refRecord('refs/heads/main', 'origin/main', '*'), refRecord('refs/heads/feature/x'), refRecord('refs/remotes/origin/main'), refRecord('refs/remotes/origin/HEAD'), refRecord('refs/remotes/upstream/release-1')].join('')
  const { localBranches, remoteBranches } = parseGitForEachRefBranches(raw)
  assert.deepEqual(localBranches, ['main', 'feature/x'])
  assert.deepEqual(remoteBranches, ['origin/main', 'upstream/release-1'])
})

test('包含空格与非 ASCII 分支名', () => {
  const raw = [refRecord('refs/heads/feature/fix bug'), refRecord('refs/heads/feature/中文分支'), refRecord('refs/remotes/origin/中文 分支')].join('')
  const { localBranches, remoteBranches } = parseGitForEachRefBranches(raw)
  assert.deepEqual(localBranches, ['feature/fix bug', 'feature/中文分支'])
  assert.deepEqual(remoteBranches, ['origin/中文 分支'])
})

test('空输出与非 refs 记录', () => {
  assert.deepEqual(parseGitForEachRefBranches(''), { localBranches: [], remoteBranches: [] })
  const raw = [refRecord('refs/tags/v1.0'), refRecord('refs/stash'), refRecord('')].join('')
  assert.deepEqual(parseGitForEachRefBranches(raw), { localBranches: [], remoteBranches: [] })
})

test('本地与远程分别 500 条截断，远程在截断后过滤 /HEAD', () => {
  const locals = Array.from({ length: 510 }, (_, i) => refRecord(`refs/heads/b${String(i).padStart(3, '0')}`))
  const remotes = Array.from({ length: 505 }, (_, i) => refRecord(`refs/remotes/origin/r${String(i).padStart(3, '0')}`))
  remotes.push(refRecord('refs/remotes/origin/HEAD'))
  const { localBranches, remoteBranches } = parseGitForEachRefBranches([...locals, ...remotes].join(''))
  assert.equal(localBranches.length, 500)
  assert.equal(localBranches[0], 'b000')
  assert.equal(localBranches[499], 'b499')
  assert.equal(remoteBranches.length, 500)
  assert.ok(!remoteBranches.some((name) => name.endsWith('/HEAD')))
})
