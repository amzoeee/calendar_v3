// Shared positioning math for the calendar event edit-overlay popover, used
// by both the daily and weekly timeline views. The overlay is anchored to a
// timeline-relative minute (`topMin`) rather than a raw viewport px so it
// tracks its event correctly as the timeline scrolls or zooms.

export interface OverlayCoords {
  topMin: number;
  x: number;
}

export const OVERLAY_WIDTH = 288;
const EDGE_MARGIN = 10;
const RIGHT_MARGIN = 20;

/** Clamp a click's x position so a fixed-width overlay doesn't run off the right edge of the viewport. */
export function clampOverlayX(clientX: number, viewportWidth: number, overlayWidth: number = OVERLAY_WIDTH): number {
  if (clientX + overlayWidth > viewportWidth) {
    return Math.max(EDGE_MARGIN, viewportWidth - overlayWidth - RIGHT_MARGIN);
  }
  return clientX;
}

/** Convert a click's clientY into a timeline-relative minute, anchored to the scroll container. */
export function clientYToTopMin(clientY: number, containerTop: number, scrollTop: number, zoomLevel: number): number {
  const contentY = clientY - containerTop + scrollTop;
  return (contentY / zoomLevel) * 60;
}

/** Compute the overlay's initial anchor (topMin + horizontally-clamped x) from a click event. */
export function computeInitialOverlayCoords(
  clientX: number,
  clientY: number,
  containerTop: number,
  scrollTop: number,
  zoomLevel: number,
  viewportWidth: number
): OverlayCoords {
  return {
    topMin: clientYToTopMin(clientY, containerTop, scrollTop, zoomLevel),
    x: clampOverlayX(clientX, viewportWidth),
  };
}

/** Convert a topMin anchor back into a viewport-relative top px, given the scroll container's current position. */
export function topMinToViewportTop(topMin: number, containerTop: number, scrollTop: number, zoomLevel: number): number {
  return containerTop + (topMin / 60) * zoomLevel - scrollTop;
}

/**
 * If the overlay (rendered at `top` px, `height` px tall) would run off the
 * top or bottom of the viewport, shift `topMin` by the overflow amount so it
 * renders fully on-screen. Returns the original topMin if it already fits.
 */
export function clampOverlayTopMin(
  topMin: number,
  top: number,
  height: number,
  zoomLevel: number,
  viewportHeight: number,
  margin: number = EDGE_MARGIN
): number {
  const overflowBottom = top + height - (viewportHeight - margin);
  if (overflowBottom > 0) {
    return topMin - (overflowBottom * 60) / zoomLevel;
  }
  const overflowTop = margin - top;
  if (overflowTop > 0) {
    return topMin + (overflowTop * 60) / zoomLevel;
  }
  return topMin;
}

/**
 * clip-path for an overlay cropped by `clipTop`/`clipBottom` px. Only the
 * corners on an unclipped edge get rounded — a rounded corner on an edge
 * that's actually cut off would look like a rendering bug, not an edge.
 */
export function overlayClipPath(clipTop: number, clipBottom: number, radius: string = '0.5rem'): string {
  const topRadius = clipTop > 0 ? '0px' : radius;
  const bottomRadius = clipBottom > 0 ? '0px' : radius;
  return `inset(${clipTop}px 0px ${clipBottom}px 0px round ${topRadius} ${topRadius} ${bottomRadius} ${bottomRadius})`;
}
