import type { IRawGrammar } from 'vscode-textmate'
import type { languages } from 'monaco-editor'

import sourceTsGrammar from './tm-grammars/source.ts.tmLanguage.json'
import sourceJsGrammar from './tm-grammars/source.js.tmLanguage.json'
import sourceJsonGrammar from './tm-grammars/source.json.tmLanguage.json'
import sourceJsoncGrammar from './tm-grammars/source.json.comments.tmLanguage.json'
import sourceJson5Grammar from './tm-grammars/source.json5.tmLanguage.json'
import sourceCssGrammar from './tm-grammars/source.css.tmLanguage.json'
import sourceHtmlGrammar from './tm-grammars/text.html.basic.tmLanguage.json'
import sourceHtmlDerivativeGrammar from './tm-grammars/text.html.derivative.tmLanguage.json'
import sourceMarkdownGrammar from './tm-grammars/text.html.markdown.tmLanguage.json'
import sourceVueGrammar from './tm-grammars/source.vue.tmLanguage.json'
import vueDirectivesGrammar from './tm-grammars/vue.directives.tmLanguage.json'
import vueInterpolationsGrammar from './tm-grammars/vue.interpolations.tmLanguage.json'
import vueStyleInjectionGrammar from './tm-grammars/vue.sfc.style.variable.injection.tmLanguage.json'
import markdownVueCodeblockGrammar from './tm-grammars/markdown.vue.codeblock.tmLanguage.json'

import type { IRawTheme } from 'vscode-textmate'
import darkPlusTheme from './themes/dark-plus.theme.json'
import lightPlusTheme from './themes/light-plus.theme.json'

import vueLanguageConfig from './language-configs/vue.language-configuration.json'
import markdownLanguageConfig from './language-configs/markdown.language-configuration.json'
import typescriptLanguageConfig from './language-configs/typescript.language-configuration.json'
import javascriptLanguageConfig from './language-configs/javascript.language-configuration.json'
import jsonLanguageConfig from './language-configs/json.language-configuration.json'

const ROOT_SCOPE_TO_LANGUAGE_ID: Record<string, string> = {
  'source.ts': 'typescript',
  'source.js': 'javascript',
  'source.json': 'json',
  'source.css': 'css',
  'text.html.basic': 'html',
  'text.html.markdown': 'markdown',
  'source.vue': 'vue',
}

export interface TextmateGrammarItem {
  scopeName: string
  grammar: unknown
  injectTo?: string[]
}

export interface TextmateLanguageDescriptor {
  languageId: string
  rootScopeName: string
  aliases?: string[]
  embeddedScopeToLanguage?: Record<string, string>
}

export interface TextmateRegistryData {
  grammarsByScope: Map<string, IRawGrammar>
  injectionsByTargetScope: Map<string, string[]>
  languageById: Map<string, TextmateLanguageDescriptor>
  languageByScope: Map<string, TextmateLanguageDescriptor>
  languageConfigurationById: Map<string, languages.LanguageConfiguration>
  themes: {
    light: IRawTheme
    dark: IRawTheme
  }
}

const GRAMMAR_ITEMS: TextmateGrammarItem[] = [
  { scopeName: 'source.ts', grammar: sourceTsGrammar },
  { scopeName: 'source.js', grammar: sourceJsGrammar },
  { scopeName: 'source.json', grammar: sourceJsonGrammar },
  { scopeName: 'source.json.comments', grammar: sourceJsoncGrammar },
  { scopeName: 'source.json5', grammar: sourceJson5Grammar },
  { scopeName: 'source.css', grammar: sourceCssGrammar },
  { scopeName: 'text.html.basic', grammar: sourceHtmlGrammar },
  { scopeName: 'text.html.derivative', grammar: sourceHtmlDerivativeGrammar },
  { scopeName: 'text.html.markdown', grammar: sourceMarkdownGrammar },
  { scopeName: 'source.vue', grammar: sourceVueGrammar },
  {
    scopeName: 'markdown.vue.codeblock',
    grammar: markdownVueCodeblockGrammar,
    injectTo: ['text.html.markdown'],
  },
  {
    scopeName: 'vue.directives',
    grammar: vueDirectivesGrammar,
    injectTo: ['source.vue', 'text.html.markdown', 'text.html.derivative', 'text.pug'],
  },
  {
    scopeName: 'vue.interpolations',
    grammar: vueInterpolationsGrammar,
    injectTo: ['source.vue', 'text.html.markdown', 'text.html.derivative', 'text.pug'],
  },
  {
    scopeName: 'vue.sfc.style.variable.injection',
    grammar: vueStyleInjectionGrammar,
    injectTo: ['source.css', 'source.postcss', 'source.sass', 'source.stylus'],
  },
]

