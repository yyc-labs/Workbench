import assert from 'node:assert/strict'
import test from 'node:test'

import { loadTsModule } from '../helpers/load-ts-module.mjs'

const { resolveProjectDocLinks } = loadTsModule('src/core/shared/projectDocLinks.ts')

function makeLink(id, groupId, title) {
  return {
    id,
    groupId,
    title,
    kind: 'url',
    url: `https://example.com/${id}`,
    createdAt: 1,
  }
}

test('resolveProjectDocLinks 返回私有列表原序（无订阅）', () => {
  const resolved = resolveProjectDocLinks(
    {
      docLinks: [
        { id: 'p1', title: 'private-1' },
        { id: 'p2', title: 'private-2' },
      ],
    },
    { groups: [{ id: 'g1', name: 'G1', sortOrder: 1 }], links: [makeLink('s1', 'g1', 'shared-1')] },
  )

  assert.deepEqual(
    resolved.map((link) => [link.id, link.source]),
    [
      ['p1', 'private'],
      ['p2', 'private'],
    ],
  )
})

test('resolveProjectDocLinks 订阅两组时按 sortOrder 排序、组内保序', () => {
  const resolved = resolveProjectDocLinks(
    { docLinks: [{ id: 'p1', title: 'private-1' }], sharedDocLinkGroupIds: ['g2', 'g1'] },
    {
      groups: [
        { id: 'g1', name: 'G1', sortOrder: 2 },
        { id: 'g2', name: 'G2', sortOrder: 1 },
      ],
      links: [makeLink('s1', 'g1', 'shared-1'), makeLink('s2', 'g2', 'shared-2'), makeLink('s3', 'g1', 'shared-3')],
    },
  )

  assert.deepEqual(
    resolved.map((link) => [link.id, link.source, link.sharedGroupId]),
    [
      ['p1', 'private', undefined],
      ['s2', 'shared', 'g2'],
      ['s1', 'shared', 'g1'],
      ['s3', 'shared', 'g1'],
    ],
  )
})

test('resolveProjectDocLinks 订阅组已删除 / 组内链接被删时静默忽略', () => {
  const resolved = resolveProjectDocLinks(
    { docLinks: [], sharedDocLinkGroupIds: ['g1', 'g-missing'] },
    {
      groups: [{ id: 'g1', name: 'G1', sortOrder: 1 }],
      links: [makeLink('s1', 'g1', 'shared-1')],
    },
  )

  assert.deepEqual(
    resolved.map((link) => link.id),
    ['s1'],
  )
})

test('resolveProjectDocLinks 私有为空、仅有共享时列表非空', () => {
  const resolved = resolveProjectDocLinks({ docLinks: [], sharedDocLinkGroupIds: ['g1'] }, { groups: [{ id: 'g1', name: 'G1', sortOrder: 1 }], links: [makeLink('s1', 'g1', 'shared-1')] })

  assert.equal(resolved.length, 1)
  assert.equal(resolved[0].source, 'shared')
  // 默认链接语义只从私有取：renderer 层 docLinks.find((link) => link.source === 'private') 为 undefined
  assert.equal(
    resolved.find((link) => link.source === 'private'),
    undefined,
  )
})

test('resolveProjectDocLinks 重复订阅同一组不重复出现', () => {
  const resolved = resolveProjectDocLinks({ docLinks: [], sharedDocLinkGroupIds: ['g1', 'g1'] }, { groups: [{ id: 'g1', name: 'G1', sortOrder: 1 }], links: [makeLink('s1', 'g1', 'shared-1')] })

  assert.deepEqual(
    resolved.map((link) => link.id),
    ['s1'],
  )
})

test('resolveProjectDocLinks 共享与私有目标严格一致时去重（私有保留）', () => {
  const resolved = resolveProjectDocLinks(
    { docLinks: [{ id: 'p1', title: 'docs', kind: 'url', url: 'https://example.com/docs' }], sharedDocLinkGroupIds: ['g1'] },
    {
      groups: [{ id: 'g1', name: 'G1', sortOrder: 1 }],
      links: [
        { id: 's1', groupId: 'g1', title: 'docs（共享）', kind: 'url', url: 'https://example.com/docs', createdAt: 1 },
        { id: 's2', groupId: 'g1', title: 'other', kind: 'url', url: 'https://example.com/other', createdAt: 1 },
      ],
    },
  )

  assert.deepEqual(
    resolved.map((link) => [link.id, link.source]),
    [
      ['p1', 'private'],
      ['s2', 'shared'],
    ],
  )
})

test('resolveProjectDocLinks 去重忽略 URL 大小写差异', () => {
  const resolved = resolveProjectDocLinks(
    { docLinks: [{ id: 'p1', title: 'docs', kind: 'url', url: 'https://Example.com/Docs' }], sharedDocLinkGroupIds: ['g1'] },
    { groups: [{ id: 'g1', name: 'G1', sortOrder: 1 }], links: [{ id: 's1', groupId: 'g1', title: 'docs', kind: 'url', url: 'https://example.com/docs', createdAt: 1 }] },
  )

  assert.deepEqual(
    resolved.map((link) => link.id),
    ['p1'],
  )
})

test('resolveProjectDocLinks SSH 按 用户名@主机:端口 严格一致去重', () => {
  const resolved = resolveProjectDocLinks(
    {
      docLinks: [{ id: 'p1', title: 'box', kind: 'ssh', sshHost: '10.0.0.1', sshPort: 22, sshUsername: 'root', account: 'root' }],
      sharedDocLinkGroupIds: ['g1'],
    },
    {
      groups: [{ id: 'g1', name: 'G1', sortOrder: 1 }],
      links: [
        { id: 's1', groupId: 'g1', title: 'box', kind: 'ssh', sshHost: '10.0.0.1', sshPort: 22, sshUsername: 'root', createdAt: 1 },
        { id: 's2', groupId: 'g1', title: 'box', kind: 'ssh', sshHost: '10.0.0.1', sshPort: 2222, sshUsername: 'root', createdAt: 1 },
      ],
    },
  )

  assert.deepEqual(
    resolved.map((link) => link.id),
    ['p1', 's2'],
  )
})

test('resolveProjectDocLinks 同一目标跨订阅组只展示第一条', () => {
  const resolved = resolveProjectDocLinks(
    { docLinks: [], sharedDocLinkGroupIds: ['g1', 'g2'] },
    {
      groups: [
        { id: 'g1', name: 'G1', sortOrder: 1 },
        { id: 'g2', name: 'G2', sortOrder: 2 },
      ],
      links: [
        { id: 's1', groupId: 'g1', title: 'docs', kind: 'url', url: 'https://example.com/docs', createdAt: 1 },
        { id: 's2', groupId: 'g2', title: 'docs（另一组）', kind: 'url', url: 'https://example.com/docs', createdAt: 1 },
      ],
    },
  )

  assert.deepEqual(
    resolved.map((link) => [link.id, link.sharedGroupId]),
    [['s1', 'g1']],
  )
})
