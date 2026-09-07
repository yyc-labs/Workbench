import type * as Monaco from 'monaco-editor'
import { loadWASM, OnigScanner, OnigString } from 'vscode-oniguruma'
import { Registry, INITIAL, type IGrammar, type IRawGrammar, type IRawTheme, type StateStack } from 'vscode-textmate'
import type { MonacoThemeName } from '../../lib/monacoEnvironment'
import { buildTextmateRegistry, resolveRootScopeForLanguage, type TextmateLanguageDescriptor } from './textmate.registry'

const registryData = buildTextmateRegistry()
const onigWasmPath = './assets/onig.wasm'

let onigasmBootPromise: Promise<void> | null = null
let textmateRegistryPromise: Promise<Registry> | null = null

const installStateByLanguage = new Map<string, Promise<void>>()
const languageConfigDisposableById = new Map<string, Monaco.IDisposable>()
const tokenProviderDisposableByLanguage = new Map<string, Monaco.IDisposable>()
const registeredLanguageIds = new Set<string>()

function ensureLanguageRegistered(monaco: typeof Monaco, languageId: string): void {
  if (!languageId) return
  if (registeredLanguageIds.has(languageId)) return

  const exists = monaco.languages.getLanguages().some((language) => language.id === languageId)
  if (!exists) {
    monaco.languages.register({ id: languageId })
  }
  registeredLanguageIds.add(languageId)
}

function ensureOnigurumaReady(): Promise<void> {
  if (!onigasmBootPromise) {
    onigasmBootPromise = (async () => {
      const onigWasmUrl = new globalThis.URL(onigWasmPath, document.baseURI).href
      const response = await fetch(onigWasmUrl)
      if (!response.ok) {
        throw new Error(`Failed to load onig.wasm: ${response.status}`)
      }
      // Use ArrayBuffer mode to avoid CSP blocking instantiateStreaming in stricter environments.
      const wasmData = await response.arrayBuffer()
      await loadWASM(wasmData)
    })()
  }
  return onigasmBootPromise
}

async function getTextmateRegistry(): Promise<Registry> {
  if (!textmateRegistryPromise) {
    textmateRegistryPromise = (async () => {
      await ensureOnigurumaReady()

      return new Registry({
        onigLib: Promise.resolve({
          createOnigScanner(patterns: string[]) {
            return new OnigScanner(patterns)
          },
          createOnigString(text: string) {
            return new OnigString(text)
          },
        }),
        theme: registryData.themes.light,
        loadGrammar: async (scopeName) => registryData.grammarsByScope.get(scopeName) as IRawGrammar | null,
        getInjections: (scopeName) => registryData.injectionsByTargetScope.get(scopeName),
      })
    })()
  }

  return textmateRegistryPromise
}

function resolveEmbeddedLanguageMap(monaco: typeof Monaco, descriptor: TextmateLanguageDescriptor): Record<string, number> {
  const result: Record<string, number> = {}
  const scopeToLanguageId = descriptor.embeddedScopeToLanguage ?? {}

  for (const [scopeName, monacoLanguageId] of Object.entries(scopeToLanguageId)) {
    const encoded = monaco.languages.getEncodedLanguageId(monacoLanguageId)
    if (encoded > 0) {
      result[scopeName] = encoded
    }
  }

  // Always preserve root language mapping even if descriptor forgot to include it.
  const rootEncoded = monaco.languages.getEncodedLanguageId(descriptor.languageId)
  if (rootEncoded > 0) {
    result[descriptor.rootScopeName] = rootEncoded
  }

  return result
}

function installLanguageConfiguration(monaco: typeof Monaco, languageId: string): void {
  ensureLanguageRegistered(monaco, languageId)

  const existing = languageConfigDisposableById.get(languageId)
  if (existing) return

  const configuration = registryData.languageConfigurationById.get(languageId)
  if (!configuration) return

  const disposable = monaco.languages.setLanguageConfiguration(languageId, configuration)
  languageConfigDisposableById.set(languageId, disposable)
}

function buildEncodedProvider(grammar: IGrammar): Monaco.languages.EncodedTokensProvider {
  return {
    getInitialState() {
      return INITIAL
    },
    tokenizeEncoded(line: string, state: Monaco.languages.IState): Monaco.languages.IEncodedLineTokens {
      const tmState = state as unknown as StateStack
      const result = grammar.tokenizeLine2(line, tmState)
      return {
        tokens: result.tokens,
        endState: result.ruleStack as unknown as Monaco.languages.IState,
      }
    },
  }
}

