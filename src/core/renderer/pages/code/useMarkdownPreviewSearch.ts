import { useCallback, useEffect, useRef, useState } from 'react'

type PreviewSearchMatch = {
  range: Range
}

const PREVIEW_SEARCH_HIGHLIGHT_NAME = 'code-markdown-search-highlight'
const PREVIEW_SEARCH_ACTIVE_HIGHLIGHT_NAME = 'code-markdown-search-highlight-active'

type SearchHighlightRegistry = {
  set: (name: string, highlight: unknown) => void
  delete: (name: string) => void
}

type SearchHighlightConstructor = new (...ranges: Range[]) => unknown

function getSearchHighlightApi(): { registry: SearchHighlightRegistry; Highlight: SearchHighlightConstructor } | null {
  const css = (globalThis as typeof globalThis & { CSS?: { highlights?: SearchHighlightRegistry } }).CSS
  const Highlight = (globalThis as typeof globalThis & { Highlight?: SearchHighlightConstructor }).Highlight
  if (!css?.highlights || !Highlight) return null
  return { registry: css.highlights, Highlight }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function clearPreviewSearchHighlights(): void {
  const api = getSearchHighlightApi()
  if (!api) return
  api.registry.delete(PREVIEW_SEARCH_HIGHLIGHT_NAME)
  api.registry.delete(PREVIEW_SEARCH_ACTIVE_HIGHLIGHT_NAME)
}

function computePreviewSearchMatches(container: HTMLElement, query: string): PreviewSearchMatch[] {
  const normalizedQuery = query.trim()
  if (!normalizedQuery) return []

  const escapedQuery = escapeRegExp(normalizedQuery)
  const matcher = new RegExp(escapedQuery, 'gi')
  const textNodes: Text[] = []
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue || node.nodeValue.trim().length === 0) {
        return NodeFilter.FILTER_REJECT
      }
      const parentElement = node.parentElement
      if (!parentElement) {
        return NodeFilter.FILTER_REJECT
      }
      // Mermaid renders its labels as SVG text nodes. Search ranges must not
      // cross into that tree because SVG text is not regular page content.
      if (parentElement.closest('svg')) {
        return NodeFilter.FILTER_REJECT
      }
      return NodeFilter.FILTER_ACCEPT
    },
  })

  while (walker.nextNode()) {
    if (walker.currentNode instanceof Text) {
      textNodes.push(walker.currentNode)
    }
  }

  const matches: PreviewSearchMatch[] = []
  textNodes.forEach((textNode) => {
    const value = textNode.nodeValue ?? ''
    matcher.lastIndex = 0
    while (matcher.lastIndex <= value.length) {
      const next = matcher.exec(value)
      if (!next) break
      const rawMatched = next[0] ?? ''
      if (!rawMatched) {
        matcher.lastIndex = next.index + 1
        continue
      }

      const start = next.index
      const end = start + rawMatched.length
      if (end <= start || end > value.length) continue

      const range = document.createRange()
      range.setStart(textNode, start)
      range.setEnd(textNode, end)
      matches.push({ range })
    }
  })

  return matches
}

function applyPreviewSearchHighlights(matches: PreviewSearchMatch[], activeIndex: number): void {
  const api = getSearchHighlightApi()
  if (!api) return

  const ranges = matches.map((match) => match.range)
  api.registry.set(PREVIEW_SEARCH_HIGHLIGHT_NAME, new api.Highlight(...ranges))

  const activeRange = matches[activeIndex]?.range
  if (activeRange) {
    api.registry.set(PREVIEW_SEARCH_ACTIVE_HIGHLIGHT_NAME, new api.Highlight(activeRange))
  } else {
    api.registry.delete(PREVIEW_SEARCH_ACTIVE_HIGHLIGHT_NAME)
  }
}

