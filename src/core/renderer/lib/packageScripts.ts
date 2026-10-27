import type { ProjectInfo } from '../../shared/types'

const MAX_PACKAGE_SCRIPT_JSON_PARSE_FALLBACK_LENGTH = 64 * 1024

/** Build the CLI command that runs `script` with the project's package manager. */
export function scriptCommand(packageManager: ProjectInfo['packageManager'] | undefined, script: string): string {
  const pm = packageManager || 'npm'
  if (pm === 'yarn') return script === 'start' ? 'yarn start' : `yarn ${script}`
  if (pm === 'bun') return script === 'start' ? 'bun start' : `bun run ${script}`
  if (script === 'start') return `${pm} start`
  return `${pm} run ${script}`
}

export function sortPackageScriptNames(names: string[]): string[] {
  return names
    .filter((name) => name.trim().length > 0)
    .sort((left, right) => {
      const preferred = ['dev', 'start', 'build', 'preview', 'test', 'typecheck', 'lint']
      const leftIndex = preferred.indexOf(left)
      const rightIndex = preferred.indexOf(right)
      if (leftIndex >= 0 || rightIndex >= 0) {
        return (leftIndex < 0 ? 99 : leftIndex) - (rightIndex < 0 ? 99 : rightIndex)
      }
      return left.localeCompare(right)
    })
}

function isJsonWhitespace(char: string | undefined): boolean {
  return char === ' ' || char === '\n' || char === '\r' || char === '\t'
}

function skipJsonWhitespace(content: string, startIndex: number): number {
  let index = startIndex
  while (index < content.length && isJsonWhitespace(content[index])) index += 1
  return index
}

function skipJsonString(content: string, startIndex: number): number | null {
  if (content[startIndex] !== '"') return null

  let index = startIndex + 1
  while (index < content.length) {
    const char = content[index]
    if (char === '\\') {
      index += 2
      continue
    }
    if (char === '"') return index + 1
    index += 1
  }

  return null
}

function readJsonStringValue(content: string, startIndex: number): { value: string; nextIndex: number } | null {
  if (content[startIndex] !== '"') return null

  let index = startIndex + 1
  let value = ''

  while (index < content.length) {
    const char = content[index]
    if (char === '"') {
      return { value, nextIndex: index + 1 }
    }
    if (char === '\\') {
      index += 1
      if (index >= content.length) return null
      const escaped = content[index]
      if (escaped === '"' || escaped === '\\' || escaped === '/') value += escaped
      else if (escaped === 'b') value += '\b'
      else if (escaped === 'f') value += '\f'
      else if (escaped === 'n') value += '\n'
      else if (escaped === 'r') value += '\r'
      else if (escaped === 't') value += '\t'
      else if (escaped === 'u') {
        const hex = content.slice(index + 1, index + 5)
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) return null
        value += String.fromCharCode(Number.parseInt(hex, 16))
        index += 4
      } else {
        return null
      }
      index += 1
      continue
    }

    value += char
    index += 1
  }

  return null
}

function findJsonPrimitiveEnd(content: string, startIndex: number): number {
  let index = startIndex
  while (index < content.length) {
    const char = content[index]
    if (char === ',' || char === '}' || char === ']' || isJsonWhitespace(char)) return index
    index += 1
  }
  return index
}

function findJsonStructureEnd(content: string, startIndex: number): number | null {
  const root = content[startIndex]
  if (root !== '{' && root !== '[') return null

  const stack: string[] = [root]
  let index = startIndex + 1
  while (index < content.length) {
    const char = content[index]
    if (char === '"') {
      const nextIndex = skipJsonString(content, index)
      if (nextIndex == null) return null
      index = nextIndex
      continue
    }
    if (char === '{' || char === '[') {
      stack.push(char)
      index += 1
      continue
    }
    if (char === '}' || char === ']') {
      const last = stack[stack.length - 1]
      if ((char === '}' && last !== '{') || (char === ']' && last !== '[')) return null
      stack.pop()
      index += 1
      if (stack.length === 0) return index
      continue
    }
    index += 1
  }

  return null
}

function findJsonValueEnd(content: string, startIndex: number): number | null {
  const char = content[startIndex]
  if (!char) return null
  if (char === '"') return skipJsonString(content, startIndex)
  if (char === '{' || char === '[') return findJsonStructureEnd(content, startIndex)
  return findJsonPrimitiveEnd(content, startIndex)
}

type JsonObjectKeyPosition = { name: string; startIndex: number }

