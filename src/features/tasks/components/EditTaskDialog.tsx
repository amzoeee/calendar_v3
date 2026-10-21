'use client';

import React, { useLayoutEffect, useRef, useState } from 'react';
import { clampOverlayX } from '@/lib/overlayPosition';

/**
 * The edit dialog, in two shapes.
 *
 * On a pointer-sized screen it's a popover whose top-left corner lands on the
 * point you clicked — the same gesture the calendar's event overlay uses, and
 * it shares clampOverlayX with it so the horizontal edge behaviour is
 * literally the same code. Anchoring to the pointer matters more with three
 * columns on screen: a card that jumps to the middle of the window loses which
 * list it belongs to.
 *
 * On a phone there's no cursor to stem from and no room to float, so it
 * becomes a bottom sheet, matching the event editor on the daily view.
 *
 * The shape is chosen from a media query rather than by rendering both and
 * hiding one: the fields are uncontrolled (defaultValue plus onBlur), so a
 * second copy would quietly hold a stale draft.
 */
export default function EditTaskDialog({
  at,
  onClose,
  children,
}: {
  at: { x: number; y: number } | null;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  // Matches Tailwind's `md`. Safe to default to the popover: this component
  // only ever mounts after a click, so it never server-renders.
  const [isWide, setIsWide] = useState(true);

  useLayoutEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)');
    const apply = () => setIsWide(mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !isWide) return;

    const MARGIN = 10;
    const { width, height } = el.getBoundingClientRect();

    if (!at) {
      setPos({
        left: Math.max(MARGIN, (window.innerWidth - width) / 2),
        top: Math.max(MARGIN, (window.innerHeight - height) / 2),
      });
      return;
    }

    const left = clampOverlayX(at.x, window.innerWidth, width);
    // Same idea vertically: keep the corner on the click unless that would
    // push the card off the bottom, then lift it just enough to fit.
    const top = Math.max(MARGIN, Math.min(at.y, window.innerHeight - height - MARGIN));

    setPos({ left, top });
  }, [at, isWide]);

  if (!isWide) {
    return (
      <div className="fixed inset-0 z-50 flex items-end">
        <div className="absolute inset-0 bg-black/60" onClick={onClose} aria-hidden="true" />
        <div
          role="dialog"
          aria-label="Edit task"
          className="relative w-full max-h-[85vh] overflow-y-auto bg-card border-t border-border rounded-t-2xl p-5 pb-8 space-y-4"
        >
          <div className="w-9 h-1 rounded-full bg-muted mx-auto" />
          {children}
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} aria-hidden="true" />
      <div
        ref={ref}
        role="dialog"
        aria-label="Edit task"
        style={{
          left: pos?.left ?? 0,
          top: pos?.top ?? 0,
          // Hidden for the single frame between mount and measurement.
          visibility: pos ? 'visible' : 'hidden',
        }}
        className="fixed z-50 w-[min(18rem,calc(100vw-1.5rem))] max-h-[65vh] overflow-y-auto bg-card border border-border rounded-xl shadow-2xl p-3.5 space-y-3"
      >
        {children}
      </div>
    </>
  );
}
