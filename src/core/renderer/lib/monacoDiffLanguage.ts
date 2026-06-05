import type * as Monaco from 'monaco-editor'

export const GIT_DIFF_MONACO_LANGUAGE_ID = 'git-patch-diff'

let gitDiffLanguageReady = false

export function ensureGitDiffMonacoLanguage(monaco: typeof Monaco): void {
  if (gitDiffLanguageReady) return

  const exists = monaco.languages.getLanguages().some((language) => language.id === GIT_DIFF_MONACO_LANGUAGE_ID)
  if (!exists) {
    monaco.languages.register({ id: GIT_DIFF_MONACO_LANGUAGE_ID })
    monaco.languages.setMonarchTokensProvider(GIT_DIFF_MONACO_LANGUAGE_ID, {
      tokenizer: {
        root: [
          [/^diff --git .*$/, 'keyword'],
          [/^index .*$/, 'comment'],
          [/^@@ .* @@.*$/, 'regexp'],
          [/^\+\+\+ .*$/, 'meta'],
          [/^--- .*$/, 'meta'],
          [/^\+.*$/, 'string'],
          [/^-.*$/, 'keyword'],
          [/^\\ No newline at end of file$/, 'comment'],
        ],
      },
    })
  }

  gitDiffLanguageReady = true
}
