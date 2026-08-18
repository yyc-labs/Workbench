import { EditorStatus, commandsCtx, type Editor } from '@milkdown/core'
import {
  clearTextInCurrentBlockCommand,
  createCodeBlockCommand,
  insertHrCommand,
  insertImageCommand,
  toggleEmphasisCommand,
  toggleInlineCodeCommand,
  toggleLinkCommand,
  toggleStrongCommand,
  turnIntoTextCommand,
  updateImageCommand,
  updateLinkCommand,
  wrapInBlockquoteCommand,
  wrapInBulletListCommand,
  wrapInHeadingCommand,
  wrapInOrderedListCommand,
  type UpdateImageCommandPayload,
  type UpdateLinkCommandPayload,
  sinkListItemCommand,
  liftListItemCommand,
} from '@milkdown/preset-commonmark'
import { addColAfterCommand, addColBeforeCommand, addRowAfterCommand, addRowBeforeCommand, deleteSelectedCellsCommand, exitTable, insertTableCommand, toggleStrikethroughCommand, selectTableCommand } from '@milkdown/preset-gfm'
import type { EditorState } from '@milkdown/prose/state'

export type MarkdownDocumentCommandId =
  | 'toggle-strong'
  | 'toggle-emphasis'
  | 'toggle-strikethrough'
  | 'toggle-inline-code'
  | 'toggle-link'
  | 'update-link'
  | 'update-image'
  | 'clear-format'
  | 'paragraph'
  | 'heading-1'
  | 'heading-2'
  | 'heading-3'
  | 'heading-4'
  | 'heading-5'
  | 'heading-6'
  | 'blockquote'
  | 'code-block'
  | 'horizontal-rule'
  | 'bullet-list'
  | 'ordered-list'
  | 'sink-list-item'
  | 'lift-list-item'
  | 'insert-link'
  | 'insert-image'
  | 'insert-code-block'
  | 'insert-table'
  | 'table-add-row-before'
  | 'table-add-row-after'
  | 'table-add-col-before'
  | 'table-add-col-after'
  | 'table-delete-cells'
  | 'table-select-row'
  | 'table-select-col'
  | 'table-select-all'
  | 'table-exit'

export type MarkdownDocumentCommandPayload = UpdateLinkCommandPayload | UpdateImageCommandPayload | { row: number; col: number } | number | string | undefined | unknown

export type MarkdownDocumentCommandDefinition = {
  id: MarkdownDocumentCommandId
  payload?: MarkdownDocumentCommandPayload
}

export type MarkdownDocumentSelectionContext = {
  inCodeBlock: boolean
  inTable: boolean
  inList: boolean
  hasSelection: boolean
  parentType: string | null
  docSize: number
}

function getAncestorNames(state: EditorState): string[] {
  const names: string[] = []
  for (let depth = state.selection.$from.depth; depth >= 0; depth -= 1) {
    names.push(state.selection.$from.node(depth).type.name)
  }
  return names
}

export function getMarkdownDocumentSelectionContext(state: EditorState): MarkdownDocumentSelectionContext {
  const names = getAncestorNames(state)
  return {
    inCodeBlock: names.indexOf('code_block') >= 0,
    inTable: names.indexOf('table') >= 0,
    inList: names.indexOf('bullet_list') >= 0 || names.indexOf('ordered_list') >= 0 || names.indexOf('list_item') >= 0,
    hasSelection: !state.selection.empty,
    parentType: names[0] ?? null,
    docSize: state.doc.content.size,
  }
}

export function canRunMarkdownDocumentCommand(command: MarkdownDocumentCommandId, context: MarkdownDocumentSelectionContext): boolean {
  if (context.inCodeBlock) {
    return command === 'paragraph' || command === 'code-block' || command === 'horizontal-rule' || command === 'clear-format' || command.indexOf('insert-') === 0
  }

  if (context.inTable) {
    return command.indexOf('table-') === 0 || command === 'insert-table' || command === 'clear-format'
  }

  return true
}

export function runMarkdownDocumentCommand(editor: Editor, command: MarkdownDocumentCommandDefinition): boolean {
  if (editor.status !== EditorStatus.Created) return false

  return editor.action((ctx) => {
    const commands = ctx.get(commandsCtx)
    if (command.id === 'toggle-strong') return commands.call(toggleStrongCommand.key)
    if (command.id === 'toggle-emphasis') return commands.call(toggleEmphasisCommand.key)
    if (command.id === 'toggle-strikethrough') return commands.call(toggleStrikethroughCommand.key)
    if (command.id === 'toggle-inline-code') return commands.call(toggleInlineCodeCommand.key)
    if (command.id === 'toggle-link') return commands.call(toggleLinkCommand.key, command.payload as UpdateLinkCommandPayload | undefined)
    if (command.id === 'update-link') return commands.call(updateLinkCommand.key, command.payload as UpdateLinkCommandPayload)
    if (command.id === 'update-image') return commands.call(updateImageCommand.key, command.payload as UpdateImageCommandPayload)
    if (command.id === 'clear-format') return commands.call(clearTextInCurrentBlockCommand.key)
    if (command.id === 'paragraph') return commands.call(turnIntoTextCommand.key)
    if (command.id === 'heading-1') return commands.call(wrapInHeadingCommand.key, 1)
    if (command.id === 'heading-2') return commands.call(wrapInHeadingCommand.key, 2)
    if (command.id === 'heading-3') return commands.call(wrapInHeadingCommand.key, 3)
    if (command.id === 'heading-4') return commands.call(wrapInHeadingCommand.key, 4)
    if (command.id === 'heading-5') return commands.call(wrapInHeadingCommand.key, 5)
    if (command.id === 'heading-6') return commands.call(wrapInHeadingCommand.key, 6)
    if (command.id === 'blockquote') return commands.call(wrapInBlockquoteCommand.key)
    if (command.id === 'code-block') return commands.call(createCodeBlockCommand.key)
    if (command.id === 'horizontal-rule') return commands.call(insertHrCommand.key)
    if (command.id === 'bullet-list') return commands.call(wrapInBulletListCommand.key)
    if (command.id === 'ordered-list') return commands.call(wrapInOrderedListCommand.key)
    if (command.id === 'sink-list-item') return commands.call(sinkListItemCommand.key)
    if (command.id === 'lift-list-item') return commands.call(liftListItemCommand.key)
    if (command.id === 'insert-link') return commands.call(toggleLinkCommand.key, command.payload as UpdateLinkCommandPayload | undefined)
    if (command.id === 'insert-image') return commands.call(insertImageCommand.key, command.payload as UpdateImageCommandPayload)
    if (command.id === 'insert-code-block') return commands.call(createCodeBlockCommand.key)
    if (command.id === 'insert-table') return commands.call(insertTableCommand.key, command.payload as { row: number; col: number })
    if (command.id === 'table-add-row-before') return commands.call(addRowBeforeCommand.key)
    if (command.id === 'table-add-row-after') return commands.call(addRowAfterCommand.key)
    if (command.id === 'table-add-col-before') return commands.call(addColBeforeCommand.key)
    if (command.id === 'table-add-col-after') return commands.call(addColAfterCommand.key)
    if (command.id === 'table-delete-cells') return commands.call(deleteSelectedCellsCommand.key)
    if (command.id === 'table-select-all') return commands.call(selectTableCommand.key)
    if (command.id === 'table-exit') return commands.call(exitTable.key)
    return false
  })
}