async function installLanguageTokenizer(monaco: typeof Monaco, languageId: string): Promise<void> {
  ensureLanguageRegistered(monaco, languageId)

  const rootScope = resolveRootScopeForLanguage(languageId, registryData)
  if (!rootScope) return

  const descriptor = registryData.languageByScope.get(rootScope)
  if (!descriptor) return

  installLanguageConfiguration(monaco, languageId)

  if (tokenProviderDisposableByLanguage.has(languageId)) {
    return
  }

  const tmRegistry = await getTextmateRegistry()
  const initialLanguage = monaco.languages.getEncodedLanguageId(languageId)
  if (initialLanguage <= 0) return

  const embeddedLanguages = resolveEmbeddedLanguageMap(monaco, descriptor)
  const grammar = await tmRegistry.loadGrammarWithConfiguration(rootScope, initialLanguage, {
    embeddedLanguages,
  })

  if (!grammar) return

  const provider = buildEncodedProvider(grammar)
  const disposable = monaco.languages.setTokensProvider(languageId, provider)
  tokenProviderDisposableByLanguage.set(languageId, disposable)
}

function resolveThemeSelection(monacoTheme: MonacoThemeName): { base: 'vs' | 'vs-dark' | 'hc-black' | 'hc-light'; rawTheme: IRawTheme } {
  if (monacoTheme === 'vs-dark' || monacoTheme === 'hc-black') {
    return { base: monacoTheme, rawTheme: registryData.themes.dark }
  }
  if (monacoTheme === 'hc-light') {
    return { base: monacoTheme, rawTheme: registryData.themes.light }
  }
  return { base: 'vs', rawTheme: registryData.themes.light }
}

function isTextmateManagedLanguage(languageId: string): boolean {
  return resolveRootScopeForLanguage(languageId, registryData) !== null
}

/**
 * Encoded tokens carry a foreground color index (not a color), so the color
 * map of the active Monaco theme must match the TextMate registry's color map
 * position by position. Monaco's builtin "vs" / "vs-dark" maps are built from
 * their own lexicographically sorted rules and do not align with TextMate
 * indices at all — that mismatch is what rendered keywords like `interface`
 * in a random color (e.g. red via `.mtk4`).
 *
 * Redefining the theme under the builtin name keeps every existing
 * `setTheme('vs' | 'vs-dark')` call site working while aligning the maps.
 * Monarch-tokenized languages still work because their rule colors are
 * appended after the mirrored TextMate prefix.
 */
export async function syncTextmateTheme(monaco: typeof Monaco, monacoTheme: MonacoThemeName): Promise<void> {
  const { base, rawTheme } = resolveThemeSelection(monacoTheme)

  try {
    const tmRegistry = await getTextmateRegistry()
    tmRegistry.setTheme(rawTheme)

    // getColorMap() returns a sparse array (index 0 is a hole). Array.map
    // skips holes, so the hole must be filled explicitly — Monaco's internal
    // for...of iteration would otherwise pass `undefined` into ColorMap.getId
    // and crash the theme resolution.
    const rawColorMap = tmRegistry.getColorMap()
    const encodedTokensColors: (string | null)[] = new Array(rawColorMap.length)
    for (let i = 0; i < rawColorMap.length; i++) {
      encodedTokensColors[i] = rawColorMap[i] ?? null
    }

    monaco.editor.defineTheme(monacoTheme, {
      base,
      inherit: true,
      rules: [],
      colors: {},
      encodedTokensColors: encodedTokensColors as unknown as string[],
    })

    // Encoded token metadata keeps the old color indices after a theme switch;
    // re-tokenize TextMate-managed models so indices match the new color map.
    for (const model of monaco.editor.getModels()) {
      if (!isTextmateManagedLanguage(model.getLanguageId())) continue
      const tokenizationPart = (
        model as unknown as {
          tokenization?: { resetTokenization?: () => void }
        }
      ).tokenization
      tokenizationPart?.resetTokenization?.()
    }
  } catch (error) {
    console.warn('[textmate] failed to sync theme:', error)
  }
}

export async function ensureTextmateForLanguage(monaco: typeof Monaco, languageId: string): Promise<void> {
  if (!languageId) return

  const existingPromise = installStateByLanguage.get(languageId)
  if (existingPromise) {
    await existingPromise
    return
  }

  const installPromise = installLanguageTokenizer(monaco, languageId)
    .catch((error) => {
      console.warn(`[textmate] failed to install grammar for ${languageId}:`, error)
    })
    .finally(() => {
      installStateByLanguage.delete(languageId)
    })

  installStateByLanguage.set(languageId, installPromise)
  await installPromise
}