export function useMarkdownPreviewSearch(previewScrollRef: React.RefObject<HTMLDivElement>, shouldHandleFindInPreview: boolean, markdownPreviewContent: string) {
  const [previewSearchVisible, setPreviewSearchVisible] = useState(false)
  const [previewSearchQuery, setPreviewSearchQuery] = useState('')
  const [activePreviewSearchMatchIndex, setActivePreviewSearchMatchIndex] = useState(0)
  const [previewSearchMatches, setPreviewSearchMatches] = useState<PreviewSearchMatch[]>([])
  const previewSearchInputRef = useRef<HTMLInputElement | null>(null)

  const closePreviewSearch = useCallback(() => {
    clearPreviewSearchHighlights()
    setPreviewSearchVisible(false)
    setPreviewSearchQuery('')
    setPreviewSearchMatches([])
    setActivePreviewSearchMatchIndex(0)
  }, [])

  useEffect(() => {
    return () => {
      clearPreviewSearchHighlights()
    }
  }, [])

  const openPreviewSearch = useCallback(() => {
    if (!shouldHandleFindInPreview) return
    setPreviewSearchVisible(true)
    window.setTimeout(() => {
      const input = previewSearchInputRef.current
      if (!input) return
      input.focus()
      input.select()
    }, 0)
  }, [shouldHandleFindInPreview])

  const goToPreviewSearchMatchByIndex = useCallback(
    (index: number) => {
      if (previewSearchMatches.length === 0) return
      const normalizedIndex = ((index % previewSearchMatches.length) + previewSearchMatches.length) % previewSearchMatches.length
      const match = previewSearchMatches[normalizedIndex]
      setActivePreviewSearchMatchIndex(normalizedIndex)
      applyPreviewSearchHighlights(previewSearchMatches, normalizedIndex)
      const target = match.range.startContainer.parentElement
      target?.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'nearest' })
    },
    [previewSearchMatches],
  )

  const goToNextPreviewSearchMatch = useCallback(() => {
    if (previewSearchMatches.length === 0) return
    goToPreviewSearchMatchByIndex(activePreviewSearchMatchIndex + 1)
  }, [activePreviewSearchMatchIndex, goToPreviewSearchMatchByIndex, previewSearchMatches.length])

  const goToPreviousPreviewSearchMatch = useCallback(() => {
    if (previewSearchMatches.length === 0) return
    goToPreviewSearchMatchByIndex(activePreviewSearchMatchIndex - 1)
  }, [activePreviewSearchMatchIndex, goToPreviewSearchMatchByIndex, previewSearchMatches.length])

  useEffect(() => {
    if (!previewSearchVisible || !shouldHandleFindInPreview) {
      if (!previewSearchVisible) return
      closePreviewSearch()
    }
  }, [closePreviewSearch, previewSearchVisible, shouldHandleFindInPreview])

  useEffect(() => {
    if (!previewSearchVisible) return
    const previewPane = previewScrollRef.current
    if (!previewPane) return

    clearPreviewSearchHighlights()
    const nextMatches = computePreviewSearchMatches(previewPane, previewSearchQuery)
    setPreviewSearchMatches(nextMatches)

    if (nextMatches.length === 0) {
      setActivePreviewSearchMatchIndex(0)
      return
    }

    setActivePreviewSearchMatchIndex((prev) => Math.min(prev, nextMatches.length - 1))
  }, [markdownPreviewContent, previewScrollRef, previewSearchQuery, previewSearchVisible])

  useEffect(() => {
    if (!previewSearchVisible) return
    if (previewSearchMatches.length === 0) return
    const normalizedIndex = ((activePreviewSearchMatchIndex % previewSearchMatches.length) + previewSearchMatches.length) % previewSearchMatches.length
    if (normalizedIndex !== activePreviewSearchMatchIndex) {
      setActivePreviewSearchMatchIndex(normalizedIndex)
      return
    }
    const match = previewSearchMatches[normalizedIndex]
    applyPreviewSearchHighlights(previewSearchMatches, normalizedIndex)
    const target = match.range.startContainer.parentElement
    target?.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'nearest' })
  }, [activePreviewSearchMatchIndex, previewSearchMatches, previewSearchVisible])

  return {
    previewSearchVisible,
    previewSearchQuery,
    setPreviewSearchQuery,
    activePreviewSearchMatchIndex,
    setActivePreviewSearchMatchIndex,
    previewSearchMatches,
    previewSearchInputRef,
    closePreviewSearch,
    openPreviewSearch,
    goToNextPreviewSearchMatch,
    goToPreviousPreviewSearchMatch,
  }
}
