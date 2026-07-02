import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTsModule } from '../helpers/load-ts-module.mjs'

const {
  findDirectoryNode,
  replaceDirectoryNodes,
} = loadTsModule('src/core/renderer/pages/code/code.tree.ts')

function directory(relativePath, children) {
  const segments = relativePath.split('/')
  return {
    name: segments[segments.length - 1],
    relativePath,
    kind: 'directory',
    hasChildren: true,
    isLoaded: Boolean(children),
    ...(children ? { children } : {}),
  }
}

function file(relativePath) {
  const segments = relativePath.split('/')
  return {
    name: segments[segments.length - 1],
    relativePath,
    kind: 'file',
  }
}

test('replaceDirectoryNodes preserves loaded lazy directory when root load resolves later', () => {
  const loadedChildFirst = replaceDirectoryNodes([], 'src/core', [
    file('src/core/App.tsx'),
  ])

  const rootResolvedLater = replaceDirectoryNodes(loadedChildFirst, null, [
    directory('src'),
    file('package.json'),
  ])

  const core = findDirectoryNode(rootResolvedLater, 'src/core')
  assert.equal(core?.isLoaded, true)
  assert.deepEqual(core?.children?.map((node) => node.relativePath), ['src/core/App.tsx'])
  assert.deepEqual(rootResolvedLater.map((node) => node.relativePath), ['src', 'package.json'])
})

test('replaceDirectoryNodes can discard loaded descendants for manual root refresh', () => {
  const loadedChildFirst = replaceDirectoryNodes([], 'src/core', [
    file('src/core/App.tsx'),
  ])

  const manuallyRefreshedRoot = replaceDirectoryNodes(loadedChildFirst, null, [
    directory('src'),
    file('package.json'),
  ], {
    preserveLoadedDescendants: false,
  })

  const src = findDirectoryNode(manuallyRefreshedRoot, 'src')
  const core = findDirectoryNode(manuallyRefreshedRoot, 'src/core')

  assert.equal(src?.isLoaded, false)
  assert.equal(src?.children, undefined)
  assert.equal(core, null)
  assert.deepEqual(manuallyRefreshedRoot.map((node) => node.relativePath), ['src', 'package.json'])
})

test('replaceDirectoryNodes inserts missing parent branch for out-of-order nested loads', () => {
  const tree = replaceDirectoryNodes([], 'src/core/renderer', [
    file('src/core/renderer/App.tsx'),
  ])

  const src = findDirectoryNode(tree, 'src')
  const core = findDirectoryNode(tree, 'src/core')
  const renderer = findDirectoryNode(tree, 'src/core/renderer')

  assert.equal(src?.isLoaded, false)
  assert.equal(core?.isLoaded, false)
  assert.equal(renderer?.isLoaded, true)
  assert.deepEqual(renderer?.children?.map((node) => node.relativePath), ['src/core/renderer/App.tsx'])
})

test('replaceDirectoryNodes refreshes target directory while preserving deeper loaded children', () => {
  const loadedComponents = replaceDirectoryNodes([], 'src/components', [
    directory('src/components/Button', [
      file('src/components/Button/index.ts'),
    ]),
    file('src/components/old.ts'),
  ])

  const refreshedComponents = replaceDirectoryNodes(loadedComponents, 'src/components', [
    directory('src/components/Button'),
    file('src/components/new.ts'),
  ])

  const components = findDirectoryNode(refreshedComponents, 'src/components')
  const button = findDirectoryNode(refreshedComponents, 'src/components/Button')

  assert.equal(components?.isLoaded, true)
  assert.deepEqual(components?.children?.map((node) => node.relativePath), [
    'src/components/Button',
    'src/components/new.ts',
  ])
  assert.equal(button?.isLoaded, true)
  assert.deepEqual(button?.children?.map((node) => node.relativePath), [
    'src/components/Button/index.ts',
  ])
})
