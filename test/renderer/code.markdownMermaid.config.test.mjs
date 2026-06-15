import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTsModule } from '../helpers/load-ts-module.mjs'

const { createMermaidRenderConfig } = loadTsModule('src/core/renderer/pages/code/code.markdownMermaid.config.ts')

test('createMermaidRenderConfig disables html labels at both global and flowchart levels', () => {
  const lightConfig = createMermaidRenderConfig('light')
  const darkConfig = createMermaidRenderConfig('dark')

  assert.equal(lightConfig.securityLevel, 'strict')
  assert.equal(lightConfig.theme, 'default')
  assert.equal(lightConfig.htmlLabels, false)
  assert.equal(lightConfig.flowchart?.htmlLabels, false)

  assert.equal(darkConfig.theme, 'dark')
  assert.equal(darkConfig.htmlLabels, false)
  assert.equal(darkConfig.flowchart?.htmlLabels, false)
})
