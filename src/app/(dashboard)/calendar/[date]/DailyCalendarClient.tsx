'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Trash2,
  Copy,
  Check,
  X,
  Sparkles,
} from 'lucide-react';
import { PositionedEvent, calculateOverlapColumns } from '@/lib/overlap';
import {
  addEventAction,
  updateEventAction,
  deleteEventAction,
  copyEventAction,
  deleteRecurringSeriesAction,
  updateRecurringSeriesAction,
} from '@/app/actions';

interface Tag {
  id: number;
  name: string;
  color: string;
  isArchived: number;
}

interface DailyCalendarClientProps {
  date: string;
  initialEvents: any[];
  tags: Tag[];
}

export default function DailyCalendarClient({ date, initialEvents, tags }: DailyCalendarClientProps) {
  const router = useRouter();

  // --- Zoom level ---
  const [zoomLevel, setZoomLevel] = useState<number>(60); // px per hour

  // --- Popovers & Modals ---
  const [activeOverlayId, setActiveOverlayId] = useState<number | null>(null);
  const [showEditRecurModal, setShowEditRecurModal] = useState<boolean>(false);
  const [showDeleteRecurModal, setShowDeleteRecurModal] = useState<boolean>(false);
  const [recurEvent, setRecurEvent] = useState<PositionedEvent | null>(null);
  const [editingEvent, setEditingEvent] = useState<PositionedEvent | null>(null);
  const [overlayCoords, setOverlayCoords] = useState<{ x: number; y: number } | null>(null);

  // --- Scroll Restoration ---
  const timelineContainerRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  // --- Add Event Form State ---
  const [formTitle, setFormTitle] = useState('');
  const [formTag, setFormTag] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [formStartDate, setFormStartDate] = useState(date);
  const [formStartTime, setFormStartTime] = useState('09:00');
  const [formEndDate, setFormEndDate] = useState(date);
  const [formEndTime, setFormEndTime] = useState('10:00');
  const [formRecur, setFormRecur] = useState('');
  const [formRecurEnd, setFormRecurEnd] = useState('');

  // --- Edit Form State (for active overlay) ---
  const [editTitle, setEditTitle] = useState('');
  const [editTag, setEditTag] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editStartDate, setEditStartDate] = useState('');
  const [editStartTime, setEditStartTime] = useState('');
  const [editEndDate, setEditEndDate] = useState('');
  const [editEndTime, setEditEndTime] = useState('');

  // --- Date navigation ---
  const prevDayStr = new Date(new Date(date + 'T00:00:00').getTime() - 24 * 60 * 60 * 1000).toLocaleDateString('en-CA');
  const nextDayStr = new Date(new Date(date + 'T00:00:00').getTime() + 24 * 60 * 60 * 1000).toLocaleDateString('en-CA');
  const displayDate = new Date(date + 'T00:00:00').toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  // Load zoom and scroll settings
  useEffect(() => {
    const savedZoom = localStorage.getItem('calendarZoomLevel');
    if (savedZoom) setZoomLevel(parseInt(savedZoom, 10));

    const savedScroll = localStorage.getItem('calendarScrollPos');
    if (savedScroll && timelineContainerRef.current) {
      timelineContainerRef.current.scrollTop = parseInt(savedScroll, 10);
    }
  }, []);

  // Save zoom level when it changes
  const changeZoom = (delta: number) => {
    setZoomLevel((prev) => {
      const next = Math.max(30, Math.min(300, prev + delta));
      localStorage.setItem('calendarZoomLevel', String(next));
      return next;
    });
  };

  const resetZoom = () => {
    setZoomLevel(60);
    localStorage.setItem('calendarZoomLevel', '60');
  };

  // Keyboard zoom listener (Cmd/Ctrl + '=', Cmd/Ctrl + '-', Cmd/Ctrl + '0') and arrow keys navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isInput =
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement;

      if (e.metaKey || e.ctrlKey) {
        if (e.key === '=' || e.key === '+') {
          e.preventDefault();
          changeZoom(15);
        } else if (e.key === '-') {
          e.preventDefault();
          changeZoom(-15);
        } else if (e.key === '0') {
          e.preventDefault();
          resetZoom();
        }
      } else if (!isInput) {
        if (e.key === 'ArrowLeft') {
          e.preventDefault();
          saveScroll();
          router.push(`/calendar/${prevDayStr}`);
        } else if (e.key === 'ArrowRight') {
          e.preventDefault();
          saveScroll();
          router.push(`/calendar/${nextDayStr}`);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [router, prevDayStr, nextDayStr]);

  // Click outside overlay listener to close the popover
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        activeOverlayId !== null &&
        overlayRef.current &&
        !overlayRef.current.contains(event.target as Node)
      ) {
        const clickedEventCard = (event.target as Element).closest('.event-card-clickable');
        if (!clickedEventCard) {
          setActiveOverlayId(null);
          setEditingEvent(null);
          setOverlayCoords(null);
        }
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [activeOverlayId]);

  const saveScroll = () => {
    if (timelineContainerRef.current) {
      localStorage.setItem('calendarScrollPos', String(timelineContainerRef.current.scrollTop));
    }
  };

  // Click handler to pre-fill time based on grid click
  const handleGridClick = (hour: number, halfHour: boolean) => {
    saveScroll();
    const minStr = halfHour ? '30' : '00';
    const startHourStr = String(hour).padStart(2, '0');
    const endHourStr = String((hour + 1) % 24).padStart(2, '0');
    setFormStartTime(`${startHourStr}:${minStr}`);
    setFormEndTime(`${endHourStr}:${minStr}`);
    setFormStartDate(date);
    setFormEndDate(date);
  };

  // Process and position events
  const getPositionedEvents = (): PositionedEvent[] => {
    const processed: PositionedEvent[] = [];
    const activeDateObj = new Date(date + 'T00:00:00');
    const dayStart = new Date(activeDateObj.getFullYear(), activeDateObj.getMonth(), activeDateObj.getDate(), 0, 0, 0).getTime();
    const dayEnd = new Date(activeDateObj.getFullYear(), activeDateObj.getMonth(), activeDateObj.getDate(), 23, 59, 59).getTime();

    for (const ev of initialEvents) {
      const startDt = new Date(ev.startDatetime.replace(' ', 'T'));
      const endDt = new Date(ev.endDatetime.replace(' ', 'T'));

      const clippedStart = Math.max(startDt.getTime(), dayStart);
      const clippedEnd = Math.min(endDt.getTime(), dayEnd);

      if (clippedStart >= dayEnd || clippedEnd <= dayStart) {
        continue; // Doesn't overlap this day
      }

      const startMin = new Date(clippedStart).getHours() * 60 + new Date(clippedStart).getMinutes();
      const endMin = new Date(clippedEnd).getHours() * 60 + new Date(clippedEnd).getMinutes();
      const duration = endMin - startMin;

      const tagColor = tags.find((t) => t.name === ev.tag)?.color || '#6b7280';

      processed.push({
        id: ev.id,
        startDatetime: ev.startDatetime,
        endDatetime: ev.endDatetime,
        title: ev.title,
        description: ev.description,
        tag: ev.tag,
        userId: ev.userId,
        recurrenceId: ev.recurrenceId,
        rrule: ev.rrule,
        originalStart: ev.originalStart,
        isPending: ev.isPending,
        // positional parameters
        top_position: startMin,
        height: duration,
        duration_minutes: duration,
        start_time: startDt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        end_time: endDt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        start_datetime_local: ev.startDatetime.replace(' ', 'T').substring(0, 16),
        end_datetime_local: ev.endDatetime.replace(' ', 'T').substring(0, 16),
        tag_color: tagColor,
        multi_day: startDt.toDateString() !== endDt.toDateString(),
        continues_before: startDt.getTime() < dayStart,
        continues_after: endDt.getTime() > dayEnd,
      });
    }

    return calculateOverlapColumns(processed);
  };

  const positionedEvents = getPositionedEvents();

  // Tag color lookup
  const getTagColor = (tagName: string) => {
    return tags.find((t) => t.name === tagName)?.color || 'transparent';
  };

  // Open edit overlay popover
  const handleOpenEditOverlay = (ev: PositionedEvent, e: React.MouseEvent) => {
    saveScroll();

    // Position clamp logic
    const overlayWidth = 288;
    const overlayHeight = 320;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let x = e.clientX;
    if (x + overlayWidth > viewportWidth) {
      x = Math.max(10, viewportWidth - overlayWidth - 20);
    }

    let y = e.clientY;
    if (y + overlayHeight > viewportHeight) {
      y = Math.max(10, viewportHeight - overlayHeight - 20);
    }

    setOverlayCoords({ x, y });
    setEditingEvent(ev);
    setActiveOverlayId(ev.id);
    setEditTitle(ev.title);
    setEditTag(ev.tag || '');
    setEditDesc(ev.description || '');
    setEditStartDate(ev.startDatetime.substring(0, 10));
    setEditStartTime(ev.startDatetime.substring(11, 16));
    setEditEndDate(ev.endDatetime.substring(0, 10));
    setEditEndTime(ev.endDatetime.substring(11, 16));
  };

  // Actions
  const handleAddSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    saveScroll();
    await addEventAction({
      title: formTitle,
      description: formDesc,
      tag: formTag,
      startDatetime: `${formStartDate}T${formStartTime}`,
      endDatetime: `${formEndDate}T${formEndTime}`,
      recurrence: formRecur,
      recurrenceEndDate: formRecurEnd,
    });
    // Reset basic input fields
    setFormTitle('');
    setFormDesc('');
    setFormTag('');
    setFormRecur('');
    setFormRecurEnd('');
  };

  const handleUpdateInstance = async (eventId: number) => {
    saveScroll();
    await updateEventAction(eventId, {
      title: editTitle,
      description: editDesc,
      tag: editTag,
      startDatetime: `${editStartDate}T${editStartTime}`,
      endDatetime: `${editEndDate}T${editEndTime}`,
    });
    setActiveOverlayId(null);
    setEditingEvent(null);
    setOverlayCoords(null);
  };

  const handleUpdateSeries = async (recurrenceId: string) => {
    saveScroll();
    await updateRecurringSeriesAction(recurrenceId, {
      title: editTitle,
      description: editDesc,
      tag: editTag,
    });
    setActiveOverlayId(null);
    setEditingEvent(null);
    setOverlayCoords(null);
  };

  const handleDeleteInstance = async (eventId: number) => {
    if (confirm('Delete this event?')) {
      saveScroll();
      await deleteEventAction(eventId);
      setActiveOverlayId(null);
      setEditingEvent(null);
      setOverlayCoords(null);
    }
  };

  const handleDeleteSeries = async (recurrenceId: string) => {
    saveScroll();
    await deleteRecurringSeriesAction(recurrenceId);
    setActiveOverlayId(null);
    setEditingEvent(null);
    setOverlayCoords(null);
  };

  const handleCopy = async (eventId: number) => {
    saveScroll();
    await copyEventAction(eventId);
    setActiveOverlayId(null);
    setEditingEvent(null);
    setOverlayCoords(null);
  };

  return (
    <div className="flex-1 flex flex-col md:flex-row overflow-hidden relative">
      
      {/* Side Pane: Event Form & Info */}
      <div className="w-full md:w-80 bg-card border-b md:border-b-0 md:border-r border-border p-6 overflow-y-auto shrink-0 space-y-6">
        <div>
          <h2 className="text-xl font-extrabold tracking-tight">Add Event</h2>
          <form onSubmit={handleAddSubmit} className="mt-4 space-y-4">
            
            {/* Title */}
            <div>
              <label htmlFor="title" className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Title
              </label>
              <input
                id="title"
                type="text"
                required
                placeholder="Event Title"
                value={formTitle}
                onChange={(e) => setFormTitle(e.target.value)}
                className="mt-1 block w-full rounded bg-secondary border border-border px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-transparent"
              />
            </div>

            {/* Start and End Times */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground">Start Time</label>
                <input
                  type="time"
                  required
                  value={formStartTime}
                  onChange={(e) => setFormStartTime(e.target.value)}
                  className="mt-1 block w-full rounded bg-secondary border border-border px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground">End Time</label>
                <input
                  type="time"
                  required
                  value={formEndTime}
                  onChange={(e) => setFormEndTime(e.target.value)}
                  className="mt-1 block w-full rounded bg-secondary border border-border px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-transparent"
                />
              </div>
            </div>

            {/* Tag Selection */}
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground">Tag</label>
              <div className="mt-1 flex items-center gap-2">
                <span
                  className="w-4 h-4 rounded-full border border-border flex-shrink-0"
                  style={{ backgroundColor: getTagColor(formTag) }}
                ></span>
                <select
                  value={formTag}
                  onChange={(e) => setFormTag(e.target.value)}
                  className="block w-full rounded bg-secondary border border-border px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-transparent cursor-pointer"
                >
                  <option value="">None</option>
                  {tags
                    .filter((t) => !t.isArchived)
                    .map((t) => (
                      <option key={t.id} value={t.name}>
                        {t.name}
                      </option>
                    ))}
                </select>
              </div>
            </div>

            {/* Description */}
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground">Description</label>
              <textarea
                value={formDesc}
                onChange={(e) => setFormDesc(e.target.value)}
                placeholder="Optional description"
                rows={2}
                className="mt-1 block w-full rounded bg-secondary border border-border px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-transparent resize-none"
              />
            </div>

            {/* Repeat / Recurrence */}
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground">Repeat</label>
              <select
                value={formRecur}
                onChange={(e) => setFormRecur(e.target.value)}
                className="mt-1 block w-full rounded bg-secondary border border-border px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-transparent cursor-pointer"
              >
                <option value="">Does not repeat</option>
                <option value="DAILY">Daily</option>
                <option value="WEEKLY">Weekly</option>
                <option value="MONTHLY">Monthly</option>
              </select>
            </div>

            {/* Recurrence End Date */}
            {formRecur && (
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground">Repeat until</label>
                <input
                  type="date"
                  value={formRecurEnd}
                  onChange={(e) => setFormRecurEnd(e.target.value)}
                  className="mt-1 block w-full rounded bg-secondary border border-border px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-transparent"
                />
              </div>
            )}

            <button
              type="submit"
              className="w-full flex justify-center py-2 px-4 border border-transparent rounded bg-primary text-sm font-bold text-white shadow-sm hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary cursor-pointer transition"
            >
              Add Event
            </button>
          </form>
        </div>

        {/* Zoom Controls */}
        <div className="border-t border-border pt-4">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Timeline Zoom</h3>
          <div className="mt-2 flex items-center justify-between gap-2">
            <button
              onClick={() => changeZoom(-15)}
              className="p-1.5 rounded bg-secondary border border-border hover:bg-muted text-foreground transition cursor-pointer"
              title="Zoom Out"
            >
              <ZoomOut className="h-4 w-4" />
            </button>
            <span className="text-xs font-bold text-muted-foreground">{Math.round((zoomLevel / 60) * 100)}%</span>
            <button
              onClick={() => changeZoom(15)}
              className="p-1.5 rounded bg-secondary border border-border hover:bg-muted text-foreground transition cursor-pointer"
              title="Zoom In"
            >
              <ZoomIn className="h-4 w-4" />
            </button>
            <button
              onClick={resetZoom}
              className="px-2 py-1.5 text-xs rounded bg-secondary border border-border hover:bg-muted font-semibold transition cursor-pointer"
              title="Reset Zoom"
            >
              Reset
            </button>
          </div>
        </div>
      </div>

      {/* Main Timeline View */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Navigation Header */}
        <div className="h-16 border-b border-border flex items-center justify-between px-6 shrink-0 glass-panel">
          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                saveScroll();
                router.push(`/calendar/${prevDayStr}`);
              }}
              className="p-2 rounded-lg bg-secondary hover:bg-muted text-foreground transition cursor-pointer"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <button
              onClick={() => {
                saveScroll();
                const today = new Date().toLocaleDateString('en-CA');
                router.push(`/calendar/${today}`);
              }}
              className="px-3 py-2 text-sm font-semibold rounded-lg bg-secondary hover:bg-muted text-foreground transition cursor-pointer"
            >
              Today
            </button>
            <button
              onClick={() => {
                saveScroll();
                router.push(`/calendar/${nextDayStr}`);
              }}
              className="p-2 rounded-lg bg-secondary hover:bg-muted text-foreground transition cursor-pointer"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          </div>

          <h1 className="text-xl font-bold tracking-tight">{displayDate}</h1>

          <div className="flex items-center gap-2">
            <span className="px-3 py-1.5 bg-accent/20 border border-accent text-accent-foreground text-xs font-semibold rounded-lg">
              Daily
            </span>
          </div>
        </div>

        {/* Scrollable Timeline Grid */}
        <div
          ref={timelineContainerRef}
          className="flex-1 overflow-y-auto calendar-scrollbar relative timeline-container"
          id="timeline-container"
        >
          {/* Timeline Wrapper (24 hours * zoomLevel) */}
          <div className="relative w-full" style={{ height: `${zoomLevel * 24}px` }}>
            
            {/* Hour Labels */}
            <div className="absolute left-0 top-0 w-16 h-full border-r border-border bg-card/30 flex flex-col z-10 select-none">
              {Array.from({ length: 24 }).map((_, hour) => {
                const displayHour = hour === 0 ? '12 AM' : hour === 12 ? '12 PM' : hour > 12 ? `${hour - 12} PM` : `${hour} AM`;
                return (
                  <div
                    key={hour}
                    className="absolute right-3 text-[10px] font-bold text-muted-foreground"
                    style={{ top: `${hour * zoomLevel}px`, transform: 'translateY(-50%)' }}
                  >
                    {displayHour}
                  </div>
                );
              })}
            </div>

            {/* Grid Lines & Click Targets */}
            <div className="absolute left-16 right-0 top-0 h-full">
              {Array.from({ length: 24 }).map((_, hour) => (
                <React.Fragment key={hour}>
                  {/* Hour line */}
                  <div
                    className="absolute left-0 right-0 border-t border-border/40"
                    style={{ top: `${hour * zoomLevel}px` }}
                  />
                  {/* Click target for top half */}
                  <div
                    onClick={() => handleGridClick(hour, false)}
                    className="absolute left-0 right-0 hover:bg-secondary/10 cursor-pointer"
                    style={{ top: `${hour * zoomLevel}px`, height: `${zoomLevel / 2}px` }}
                    title={`Schedule event at ${hour}:00`}
                  />
                  
                  {/* Half-hour line */}
                  <div
                    className="absolute left-0 right-0 border-t border-border/10 border-dashed"
                    style={{ top: `${hour * zoomLevel + zoomLevel / 2}px` }}
                  />
                  {/* Click target for bottom half */}
                  <div
                    onClick={() => handleGridClick(hour, true)}
                    className="absolute left-0 right-0 hover:bg-secondary/10 cursor-pointer"
                    style={{ top: `${hour * zoomLevel + zoomLevel / 2}px`, height: `${zoomLevel / 2}px` }}
                    title={`Schedule event at ${hour}:30`}
                  />
                </React.Fragment>
              ))}
            </div>

            {/* Positioned Events Container */}
            <div className="absolute left-16 right-0 top-0 h-full pointer-events-none">
              {positionedEvents.map((ev) => {
                const widthPercent = 100 / (ev.overlap_total || 1);
                const leftPercent = (ev.overlap_column || 0) * widthPercent;

                const topPx = ((ev.top_position || 0) / 60) * zoomLevel;
                const heightPx = ((ev.height || 0) / 60) * zoomLevel;

                const isOverlayOpen = activeOverlayId === ev.id;

                const getContrastClass = (hexColor: string) => {
                  if (!hexColor) return 'text-white';
                  const hex = hexColor.replace('#', '');
                  if (hex.length !== 6) return 'text-white';
                  const r = parseInt(hex.substring(0, 2), 16);
                  const g = parseInt(hex.substring(2, 4), 16);
                  const b = parseInt(hex.substring(4, 6), 16);
                  const yiq = (r * 299 + g * 587 + b * 114) / 1000;
                  return yiq >= 128 ? 'text-black' : 'text-white';
                };

                const textClass = ev.isPending ? 'text-foreground' : getContrastClass(ev.tag_color || '#6b7280');
                const subtextClass = ev.isPending
                  ? 'text-muted-foreground'
                  : getContrastClass(ev.tag_color || '#6b7280') === 'text-black'
                  ? 'text-black/80 font-medium'
                  : 'text-white/80 font-medium';

                return (
                  <div
                    key={ev.id}
                    className={`absolute rounded pointer-events-auto transition-all select-none cursor-pointer flex flex-col overflow-hidden group event-card-clickable ${
                      ev.isPending
                        ? 'border border-dashed bg-amber-950/20 border-amber-500/50 shadow-md'
                        : 'shadow border border-black/10 hover:brightness-105'
                    } ${
                      heightPx < 46
                        ? 'px-1.5 items-start justify-center'
                        : 'pt-1 pb-1 px-1.5 items-start justify-start'
                    }`}
                    style={{
                      top: `${topPx}px`,
                      height: `${heightPx}px`,
                      left: `${leftPercent}%`,
                      width: `calc(${widthPercent}% - 3px)`,
                      backgroundColor: ev.isPending ? undefined : ev.tag_color,
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleOpenEditOverlay(ev, e);
                    }}
                  >
                    {/* Event block content */}
                    {heightPx < 46 ? (
                      <div className="truncate leading-none w-full">
                        <span className={`font-extrabold text-xs ${textClass}`}>{ev.title}</span>
                        <span className={`font-extrabold text-[9px] ml-1 opacity-80 ${subtextClass}`}>({ev.start_time})</span>
                      </div>
                    ) : (
                      <div className="truncate leading-none w-full">
                        <span className={`font-extrabold text-xs truncate block ${textClass}`}>
                          {ev.title}
                        </span>
                        {ev.recurrenceId && (
                          <span className={`text-[10px] ml-1.5 ${subtextClass}`} title="Recurring Event">
                            ↻
                          </span>
                        )}
                        <span className={`font-extrabold text-[10px] block mt-0.5 ${subtextClass}`}>
                          {ev.start_time} - {ev.end_time}
                        </span>
                      </div>
                    )}

                    {/* Pending label indicator */}
                    {ev.isPending === 1 && heightPx >= 46 && (
                      <span className="text-[9px] font-bold text-amber-400 uppercase tracking-widest bg-amber-900/30 px-1 rounded self-start mt-1">
                        Pending
                      </span>
                    )}
                  </div>
                );
              })}
            </div>

          </div>
        </div>
      </div>

      {/* EDIT OVERLAY POPOVER */}
      {activeOverlayId && editingEvent && (
        <div
          ref={overlayRef}
          className="fixed bg-card border border-border rounded-lg shadow-2xl p-4 w-72 space-y-3 z-50 text-left"
          style={{
            left: overlayCoords ? `${overlayCoords.x}px` : '50%',
            top: overlayCoords ? `${overlayCoords.y}px` : '50%',
          }}
        >
          <div className="flex items-center justify-between border-b border-border pb-2">
            <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Edit Event
            </h4>
            <button
              onClick={() => {
                setActiveOverlayId(null);
                setEditingEvent(null);
                setOverlayCoords(null);
              }}
              className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Title */}
          <div>
            <input
              type="text"
              required
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              placeholder="Title"
              className="block w-full rounded bg-secondary border border-border px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          {/* Tag */}
          <div className="flex items-center gap-2">
            <span
              className="w-4 h-4 rounded-full border border-border flex-shrink-0"
              style={{ backgroundColor: getTagColor(editTag) }}
            ></span>
            <select
              value={editTag}
              onChange={(e) => setEditTag(e.target.value)}
              className="block w-full rounded bg-secondary border border-border px-2 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary cursor-pointer"
            >
              <option value="">No Tag</option>
              {tags.map((t) => (
                <option key={t.id} value={t.name}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>

          {/* Date/Time Inputs */}
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <label className="block text-muted-foreground">Start Time</label>
              <input
                type="time"
                value={editStartTime}
                onChange={(e) => setEditStartTime(e.target.value)}
                className="mt-1 block w-full rounded bg-secondary border border-border px-1 py-1 text-foreground focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-muted-foreground">End Time</label>
              <input
                type="time"
                value={editEndTime}
                onChange={(e) => setEditEndTime(e.target.value)}
                className="mt-1 block w-full rounded bg-secondary border border-border px-1 py-1 text-foreground focus:outline-none"
              />
            </div>
          </div>

          {/* Description */}
          <div>
            <textarea
              value={editDesc}
              onChange={(e) => setEditDesc(e.target.value)}
              placeholder="Description"
              rows={2}
              className="block w-full rounded bg-secondary border border-border px-3 py-1.5 text-xs text-foreground focus:outline-none resize-none"
            />
          </div>

          {/* Buttons Actions */}
          <div className="flex gap-2">
            {editingEvent.recurrenceId ? (
              <button
                type="button"
                onClick={() => {
                  setRecurEvent(editingEvent);
                  setShowEditRecurModal(true);
                }}
                className="flex-1 py-1.5 bg-primary hover:bg-blue-600 text-white rounded text-xs font-semibold cursor-pointer text-center"
              >
                Save
              </button>
            ) : (
              <button
                type="button"
                onClick={() => handleUpdateInstance(editingEvent.id)}
                className="flex-1 py-1.5 bg-primary hover:bg-blue-600 text-white rounded text-xs font-semibold cursor-pointer text-center"
              >
                Save
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setActiveOverlayId(null);
                setEditingEvent(null);
                setOverlayCoords(null);
              }}
              className="px-3 py-1.5 bg-secondary hover:bg-muted text-foreground rounded text-xs font-semibold cursor-pointer"
            >
              Cancel
            </button>
          </div>

            {/* Delete & Copy buttons */}
            <div className="border-t border-border pt-2 flex justify-between gap-2">
              {editingEvent.recurrenceId ? (
                <button
                  type="button"
                  onClick={() => {
                    setRecurEvent(editingEvent);
                    setShowDeleteRecurModal(true);
                  }}
                  className="flex-1 flex items-center justify-center gap-1.5 py-1.5 bg-red-650 hover:bg-red-700 text-white rounded text-xs font-semibold cursor-pointer"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => handleDeleteInstance(editingEvent.id)}
                  className="flex-1 flex items-center justify-center gap-1.5 py-1.5 bg-red-650 hover:bg-red-700 text-white rounded text-xs font-semibold cursor-pointer"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete
                </button>
              )}
              
              <button
                type="button"
                onClick={() => handleCopy(editingEvent.id)}
                className="px-3 py-1.5 bg-secondary hover:bg-muted text-foreground rounded text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer"
                title="Copy Event"
              >
                <Copy className="h-3.5 w-3.5" />
                Copy
              </button>
            </div>
          </div>
        )}

      {/* RENDER EDIT RECURRING MODAL */}
      {showEditRecurModal && recurEvent && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="bg-card border border-border p-6 rounded-lg w-full max-w-sm space-y-4 shadow-2xl">
            <h3 className="text-lg font-bold text-foreground">Edit Recurring Event</h3>
            <p className="text-sm text-muted-foreground">
              This is a recurring event. How would you like to edit it?
            </p>
            <div className="space-y-2">
              <button
                onClick={() => {
                  handleUpdateInstance(recurEvent.id);
                  setShowEditRecurModal(false);
                }}
                className="w-full py-2 bg-primary hover:bg-blue-600 text-white text-sm font-semibold rounded cursor-pointer transition"
              >
                Edit this event only
              </button>
              <button
                onClick={() => {
                  if (recurEvent.recurrenceId) {
                    handleUpdateSeries(recurEvent.recurrenceId);
                  }
                  setShowEditRecurModal(false);
                }}
                className="w-full py-2 bg-primary hover:bg-blue-600 text-white text-sm font-semibold rounded cursor-pointer transition"
              >
                Edit entire series
              </button>
              <button
                onClick={() => setShowEditRecurModal(false)}
                className="w-full py-2 bg-secondary hover:bg-muted text-foreground text-sm font-semibold rounded cursor-pointer transition"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* RENDER DELETE RECURRING MODAL */}
      {showDeleteRecurModal && recurEvent && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="bg-card border border-border p-6 rounded-lg w-full max-w-sm space-y-4 shadow-2xl">
            <h3 className="text-lg font-bold text-foreground">Delete Recurring Event</h3>
            <p className="text-sm text-muted-foreground">
              This is a recurring event. How would you like to delete it?
            </p>
            <div className="space-y-2">
              <button
                onClick={() => {
                  handleDeleteInstance(recurEvent.id);
                  setShowDeleteRecurModal(false);
                }}
                className="w-full py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-semibold rounded cursor-pointer transition"
              >
                Delete this event only
              </button>
              <button
                onClick={() => {
                  if (recurEvent.recurrenceId) {
                    handleDeleteSeries(recurEvent.recurrenceId);
                  }
                  setShowDeleteRecurModal(false);
                }}
                className="w-full py-2 bg-red-650 hover:bg-red-750 text-white text-sm font-semibold rounded cursor-pointer transition"
              >
                Delete entire series
              </button>
              <button
                onClick={() => setShowDeleteRecurModal(false)}
                className="w-full py-2 bg-secondary hover:bg-muted text-foreground text-sm font-semibold rounded cursor-pointer transition"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
