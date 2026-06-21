import { ensureMonacoEnvironmentConfigured } from './monacoEnvironment'

type MonacoEditorModule = typeof import('monaco-editor')

let monacoEditorModulePromise: Promise<MonacoEditorModule> | null = null

export function loadMonacoEditorModule(): Promise<MonacoEditorModule> {
  ensureMonacoEnvironmentConfigured()
  monacoEditorModulePromise ??= import('monaco-editor')
  return monacoEditorModulePromise
}

export function preloadMonacoEditorModule(): void {
  void loadMonacoEditorModule()
}