const TEXTMATE_LANGUAGES: TextmateLanguageDescriptor[] = [
  {
    languageId: 'typescript',
    rootScopeName: 'source.ts',
    aliases: ['typescriptreact'],
    embeddedScopeToLanguage: {
      'source.ts': 'typescript',
    },
  },
  {
    languageId: 'javascript',
    rootScopeName: 'source.js',
    aliases: ['javascriptreact'],
    embeddedScopeToLanguage: {
      'source.js': 'javascript',
    },
  },
  {
    languageId: 'javascriptreact',
    rootScopeName: 'source.js',
    embeddedScopeToLanguage: {
      'source.js': 'javascript',
    },
  },
  {
    languageId: 'typescriptreact',
    rootScopeName: 'source.ts',
    embeddedScopeToLanguage: {
      'source.ts': 'typescript',
    },
  },
  {
    languageId: 'json',
    rootScopeName: 'source.json',
    aliases: ['jsonc', 'json5'],
    embeddedScopeToLanguage: {
      'source.json': 'json',
      'source.json.comments': 'jsonc',
      'source.json5': 'json5',
    },
  },
  {
    languageId: 'css',
    rootScopeName: 'source.css',
    aliases: ['scss', 'less'],
    embeddedScopeToLanguage: {
      'source.css': 'css',
      'source.css.scss': 'scss',
      'source.css.less': 'less',
    },
  },
  {
    languageId: 'html',
    rootScopeName: 'text.html.basic',
    embeddedScopeToLanguage: {
      'text.html.basic': 'html',
      'text.html.derivative': 'html',
      'source.js': 'javascript',
      'source.css': 'css',
    },
  },
  {
    languageId: 'markdown',
    rootScopeName: 'text.html.markdown',
    aliases: ['mdx', 'mdc'],
    embeddedScopeToLanguage: {
      'text.html.markdown': 'markdown',
      'text.html.derivative': 'html',
      'text.html.basic': 'html',
      'source.js': 'javascript',
      'source.ts': 'typescript',
      'source.css': 'css',
      'source.json': 'json',
      'source.json.comments': 'jsonc',
      'source.json5': 'json5',
      'source.vue': 'vue',
    },
  },
  {
    languageId: 'vue',
    rootScopeName: 'source.vue',
    embeddedScopeToLanguage: {
      'source.vue': 'vue',
      'text.html.derivative': 'html',
      'text.html.basic': 'html',
      'text.html.markdown': 'markdown',
      'source.css': 'css',
      'source.css.scss': 'scss',
      'source.css.less': 'less',
      'source.js': 'javascript',
      'source.ts': 'typescript',
      'source.js.jsx': 'javascript',
      'source.tsx': 'typescript',
      'source.json': 'json',
      'source.json.comments': 'jsonc',
      'source.json5': 'json5',
    },
  },
]

function normalizeLanguageConfig(value: unknown): languages.LanguageConfiguration {
  return value as languages.LanguageConfiguration
}

function normalizeRawGrammar(scopeName: string, value: unknown): IRawGrammar {
  const raw = value as Record<string, unknown>
  return {
    ...raw,
    scopeName,
  } as unknown as IRawGrammar
}

function normalizeRawTheme(value: unknown): IRawTheme {
  const raw = value as { name?: string; tokenColors?: unknown }
  const settings = Array.isArray(raw.tokenColors) ? raw.tokenColors : []
  return {
    name: raw.name,
    settings: settings as IRawTheme['settings'],
  }
}

export function buildTextmateRegistry(): TextmateRegistryData {
  const grammarsByScope = new Map<string, IRawGrammar>()
  const injectionsByTargetScope = new Map<string, string[]>()

  for (const item of GRAMMAR_ITEMS) {
    const grammar = normalizeRawGrammar(item.scopeName, item.grammar)
    grammarsByScope.set(item.scopeName, grammar)

    const injectTargets = item.injectTo ?? (((item.grammar as { injectTo?: string[] })?.injectTo) ?? [])
    for (const targetScope of injectTargets) {
      if (!targetScope) continue
      const current = injectionsByTargetScope.get(targetScope) ?? []
      if (!current.includes(item.scopeName)) {
        current.push(item.scopeName)
      }
      injectionsByTargetScope.set(targetScope, current)
    }
  }

  const languageById = new Map<string, TextmateLanguageDescriptor>()
  const languageByScope = new Map<string, TextmateLanguageDescriptor>()

  for (const descriptor of TEXTMATE_LANGUAGES) {
    languageById.set(descriptor.languageId, descriptor)
    languageByScope.set(descriptor.rootScopeName, descriptor)

    for (const alias of descriptor.aliases ?? []) {
      if (!languageById.has(alias)) {
        languageById.set(alias, descriptor)
      }
    }
  }

  const languageConfigurationById = new Map<string, languages.LanguageConfiguration>()
  languageConfigurationById.set('vue', normalizeLanguageConfig(vueLanguageConfig))
  languageConfigurationById.set('markdown', normalizeLanguageConfig(markdownLanguageConfig))
  languageConfigurationById.set('typescript', normalizeLanguageConfig(typescriptLanguageConfig))
  languageConfigurationById.set('javascript', normalizeLanguageConfig(javascriptLanguageConfig))
  languageConfigurationById.set('json', normalizeLanguageConfig(jsonLanguageConfig))

  // Reuse same defaults for monaco sibling ids where practical.
  languageConfigurationById.set('typescriptreact', normalizeLanguageConfig(typescriptLanguageConfig))
  languageConfigurationById.set('javascriptreact', normalizeLanguageConfig(javascriptLanguageConfig))
  languageConfigurationById.set('jsonc', normalizeLanguageConfig(jsonLanguageConfig))

  return {
    grammarsByScope,
    injectionsByTargetScope,
    languageById,
    languageByScope,
    languageConfigurationById,
    themes: {
      light: normalizeRawTheme(lightPlusTheme),
      dark: normalizeRawTheme(darkPlusTheme),
    },
  }
}

export function resolveRootScopeForLanguage(
  languageId: string,
  registry: TextmateRegistryData,
): string | null {
  const descriptor = registry.languageById.get(languageId)
  if (descriptor) return descriptor.rootScopeName

  // Fallback for less common monaco ids that are directly mapped via root scope table.
  for (const [scopeName, mappedLanguageId] of Object.entries(ROOT_SCOPE_TO_LANGUAGE_ID)) {
    if (mappedLanguageId === languageId) {
      return scopeName
    }
  }

  return null
}
