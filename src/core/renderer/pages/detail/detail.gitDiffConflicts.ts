export type ConflictBlock = {
  id: string
  startLine: number
  endLine: number
  oursLabel: string
  theirsLabel: string
  ancestorLabel?: string
  oursContent: string
  theirsContent: string
  ancestorContent: string
}

type ParsedConflictDocument = {
  blocks: ConflictBlock[]
}

function splitLinesKeepingEol(text: string): string[] {
  if (!text) return []
  const matches = text.match(/[^\n]*\n|[^\n]+$/g)
  return matches ?? []
}

function joinLines(lines: string[]): string {
  if (lines.length <= 0) return ''
  return lines.join('')
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
  return `${bytes} B`
}

export function parseConflictMarkers(text: string): ParsedConflictDocument {
  const lines = splitLinesKeepingEol(text)
  const blocks: ConflictBlock[] = []
  let lineIndex = 0

  while (lineIndex < lines.length) {
    const line = lines[lineIndex]
    if (!line.startsWith('<<<<<<< ')) {
      lineIndex += 1
      continue
    }

    const startLine = lineIndex + 1
    const oursLabel = line.replace(/\r?\n$/, '').slice('<<<<<<< '.length).trim() || 'OURS'
    let scanIndex = lineIndex + 1
    let ancestorSplit = -1
    let midSplit = -1
    let endSplit = -1

    while (scanIndex < lines.length) {
      const scanLine = lines[scanIndex]
      if (scanLine.startsWith('||||||| ')) {
        ancestorSplit = scanIndex
        scanIndex += 1
        continue
      }
      if (scanLine.startsWith('=======')) {
        midSplit = scanIndex
        scanIndex += 1
        continue
      }
      if (scanLine.startsWith('>>>>>>> ')) {
        endSplit = scanIndex
        break
      }
      scanIndex += 1
    }

    if (midSplit < 0 || endSplit < 0) {
      lineIndex += 1
      continue
    }

    const ancestorLabel = ancestorSplit >= 0
      ? lines[ancestorSplit].replace(/\r?\n$/, '').slice('||||||| '.length).trim() || 'BASE'
      : undefined
    const theirsLabel = lines[endSplit].replace(/\r?\n$/, '').slice('>>>>>>> '.length).trim() || 'THEIRS'
    const oursStart = lineIndex + 1
    const oursEndExclusive = ancestorSplit >= 0 ? ancestorSplit : midSplit
    const ancestorStart = ancestorSplit >= 0 ? ancestorSplit + 1 : midSplit
    const ancestorEndExclusive = ancestorSplit >= 0 ? midSplit : midSplit
    const theirsStart = midSplit + 1
    const theirsEndExclusive = endSplit
    const oursContent = joinLines(lines.slice(oursStart, oursEndExclusive))
    const ancestorContent = joinLines(lines.slice(ancestorStart, ancestorEndExclusive))
    const theirsContent = joinLines(lines.slice(theirsStart, theirsEndExclusive))

    blocks.push({
      id: `conflict-${blocks.length + 1}-${startLine}`,
      startLine,
      endLine: endSplit + 1,
      oursLabel,
      theirsLabel,
      ancestorLabel,
      oursContent,
      theirsContent,
      ancestorContent,
    })

    lineIndex = endSplit + 1
  }

  return { blocks }
}

function lineStartOffset(text: string, lineNumber: number): number {
  if (lineNumber <= 1) return 0
  let currentLine = 1
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === '\n') {
      currentLine += 1
      if (currentLine === lineNumber) {
        return index + 1
      }
    }
  }
  return text.length
}

export function replaceConflictBlock(source: string, block: ConflictBlock, replacement: string): string {
  const start = lineStartOffset(source, block.startLine)
  const end = lineStartOffset(source, block.endLine + 1)
  return `${source.slice(0, start)}${replacement}${source.slice(end)}`
}
