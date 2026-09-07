import type { SyntheticEvent } from 'react'

/**
 * An `<img>` whose svg source declares percentage root dimensions (e.g.
 * `width="100%" height="100%"`, common in exported svg files) has no
 * resolvable intrinsic size: Chromium resolves the svg percentages against
 * the layout containing block, which is indefinite inside `width: max-content`
 * chains like the zoom/pan preview canvases, so the img computes to 0x0
 * (raster images carry real px intrinsic sizes and are unaffected).
 *
 * Pinning explicit px from naturalWidth/naturalHeight — Chromium derives a
 * ratio-correct fallback size for viewBox-only svgs — gives the canvas a
 * definite box; the viewport's fit zoom then scales the vector content up
 * without blur. The pin is skipped when the img already has a layout box
 * (normal page flow resolves percentage svgs against a definite width).
 */
export function pinSvgImageIntrinsicSize(event: SyntheticEvent<HTMLImageElement>): void {
  const img = event.currentTarget
  const { naturalWidth, naturalHeight } = img
  if (naturalWidth <= 0 || naturalHeight <= 0) return
  window.requestAnimationFrame(() => {
    if (!img.isConnected) return
    if (img.clientWidth > 0 || img.clientHeight > 0) return
    img.style.width = `${naturalWidth}px`
    img.style.height = `${naturalHeight}px`
  })
}

export function isSvgImageSrc(src: string): boolean {
  return /^data:image\/svg/i.test(src) || /\.svgz?(?:[?#]|$)/i.test(src)
}
