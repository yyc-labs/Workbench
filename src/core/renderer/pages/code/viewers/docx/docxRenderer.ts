import { renderAsync } from 'docx-preview'
import JSZip from 'jszip'

/**
 * docx-preview 的唯一封装点：全仓库只允许这里 import docx-preview。
 *
 * 渲染产物是纯 DOM/内联样式，仅作为展示层使用，不作为文档数据模型。
 * 未来替换渲染引擎，或在渲染前叠加自研编辑中间层（Document Model →
 * 渲染 → DOCX），都只改这个文件，不波及 React 组件。
 *
 * 该库对中文 Word 文档有若干能力缺口，均在此层补救：
 * 1. w:spacing 的 w:lineRule 缺省时规范是 "auto"（倍数行距），库却按固定磅值
 *    处理 —— XML 预处理补写 lineRule="auto"。
 * 2. 不支持中文单位属性 w:firstLineChars / w:hangingChars（首行缩进 N 字符）、
 *    w:beforeLines / w:afterLines（段前段后 N 行）—— XML 预处理换算成库支持
 *    的 twips 属性（w:firstLine / w:hanging / w:before / w:after）。
 * 3. 不解析 w:docGrid（文档网格），中文模板的行距观感主要来自网格 —— 渲染后
 *    注入近似行高规则。
 * 4. 只按显式分页标记（lastRenderedPageBreak / pageBreakBefore / w:br
 *    type="page"）分页，不做内容溢出自然分页 —— 渲染后按页面内容高度对
 *    article 子块做 DOM 级分页。
 */

const SPACING_WITHOUT_LINE_RULE_RE = /(<w:spacing\b(?![^>]*\bw:lineRule=)[^>]*?)(\s*\/?>)/g
const SPACING_TAG_RE = /<w:spacing\b[^>]*?\/?>/g
const IND_TAG_RE = /<w:ind\b[^>]*?\/?>/g
const DOC_GRID_TAG_RE = /<w:docGrid\b[^>]*>/g
/** 会影响行距的文档网格类型；缺省/显式 "default" 的网格不约束行高。 */
const LINE_SNAP_DOC_GRID_TYPES = new Set(['lines', 'linesAndChars', 'snapToChars'])
/** 中文正文标准字号 10.5pt（五号），styles.xml 无 docDefaults 字号时的兜底。 */
const DEFAULT_FONT_HALF_POINTS = 21
/** 单页分页循环的防御性上限。 */
const PAGE_SPLIT_MAX_ITERATIONS = 200

/** OOXML 长度单位：twips（1/20 磅）；中文单位按“字符/行”计，需换算。 */
type WordLayoutDefaults = {
  /** 文档默认字号（半磅），用于“字符”换算。 */
  fontHalfPoints: number
  /** 一“行”的 twips（文档网格行高或默认字号行高），用于“行”换算。 */
  rowTwips: number
}

function removeXmlAttr(tag: string, name: string): string {
  return tag.replace(new RegExp(`\\s${name}="[^"]*"`), '')
}

function appendXmlAttr(tag: string, name: string, value: number): string {
  return tag.replace(/(\s*\/?>)$/, (_match, end: string) => ` ${name}="${value}"${end}`)
}

