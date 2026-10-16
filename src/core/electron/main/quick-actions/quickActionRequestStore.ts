import { parseQuickActionArg } from '../launchArgs'

/**
 * Pending quick action request store for cold starts: a desktop `.lnk` launch
 * passes `--quick-action=<id>`; the request is captured at module top (before
 * the window exists) and consumed at the end of the startup chain.
 *
 * Mirrors MarkdownDocumentOpenRequestStore.
 */
export class QuickActionRequestStore {
  private pendingId: string | null = null

  setFromArgv(argv: readonly string[]): string | null {
    const id = parseQuickActionArg(argv)
    if (id) this.pendingId = id
    return id
  }

  consume(): { id: string } | null {
    if (!this.pendingId) return null
    const id = this.pendingId
    this.pendingId = null
    return { id }
  }
}
