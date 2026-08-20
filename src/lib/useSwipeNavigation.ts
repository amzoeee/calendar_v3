import { useEffect, useRef } from 'react';

// A gesture has to travel this far horizontally before it counts as a swipe —
// keeps taps and the small drags that come with scrolling from navigating.
// Kept short so a small deliberate flick pages without a full-width drag; the
// off-axis ratio below is what actually keeps scrolling from triggering it.
const MIN_DISTANCE_PX = 40;
// ...and stay horizontal-dominant. Vertical travel above this fraction of the
// horizontal travel means the user was scrolling the timeline/agenda, not
// paging. At 1.0 the rule is simply "moved further sideways than up/down",
// which is the most permissive this can get while still being a horizontal
// gesture — going past 1.0 would start stealing vertical scrolls.
const MAX_OFF_AXIS_RATIO = 1.0;
// A slow drag across the screen is a fidget, not a flick.
const MAX_DURATION_MS = 800;

interface SwipeNavigationOptions {
  // Swiping left drags the current page off to the left, revealing what comes
  // after it — so left = next, right = previous, matching native paging.
  onSwipeLeft: () => void;
  onSwipeRight: () => void;
  // Pass false while a modal, bottom sheet, or edit popover is open, so a
  // gesture inside it can't page the view out from under itself.
  enabled?: boolean;
}

// Does the gesture start inside something that scrolls sideways on its own
// (the stats bar chart)? If so it owns the horizontal axis and we stay out of
// the way, whether or not it happens to be at the end of its scroll range.
function startedInHorizontalScroller(target: EventTarget | null, root: HTMLElement): boolean {
  let node = target instanceof Element ? target : null;
  while (node && node !== root.parentElement) {
    if (node.scrollWidth > node.clientWidth + 1) {
      const overflowX = getComputedStyle(node).overflowX;
      if (overflowX === 'auto' || overflowX === 'scroll') return true;
    }
    node = node.parentElement;
  }
  return false;
}

// Touch paging for the date-ranged views. Returns a ref to attach to the
// subtree the gesture should be recognized in; listeners are touch-only, so
// this is inert on desktop without needing a breakpoint check.
export function useSwipeNavigation<T extends HTMLElement>({
  onSwipeLeft,
  onSwipeRight,
  enabled = true,
}: SwipeNavigationOptions) {
  const ref = useRef<T>(null);
  // Callbacks are fresh closures on every render; holding them in a ref keeps
  // the listeners attached across renders instead of being torn down and
  // rebound, which could drop a gesture already in progress.
  const callbacks = useRef({ onSwipeLeft, onSwipeRight });
  useEffect(() => {
    callbacks.current = { onSwipeLeft, onSwipeRight };
  }, [onSwipeLeft, onSwipeRight]);

  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;

    let start: { x: number; y: number; time: number } | null = null;

    const handleTouchStart = (e: TouchEvent) => {
      // More than one finger down is a pinch-zoom, never a page swipe.
      if (e.touches.length !== 1 || startedInHorizontalScroller(e.target, el)) {
        start = null;
        return;
      }
      const touch = e.touches[0];
      start = { x: touch.clientX, y: touch.clientY, time: e.timeStamp };
    };

    const handleTouchEnd = (e: TouchEvent) => {
      const from = start;
      start = null;
      // touches still down => a second finger joined mid-gesture; abandon it.
      if (!from || e.touches.length > 0) return;

      const touch = e.changedTouches[0];
      if (!touch) return;

      const dx = touch.clientX - from.x;
      const dy = touch.clientY - from.y;

      if (e.timeStamp - from.time > MAX_DURATION_MS) return;
      if (Math.abs(dx) < MIN_DISTANCE_PX) return;
      if (Math.abs(dy) > Math.abs(dx) * MAX_OFF_AXIS_RATIO) return;

      if (dx < 0) callbacks.current.onSwipeLeft();
      else callbacks.current.onSwipeRight();
    };

    const handleTouchCancel = () => {
      start = null;
    };

    el.addEventListener('touchstart', handleTouchStart, { passive: true });
    el.addEventListener('touchend', handleTouchEnd, { passive: true });
    el.addEventListener('touchcancel', handleTouchCancel, { passive: true });
    return () => {
      el.removeEventListener('touchstart', handleTouchStart);
      el.removeEventListener('touchend', handleTouchEnd);
      el.removeEventListener('touchcancel', handleTouchCancel);
    };
  }, [enabled]);

  return ref;
}
