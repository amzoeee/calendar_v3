'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  DAY_START_HOUR,
  EXACT,
  MINUTES_PER_DAY,
  RELATED,
  dateOfColumn,
  type LifetimeEvents,
  type Segments,
} from '@/lib/lifetime';
import Button from '@/app/components/Button';

const MARGIN = { top: 8, right: 8, bottom: 24, left: 44 };
// Hit slop around tiny bars, in CSS pixels.
const HIT_SLOP_X = 3;
const HIT_SLOP_Y = 4;
const MIN_BAR_HEIGHT = 1.5;

const GRID = 'rgba(255, 255, 255, 0.06)';
const LABEL = '#888888';
const OUTLINE = '#f0f0f0';
// Alpha per match level while something is focused.
const ALPHA_DIM = 0.1;
const ALPHA_RELATED = 0.55;

const MIN_SPAN_DAYS = 7;
// Pointer travel before a press becomes a pan rather than a click.
const DRAG_THRESHOLD = 4;
// Zoom per pixel of wheel delta; trackpad pinches report smaller deltas.
const WHEEL_ZOOM = 0.002;
const PINCH_ZOOM = 0.01;
const LINE_HEIGHT = 16;

// Visible window, in days from the first column; end is exclusive.
interface View {
  start: number;
  end: number;
}

// Null means the whole history fits, which is also the default.
function clampView(start: number, span: number, nDays: number): View | null {
  const s = Math.min(Math.max(span, Math.min(MIN_SPAN_DAYS, nDays)), nDays);
  if (s >= nDays) return null;
  const st = Math.min(Math.max(start, 0), nDays - s);
  return { start: st, end: st + s };
}

// Scales `base` by `factor` so the day under `fromX` lands under `toX`.
function zoomView(base: View, fromX: number, toX: number, factor: number, plotW: number, nDays: number) {
  const span = base.end - base.start;
  const anchorDay = base.start + (fromX / plotW) * span;
  const next = span * factor;
  return clampView(anchorDay - (toX / plotW) * next, next, nDays);
}

const monthLabel = (d: Date) =>
  d.getMonth() === 0 ? String(d.getFullYear()) : d.toLocaleDateString('en-US', { month: 'short' });

interface SafariGestureEvent extends Event {
  scale: number;
  clientX: number;
}

interface LifetimeChartProps {
  data: LifetimeEvents;
  segments: Segments;
  firstDay: number;
  lastDay: number;
  tagColors: string[];
  untaggedColor: string;
  hiddenTags: Set<number>;
  // Match level per event, or null when nothing is focused.
  eventLevels: Uint8Array | null;
  hovered: number | null;
  pinned: number | null;
  onHover: (event: number | null, clientX: number, clientY: number) => void;
  onSelect: (event: number | null) => void;
}

