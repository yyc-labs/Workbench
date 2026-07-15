import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTsModule } from '../helpers/load-ts-module.mjs'

const { isValidGitBranchName, normalizeGitOperationRequest, normalizeGitRemoteName } = loadTsModule('src/core/electron/main/git/git-operation-request.ts')

test('normalizeGitOperationRequest trims repo and target branch and defaults remote name', () => {
  assert.deepEqual(
    normalizeGitOperationRequest({
      repoRoot: '  /repo/project  ',
      operation: 'create-local-branch',
      targetBranch: '  feature/test  ',
      remoteName: '   ',
    }),
    {
      repoRoot: '/repo/project',
      operation: 'create-local-branch',
      targetBranch: 'feature/test',
      remoteName: 'origin',
    },
  )

  assert.deepEqual(
    normalizeGitOperationRequest({
      repoRoot: ' /repo/project ',
      operation: 'fetch',
      targetBranch: '   ',
      remoteName: ' upstream ',
    }),
    {
      repoRoot: '/repo/project',
      operation: 'fetch',
      targetBranch: undefined,
      remoteName: 'upstream',
    },
  )
})

test('normalizeGitOperationRequest preserves a trimmed commit message', () => {
  assert.deepEqual(
    normalizeGitOperationRequest({
      repoRoot: ' /repo/project ',
      operation: 'commit',
      message: '  feat: add staged commit action\n\n- keep the body  ',
    }),
    {
      repoRoot: '/repo/project',
      operation: 'commit',
      message: 'feat: add staged commit action\n\n- keep the body',
      remoteName: 'origin',
      targetBranch: undefined,
    },
  )
})

test('normalizeGitRemoteName falls back to origin for empty remote names', () => {
  assert.equal(normalizeGitRemoteName(undefined), 'origin')
  assert.equal(normalizeGitRemoteName('   '), 'origin')
  assert.equal(normalizeGitRemoteName(' upstream '), 'upstream')
})

test('isValidGitBranchName accepts git branch paths and rejects unsafe refs', () => {
  assert.equal(isValidGitBranchName('feature/transcript-tests'), true)
  assert.equal(isValidGitBranchName('release/2026.06'), true)

  for (const branchName of ['', '/feature', 'feature/', 'feature//x', 'feature\\x', 'feature..x', 'feature@{x', 'feature.lock', 'feature x', 'feature:x', '.hidden', 'feature/.hidden', 'feature/trailing.']) {
    assert.equal(isValidGitBranchName(branchName), false, branchName)
  }
})
