const BLOCKED_SVG_ELEMENT_NAMES = [
  'a',
  'animate',
  'animateMotion',
  'animateTransform',
  'audio',
  'canvas',
  'embed',
  'foreignObject',
  'iframe',
  'image',
  'mpath',
  'object',
  'script',
  'set',
  'video',
]

const ALLOWED_SVG_TAG_NAMES = new Map<string, string>([
  ['circle', 'circle'],
  ['clippath', 'clipPath'],
  ['defs', 'defs'],
  ['desc', 'desc'],
  ['ellipse', 'ellipse'],
  ['filter', 'filter'],
  ['g', 'g'],
  ['line', 'line'],
  ['lineargradient', 'linearGradient'],
  ['marker', 'marker'],
  ['mask', 'mask'],
  ['path', 'path'],
  ['pattern', 'pattern'],
  ['polygon', 'polygon'],
  ['polyline', 'polyline'],
  ['radialgradient', 'radialGradient'],
  ['rect', 'rect'],
  ['stop', 'stop'],
  ['style', 'style'],
  ['svg', 'svg'],
  ['symbol', 'symbol'],
  ['text', 'text'],
  ['textpath', 'textPath'],
  ['title', 'title'],
  ['tspan', 'tspan'],
  ['use', 'use'],
])

const ALLOWED_SVG_ATTRIBUTE_NAMES = new Set([
  'alignment-baseline',
  'aria-describedby',
  'aria-label',
  'aria-labelledby',
  'aria-roledescription',
  'baseline-shift',
  'class',
  'clip-path',
  'clip-rule',
  'color',
  'colspan',
  'cx',
  'cy',
  'd',
  'direction',
  'display',
  'dominant-baseline',
  'dx',
  'dy',
  'fill',
  'fill-opacity',
  'fill-rule',
  'filter',
  'font-family',
  'font-size',
  'font-style',
  'font-weight',
  'height',
  'href',
  'id',
  'kerning',
  'lengthadjust',
  'marker-end',
  'marker-mid',
  'marker-start',
  'markerheight',
  'markerunits',
  'markerwidth',
  'mask',
  'offset',
  'opacity',
  'orient',
  'paint-order',
  'pathlength',
  'patterncontentunits',
  'patternunits',
  'points',
  'preserveaspectratio',
  'r',
  'refx',
  'refy',
  'role',
  'rotate',
  'rx',
  'ry',
  'shape-rendering',
  'spreadmethod',
  'startoffset',
  'stop-color',
  'stop-opacity',
  'stroke',
  'stroke-dasharray',
  'stroke-dashoffset',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-miterlimit',
  'stroke-opacity',
  'stroke-width',
  'style',
  'tabindex',
  'text-anchor',
  'text-decoration',
  'textlength',
  'transform',
  'transform-origin',
  'vector-effect',
  'version',
  'viewbox',
  'visibility',
  'width',
  'x',
  'x1',
  'x2',
  'xlink:href',
  'xmlns',
  'xmlns:xlink',
  'y',
  'y1',
  'y2',
])

const ATTRIBUTE_PATTERN = /([A-Za-z_:][\w:.-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g
const SVG_STYLE_BLOCK_PATTERN = /<\s*style\b([^>]*)>([\s\S]*?)<\s*\/\s*style\s*>/gi
const SVG_TAG_PATTERN = /<([^<>]+)>/g
const CSS_URL_PATTERN = /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi
const LOCAL_URL_VALUE_PATTERN = /^#[-\w:.]+$/
const UNSAFE_TEXT_PATTERN = /[<>\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/
const UNSAFE_DECODED_VALUE_PATTERN = /(?:javascript|vbscript|data|file|https?):|expression\s*\(|-moz-binding\s*:|behavior\s*:/i

function stripBlockedSvgElements(markup: string): string {
  let sanitized = markup
  for (const tagName of BLOCKED_SVG_ELEMENT_NAMES) {
    const blockPattern = new RegExp(
      `<\\s*${tagName}\\b[^>]*>[\\s\\S]*?<\\s*\\/\\s*${tagName}\\s*>`,
      'gi'
    )
    const selfClosingPattern = new RegExp(`<\\s*${tagName}\\b[^>]*\\/\\s*>`, 'gi')
    sanitized = sanitized.replace(blockPattern, '').replace(selfClosingPattern, '')
  }
  return sanitized
}

function decodeBasicEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_match, codePoint: string) => {
      const parsed = Number.parseInt(codePoint, 16)
      return Number.isFinite(parsed) ? String.fromCodePoint(parsed) : ''
    })
    .replace(/&#(\d+);/g, (_match, codePoint: string) => {
      const parsed = Number.parseInt(codePoint, 10)
      return Number.isFinite(parsed) ? String.fromCodePoint(parsed) : ''
    })
    .replace(/&colon;/gi, ':')
    .replace(/&tab;/gi, '\t')
    .replace(/&newline;/gi, '\n')
    .replace(/&lpar;/gi, '(')
    .replace(/&rpar;/gi, ')')
}

function escapeSvgAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function isSafeLocalUrl(value: string): boolean {
  return LOCAL_URL_VALUE_PATTERN.test(value.trim())
}

