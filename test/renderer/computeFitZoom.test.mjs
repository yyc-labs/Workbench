import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTsModule } from '../helpers/load-ts-module.mjs'

const { computeFitZoom } = loadTsModule('src/core/renderer/lib/computeFitZoom.ts')

test('computeFitZoom shrinks oversized content until it fits the viewport', () => {
  const zoom = computeFitZoom({
    viewportWidth: 800,
    viewportHeight: 600,
    contentWidth: 1600,
    contentHeight: 900,
    allowUpscale: true,
  })

  assert.equal(zoom, 0.5)
})

test('computeFitZoom enlarges small vector content to fill the viewport without a hard 1x cap', () => {
  const zoom = computeFitZoom({
    viewportWidth: 800,
    viewportHeight: 600,
    contentWidth: 200,
    contentHeight: 400,
    allowUpscale: true,
  })

  assert.equal(zoom, 1.5)
})

test('computeFitZoom keeps raster content at or below 100% when upscaling is not allowed', () => {
  const zoom = computeFitZoom({
    viewportWidth: 800,
    viewportHeight: 600,
    contentWidth: 200,
    contentHeight: 400,
    allowUpscale: false,
  })

  assert.equal(zoom, 1)
})

test('computeFitZoom still shrinks raster content that exceeds the viewport', () => {
  const zoom = computeFitZoom({
    viewportWidth: 800,
    viewportHeight: 600,
    contentWidth: 1600,
    contentHeight: 300,
    allowUpscale: false,
  })

  assert.equal(zoom, 0.5)
})

test('computeFitZoom returns 1 for degenerate measurements', () => {
  assert.equal(computeFitZoom({ viewportWidth: 0, viewportHeight: 600, contentWidth: 100, contentHeight: 100, allowUpscale: true }), 1)
  assert.equal(computeFitZoom({ viewportWidth: 800, viewportHeight: 600, contentWidth: 0, contentHeight: 100, allowUpscale: false }), 1)
})