function normalizeLineRuleInXml(xml: string): string {
  return xml.replace(SPACING_WITHOUT_LINE_RULE_RE, (match, head: string, tail: string) => {
    // 仅当该 spacing 声明了 w:line 时才补 lineRule；`w:line="` 不会误匹配 `w:lineRule="`。
    if (!/\bw:line="/.test(head)) return match
    return `${head} w:lineRule="auto"${tail}`
  })
}

/** 字符单位 → twips：chars/100 × 字号 × 20。 */
function charsToTwips(chars: number, fontHalfPoints: number): number {
  return Math.round((chars / 100) * (fontHalfPoints / 2) * 20)
}

/** 行单位 → twips：lines/100 × 行高。 */
function linesToTwips(lines: number, rowTwips: number): number {
  return Math.round((lines / 100) * rowTwips)
}

function normalizeWordFeaturesInXml(xml: string, defaults: WordLayoutDefaults): string {
  let next = normalizeLineRuleInXml(xml)

  // 首行缩进/悬挂缩进的字符单位（中文“缩进2字符”），换算为 twips。
  // OOXML 中 *Chars 属性优先于同名 twips 属性，故替换时删旧值再插新值。
  next = next.replace(IND_TAG_RE, (tag) => {
    const pairs = [
      ['w:firstLineChars', 'w:firstLine'],
      ['w:hangingChars', 'w:hanging'],
    ] as const
    let result = tag
    for (const [charsName, twipsName] of pairs) {
      const chars = new RegExp(`\\s${charsName}="([^"]*)"`).exec(result)?.[1]
      if (chars == null) continue
      const twips = charsToTwips(Number(chars), defaults.fontHalfPoints)
      result = appendXmlAttr(removeXmlAttr(removeXmlAttr(result, charsName), twipsName), twipsName, twips)
    }
    return result
  })

  // 段前/段后的行单位（中文“段前 0.5 行”），换算为 twips。
  next = next.replace(SPACING_TAG_RE, (tag) => {
    const pairs = [
      ['w:beforeLines', 'w:before'],
      ['w:afterLines', 'w:after'],
    ] as const
    let result = tag
    for (const [linesName, twipsName] of pairs) {
      const lines = new RegExp(`\\s${linesName}="([^"]*)"`).exec(result)?.[1]
      if (lines == null) continue
      const twips = linesToTwips(Number(lines), defaults.rowTwips)
      result = appendXmlAttr(removeXmlAttr(removeXmlAttr(result, linesName), twipsName), twipsName, twips)
    }
    return result
  })

  return next
}

function extractLinePitchTwips(documentXml: string): number | null {
  for (const tag of documentXml.match(DOC_GRID_TAG_RE) ?? []) {
    const gridType = /\bw:type="([^"]+)"/.exec(tag)?.[1] ?? 'default'
    if (!LINE_SNAP_DOC_GRID_TYPES.has(gridType)) continue
    const pitchTwips = /\bw:linePitch="(\d+)"/.exec(tag)?.[1]
    if (pitchTwips) return Number.parseInt(pitchTwips, 10)
  }
  return null
}

/** 从 styles.xml 的 docDefaults 提取文档默认字号；取不到时回落到五号。 */
function extractDefaultFontHalfPoints(stylesXml: string): number {
  const docDefaults = /<w:docDefaults[\s\S]*?<\/w:docDefaults>/.exec(stylesXml)?.[0] ?? ''
  const halfPoints = /\bw:sz\s+w:val="(\d+)"/.exec(docDefaults)?.[1]
  return halfPoints ? Number.parseInt(halfPoints, 10) : DEFAULT_FONT_HALF_POINTS
}

type DocxPreprocessResult = {
  data: Uint8Array
  /** 文档网格行高（磅）。仅当网格类型会约束行距时非空。 */
  linePitchPt: number | null
}

async function preprocessDocx(data: Uint8Array): Promise<DocxPreprocessResult> {
  const zip = await JSZip.loadAsync(data)
  const documentPart = zip.file('word/document.xml')
  const stylesPart = zip.file('word/styles.xml')
  const documentXml = documentPart ? await documentPart.async('string') : ''
  const stylesXml = stylesPart ? await stylesPart.async('string') : ''

  const linePitchTwips = extractLinePitchTwips(documentXml)
  const fontHalfPoints = extractDefaultFontHalfPoints(stylesXml)
  const defaults: WordLayoutDefaults = {
    fontHalfPoints,
    rowTwips: linePitchTwips ?? fontHalfPoints * 15,
  }

  let patched = false
  const nextDocumentXml = documentXml ? normalizeWordFeaturesInXml(documentXml, defaults) : documentXml
  if (documentPart && nextDocumentXml !== documentXml) {
    zip.file('word/document.xml', nextDocumentXml)
    patched = true
  }
  const nextStylesXml = stylesXml ? normalizeWordFeaturesInXml(stylesXml, defaults) : stylesXml
  if (stylesPart && nextStylesXml !== stylesXml) {
    zip.file('word/styles.xml', nextStylesXml)
    patched = true
  }

  const nextData = patched ? await zip.generateAsync({ type: 'uint8array' }) : data
  return { data: nextData, linePitchPt: linePitchTwips != null ? linePitchTwips / 20 : null }
}

