import { type KeyboardEvent, type RefObject, type UIEventHandler } from 'react'
import { continueMarkdownList, indentMarkdownLines, outdentMarkdownLines } from '../learning/notes/learningMarkdownEditor'

type MarkdownDocumentSourceEditorProps = {
  value: string
  editorRef: RefObject<HTMLTextAreaElement>
  onChange: (value: string) => void
  onScroll?: UIEventHandler<HTMLTextAreaElement>
  className?: string
}

export function MarkdownDocumentSourceEditor({ value, editorRef, onChange, onScroll, className }: MarkdownDocumentSourceEditorProps) {
  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    const editor = event.currentTarget
    const start = editor.selectionStart
    const end = editor.selectionEnd

    if (event.key === 'Tab') {
      event.preventDefault()
      const result = event.shiftKey ? outdentMarkdownLines(value, start, end) : indentMarkdownLines(value, start, end)
      onChange(result.value)
      requestAnimationFrame(() => editor.setSelectionRange(result.selectionStart, result.selectionEnd))
      return
    }

    if (event.key === 'Enter') {
      const result = continueMarkdownList(value, start, end)
      if (result) {
        event.preventDefault()
        onChange(result.value)
        requestAnimationFrame(() => editor.setSelectionRange(result.selectionStart, result.selectionEnd))
      }
    }
  }

  return <textarea ref={editorRef} value={value} onChange={(event) => onChange(event.target.value)} onKeyDown={handleKeyDown} onScroll={onScroll} className={className} spellCheck={false} aria-label="Markdown source editor" />
}
