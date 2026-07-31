import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type PropsWithChildren, type RefCallback, type RefObject } from 'react'

const DEFAULT_MARKDOWN_VISIBILITY_ROOT_MARGIN = '480px 0px'

function parseVerticalRootMargin(rootMargin: string): number {
  const firstValue = rootMargin.trim().split(/\s+/)[0] ?? ''
  const parsed = Number.parseFloat(firstValue)
  return Number.isFinite(parsed) ? parsed : 0
}

function isElementNearViewport(element: Element, root: Element | null, rootMargin: string): boolean {
  const elementRect = element.getBoundingClientRect()
  const rootRect = root?.getBoundingClientRect()
  const viewportTop = rootRect?.top ?? 0
  const viewportBottom = rootRect?.bottom ?? window.innerHeight
  const margin = parseVerticalRootMargin(rootMargin)

  return elementRect.bottom >= viewportTop - margin && elementRect.top <= viewportBottom + margin
}

function isElementVisible(element: Element, root: Element | null): boolean {
  return isElementNearViewport(element, root, '0px')
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
        root,
        rootMargin,
        threshold: 0.01,
      },
    )

    observerRef.current = observer
    for (const element of registrationsRef.current.keys()) {
      observer.observe(element)
      // Ref callbacks can run before the scroll container has completed layout.
      // Recheck after the root and all preview blocks have their final geometry.
      if (isElementNearViewport(element, root, rootMargin) || isElementNearViewport(element, null, rootMargin)) {
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
      if (isElementNearViewport(element, rootRef?.current ?? null, rootMargin) || isElementNearViewport(element, null, rootMargin)) {
        onVisibilityChange(true)
      }
      observerRef.current?.observe(element)

      // IntersectionObserver is the cheap primary path. These checks cover layout
      // changes and delayed scroll-root attachment, which can otherwise leave a
      // visible block deferred without ever receiving an observer entry.
      let cancelled = false
      let frame: number | null = null
      let safetyTimeout: number | null = null
      const recheckVisibility = (requireVisible = false) => {
        if (cancelled) return
        const root = rootRef?.current ?? null
        const isEligible = requireVisible ? isElementVisible(element, root) || isElementVisible(element, null) : isElementNearViewport(element, root, rootMargin) || isElementNearViewport(element, null, rootMargin)
        if (isEligible) {
          onVisibilityChange(true)
        }
      }
      const scheduleRecheck = () => {
        if (frame !== null) return
        frame = window.requestAnimationFrame(() => {
          frame = null
          recheckVisibility()
        })
      }
      const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(scheduleRecheck)
      resizeObserver?.observe(element)
      if (rootRef?.current) resizeObserver?.observe(rootRef.current)
      window.addEventListener('scroll', scheduleRecheck, true)
      window.addEventListener('resize', scheduleRecheck)

      // A short first-screen safety valve: only start rendering when geometry says
      // the block is actually visible, so distant diagrams remain lazy.
      scheduleRecheck()
      safetyTimeout = window.setTimeout(() => recheckVisibility(true), 250)

      return () => {
        cancelled = true
        if (frame !== null) window.cancelAnimationFrame(frame)
        if (safetyTimeout !== null) window.clearTimeout(safetyTimeout)
        resizeObserver?.disconnect()
        window.removeEventListener('scroll', scheduleRecheck, true)
        window.removeEventListener('resize', scheduleRecheck)
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
  const fallbackUnregisterRef = useRef<() => void>(() => {})
  const [isNearViewport, setIsNearViewport] = useState(() => Boolean(context?.forceRenderAllBlocks))

  const registerElement = useCallback(
    (element: T | null) => {
      unregisterRef.current()
      unregisterRef.current = () => {}
      fallbackUnregisterRef.current()
      fallbackUnregisterRef.current = () => {}
      elementRef.current = element
      if (!element) return

      if (context) {
        if (!context.forceRenderAllBlocks) {
          unregisterRef.current = context.register(element, setIsNearViewport)

          // The provider observes relative to the preview scroll root. Keep a
          // browser-viewport observer as a narrow fallback for a root that is
          // attached or resized after the Markdown children mount. It only
          // promotes blocks that are actually visible, so it preserves lazy
          // rendering for diagrams farther down a long document.
          if (typeof IntersectionObserver !== 'undefined') {
            const fallbackObserver = new IntersectionObserver(
              (entries) => {
                if (entries.some((entry) => entry.isIntersecting || entry.intersectionRatio > 0)) {
                  setIsNearViewport(true)
                }
              },
              { root: null, threshold: 0.01 },
            )
            fallbackObserver.observe(element)

            const safetyFrame = window.requestAnimationFrame(() => {
              if (isElementVisible(element, null)) {
                setIsNearViewport(true)
              }
            })
            const safetyTimeout = window.setTimeout(() => {
              if (isElementVisible(element, null)) {
                setIsNearViewport(true)
              }
            }, 250)
            fallbackUnregisterRef.current = () => {
              window.cancelAnimationFrame(safetyFrame)
              window.clearTimeout(safetyTimeout)
              fallbackObserver.disconnect()
            }
          }
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
      if (isElementNearViewport(element, null, rootMargin)) {
        setIsNearViewport(true)
      }
      unregisterRef.current = () => observer.disconnect()
    },
    [context, rootMargin],
  )

  useEffect(() => {
    return () => {
      unregisterRef.current()
      unregisterRef.current = () => {}
      fallbackUnregisterRef.current()
      fallbackUnregisterRef.current = () => {}
      elementRef.current = null
    }
  }, [])

  return [registerElement, Boolean(context?.forceRenderAllBlocks) || isNearViewport]
}
