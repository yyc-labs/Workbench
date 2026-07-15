import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type PropsWithChildren, type RefCallback, type RefObject } from 'react'

const DEFAULT_MARKDOWN_VISIBILITY_ROOT_MARGIN = '480px 0px'

function parseVerticalRootMargin(rootMargin: string): number {
  const firstValue = rootMargin.trim().split(/\s+/)[0] ?? ''
  const parsed = Number.parseFloat(firstValue)
  return Number.isFinite(parsed) ? parsed : 0
}

function isNearViewport(element: Element, root: Element | null, rootMargin: string): boolean {
  const elementRect = element.getBoundingClientRect()
  const rootRect = root?.getBoundingClientRect()
  const viewportTop = rootRect?.top ?? 0
  const viewportBottom = rootRect?.bottom ?? window.innerHeight
  const margin = parseVerticalRootMargin(rootMargin)

  return elementRect.bottom >= viewportTop - margin && elementRect.top <= viewportBottom + margin
}

type MarkdownVisibilityContextValue = {
  forceRenderAllBlocks: boolean
  register: (element: Element, onVisibilityChange: (isNearViewport: boolean) => void) => () => void
}

const MarkdownVisibilityContext = createContext<MarkdownVisibilityContextValue | null>(null)

type MarkdownPreviewVisibilityProviderProps = PropsWithChildren<{
  forceRenderAllBlocks?: boolean
  rootMargin?: string
  rootRef?: RefObject<Element | null> | null
}>

export function MarkdownPreviewVisibilityProvider({ children, forceRenderAllBlocks = false, rootMargin = DEFAULT_MARKDOWN_VISIBILITY_ROOT_MARGIN, rootRef = null }: MarkdownPreviewVisibilityProviderProps) {
  const registrationsRef = useRef(new Map<Element, (isNearViewport: boolean) => void>())
  const observerRef = useRef<IntersectionObserver | null>(null)

  useLayoutEffect(() => {
    if (forceRenderAllBlocks || typeof IntersectionObserver === 'undefined') return

    const root = rootRef?.current ?? null
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting || entry.intersectionRatio > 0) {
            registrationsRef.current.get(entry.target)?.(true)
          }
        }
      },
      {
        // The browser viewport still accounts for clipping by nested scroll
        // containers, and is more reliable in Electron than using the preview
        // pane itself as the observer root.
        root: null,
        rootMargin,
        threshold: 0.01,
      },
    )

    observerRef.current = observer
    for (const element of registrationsRef.current.keys()) {
      observer.observe(element)
      // Ref callbacks can run before the scroll container has completed layout.
      // Recheck after the root and all preview blocks have their final geometry.
      if (isNearViewport(element, root, rootMargin) || isNearViewport(element, null, rootMargin)) {
        registrationsRef.current.get(element)?.(true)
      }
    }

    return () => {
      observer.disconnect()
      observerRef.current = null
    }
  }, [forceRenderAllBlocks, rootMargin, rootRef])

  const register = useCallback(
    (element: Element, onVisibilityChange: (isNearViewport: boolean) => void) => {
      if (forceRenderAllBlocks || typeof IntersectionObserver === 'undefined') {
        onVisibilityChange(true)
        return () => {}
      }

      registrationsRef.current.set(element, onVisibilityChange)
      if (isNearViewport(element, rootRef?.current ?? null, rootMargin) || isNearViewport(element, null, rootMargin)) {
        onVisibilityChange(true)
      }
      observerRef.current?.observe(element)

      return () => {
        registrationsRef.current.delete(element)
        observerRef.current?.unobserve(element)
      }
    },
    [forceRenderAllBlocks, rootMargin, rootRef],
  )

  const value = useMemo<MarkdownVisibilityContextValue>(
    () => ({
      forceRenderAllBlocks,
      register,
    }),
    [forceRenderAllBlocks, register],
  )

  return <MarkdownVisibilityContext.Provider value={value}>{children}</MarkdownVisibilityContext.Provider>
}

export function useMarkdownNearViewport<T extends Element>(rootMargin = DEFAULT_MARKDOWN_VISIBILITY_ROOT_MARGIN): [RefCallback<T>, boolean] {
  const context = useContext(MarkdownVisibilityContext)
  const elementRef = useRef<T | null>(null)
  const unregisterRef = useRef<() => void>(() => {})
  const [isNearViewport, setIsNearViewport] = useState(() => Boolean(context?.forceRenderAllBlocks))

  const registerElement = useCallback(
    (element: T | null) => {
      unregisterRef.current()
      unregisterRef.current = () => {}
      elementRef.current = element
      if (!element) return

      if (context) {
        if (!context.forceRenderAllBlocks) {
          unregisterRef.current = context.register(element, setIsNearViewport)
        }
        return
      }

      if (typeof IntersectionObserver === 'undefined') {
        setIsNearViewport(true)
        return
      }

      const observer = new IntersectionObserver(
        (entries) => {
          if (entries.some((entry) => entry.isIntersecting || entry.intersectionRatio > 0)) {
            setIsNearViewport(true)
          }
        },
        {
          root: null,
          rootMargin,
          threshold: 0.01,
        },
      )
      observer.observe(element)
      unregisterRef.current = () => observer.disconnect()
    },
    [context, rootMargin],
  )

  useEffect(() => {
    return () => {
      unregisterRef.current()
      unregisterRef.current = () => {}
      elementRef.current = null
    }
  }, [])

  return [registerElement, Boolean(context?.forceRenderAllBlocks) || isNearViewport]
}
