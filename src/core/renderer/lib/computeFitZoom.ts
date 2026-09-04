export type FitZoomInput = {
  viewportWidth: number
  viewportHeight: number
  contentWidth: number
  contentHeight: number
  /**
   * Vector content (SVG diagrams) stays sharp at any layout-zoom level, so it
   * may be enlarged to fill the viewport. Raster content (images) must not be
   * upscaled, otherwise it turns blurry.
   */
  allowUpscale: boolean
}

/**
 * Computes the initial "fit" zoom for the zoom/pan preview viewport from the
 * measured content size. There is no hard-coded zoom factor: the value is
 * derived from the viewport/content ratio, so large diagrams shrink to become
 * fully visible and small vector diagrams grow until they fill the viewport.
 */
export function computeFitZoom({ viewportWidth, viewportHeight, contentWidth, contentHeight, allowUpscale }: FitZoomInput): number {
  if (viewportWidth <= 0 || viewportHeight <= 0 || contentWidth <= 0 || contentHeight <= 0) {
    return 1
  }

  const fitZoom = Math.min(viewportWidth / contentWidth, viewportHeight / contentHeight)
  return allowUpscale ? fitZoom : Math.min(1, fitZoom)
}
