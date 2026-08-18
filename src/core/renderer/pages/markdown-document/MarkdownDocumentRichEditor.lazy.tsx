import { lazy } from 'react'

export const MarkdownDocumentRichEditorLazy = lazy(() => import('./MarkdownDocumentRichEditor').then((module) => ({ default: module.MarkdownDocumentRichEditor })))
