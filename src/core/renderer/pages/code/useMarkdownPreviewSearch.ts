import { useCallback, useEffect, useRef, useState } from 'react'

type PreviewSearchMatch = {
  mark: HTMLElement
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function clearPreviewSearchMarks(container: HTMLElement): void {
  const marks = container.querySelectorAll('mark.code-markdown-search-highlight')
  marks.forEach((markNode) => {
    const parent = markNode.parentNode
    if (!parent) return
    const text = document.createTextNode(markNode.textContent ?? '')
    parent.replaceChild(text, markNode)
    parent.normalize()
  })
}

function computePreviewSearchMatches(container: HTMLElement, query: string): PreviewSearchMatch[] {
  const normalizedQuery = query.trim()
  if (!normalizedQuery) return []

  const escapedQuery = escapeRegExp(normalizedQuery)
  const matcher = new RegExp(escapedQuery, 'gi')
  const textNodes: Text[] = []
  const walker = document.createTreeWalker(
    container,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        if (!node.nodeValue || node.nodeValue.trim().length === 0) {
          return NodeFilter.FILTER_REJECT
        }
        if (!(node.parentElement instanceof HTMLElement)) {
          return NodeFilter.FILTER_ACCEPT
        }
        if (node.parentElement.closest('mark.code-markdown-search-highlight')) {
          return NodeFilter.FILTER_REJECT
        }
        return NodeFilter.FILTER_ACCEPT
      },
    }
  )

  while (walker.nextNode()) {
    if (walker.currentNode instanceof Text) {
      textNodes.push(walker.currentNode)
    }
  }

  const matches: PreviewSearchMatch[] = []
  textNodes.forEach((textNode) => {
    const value = textNode.nodeValue ?? ''
    matcher.lastIndex = 0
    let currentOffset = 0
    let remainderNode: Text = textNode

    while (currentOffset <= value.length) {
      const next = matcher.exec(value)
      if (!next) break
      const rawMatched = next[0] ?? ''
      if (!rawMatched) {
        matcher.lastIndex = next.index + 1
        continue
      }

      const start = next.index
      const end = start + rawMatched.length
      const relativeStart = start - currentOffset
      const relativeEnd = end - currentOffset

      if (relativeStart < 0 || relativeEnd <= relativeStart || relativeStart > remainderNode.length) {
        currentOffset = end
        continue
      }

      if (relativeStart > 0) {
        remainderNode = remainderNode.splitText(relativeStart)
      }

      const tailLength = relativeEnd - relativeStart
      const tailNode = remainderNode.splitText(tailLength)
      const matchedNode = remainderNode
      remainderNode = tailNode

      const markNode = document.createElement('mark')
      markNode.className = 'code-markdown-search-highlight'
      markNode.textContent = matchedNode.nodeValue ?? ''
      matchedNode.parentNode?.replaceChild(markNode, matchedNode)

      matches.push({ mark: markNode })
      currentOffset = end
    }
  })

  return matches
}

export function useMarkdownPreviewSearch(
  previewScrollRef: React.RefObject<HTMLDivElement>,
  shouldHandleFindInPreview: boolean,
  markdownPreviewContent: string
) {
  const [previewSearchVisible, setPreviewSearchVisible] = useState(false)
  const [previewSearchQuery, setPreviewSearchQuery] = useState('')
  const [activePreviewSearchMatchIndex, setActivePreviewSearchMatchIndex] = useState(0)
  const [previewSearchMatches, setPreviewSearchMatches] = useState<PreviewSearchMatch[]>([])
  const previewSearchInputRef = useRef<HTMLInputElement | null>(null)

  const closePreviewSearch = useCallback(() => {
    const previewPane = previewScrollRef.current
    if (previewPane) {
      clearPreviewSearchMarks(previewPane)
    }
    setPreviewSearchVisible(false)
    setPreviewSearchQuery('')
    setPreviewSearchMatches([])
    setActivePreviewSearchMatchIndex(0)
  }, [previewScrollRef])

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

  const goToPreviewSearchMatchByIndex = useCallback((index: number) => {
    if (previewSearchMatches.length === 0) return
    const normalizedIndex = ((index % previewSearchMatches.length) + previewSearchMatches.length) % previewSearchMatches.length
    const match = previewSearchMatches[normalizedIndex]
    setActivePreviewSearchMatchIndex(normalizedIndex)
    previewSearchMatches.forEach((item, itemIndex) => {
      if (itemIndex === normalizedIndex) {
        item.mark.classList.add('is-active')
      } else {
        item.mark.classList.remove('is-active')
      }
    })
    match.mark.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'nearest' })
  }, [previewSearchMatches])

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

    clearPreviewSearchMarks(previewPane)
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
    previewSearchMatches.forEach((item, itemIndex) => {
      item.mark.classList.toggle('is-active', itemIndex === normalizedIndex)
    })
    match.mark.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'nearest' })
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
