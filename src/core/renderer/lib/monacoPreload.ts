import { ensureMonacoEnvironmentConfigured } from './monacoEnvironment'
import { configureMonacoTypeScriptDefaults } from './monacoTypeScriptDefaults'

type MonacoEditorModule = typeof import('monaco-editor')

let monacoEditorModulePromise: Promise<MonacoEditorModule> | null = null

export function loadMonacoEditorModule(): Promise<MonacoEditorModule> {
  ensureMonacoEnvironmentConfigured()
  monacoEditorModulePromise ??= import('monaco-editor').then((monaco) => {
    configureMonacoTypeScriptDefaults(monaco)
    return monaco
  })
  return monacoEditorModulePromise
}

export function preloadMonacoEditorModule(): void {
  void loadMonacoEditorModule()
}
