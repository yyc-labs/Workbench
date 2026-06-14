import type * as Monaco from 'monaco-editor'
import { loadWASM, OnigScanner, OnigString } from 'vscode-oniguruma'
import { Registry, INITIAL, type IGrammar, type IRawGrammar, type IRawTheme, type StateStack } from 'vscode-textmate'
import { buildTextmateRegistry, resolveRootScopeForLanguage, type TextmateLanguageDescriptor } from './textmate.registry'

const registryData = buildTextmateRegistry()
const onigWasmPath = '/assets/onig.wasm'

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

function resolveEmbeddedLanguageMap(
  monaco: typeof Monaco,
  descriptor: TextmateLanguageDescriptor,
): Record<string, number> {
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

function setRegistryTheme(theme: IRawTheme): void {
  void getTextmateRegistry().then((tmRegistry) => {
    tmRegistry.setTheme(theme)
  })
}

export async function ensureTextmateForLanguage(
  monaco: typeof Monaco,
  languageId: string,
): Promise<void> {
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

export function syncTextmateTheme(monacoTheme: 'vs' | 'vs-dark'): void {
  if (monacoTheme === 'vs-dark') {
    setRegistryTheme(registryData.themes.dark)
    return
  }
  setRegistryTheme(registryData.themes.light)
}