/**
 * 内容溢出自然分页：docx-preview 只按显式分页标记分页，无标记的文档会
 * 挤成一页。这里按页面内容高度测量 article 的块级子元素，把溢出的元素
 * 依次移入克隆出的新 section（页眉页脚一并复制）。段落作为整体移动，
 * 不做段内切割；单个超出页高的元素（如大表格）独占一页并被撑高。
 */
function paginateSections(container: HTMLElement): void {
  for (const section of Array.from(container.querySelectorAll<HTMLElement>('section.docx'))) {
    const article = section.querySelector<HTMLElement>(':scope > article')
    if (!article) continue

    // CSS zoom 会等比缩放子树布局，clientWidth/offsetHeight 与内联样式值
    // 之间相差 zoom 倍；统一乘上该比例后再比较，缩放态下分页依然正确。
    const styleWidth = Number.parseFloat(section.style.width)
    const zoomRatio = styleWidth > 0 && section.clientWidth > 0 ? section.clientWidth / styleWidth : 1
    const pageHeight = Number.parseFloat(section.style.minHeight)
    if (!Number.isFinite(pageHeight) || pageHeight <= 0) continue
    const padTop = Number.parseFloat(section.style.paddingTop) || 0
    const padBottom = Number.parseFloat(section.style.paddingBottom) || 0
    const contentLimit = (pageHeight - padTop - padBottom) * zoomRatio
    if (!(contentLimit > 0)) continue

    let currentArticle: HTMLElement = article
    for (let iteration = 0; iteration < PAGE_SPLIT_MAX_ITERATIONS; iteration += 1) {
      const children = Array.from(currentArticle.children) as HTMLElement[]
      let usedHeight = 0
      let splitIndex = -1
      for (let index = 0; index < children.length; index += 1) {
        const element = children[index]
        const elementStyle = getComputedStyle(element)
        const outerHeight = element.offsetHeight + (Number.parseFloat(elementStyle.marginTop) || 0) + (Number.parseFloat(elementStyle.marginBottom) || 0)
        // 至少保留一个元素在当前页：首个元素即超页高时（大表格）让它
        // 独占本页，从下一个元素开始分页。
        if (usedHeight > 0 && usedHeight + outerHeight > contentLimit) {
          splitIndex = index
          break
        }
        usedHeight += outerHeight
      }
      if (splitIndex === -1) break

      const newSection = section.cloneNode(false) as HTMLElement
      for (const child of Array.from(section.children)) {
        if (child === currentArticle) continue
        // 页眉/页脚随分页复制（页码域在库中被渲染为静态文本，多页同号是已知局限）。
        newSection.appendChild(child.cloneNode(true))
      }
      const newArticle = currentArticle.cloneNode(false) as HTMLElement
      newSection.appendChild(newArticle)
      for (const element of children.slice(splitIndex)) {
        newArticle.appendChild(element)
      }
      section.parentElement?.insertBefore(newSection, section.nextSibling)
      currentArticle = newArticle
    }
  }
}

export async function renderDocxIntoElement(data: Uint8Array, container: HTMLElement): Promise<void> {
  // 先清空容器（含上一次渲染遗留的样式节点），避免重复渲染时样式累积。
  container.replaceChildren()
  const { data: normalizedData, linePitchPt } = await preprocessDocx(data)
  await renderAsync(normalizedData, container, container, {
    inWrapper: true,
    breakPages: true,
  })

  if (linePitchPt != null) {
    // 近似 Word 网格行距：只作用于没有显式行距的段落（docx-preview 会把
    // w:spacing 写成内联 line-height，优先级更高，不受影响）。max() 保证
    // 字号大于网格的大标题不会被固定行高压扁。需在分页测量前注入，
    // 行高变化会影响元素高度与分页位置。
    const style = document.createElement('style')
    style.textContent = `.docx-wrapper section.docx p { line-height: max(${linePitchPt}pt, 1.15em); }`
    container.append(style)
  }

  paginateSections(container)
}
