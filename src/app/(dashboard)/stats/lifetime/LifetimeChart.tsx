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
  const colW = (width - MARGIN.left - MARGIN.right) / nDays;
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

    const plotW = width - MARGIN.left - MARGIN.right;
    const plotBottom = MARGIN.top + MINUTES_PER_DAY * pxPerMin;
    const xOf = (day: number) => MARGIN.left + (day - firstDay) * colW;

    // Hour grid, every 4 hours from the 4am column start.
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

    // Month ticks; thinned to quarters, then years, when they get crowded.
    const first = dateOfColumn(firstDay);
    const pxPerMonth = colW * 30.4;
    const step = pxPerMonth >= 34 ? 1 : pxPerMonth >= 12 ? 3 : 12;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (
      let m = new Date(first.getFullYear(), first.getMonth() + 1, 1);
      ;
      m = new Date(m.getFullYear(), m.getMonth() + 1, 1)
    ) {
      const day = Math.round(Date.UTC(m.getFullYear(), m.getMonth(), m.getDate()) / 86_400_000);
      if (day > lastDay) break;
      if (m.getMonth() % step !== 0) continue;
      const x = Math.round(xOf(day)) + 0.5;
      ctx.fillStyle = GRID;
      ctx.fillRect(x, MARGIN.top, 1, plotBottom - MARGIN.top);
      const label =
        m.getMonth() === 0
          ? String(m.getFullYear())
          : m.toLocaleDateString('en-US', { month: 'short' });
      ctx.fillStyle = LABEL;
      ctx.fillText(label, x, plotBottom + 6);
    }

    const barW = colW >= 2 ? Math.max(1, colW * 0.8) : Math.max(colW, 1);
    const drawPass = (level: number | null, alpha: number) => {
      ctx.globalAlpha = alpha;
      for (let s = 0; s < segments.length; s++) {
        const e = segments.event[s];
        if (hiddenTags.has(data.tagIdx[e])) continue;
        if (level !== null && eventLevels && eventLevels[e] !== level) continue;
        ctx.fillStyle = colorOf(e);
        const y = MARGIN.top + segments.y0[s] * pxPerMin;
        const h = Math.max((segments.y1[s] - segments.y0[s]) * pxPerMin, MIN_BAR_HEIGHT);
        ctx.fillRect(xOf(segments.day[s]), y, barW, h);
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
        ctx.strokeRect(xOf(segments.day[s]) - 1.5, y - 1.5, barW + 3, h + 3);
      }
    }
  }, [width, height, colW, pxPerMin, data, segments, firstDay, lastDay, hiddenTags, eventLevels, hovered, pinned, colorOf]);

  const hitTest = (clientX: number, clientY: number): number | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    if (colW <= 0) return null;
    const col = Math.floor((x - MARGIN.left) / colW);
    const reach = Math.ceil(HIT_SLOP_X / colW);
    const minute = (y - MARGIN.top) / pxPerMin;

    let best: number | null = null;
    let bestScore = Infinity;
    for (let c = col - reach; c <= col + reach; c++) {
      for (const s of bucketsRef.current[c] ?? []) {
        const e = segments.event[s];
        if (hiddenTags.has(data.tagIdx[e])) continue;
        const left = MARGIN.left + c * colW;
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

  return (
    <div ref={wrapRef} className="relative w-full h-full">
      <canvas
        ref={canvasRef}
        style={{ width, height, touchAction: 'manipulation' }}
        className={`block ${hovered !== null ? 'cursor-pointer' : ''}`}
        onPointerMove={(e) => {
          if (e.pointerType !== 'mouse') return;
          onHover(hitTest(e.clientX, e.clientY), e.clientX, e.clientY);
        }}
        onPointerLeave={(e) => onHover(null, e.clientX, e.clientY)}
        onClick={(e) => onSelect(hitTest(e.clientX, e.clientY))}
      />
    </div>
  );
}
