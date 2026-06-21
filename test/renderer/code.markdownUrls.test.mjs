import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { loadTsModule } from '../helpers/load-ts-module.mjs'

const {
  normalizeAbsoluteMarkdownFileUrl,
  transformMarkdownUrl,
} = loadTsModule('src/core/renderer/pages/code/code.markdownUrls.ts')

test('transformMarkdownUrl converts windows absolute paths to file urls', () => {
  assert.equal(
    transformMarkdownUrl('C:\\Users\\yyc20\\AppData\\Local\\Temp\\1778395065189.png'),
    'file:///C:/Users/yyc20/AppData/Local/Temp/1778395065189.png'
  )
  assert.equal(
    transformMarkdownUrl('C:%5CUsers%5Cyyc20%5CAppData%5CLocal%5CTemp%5C1778395065189.png'),
    'file:///C:/Users/yyc20/AppData/Local/Temp/1778395065189.png'
  )
})

test('normalizeAbsoluteMarkdownFileUrl keeps valid file urls', () => {
  assert.equal(
    normalizeAbsoluteMarkdownFileUrl('file:///C:/Users/yyc20/AppData/Local/Temp/1778395065189.png'),
    'file:///C:/Users/yyc20/AppData/Local/Temp/1778395065189.png'
  )
})

test('transformMarkdownUrl keeps valid file urls', () => {
  assert.equal(
    transformMarkdownUrl('file:///C:/Users/yyc20/AppData/Local/Temp/1778395065189.png'),
    'file:///C:/Users/yyc20/AppData/Local/Temp/1778395065189.png'
  )
})

test('react-markdown image destinations keep src after windows path normalization', () => {
  const input = '![77839506518](C:\\\\Users\\\\yyc20\\\\AppData\\\\Local\\\\Temp\\\\1778395065189.png)'
  let seenSrc = null

  renderToStaticMarkup(React.createElement(ReactMarkdown, {
    remarkPlugins: [remarkGfm],
    urlTransform: transformMarkdownUrl,
    components: {
      img(props) {
        seenSrc = props.src ?? null
        return React.createElement('img', props)
      },
    },
  }, input))

  assert.equal(seenSrc, 'file:///C:/Users/yyc20/AppData/Local/Temp/1778395065189.png')
})
