'use client';

import type { PositionedEvent } from '@/lib/overlap';
import { contrastTextClass, UNTAGGED_COLOR } from '../positionEvents';

// The day view has room for slightly more padding and type; the week view's
// columns are a seventh of the width.
const DENSITY = {
  day: { pad: 'px-1.5', shadow: 'shadow', gap: 3, time: 'text-[10px]' },
  week: { pad: 'px-1', shadow: 'shadow-sm', gap: 2, time: 'text-[9px]' },
};

/** An event drawn on a timeline column, positioned from its minutes and the zoom. */
export default function EventBlock({
  ev,
  zoomLevel,
  density,
  highlighted = false,
  onOpen,
}: {
  ev: PositionedEvent;
  zoomLevel: number;
  density: keyof typeof DENSITY;
  highlighted?: boolean;
  onOpen: (ev: PositionedEvent, e: React.MouseEvent) => void;
}) {
  const d = DENSITY[density];
  const widthPercent = 100 / (ev.overlap_total || 1);
  const leftPercent = (ev.overlap_column || 0) * widthPercent;
  const topPx = ((ev.top_position || 0) / 60) * zoomLevel;
  const heightPx = ((ev.height || 0) / 60) * zoomLevel;
  const short = heightPx < 46;

  const textClass = contrastTextClass(ev.tag_color || UNTAGGED_COLOR);
  const subtextClass = textClass === 'text-black' ? 'text-black/80 font-medium' : 'text-white/80 font-medium';

  return (
    <div
      data-event-id={ev.id}
      className={`absolute rounded pointer-events-auto transition-all select-none cursor-pointer flex flex-col overflow-hidden event-card-clickable ${d.shadow} border border-black/10 hover:brightness-105 ${
        short ? `${d.pad} items-start justify-center` : `pt-1 pb-1 ${d.pad} items-start justify-start`
      } ${highlighted ? 'ring-2 ring-white z-20' : ''}`}
      style={{
        top: `${topPx}px`,
        height: `${heightPx}px`,
        left: `${leftPercent}%`,
        width: `calc(${widthPercent}% - ${d.gap}px)`,
        backgroundColor: ev.tag_color ? (ev.isPending ? `${ev.tag_color}66` : ev.tag_color) : undefined,
      }}
      onClick={(e) => {
        e.stopPropagation();
        onOpen(ev, e);
      }}
    >
      {short ? (
        <div className="truncate leading-none w-full">
          <span className={`font-extrabold text-xs ${textClass}`}>{ev.title}</span>
          <span className={`font-extrabold text-[9px] ml-1 opacity-80 ${subtextClass}`}>({ev.start_time})</span>
        </div>
      ) : (
        <div className="truncate leading-none w-full">
          <span className={`font-extrabold text-xs truncate block ${textClass}`}>{ev.title}</span>
          {density === 'day' && ev.recurrenceId && (
            <span className={`text-[10px] ml-1.5 ${subtextClass}`} title="Recurring Event">
              ↻
            </span>
          )}
          <span className={`font-extrabold ${d.time} block mt-0.5 ${subtextClass}`}>
            {ev.start_time} - {ev.end_time}
          </span>
        </div>
      )}
    </div>
  );
}
