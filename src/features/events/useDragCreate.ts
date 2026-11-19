'use client';

import { useRef, useState } from 'react';
import { anchorMinute, clickRange, dragRange, type MinuteRange } from './dragCreate';

// Movement under this is a click, not a drag.
const DRAG_THRESHOLD_PX = 4;

interface Gesture {
  date: string;
  pointerId: number;
  anchor: number;
  startY: number;
  dragging: boolean;
}

/**
 * Click or drag on an empty day column to sweep out a new event's range.
 * `bind(date)` goes on an element whose top is that day's midnight; `onCreate`
 * gets the range on release. Touch only taps: a touch drag is left to scroll.
 * While `suspended` (an editor is open), a press only closes that editor.
 * The bound element should be `select-none` so a sweep doesn't select text.
 */
export function useDragCreate({
  zoomLevel,
  suspended,
  onCreate,
}: {
  zoomLevel: number;
  suspended: boolean;
  onCreate: (date: string, range: MinuteRange, e: React.PointerEvent) => void;
}) {
  const gesture = useRef<Gesture | null>(null);
  const [preview, setPreview] = useState<(MinuteRange & { date: string }) | null>(null);

  const minuteAt = (e: React.PointerEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return ((e.clientY - rect.top) / zoomLevel) * 60;
  };

  const bind = (date: string) => ({
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      if (e.button !== 0 || suspended) return;
      if ((e.target as Element).closest('.event-card-clickable')) return;
      gesture.current = { date, pointerId: e.pointerId, anchor: anchorMinute(minuteAt(e)), startY: e.clientY, dragging: false };
      if (e.pointerType !== 'touch') e.currentTarget.setPointerCapture(e.pointerId);
    },
    onPointerMove: (e: React.PointerEvent<HTMLElement>) => {
      const g = gesture.current;
      if (!g || g.pointerId !== e.pointerId || e.pointerType === 'touch') return;
      if (!g.dragging && Math.abs(e.clientY - g.startY) < DRAG_THRESHOLD_PX) return;
      g.dragging = true;
      const r = dragRange(g.anchor, minuteAt(e));
      setPreview((p) => (p && p.startMin === r.startMin && p.endMin === r.endMin ? p : { date: g.date, ...r }));
    },
    onPointerUp: (e: React.PointerEvent<HTMLElement>) => {
      const g = gesture.current;
      if (!g || g.pointerId !== e.pointerId) return;
      gesture.current = null;
      setPreview(null);
      if (e.pointerType === 'touch' && Math.abs(e.clientY - g.startY) >= DRAG_THRESHOLD_PX) return;
      onCreate(g.date, g.dragging ? dragRange(g.anchor, minuteAt(e)) : clickRange(minuteAt(e)), e);
    },
    onPointerCancel: () => {
      gesture.current = null;
      setPreview(null);
    },
  });

  return { bind, preview };
}