function containsOnlySafeSvgUrls(value: string): boolean {
  const decoded = decodeBasicEntities(value)
  let safe = true
  decoded.replace(CSS_URL_PATTERN, (_match, _quote: string, urlValue: string) => {
    if (!isSafeLocalUrl(urlValue)) {
      safe = false
    }
    return ''
  })
  return safe
}

function sanitizeCssUrls(cssText: string): string {
  return cssText.replace(CSS_URL_PATTERN, (_match, _quote: string, urlValue: string) => {
    const trimmedUrl = urlValue.trim()
    return isSafeLocalUrl(trimmedUrl) ? `url(${trimmedUrl})` : ''
  })
}

export function sanitizeMermaidSvgCssText(cssText: string): string {
  const withoutComments = cssText.replace(/\/\*[\s\S]*?\*\//g, '')
  const decoded = decodeBasicEntities(withoutComments)
  if (
    /[<>]/.test(decoded)
    || /@(?:import|namespace|font-face)\b/i.test(decoded)
    || UNSAFE_DECODED_VALUE_PATTERN.test(decoded)
  ) {
    return ''
  }
  return sanitizeCssUrls(withoutComments)
}

function isAllowedAttribute(name: string): boolean {
  const normalized = name.toLowerCase()
  return (
    ALLOWED_SVG_ATTRIBUTE_NAMES.has(normalized)
    || normalized.startsWith('aria-')
    || normalized.startsWith('data-')
  )
}

function sanitizeSvgAttributeValue(name: string, value: string): string | null {
  const normalizedName = name.toLowerCase()
  const trimmed = value.trim()
  const decoded = decodeBasicEntities(trimmed)

  if (UNSAFE_TEXT_PATTERN.test(trimmed) || UNSAFE_DECODED_VALUE_PATTERN.test(decoded)) {
    return null
  }

  if ((normalizedName === 'href' || normalizedName === 'xlink:href') && !isSafeLocalUrl(decoded)) {
    return null
  }

  if (/\burl\s*\(/i.test(decoded) && !containsOnlySafeSvgUrls(trimmed)) {
    return null
  }

  if (normalizedName === 'style') {
    const sanitizedStyle = sanitizeMermaidSvgCssText(trimmed)
    return sanitizedStyle.trim() ? sanitizedStyle : null
  }

  return trimmed
}

function sanitizeSvgAttributes(rawAttributes: string): string {
  const attributes: string[] = []

  for (const match of rawAttributes.matchAll(ATTRIBUTE_PATTERN)) {
    const rawName = match[1]
    if (!rawName || rawName.toLowerCase().startsWith('on') || !isAllowedAttribute(rawName)) {
      continue
    }

    const rawValue = match[2] ?? match[3] ?? match[4] ?? ''
    const cleanValue = sanitizeSvgAttributeValue(rawName, rawValue)
    if (cleanValue == null) {
      continue
    }

    attributes.push(`${rawName}="${escapeSvgAttribute(cleanValue)}"`)
  }

  return attributes.length > 0 ? ` ${attributes.join(' ')}` : ''
}

function sanitizeSvgStyleBlocks(markup: string): string {
  return markup.replace(SVG_STYLE_BLOCK_PATTERN, (_match, rawAttributes: string, cssText: string) => {
    const sanitizedCssText = sanitizeMermaidSvgCssText(cssText)
    if (!sanitizedCssText.trim()) return ''
    return `<style${sanitizeSvgAttributes(rawAttributes)}>${sanitizedCssText}</style>`
  })
}

function sanitizeSvgTag(rawTagContent: string): string {
  const trimmed = rawTagContent.trim()
  if (!trimmed || trimmed.startsWith('!') || trimmed.startsWith('?')) {
    return ''
  }

  const isClosingTag = trimmed.startsWith('/')
  const tagContent = isClosingTag ? trimmed.slice(1).trim() : trimmed
  const tagNameMatch = /^([A-Za-z][\w:-]*)/.exec(tagContent)
  if (!tagNameMatch) {
    return ''
  }

  const rawTagName = tagNameMatch[1]
  const safeTagName = ALLOWED_SVG_TAG_NAMES.get(rawTagName.toLowerCase())
  if (!safeTagName) {
    return ''
  }

  if (isClosingTag) {
    return `</${safeTagName}>`
  }

  const selfClosing = /\/\s*$/.test(tagContent)
  const rawAttributes = tagContent
    .slice(rawTagName.length)
    .replace(/\/\s*$/, '')
  const attributes = sanitizeSvgAttributes(rawAttributes)
  return `<${safeTagName}${attributes}${selfClosing ? ' />' : '>'}`
}

export function sanitizeMermaidSvgMarkup(svgMarkup: string): string {
  const withoutBlockedElements = sanitizeSvgStyleBlocks(stripBlockedSvgElements(svgMarkup))
    .replace(/<\?xml[\s\S]*?\?>/gi, '')
    .replace(/<!doctype[\s\S]*?>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')

  return withoutBlockedElements.replace(SVG_TAG_PATTERN, (_match, rawTagContent: string) => (
    sanitizeSvgTag(rawTagContent)
  ))
}
