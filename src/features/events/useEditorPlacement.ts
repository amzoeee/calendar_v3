'use client';

import { useLayoutEffect, useState, type RefObject } from 'react';
import {
  clampOverlayTopMin,
  computeInitialOverlayCoords,
  overlayClipPath,
  topMinToViewportTop,
  type OverlayCoords,
} from '@/lib/overlayPosition';

/**
 * Pins the desktop edit popover to the point that opened it, tracking the
 * timeline as it scrolls and zooms.
 *
 * Styles are written straight to the element rather than through state, so
 * scrolling doesn't re-render the view. The popover is clipped to the
 * timeline's box and hidden once its event scrolls out of view.
 */
export function useEditorPlacement({
  open,
  popoverRef,
  containerRef,
  zoomLevel,
}: {
  open: boolean;
  popoverRef: RefObject<HTMLDivElement | null>;
  containerRef: RefObject<HTMLDivElement | null>;
  zoomLevel: number;
}) {
  // `topMin` is the click's timeline minute (so it scales with zoom), `x` its
  // viewport px. Never mutated after a click; positioning reads from it.
  const [coords, setCoords] = useState<OverlayCoords | null>(null);
  // One-time nudge (in timeline minutes) so the popover opens fully on-screen
  // near the end of the day. Dropped on zoom/resize so a nudge sized for one
  // viewport never drags the popover out of sync with its event.
  const [nudgeMin, setNudgeMin] = useState(0);
  const [prevZoom, setPrevZoom] = useState(zoomLevel);
  if (prevZoom !== zoomLevel) {
    setPrevZoom(zoomLevel);
    if (nudgeMin !== 0) setNudgeMin(0);
  }

  /** Anchors the popover at a click on the timeline. */
  const anchorAt = (e: React.MouseEvent) => {
    const container = containerRef.current;
    const rect = container?.getBoundingClientRect();
    setCoords(
      computeInitialOverlayCoords(e.clientX, e.clientY, rect?.top ?? 0, container?.scrollTop ?? 0, zoomLevel, window.innerWidth)
    );
  };

  const position = () => {
    const el = popoverRef.current;
    const container = containerRef.current;
    if (!el || !container || !coords) return;

    const rect = container.getBoundingClientRect();
    const top = topMinToViewportTop(coords.topMin + nudgeMin, rect.top, container.scrollTop, zoomLevel);
    el.style.top = `${top}px`;
    el.style.left = `${coords.x}px`;

    const h = el.offsetHeight;
    const clipTop = Math.max(0, rect.top - top);
    const clipBottom = Math.max(0, top + h - rect.bottom);
    if (clipTop >= h || clipBottom >= h) {
      el.style.visibility = 'hidden';
    } else {
      el.style.visibility = 'visible';
      el.style.clipPath = overlayClipPath(clipTop, clipBottom);
    }
  };

  // The nudge is computed fresh from the true anchor on every open or
  // re-anchor, never from a nudged value, so it can't compound.
  useLayoutEffect(() => {
    if (!open || !coords) return;
    const el = popoverRef.current;
    const container = containerRef.current;
    if (!el || !container) return;

    const rect = container.getBoundingClientRect();
    const naturalTop = topMinToViewportTop(coords.topMin, rect.top, container.scrollTop, zoomLevel);
    setNudgeMin(clampOverlayTopMin(coords.topMin, naturalTop, el.offsetHeight, zoomLevel, window.innerHeight) - coords.topMin);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, coords]);

  // Track scrolling with the current nudge; a resize drops it and lets the
  // clip-path crop or hide the popover instead.
  useLayoutEffect(() => {
    if (!open || !coords) return;
    position();
    const container = containerRef.current;
    const onScroll = () => position();
    const onResize = () => {
      setNudgeMin(0);
      position();
    };
    container?.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize);
    return () => {
      container?.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, coords, zoomLevel, nudgeMin]);

  return { anchorAt };
}