export default function LifetimeChart({
  data,
  segments,
  firstDay,
  lastDay,
  tagColors,
  untaggedColor,
  hiddenTags,
  eventLevels,
  hovered,
  pinned,
  onHover,
  onSelect,
}: LifetimeChartProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [view, setView] = useState<View | null>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize({ width: Math.floor(width), height: Math.floor(height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const nDays = lastDay - firstDay + 1;
  const { width, height } = size;
  const plotW = width - MARGIN.left - MARGIN.right;
  const v = view ?? { start: 0, end: nDays };
  const colW = plotW / (v.end - v.start);
  const pxPerMin = (height - MARGIN.top - MARGIN.bottom) / MINUTES_PER_DAY;

  // Segment indices per column, for hit-testing.
  const bucketsRef = useRef<number[][]>([]);
  useEffect(() => {
    const buckets: number[][] = Array.from({ length: nDays }, () => []);
    for (let s = 0; s < segments.length; s++) {
      const col = segments.day[s] - firstDay;
      if (col >= 0 && col < nDays) buckets[col].push(s);
    }
    bucketsRef.current = buckets;
  }, [segments, firstDay, nDays]);

  const colorOf = useCallback(
    (e: number) => {
      const g = data.tagIdx[e];
      return g >= 0 ? tagColors[g] : untaggedColor;
    },
    [data, tagColors, untaggedColor],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width <= 0 || height <= 0) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const plotBottom = MARGIN.top + MINUTES_PER_DAY * pxPerMin;
    const xOf = (day: number) => MARGIN.left + (day - firstDay - v.start) * colW;
    const firstVisible = firstDay + Math.floor(v.start);
    const lastVisible = firstDay + Math.ceil(v.end);

    // Hour grid, every 4 hours.
    ctx.font = '11px ui-sans-serif, system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'right';
    for (let h = 0; h <= 24; h += 4) {
      const y = Math.round(MARGIN.top + h * 60 * pxPerMin) + 0.5;
      ctx.fillStyle = GRID;
      ctx.fillRect(MARGIN.left, y, plotW, 1);
      const hour = (DAY_START_HOUR + h) % 24;
      const label = hour === 0 ? '12am' : hour === 12 ? 'noon' : hour < 12 ? `${hour}am` : `${hour - 12}pm`;
      ctx.fillStyle = LABEL;
      ctx.fillText(label, MARGIN.left - 6, y);
    }

    // Date ticks: every day, then the 1st/8th/15th/22nd, then months thinned
    // to quarters and years as they get crowded.
    const pxPerMonth = colW * 30.4;
    const mode = colW >= 20 ? 'day' : colW >= 5 ? 'week' : 'month';
    const step = pxPerMonth >= 34 ? 1 : pxPerMonth >= 12 ? 3 : 12;
    ctx.save();
    ctx.beginPath();
    ctx.rect(MARGIN.left, 0, plotW, height);
    ctx.clip();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let day = firstVisible; day <= lastVisible; day++) {
      const d = dateOfColumn(day);
      const dom = d.getDate();
      let label: string | null = null;
      if (mode === 'day') label = dom === 1 ? monthLabel(d) : String(dom);
      else if (mode === 'week') label = dom === 1 ? monthLabel(d) : dom % 7 === 1 && dom < 29 ? String(dom) : null;
      else if (dom === 1 && d.getMonth() % step === 0) label = monthLabel(d);
      if (label === null) continue;
      // Day ticks sit mid-column; month and week ticks mark the boundary.
      const x = Math.round(xOf(day) + (mode === 'day' ? colW / 2 : 0)) + 0.5;
      // Skip ticks whose label would be cut off at the plot edges.
      if (x < MARGIN.left + 12 || x > MARGIN.left + plotW - 12) continue;
      ctx.fillStyle = GRID;
      ctx.fillRect(x, MARGIN.top, 1, plotBottom - MARGIN.top);
      ctx.fillStyle = dom === 1 ? '#bbbbbb' : LABEL;
      ctx.fillText(label, x, plotBottom + 6);
    }

    const barW = colW >= 2 ? Math.max(1, colW * 0.8) : Math.max(colW, 1);
    // Bars sit centred in their column, under the day's tick.
    const barX = (day: number) => xOf(day) + (colW - barW) / 2;
    const drawPass = (level: number | null, alpha: number) => {
      ctx.globalAlpha = alpha;
      for (let s = 0; s < segments.length; s++) {
        const e = segments.event[s];
        if (hiddenTags.has(data.tagIdx[e])) continue;
        if (level !== null && eventLevels && eventLevels[e] !== level) continue;
        const day = segments.day[s];
        if (day < firstVisible - 1 || day > lastVisible) continue;
        ctx.fillStyle = colorOf(e);
        const y = MARGIN.top + segments.y0[s] * pxPerMin;
        const h = Math.max((segments.y1[s] - segments.y0[s]) * pxPerMin, MIN_BAR_HEIGHT);
        ctx.fillRect(barX(day), y, barW, h);
      }
    };

    if (eventLevels) {
      drawPass(0, ALPHA_DIM);
      drawPass(RELATED, ALPHA_RELATED);
      drawPass(EXACT, 1);
    } else {
      drawPass(null, 0.9);
    }
    ctx.globalAlpha = 1;

    // Outline the hovered and pinned events across all their segments.
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 1;
    for (const target of [pinned, hovered]) {
      if (target === null) continue;
      for (let s = 0; s < segments.length; s++) {
        if (segments.event[s] !== target) continue;
        const y = MARGIN.top + segments.y0[s] * pxPerMin;
        const h = Math.max((segments.y1[s] - segments.y0[s]) * pxPerMin, MIN_BAR_HEIGHT);
        ctx.strokeRect(barX(segments.day[s]) - 1.5, y - 1.5, barW + 3, h + 3);
      }
    }
    ctx.restore();
  }, [width, height, plotW, v.start, v.end, colW, pxPerMin, data, segments, firstDay, lastDay, hiddenTags, eventLevels, hovered, pinned, colorOf]);

  // The current view, for listeners registered outside React's event system.
  const viewRef = useRef<View>(v);
  useEffect(() => {
    viewRef.current = v;
  });

  // Wheel: sideways scrolls pan, vertical scrolls and trackpad pinches zoom
  // around the cursor. Non-passive so the page doesn't scroll as well.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || plotW <= 0) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const unit = e.deltaMode === 1 ? LINE_HEIGHT : 1;
      const rect = canvas.getBoundingClientRect();
      const ax = Math.min(Math.max(e.clientX - rect.left - MARGIN.left, 0), plotW);
      const base = viewRef.current;
      const span = base.end - base.start;
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        setView(clampView(base.start + ((e.deltaX * unit) / plotW) * span, span, nDays));
      } else {
        const factor = Math.exp(e.deltaY * unit * (e.ctrlKey ? PINCH_ZOOM : WHEEL_ZOOM));
        setView(zoomView(base, ax, ax, factor, plotW, nDays));
      }
    };

    // Desktop Safari reports trackpad pinches as gesture events, not wheels.
    let gestureBase: { view: View; ax: number } | null = null;
    const onGestureStart = (e: Event) => {
      e.preventDefault();
      if (pointersRef.current.size >= 2) return;
      const rect = canvas.getBoundingClientRect();
      const ge = e as SafariGestureEvent;
      gestureBase = { view: viewRef.current, ax: ge.clientX - rect.left - MARGIN.left };
    };
    const onGestureChange = (e: Event) => {
      e.preventDefault();
      if (!gestureBase || pointersRef.current.size >= 2) return;
      const ge = e as SafariGestureEvent;
      setView(zoomView(gestureBase.view, gestureBase.ax, gestureBase.ax, 1 / ge.scale, plotW, nDays));
    };
    const onGestureEnd = () => {
      gestureBase = null;
    };

    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('gesturestart', onGestureStart);
    canvas.addEventListener('gesturechange', onGestureChange);
    canvas.addEventListener('gestureend', onGestureEnd);
    return () => {
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('gesturestart', onGestureStart);
      canvas.removeEventListener('gesturechange', onGestureChange);
      canvas.removeEventListener('gestureend', onGestureEnd);
    };
  }, [plotW, nDays]);

  // Drag to pan, two pointers to pinch. A press that never moves is a click.
  const pointersRef = useRef(new Map<number, number>());
  // Double-click resets the zoom for a mouse only; a double tap shouldn't.
  const lastPointerType = useRef('mouse');
  const gestureRef = useRef<
    | { kind: 'pan'; startX: number; base: View; moved: boolean }
    | { kind: 'pinch'; dist: number; mid: number; base: View }
    | null
  >(null);

  const plotX = (clientX: number) =>
    clientX - (canvasRef.current?.getBoundingClientRect().left ?? 0) - MARGIN.left;

  const pinchState = () => {
    const [a, b] = [...pointersRef.current.values()];
    return { dist: Math.max(Math.abs(a - b), 10), mid: plotX((a + b) / 2) };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    lastPointerType.current = e.pointerType;
    e.currentTarget.setPointerCapture(e.pointerId);
    pointersRef.current.set(e.pointerId, e.clientX);
    if (pointersRef.current.size === 1) {
      gestureRef.current = { kind: 'pan', startX: e.clientX, base: v, moved: false };
    } else if (pointersRef.current.size === 2) {
      gestureRef.current = { kind: 'pinch', ...pinchState(), base: v };
      setDragging(true);
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const g = gestureRef.current;
    if (pointersRef.current.has(e.pointerId)) {
      pointersRef.current.set(e.pointerId, e.clientX);
      if (g?.kind === 'pan') {
        const dx = e.clientX - g.startX;
        if (!g.moved && Math.abs(dx) > DRAG_THRESHOLD) {
          g.moved = true;
          setDragging(true);
          onHover(null, e.clientX, e.clientY);
        }
        if (g.moved) {
          const span = g.base.end - g.base.start;
          setView(clampView(g.base.start - (dx / plotW) * span, span, nDays));
        }
        if (g.moved) return;
      } else if (g?.kind === 'pinch' && pointersRef.current.size === 2) {
        const now = pinchState();
        setView(zoomView(g.base, g.mid, now.mid, g.dist / now.dist, plotW, nDays));
        return;
      }
    }
    if (e.pointerType === 'mouse') onHover(hitTest(e.clientX, e.clientY), e.clientX, e.clientY);
  };

  const endPointer = (e: React.PointerEvent<HTMLCanvasElement>, cancelled: boolean) => {
    if (!pointersRef.current.delete(e.pointerId)) return;
    const g = gestureRef.current;
    if (!cancelled && g?.kind === 'pan' && !g.moved) onSelect(hitTest(e.clientX, e.clientY));
    // Lifting one finger of a pinch ends the gesture rather than turning the
    // remaining finger into a pan that would jump.
    if (pointersRef.current.size === 0 || g?.kind === 'pinch') {
      gestureRef.current = null;
      setDragging(false);
    }
  };

  const hitTest = (clientX: number, clientY: number): number | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    if (colW <= 0) return null;
    if (x < MARGIN.left || x > MARGIN.left + plotW) return null;
    const col = Math.floor((x - MARGIN.left) / colW + v.start);
    const reach = Math.ceil(HIT_SLOP_X / colW);
    const minute = (y - MARGIN.top) / pxPerMin;

    let best: number | null = null;
    let bestScore = Infinity;
    for (let c = col - reach; c <= col + reach; c++) {
      for (const s of bucketsRef.current[c] ?? []) {
        const e = segments.event[s];
        if (hiddenTags.has(data.tagIdx[e])) continue;
        const left = MARGIN.left + (c - v.start) * colW;
        const dx = x < left ? left - x : x > left + colW ? x - left - colW : 0;
        const y1 = Math.max(segments.y1[s], segments.y0[s] + MIN_BAR_HEIGHT / pxPerMin);
        const dy =
          minute < segments.y0[s]
            ? (segments.y0[s] - minute) * pxPerMin
            : minute > y1
              ? (minute - y1) * pxPerMin
              : 0;
        if (dx > HIT_SLOP_X || dy > HIT_SLOP_Y) continue;
        // Prefer the closest bar, then the shorter one, so a brief event
        // sitting on top of a long one stays reachable.
        const score = dx + dy + (segments.y1[s] - segments.y0[s]) * 1e-4;
        if (score < bestScore) {
          bestScore = score;
          best = e;
        }
      }
    }
    return best;
  };

  const cursor = dragging ? 'cursor-grabbing' : hovered !== null ? 'cursor-pointer' : view ? 'cursor-grab' : '';

  return (
    <div ref={wrapRef} className="relative w-full h-full">
      <canvas
        ref={canvasRef}
        // Vertical swipes still scroll the page on touch; sideways ones pan.
        style={{ width, height, touchAction: 'pan-y' }}
        className={`block select-none ${cursor}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(e) => endPointer(e, false)}
        onPointerCancel={(e) => endPointer(e, true)}
        onPointerLeave={(e) => {
          if (!pointersRef.current.has(e.pointerId)) onHover(null, e.clientX, e.clientY);
        }}
        onDoubleClick={() => {
          if (lastPointerType.current === 'mouse') setView(null);
        }}
      />
      {view && (
        <Button
          size="none"
          onClick={() => setView(null)}
          className="absolute top-3 right-3 px-2.5 py-1 text-xs font-semibold rounded-md"
        >
          Fit all
        </Button>
      )}
    </div>
  );
}
