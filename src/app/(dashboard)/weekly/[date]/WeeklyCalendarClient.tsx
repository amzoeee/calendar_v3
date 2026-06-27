'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  Trash2,
  Copy,
  X,
  Plus,
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

interface WeeklyCalendarClientProps {
  date: string;
  sundayDate: string;
  initialEvents: any[];
  tags: Tag[];
}

export default function WeeklyCalendarClient({ date, sundayDate, initialEvents, tags }: WeeklyCalendarClientProps) {
  const router = useRouter();

  // --- Zoom & Scroll ---
  const [zoomLevel, setZoomLevel] = useState<number>(60);
  const timelineContainerRef = useRef<HTMLDivElement>(null);

  // --- Overlay & Modal States ---
  const [activeOverlayId, setActiveOverlayId] = useState<number | null>(null);
  const [showEditRecurModal, setShowEditRecurModal] = useState<boolean>(false);
  const [showDeleteRecurModal, setShowDeleteRecurModal] = useState<boolean>(false);
  const [recurEvent, setRecurEvent] = useState<PositionedEvent | null>(null);
  const [editingEvent, setEditingEvent] = useState<PositionedEvent | null>(null);
  const [overlayCoords, setOverlayCoords] = useState<{ x: number; y: number } | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  // --- Edit Form State ---
  const [editTitle, setEditTitle] = useState('');
  const [editTag, setEditTag] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editStartDate, setEditStartDate] = useState('');
  const [editStartTime, setEditStartTime] = useState('');
  const [editEndDate, setEditEndDate] = useState('');
  const [editEndTime, setEditEndTime] = useState('');

  // --- Add Event Modal State ---
  const [showAddModal, setShowAddModal] = useState(false);
  const [addTitle, setAddTitle] = useState('');
  const [addTag, setAddTag] = useState('');
  const [addDesc, setAddDesc] = useState('');
  const [addStartDate, setAddStartDate] = useState(date);
  const [addStartTime, setAddStartTime] = useState('09:00');
  const [addEndDate, setAddEndDate] = useState(date);
  const [addEndTime, setAddEndTime] = useState('10:00');
  const [addRecur, setAddRecur] = useState('');
  const [addRecurEnd, setAddRecurEnd] = useState('');

  // Get week dates (7 dates from Sunday)
  const getWeekDates = (): Date[] => {
    const dates: Date[] = [];
    const sun = new Date(sundayDate + 'T00:00:00');
    for (let i = 0; i < 7; i++) {
      dates.push(new Date(sun.getTime() + i * 24 * 60 * 60 * 1000));
    }
    return dates;
  };

  const weekDates = getWeekDates();

  // Navigation
  const prevWeekStr = new Date(new Date(sundayDate).getTime() - 7 * 24 * 60 * 60 * 1000).toLocaleDateString('en-CA');
  const nextWeekStr = new Date(new Date(sundayDate).getTime() + 7 * 24 * 60 * 60 * 1000).toLocaleDateString('en-CA');
  const weekStartStr = weekDates[0].toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const weekEndStr = weekDates[6].toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  // Load state
  useEffect(() => {
    const savedZoom = localStorage.getItem('calendarZoomLevel');
    if (savedZoom) setZoomLevel(parseInt(savedZoom, 10));

    const savedScroll = localStorage.getItem('calendarScrollPos');
    if (savedScroll && timelineContainerRef.current) {
      timelineContainerRef.current.scrollTop = parseInt(savedScroll, 10);
    }
  }, []);

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

  // Keyboard zoom (Cmd/Ctrl + '=', '-', '0') and arrow key navigation
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
          router.push(`/weekly/${prevWeekStr}`);
        } else if (e.key === 'ArrowRight') {
          e.preventDefault();
          saveScroll();
          router.push(`/weekly/${nextWeekStr}`);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [prevWeekStr, nextWeekStr]);

  const saveScroll = () => {
    if (timelineContainerRef.current) {
      localStorage.setItem('calendarScrollPos', String(timelineContainerRef.current.scrollTop));
    }
  };

  // Process events for a single day
  const getPositionedEventsForDay = (day: Date): PositionedEvent[] => {
    const processed: PositionedEvent[] = [];
    const dayStart = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, 0, 0).getTime();
    const dayEnd = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 23, 59, 59).getTime();

    for (const ev of initialEvents) {
      const startDt = new Date(ev.startDatetime.replace(' ', 'T'));
      const endDt = new Date(ev.endDatetime.replace(' ', 'T'));

      const clippedStart = Math.max(startDt.getTime(), dayStart);
      const clippedEnd = Math.min(endDt.getTime(), dayEnd);

      if (clippedStart >= dayEnd || clippedEnd <= dayStart) {
        continue;
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

  const handleGridClick = (day: Date, hour: number) => {
    saveScroll();
    const dateStr = day.toLocaleDateString('en-CA');
    setAddStartDate(dateStr);
    setAddEndDate(dateStr);
    const startHourStr = String(hour).padStart(2, '0');
    const endHourStr = String((hour + 1) % 24).padStart(2, '0');
    setAddStartTime(`${startHourStr}:00`);
    setAddEndTime(`${endHourStr}:00`);
    setShowAddModal(true);
  };

  const getTagColor = (tagName: string) => {
    return tags.find((t) => t.name === tagName)?.color || 'transparent';
  };

  // Handlers
  const handleAddSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    saveScroll();
    await addEventAction({
      title: addTitle,
      description: addDesc,
      tag: addTag,
      startDatetime: `${addStartDate}T${addStartTime}`,
      endDatetime: `${addEndDate}T${addEndTime}`,
      recurrence: addRecur,
      recurrenceEndDate: addRecurEnd,
    });
    // Reset inputs
    setAddTitle('');
    setAddDesc('');
    setAddTag('');
    setAddRecur('');
    setAddRecurEnd('');
    setShowAddModal(false);
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
    <div className="flex-1 flex flex-col overflow-hidden relative">
      
      {/* Navigation Header */}
      <div className="h-16 border-b border-border flex items-center justify-between px-6 shrink-0 glass-panel">
        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              saveScroll();
              router.push(`/weekly/${prevWeekStr}`);
            }}
            className="p-2 rounded-lg bg-secondary hover:bg-muted text-foreground transition cursor-pointer"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button
            onClick={() => {
              saveScroll();
              const today = new Date().toLocaleDateString('en-CA');
              router.push(`/weekly/${today}`);
            }}
            className="px-3 py-2 text-sm font-semibold rounded-lg bg-secondary hover:bg-muted text-foreground transition cursor-pointer"
          >
            Today
          </button>
          <button
            onClick={() => {
              saveScroll();
              router.push(`/weekly/${nextWeekStr}`);
            }}
            className="p-2 rounded-lg bg-secondary hover:bg-muted text-foreground transition cursor-pointer"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>

        <h1 className="text-xl font-bold tracking-tight">
          {weekStartStr} – {weekEndStr}
        </h1>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5 bg-secondary border border-border rounded-lg p-0.5">
            <button
              onClick={() => changeZoom(-15)}
              className="p-1 rounded hover:bg-muted text-foreground cursor-pointer"
              title="Zoom Out (Cmd -)">
              <ZoomOut className="h-4 w-4" />
            </button>
            <button
              onClick={resetZoom}
              className="text-xs font-bold text-muted-foreground px-1 hover:text-foreground cursor-pointer"
              title="Reset Zoom (Cmd 0)">
              {Math.round((zoomLevel / 60) * 100)}%
            </button>
            <button
              onClick={() => changeZoom(15)}
              className="p-1 rounded hover:bg-muted text-foreground cursor-pointer"
              title="Zoom In (Cmd +)">
              <ZoomIn className="h-4 w-4" />
            </button>
          </div>
          <span className="px-3 py-1.5 bg-accent/20 border border-accent text-accent-foreground text-xs font-semibold rounded-lg">
            Weekly
          </span>
        </div>
      </div>

      {/* Frozen day-header row (outside scroll) */}
      <div className="flex shrink-0 border-b border-border bg-background">
        {/* Spacer matching the time-labels sidebar width */}
        <div className="w-16 shrink-0 border-r border-border" />
        {/* Day headers */}
        <div className="flex-1 grid grid-cols-7">
          {weekDates.map((day, colIdx) => {
            const isToday = day.toDateString() === new Date().toDateString();
            return (
              <div
                key={colIdx}
                className={`border-r border-border/40 p-2 text-center select-none ${
                  isToday ? 'bg-primary/5' : ''
                }`}
              >
                <p className="text-[10px] uppercase font-bold text-muted-foreground">
                  {day.toLocaleDateString('en-US', { weekday: 'short' })}
                </p>
                <p className={`text-sm font-extrabold mt-0.5 inline-flex items-center justify-center h-6 w-6 rounded-full ${
                  isToday ? 'bg-primary text-primary-foreground' : 'text-foreground'
                }`}>
                  {day.getDate()}
                </p>
              </div>
            );
          })}
        </div>
      </div>

      {/* Scrollable timeline area */}
      <div
        ref={timelineContainerRef}
        className="flex-1 overflow-y-auto calendar-scrollbar relative timeline-container"
        id="timeline-container"
      >
        {/* Weekly grid wrapper */}
        <div className="relative w-full flex" style={{ height: `${zoomLevel * 24}px` }}>

          {/* Hour labels sidebar */}
          <div className="w-16 h-full border-r border-border bg-card/30 shrink-0 select-none relative z-10">
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

          {/* 7 Columns Grid */}
          <div className="flex-1 grid grid-cols-7 h-full relative">
            {weekDates.map((day, colIdx) => {
              const isToday = day.toDateString() === new Date().toDateString();
              const dayEvents = getPositionedEventsForDay(day);

              return (
                <div
                  key={colIdx}
                  className={`h-full border-r border-border/40 relative ${
                    isToday ? 'bg-primary/5' : ''
                  }`}
                >
                  {/* Hourly lines & click listeners */}
                  <div className="absolute inset-0 pointer-events-none">
                    {Array.from({ length: 24 }).map((_, hour) => (
                      <React.Fragment key={hour}>
                        {/* Hour line */}
                        <div
                          className="absolute left-0 right-0 border-t border-border/20"
                          style={{ top: `${hour * zoomLevel}px` }}
                        />
                        {/* Click target to add event */}
                        <div
                          onClick={() => handleGridClick(day, hour)}
                          className="absolute left-0 right-0 hover:bg-secondary/15 cursor-pointer pointer-events-auto"
                          style={{ top: `${hour * zoomLevel}px`, height: `${zoomLevel}px` }}
                          title={`Schedule event on ${day.getDate()} at ${hour}:00`}
                        />
                      </React.Fragment>
                    ))}
                  </div>

                  {/* Event Blocks Container */}
                  <div className="absolute inset-0 pointer-events-none">
                    {dayEvents.map((ev) => {
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
                          className={`absolute rounded pointer-events-auto transition-all select-none cursor-pointer flex flex-col justify-center overflow-hidden shadow-sm event-card-clickable ${
                            ev.isPending
                              ? 'border border-dashed bg-amber-950/20 border-amber-500/50'
                              : 'border border-black/10 hover:brightness-105'
                          } ${
                            heightPx < 46
                              ? 'px-1 items-start justify-center'
                              : 'pt-1 pb-1 px-1 items-start justify-start'
                          }`}
                          style={{
                            top: `${topPx}px`,
                            height: `${heightPx}px`,
                            left: `${leftPercent}%`,
                            width: `calc(${widthPercent}% - 2px)`,
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
                              <span className={`font-extrabold text-[9px] block mt-0.5 ${subtextClass}`}>
                                {ev.start_time} - {ev.end_time}
                              </span>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                </div>
              );
            })}
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

          {/* Times */}
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

          {/* Actions */}
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

            {/* Delete & Copy */}
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
              >
                <Copy className="h-3.5 w-3.5" />
                Copy
              </button>
            </div>
          </div>
        )}

      {/* QUICK ADD MODAL */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="bg-card border border-border p-6 rounded-lg w-full max-w-sm space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-border pb-2">
              <h3 className="text-lg font-bold text-foreground">Add Event</h3>
              <button
                onClick={() => setShowAddModal(false)}
                className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleAddSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-muted-foreground uppercase">Title</label>
                <input
                  type="text"
                  required
                  placeholder="Event name"
                  value={addTitle}
                  onChange={(e) => setAddTitle(e.target.value)}
                  className="mt-1 block w-full rounded bg-secondary border border-border px-3 py-1.5 text-sm text-foreground focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <label className="block text-muted-foreground">Start Time</label>
                  <input
                    type="time"
                    required
                    value={addStartTime}
                    onChange={(e) => setAddStartTime(e.target.value)}
                    className="mt-1 block w-full rounded bg-secondary border border-border px-2 py-1 text-foreground"
                  />
                </div>
                <div>
                  <label className="block text-muted-foreground">End Time</label>
                  <input
                    type="time"
                    required
                    value={addEndTime}
                    onChange={(e) => setAddEndTime(e.target.value)}
                    className="mt-1 block w-full rounded bg-secondary border border-border px-2 py-1 text-foreground"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-muted-foreground uppercase">Tag</label>
                <select
                  value={addTag}
                  onChange={(e) => setAddTag(e.target.value)}
                  className="mt-1 block w-full rounded bg-secondary border border-border px-3 py-1.5 text-sm text-foreground"
                >
                  <option value="">None</option>
                  {tags.filter((t) => !t.isArchived).map((t) => (
                    <option key={t.id} value={t.name}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-muted-foreground uppercase">Description</label>
                <textarea
                  value={addDesc}
                  onChange={(e) => setAddDesc(e.target.value)}
                  placeholder="Optional description"
                  rows={2}
                  className="mt-1 block w-full rounded bg-secondary border border-border px-3 py-1.5 text-sm text-foreground resize-none"
                />
              </div>

              <div>
                <button
                  type="submit"
                  className="w-full py-2 bg-primary hover:bg-blue-600 text-white rounded text-sm font-bold cursor-pointer transition"
                >
                  Create Event
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* EDIT RECURRING SERIES MODAL */}
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

      {/* DELETE RECURRING SERIES MODAL */}
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
                className="w-full py-2 bg-red-650 hover:bg-red-750 text-white text-sm font-semibold rounded cursor-pointer transition"
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
                className="w-full py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-semibold rounded cursor-pointer transition"
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
