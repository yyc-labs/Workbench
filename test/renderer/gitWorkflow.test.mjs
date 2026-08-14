import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTsModule } from '../helpers/load-ts-module.mjs'

const graph = loadTsModule('src/core/renderer/pages/detail/gitWorkflow.graph.ts')

test('migrates legacy linear steps into a v2 graph', () => {
  const migrated = graph.migrateLegacyGitWorkflowSteps([
    { id: 'step-a', operation: 'fetch' },
    { id: 'step-b', operation: 'pull' },
    { id: 'step-c', operation: 'merge' },
  ])

  assert.equal(migrated.migratedFromVersion, 1)
  assert.equal(migrated.graph.version, 2)
  assert.equal(migrated.graph.entryNodeId, 'step-a')
  assert.equal(migrated.graph.nodes.length, 3)
  assert.equal(migrated.graph.edges.length, 2)
  assert.deepEqual(
    migrated.graph.edges.map((edge) => edge.type),
    ['success', 'success'],
  )
})

test('commits node positions without changing unrelated graph data', () => {
  const sample = graph.createGitWorkflowGraph()
  const nodeA = sample.nodes[0]
  const nodeB = graph.createGitWorkflowNode('pull', { x: 400, y: 120 })
  sample.nodes.push(nodeB)
  sample.edges.push({
    id: graph.createGitWorkflowEdgeId(nodeA.id, 'success'),
    type: 'success',
    source: nodeA.id,
    sourceHandle: 'success',
    target: nodeB.id,
    targetHandle: 'input',
    data: { kind: 'success' },
  })

  const committed = graph.commitGitWorkflowNodePositions(sample, [
    { id: nodeA.id, position: { x: 220, y: 180 } },
    { id: nodeB.id, position: { x: 620, y: 260 } },
  ])

  assert.notEqual(committed, sample)
  assert.deepEqual(
    committed.nodes.map((node) => node.position),
    [
      { x: 220, y: 180 },
      { x: 620, y: 260 },
    ],
  )
  assert.equal(committed.nodes[0].data, nodeA.data)
  assert.equal(committed.nodes[1].data, nodeB.data)
  assert.equal(committed.edges, sample.edges)
  assert.equal(committed.nodes[0].type, 'gitOperation')
  assert.equal(committed.nodes[1].type, 'gitOperation')
})

test('removes a node together with connected edges without respawning the default graph', () => {
  const sample = graph.createGitWorkflowGraph()
  const nodeA = sample.nodes[0]
  const nodeB = graph.createGitWorkflowNode('pull', { x: 400, y: 120 })
  sample.nodes.push(nodeB)
  sample.edges.push({
    id: graph.createGitWorkflowEdgeId(nodeA.id, 'success'),
    type: 'success',
    source: nodeA.id,
    sourceHandle: 'success',
    target: nodeB.id,
    targetHandle: 'input',
    data: { kind: 'success' },
  })

  const removed = graph.removeGitWorkflowNode(sample, nodeA.id)

  assert.equal(removed.nodes.length, 1)
  assert.equal(removed.nodes[0].id, nodeB.id)
  assert.equal(removed.edges.length, 0)
  assert.equal(removed.entryNodeId, nodeB.id)

  const emptied = graph.removeGitWorkflowNode(removed, nodeB.id)
  assert.equal(emptied.nodes.length, 0)
  assert.equal(emptied.edges.length, 0)
  assert.equal(emptied.entryNodeId, '')
})

test('commit node positions returns the original graph when nothing changes', () => {
  const sample = graph.createGitWorkflowGraph()
  const samePosition = graph.commitGitWorkflowNodePositions(sample, [{ id: sample.nodes[0].id, position: { ...sample.nodes[0].position } }])
  const missingNode = graph.commitGitWorkflowNodePositions(sample, [{ id: 'missing', position: { x: 1, y: 1 } }])

  assert.equal(samePosition, sample)
  assert.equal(missingNode, sample)
})

test('validates graph structure and reports cycles', () => {
  const sample = graph.createGitWorkflowGraph()
  const nodeA = sample.nodes[0]
  const nodeB = graph.createGitWorkflowNode('pull', { x: 400, y: 120 })
  sample.nodes.push(nodeB)
  sample.edges.push({
    id: graph.createGitWorkflowEdgeId(nodeA.id, 'success'),
    type: 'success',
    source: nodeA.id,
    sourceHandle: 'success',
    target: nodeB.id,
    targetHandle: 'input',
    data: { kind: 'success' },
  })
  sample.edges.push({
    id: graph.createGitWorkflowEdgeId(nodeB.id, 'success'),
    type: 'success',
    source: nodeB.id,
    sourceHandle: 'success',
    target: nodeA.id,
    targetHandle: 'input',
    data: { kind: 'success' },
  })

  const result = graph.validateGitWorkflowGraph(sample, {
    currentBranch: 'main',
    localBranches: ['main'],
    remoteBranches: ['origin/main'],
  })

  assert.equal(result.ok, false)
  assert.ok(result.issues.some((issue) => issue.code === 'cycle'))
})

test('committing node positions does not change validation results', () => {
  const sample = graph.createGitWorkflowGraph()
  const nodeB = graph.createGitWorkflowNode('pull', { x: 400, y: 120 })
  sample.nodes.push(nodeB)
  sample.edges.push({
    id: graph.createGitWorkflowEdgeId(sample.nodes[0].id, 'success'),
    type: 'success',
    source: sample.nodes[0].id,
    sourceHandle: 'success',
    target: nodeB.id,
    targetHandle: 'input',
    data: { kind: 'success' },
  })

  const before = graph.validateGitWorkflowGraph(sample, {
    currentBranch: 'main',
    localBranches: ['main'],
    remoteBranches: ['origin/main'],
  })
  const committed = graph.commitGitWorkflowNodePositions(sample, [{ id: sample.nodes[0].id, position: { x: 180, y: 200 } }])
  const after = graph.validateGitWorkflowGraph(committed, {
    currentBranch: 'main',
    localBranches: ['main'],
    remoteBranches: ['origin/main'],
  })

  assert.deepEqual(after, before)
})

test('classifies structured skip reasons into success and failure', () => {
  assert.deepEqual(graph.classifyGitOperationResult({ ok: false, skipped: true, skipReason: 'nothing-to-pull' }).kind, 'success')
  assert.deepEqual(graph.classifyGitOperationResult({ ok: false, skipped: true, skipReason: 'missing-upstream' }).kind, 'failure')
  assert.deepEqual(graph.classifyGitOperationResult({ ok: false, skipped: false, error: 'boom' }).kind, 'failure')
})
