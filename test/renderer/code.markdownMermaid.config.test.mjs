import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTsModule } from '../helpers/load-ts-module.mjs'

const { createMermaidRenderConfig } = loadTsModule('src/core/renderer/pages/code/code.markdownMermaid.config.ts')

test('createMermaidRenderConfig applies the project base theme and disables html labels', () => {
  const lightConfig = createMermaidRenderConfig('light')
  const darkConfig = createMermaidRenderConfig('dark')

  assert.equal(lightConfig.securityLevel, 'strict')
  assert.equal(lightConfig.theme, 'base')
  assert.equal(lightConfig.htmlLabels, false)
  assert.equal(lightConfig.flowchart?.htmlLabels, false)
  assert.equal(lightConfig.themeVariables?.primaryColor, '#ffffff')
  assert.equal(lightConfig.themeVariables?.primaryTextColor, '#1d1d1f')
  assert.equal(lightConfig.themeVariables?.primaryBorderColor, '#b8b8c0')
  assert.equal(lightConfig.themeVariables?.git0, '#0a84ff')
  assert.equal(lightConfig.themeVariables?.cScaleLabel0, '#1d1d1f')
  assert.equal(lightConfig.themeVariables?.cScaleInv0, '#fbfbfc')
  assert.equal(lightConfig.themeVariables?.pie12, '#b26086')
  assert.match(lightConfig.themeCSS ?? '', /mindmap-node/)
  assert.match(lightConfig.themeCSS ?? '', /sankey-node/)
  assert.match(lightConfig.themeCSS ?? '', /fill: #eaf4fe; stroke: #79afe1/)
  assert.match(lightConfig.themeCSS ?? '', /timeline-node:nth-of-type\(8n \+ 1\) > \.node-bkg/)
  assert.match(lightConfig.themeCSS ?? '', /timeline-node text \{ font-weight: 600; \}/)
  assert.match(lightConfig.themeCSS ?? '', /mindmap-node\.section-root \.label text \{ text-anchor: middle; \}/)
  assert.match(lightConfig.themeCSS ?? '', /fill: #0a84ff !important; stroke: #0a84ff !important/)
  assert.match(lightConfig.themeCSS ?? '', /8n \+ 8/)

  assert.equal(darkConfig.theme, 'base')
  assert.equal(darkConfig.htmlLabels, false)
  assert.equal(darkConfig.flowchart?.htmlLabels, false)
  assert.equal(darkConfig.themeVariables?.primaryColor, '#2c2c2e')
  assert.equal(darkConfig.themeVariables?.primaryTextColor, '#f5f5f7')
  assert.equal(darkConfig.themeVariables?.primaryBorderColor, '#636369')
  assert.equal(darkConfig.themeVariables?.git0, '#409cff')
  assert.equal(darkConfig.themeVariables?.cScaleLabel0, '#f5f5f7')
  assert.equal(darkConfig.themeVariables?.cScaleInv0, '#232326')
  assert.equal(darkConfig.themeVariables?.pie12, '#d178a1')
  assert.match(darkConfig.themeCSS ?? '', /fill: #203a54; stroke: #5da9ef/)
  assert.match(darkConfig.themeCSS ?? '', /fill: #409cff !important; stroke: #409cff !important/)
})
