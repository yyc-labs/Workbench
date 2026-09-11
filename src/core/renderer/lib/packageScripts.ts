import type { ProjectInfo } from '../../shared/types'

const MAX_PACKAGE_SCRIPT_JSON_PARSE_FALLBACK_LENGTH = 64 * 1024

/** Build the CLI command that runs `script` with the project's package manager. */
export function scriptCommand(packageManager: ProjectInfo['packageManager'] | undefined, script: string): string {
  const pm = packageManager || 'npm'
  if (pm === 'yarn') return script === 'start' ? 'yarn start' : `yarn ${script}`
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

function extractTopLevelObjectKeys(content: string, objectStartIndex: number): string[] | null {
  if (content[objectStartIndex] !== '{') return null

  const keys: string[] = []
  let index = objectStartIndex + 1

  while (index < content.length) {
    index = skipJsonWhitespace(content, index)
    const current = content[index]
    if (current === '}') return keys
    if (current !== '"') return null

    const keyResult = readJsonStringValue(content, index)
    if (!keyResult) return null
    keys.push(keyResult.value)

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
      return extractTopLevelObjectKeys(content, index)
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
