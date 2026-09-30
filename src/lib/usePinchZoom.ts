import { useEffect, useLayoutEffect, useRef, type Dispatch, type RefObject, type SetStateAction } from 'react';

const MIN_ZOOM = 30;
const MAX_ZOOM = 300;

/**
 * Two-finger pinch on a vertical timeline changes its zoom (px per hour),
 * keeping the time under the fingers in place. The timeline's content must
 * start (midnight) at the top of `containerRef`.
 */
export function usePinchZoom(
  containerRef: RefObject<HTMLElement | null>,
  zoomLevel: number,
  setZoomLevel: Dispatch<SetStateAction<number>>,
) {
  const zoomLevelRef = useRef(zoomLevel);
  useEffect(() => {
    zoomLevelRef.current = zoomLevel;
  }, [zoomLevel]);

  // Set at pinch start and updated as fingers move; consumed by the layout
  // effect below once the DOM has resized for the new zoomLevel.
  const pinchAnchorRef = useRef<{ anchorMin: number; centerClientY: number } | null>(null);

  useLayoutEffect(() => {
    const anchor = pinchAnchorRef.current;
    const container = containerRef.current;
    if (!anchor || !container) return;
    const rect = container.getBoundingClientRect();
    container.scrollTop = (anchor.anchorMin / 60) * zoomLevel - (anchor.centerClientY - rect.top);
  }, [containerRef, zoomLevel]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const touchDist = (touches: TouchList) => {
      const dx = touches[0].clientX - touches[1].clientX;
      const dy = touches[0].clientY - touches[1].clientY;
      return Math.hypot(dx, dy);
    };

    let startDist = 0;
    let startZoom = 0;

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 2) return;
      const rect = container.getBoundingClientRect();
      const centerClientY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      const zoom = zoomLevelRef.current;
      const anchorMin = ((centerClientY - rect.top + container.scrollTop) / zoom) * 60;
      startDist = touchDist(e.touches);
      startZoom = zoom;
      pinchAnchorRef.current = { anchorMin, centerClientY };
    };

    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 2 || !pinchAnchorRef.current || startDist === 0) return;
      e.preventDefault(); // stop the page itself from pinch-zooming
      const scale = touchDist(e.touches) / startDist;
      const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.round(startZoom * scale)));
      pinchAnchorRef.current.centerClientY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      setZoomLevel(newZoom);
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2 && pinchAnchorRef.current) {
        pinchAnchorRef.current = null;
        startDist = 0;
      }
    };

    container.addEventListener('touchstart', onTouchStart, { passive: true });
    container.addEventListener('touchmove', onTouchMove, { passive: false });
    container.addEventListener('touchend', onTouchEnd);
    container.addEventListener('touchcancel', onTouchEnd);
    return () => {
      container.removeEventListener('touchstart', onTouchStart);
      container.removeEventListener('touchmove', onTouchMove);
      container.removeEventListener('touchend', onTouchEnd);
      container.removeEventListener('touchcancel', onTouchEnd);
    };
  }, [containerRef, setZoomLevel]);
}
