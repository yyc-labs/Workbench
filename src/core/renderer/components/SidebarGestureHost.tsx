import type { RefObject } from 'react'
import { useSidebarGesture } from '../hooks/useSidebarGesture'
import { SidebarGestureOverlay } from './SidebarGestureOverlay'

type SidebarGestureHostProps = {
  pageRootRef: RefObject<HTMLElement | null>
  onBeforeToggle?: () => void
  onToggleLeftSidebar?: () => void
  onToggleRightSidebar?: () => void
}

/**
 * Isolates the sidebar gesture overlay state inside this tiny component.
 *
 * `useSidebarGesture` updates its overlay state on every gesture frame. When
 * the hook was called directly in a page component (e.g. the markdown document
 * page), each mousemove re-rendered the whole page — including a long preview
 * tree that React still has to reconcile every frame — which made the gesture
 * animation stutter. Hosting the hook here limits re-renders to the overlay.
 */
export function SidebarGestureHost({ pageRootRef, onBeforeToggle, onToggleLeftSidebar, onToggleRightSidebar }: SidebarGestureHostProps) {
  const overlay = useSidebarGesture({ pageRootRef, onBeforeToggle, onToggleLeftSidebar, onToggleRightSidebar })
  return <SidebarGestureOverlay overlay={overlay} />
}