function extractObjectKeyPositions(content: string, objectStartIndex: number): JsonObjectKeyPosition[] | null {
  if (content[objectStartIndex] !== '{') return null

  const keys: JsonObjectKeyPosition[] = []
  let index = objectStartIndex + 1

  while (index < content.length) {
    index = skipJsonWhitespace(content, index)
    const current = content[index]
    if (current === '}') return keys
    if (current !== '"') return null

    const keyResult = readJsonStringValue(content, index)
    if (!keyResult) return null
    keys.push({ name: keyResult.value, startIndex: index })

    index = skipJsonWhitespace(content, keyResult.nextIndex)
    if (content[index] !== ':') return null

    index = skipJsonWhitespace(content, index + 1)
    const valueEndIndex = findJsonValueEnd(content, index)
    if (valueEndIndex == null) return null

    index = skipJsonWhitespace(content, valueEndIndex)
    if (content[index] === ',') {
      index += 1
      continue
    }
    if (content[index] === '}') return keys
    return null
  }

  return null
}

function extractPackageScriptsFromJsonText(content: string): string[] | null {
  let index = skipJsonWhitespace(content, 0)
  if (content[index] !== '{') return null
  index += 1

  while (index < content.length) {
    index = skipJsonWhitespace(content, index)
    const current = content[index]
    if (current === '}') return []
    if (current !== '"') return null

    const keyResult = readJsonStringValue(content, index)
    if (!keyResult) return null

    index = skipJsonWhitespace(content, keyResult.nextIndex)
    if (content[index] !== ':') return null

    index = skipJsonWhitespace(content, index + 1)
    if (keyResult.value === 'scripts') {
      if (content[index] !== '{') return []
      const positions = extractObjectKeyPositions(content, index)
      return positions?.map((entry) => entry.name) ?? null
    }

    const valueEndIndex = findJsonValueEnd(content, index)
    if (valueEndIndex == null) return null

    index = skipJsonWhitespace(content, valueEndIndex)
    if (content[index] === ',') {
      index += 1
      continue
    }
    if (content[index] === '}') return []
    return null
  }

  return null
}

function countLinesBefore(content: string, index: number): number {
  let lines = 0
  for (let i = 0; i < index; i++) {
    if (content.charCodeAt(i) === 10) lines += 1
  }
  return lines
}

/**
 * 流式提取 scripts 中每个条目的名字与 key 所在行（1-based），顺序为文档原始顺序。
 * 内容非法（注释、尾逗号、截断等）时返回 null。
 */
function extractPackageScriptsWithLines(content: string): PackageScriptEntry[] | null {
  let index = skipJsonWhitespace(content, 0)
  if (content[index] !== '{') return null
  index += 1

  while (index < content.length) {
    index = skipJsonWhitespace(content, index)
    const current = content[index]
    if (current === '}') return []
    if (current !== '"') return null

    const keyResult = readJsonStringValue(content, index)
    if (!keyResult) return null

    index = skipJsonWhitespace(content, keyResult.nextIndex)
    if (content[index] !== ':') return null

    index = skipJsonWhitespace(content, index + 1)
    if (keyResult.value === 'scripts') {
      if (content[index] !== '{') return []
      const positions = extractObjectKeyPositions(content, index)
      if (!positions) return null
      return positions.map((entry) => ({ name: entry.name, line: countLinesBefore(content, entry.startIndex) + 1 }))
    }

    const valueEndIndex = findJsonValueEnd(content, index)
    if (valueEndIndex == null) return null

    index = skipJsonWhitespace(content, valueEndIndex)
    if (content[index] === ',') {
      index += 1
      continue
    }
    if (content[index] === '}') return []
    return null
  }

  return null
}

export interface PackageScriptEntry {
  name: string
  /** script key 在文件中的行号（1-based）。 */
  line: number
}

/**
 * 编辑器快捷运行场景（19 号计划 §11.1）：只走流式路径并携带行号。
 * 与 `parsePackageScripts` 不同，这里不做 JSON.parse 兜底——兜底路径没有位置信息，
 * 而编辑器需要行级定位；内容暂时非法时返回 null，调用方应隐藏运行入口。
 * 顺序保持 package.json 文档原始顺序（§2.2：菜单不按语义重排）。
 */
export function parsePackageScriptsWithLines(content: string): PackageScriptEntry[] | null {
  return extractPackageScriptsWithLines(content)
}

function parsePackageScriptsViaJson(content: string): string[] {
  try {
    const parsed = JSON.parse(content) as { scripts?: unknown }
    if (!parsed.scripts || typeof parsed.scripts !== 'object' || Array.isArray(parsed.scripts)) return []
    return sortPackageScriptNames(Object.keys(parsed.scripts as Record<string, unknown>))
  } catch {
    return []
  }
}

/**
 * Extract package.json script names without JSON.parse-ing the whole file:
 * large package.json files are streamed by hand, with a bounded JSON.parse
 * fallback for smaller payloads.
 */
export function parsePackageScripts(content: string): string[] {
  const extracted = extractPackageScriptsFromJsonText(content)
  if (extracted) return sortPackageScriptNames(extracted)
  if (content.length <= MAX_PACKAGE_SCRIPT_JSON_PARSE_FALLBACK_LENGTH) {
    return parsePackageScriptsViaJson(content)
  }
  return []
}
