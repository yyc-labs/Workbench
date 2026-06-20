import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTsModule } from '../helpers/load-ts-module.mjs'

const { buildTranscriptShareSnapshot } = loadTsModule(
  'src/core/renderer/pages/transcript/transcriptShareSnapshot.ts'
)

class FakeElement {
  constructor(tagName, attrs = {}, children = [], innerHTML = '') {
    this.tagName = tagName.toUpperCase()
    this.attributes = new Map(Object.entries(attrs))
    this.children = children
    this.innerHTML = innerHTML || children.map((child) => child.outerHTML).join('')
    for (const child of this.children) {
      child.parent = this
    }
  }

  get outerHTML() {
    const attrs = Array.from(this.attributes.entries())
      .map(([key, value]) => (value === '' ? ` ${key}` : ` ${key}="${escapeAttribute(String(value))}"`))
      .join('')
    return `<${this.tagName.toLowerCase()}${attrs}>${this.innerHTML}</${this.tagName.toLowerCase()}>`
  }

  cloneNode() {
    const clonedChildren = this.children.map((child) => child.cloneNode(true))
    return new FakeElement(this.tagName, Object.fromEntries(this.attributes.entries()), clonedChildren)
  }

  querySelector(selector) {
    if (selector === '.code-markdown-content') {
      if (hasClass(this, 'code-markdown-content')) return this
      return findFirst(this.children, (child) => hasClass(child, 'code-markdown-content'))
    }
    return null
  }

  querySelectorAll(selector) {
    const matched = []
    walk(this.children, (child) => {
      if (matchesSelector(child, selector)) {
        matched.push(child)
      }
    })
    return matched
  }

  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value))
    if (this.parent) {
      this.parent.syncInnerHtml()
    }
  }

  removeAttribute(name) {
    this.attributes.delete(name)
    if (this.parent) {
      this.parent.syncInnerHtml()
    }
  }

  replaceWith(replacement) {
    if (!this.parent) return
    const index = this.parent.children.indexOf(this)
    if (index >= 0) {
      replacement.parent = this.parent
      this.parent.children.splice(index, 1, replacement)
      this.parent.syncInnerHtml()
    }
  }

  syncInnerHtml() {
    this.innerHTML = this.children.map((child) => child.outerHTML).join('')
    if (this.parent) {
      this.parent.syncInnerHtml()
    }
  }

  set parent(value) {
    this._parent = value
  }

  get parent() {
    return this._parent || null
  }

  get className() {
    return this.getAttribute('class') || ''
  }

  set className(value) {
    this.attributes.set('class', String(value))
    if (this.parent) {
      this.parent.syncInnerHtml()
    }
  }
}

function escapeAttribute(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function hasClass(node, className) {
  const raw = node.getAttribute('class') || ''
  return raw.split(/\s+/).includes(className)
}

function walk(nodes, visitor) {
  for (const node of nodes) {
    visitor(node)
    walk(node.children, visitor)
  }
}

function findFirst(nodes, predicate) {
  for (const node of nodes) {
    if (predicate(node)) return node
    const nested = findFirst(node.children, predicate)
    if (nested) return nested
  }
  return null
}

function matchesSelector(node, selector) {
  if (selector === 'img') return node.tagName === 'IMG'
  if (selector === 'a') return node.tagName === 'A'
  if (selector === '[data-structured-block-kind]') return node.getAttribute('data-structured-block-kind') !== null
  return false
}

function link(innerText, href, className = '') {
  return new FakeElement('a', className ? { href, class: className } : { href }, [], innerText)
}

function image(attrs) {
  return new FakeElement('img', attrs)
}

function div(attrs, children = []) {
  const node = new FakeElement('div', attrs, children)
  for (const child of children) {
    child.parent = node
  }
  node.syncInnerHtml()
  return node
}

test('buildTranscriptShareSnapshot injects share runtime and degrades app-only interactions', () => {
  globalThis.document = {
    styleSheets: [
      {
        cssRules: [
          { cssText: '.code-markdown-content{color:red;}' },
        ],
      },
    ],
    documentElement: {
      getAttribute(name) {
        if (name === 'data-theme-mode') return 'dark'
        if (name === 'data-theme') return 'dark'
        return null
      },
    },
    createElement(tagName) {
      return new FakeElement(tagName)
    },
  }

  const codeBlock = div(
    {
      class: 'code-markdown-syntax-wrap',
      'data-source-start-line': '12',
      'data-source-end-line': '18',
    },
    [
      div({ class: 'code-markdown-code-toolbar' }, []),
      new FakeElement(
        'pre',
        { class: 'code-markdown-syntax-block' },
        [new FakeElement('code', {}, [], 'const value = 1;')]
      ),
    ]
  )
  const structured = div(
    {
      class: 'code-markdown-box-flow code-markdown-zoomable-structure',
      'data-structured-block-kind': 'box-flow',
      'data-source-start-line': '20',
      'data-source-end-line': '28',
      role: 'button',
      tabindex: '0',
    },
    [new FakeElement('span', {}, [], 'diagram')]
  )
  const transcriptRef = link('ref', 'transcript-ref://abc', 'code-markdown-transcript-ref')
  const normalLink = link('docs', 'https://example.com')
  const localImage = image({ src: 'file:///tmp/demo.png', loading: 'lazy', alt: 'demo image' })
  const root = div(
    { class: 'share-root' },
    [
      div(
        { class: 'code-markdown-content code-markdown-content--viewport-scroll' },
        [codeBlock, structured, transcriptRef, normalLink, localImage]
      ),
    ]
  )
  const i18n = {
    copied: 'Copied',
    copyFailed: 'Copy failed',
    transcriptRefDisabled: 'Only available inside the app.',
  }

  const snapshot = buildTranscriptShareSnapshot(root, 'Demo Share', i18n)

  assert.match(snapshot.html, /<script>[\s\S]*transcriptRefDisabled[\s\S]*copyFailed[\s\S]*<\/script>/)
  assert.match(snapshot.html, /data-transcript-share-toast/)
  assert.match(snapshot.html, /background:\s*var\(--color-card-solid,\s*#ffffff\)/)
  assert.match(snapshot.html, /data-transcript-ref-disabled="true"/)
  assert.match(snapshot.html, /Only available inside the app\./)
  assert.doesNotMatch(snapshot.html, /<a[^>]+href="transcript-ref:\/\/abc"/)
  assert.match(snapshot.html, /href="https:\/\/example\.com"/)
  assert.match(snapshot.html, /data-structured-block-kind="box-flow"/)
  assert.match(snapshot.html, /role="button"/)
  assert.doesNotMatch(snapshot.html, /code-markdown-content--viewport-scroll/)
  assert.doesNotMatch(snapshot.html, /code-markdown-code-action-btn/)
  assert.doesNotMatch(snapshot.html, /data-transcript-share-image/)
  assert.match(snapshot.html, /code-markdown-copy-btn/)
  assert.equal(snapshot.images.length, 1)
  assert.equal(snapshot.images[0].fileUrl, 'file:///tmp/demo.png')
  assert.match(snapshot.html, /__TRANSCRIPT_SHARE_IMG_0__/)
})
