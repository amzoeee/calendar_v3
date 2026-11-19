'use client';

import type { MinuteRange } from '../dragCreate';
import { contrastTextClass } from '../positionEvents';

const clock = (min: number) => {
  const h = Math.floor(min / 60) % 24;
  const m = String(min % 60).padStart(2, '0');
  return `${String(h % 12 || 12).padStart(2, '0')}:${m} ${h < 12 ? 'AM' : 'PM'}`;
};

/** The placeholder for an event being swept out or drafted, before it's saved. */
export default function DraftBlock({
  range,
  title,
  color,
  zoomLevel,
}: {
  range: MinuteRange;
  title?: string;
  color?: string;
  zoomLevel: number;
}) {
  const heightPx = ((range.endMin - range.startMin) / 60) * zoomLevel;
  const text = color ? contrastTextClass(color) : 'text-primary-foreground';
  return (
    <div
      data-draft-block
      className={`absolute left-0 right-0.5 rounded border-2 border-primary bg-primary/70 shadow-lg pointer-events-none px-1.5 py-0.5 overflow-hidden z-20 ${text}`}
      style={{
        top: `${(range.startMin / 60) * zoomLevel}px`,
        height: `${heightPx}px`,
        ...(color ? { backgroundColor: color, borderColor: color } : {}),
      }}
    >
      <div className={`truncate leading-tight font-extrabold text-xs ${heightPx < 30 ? 'inline' : 'block'}`}>
        {title || '(no title)'}
      </div>
      <div className={`truncate text-[10px] font-bold opacity-90 ${heightPx < 30 ? 'inline ml-1' : 'block'}`}>
        {clock(range.startMin)} - {clock(range.endMin)}
      </div>
    </div>
  );
}
