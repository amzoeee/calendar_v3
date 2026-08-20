'use client';

import React, { useState, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import TagSelect from '@/app/components/TagSelect';
import {
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  Trash2,
  Copy,
  X,
  Plus,
  Circle,
} from 'lucide-react';
import { PositionedEvent, calculateOverlapColumns } from '@/lib/overlap';
import { computeInitialOverlayCoords, topMinToViewportTop, clampOverlayTopMin, overlayClipPath } from '@/lib/overlayPosition';
import EventSearch from '@/app/components/EventSearch';
import {
  addEventAction,
  updateEventAction,
  deleteEventAction,
  copyEventAction,
  deleteRecurringSeriesAction,
  updateRecurringSeriesAction,
} from '@/app/actions';
import {
  getBrowserTimeZone,
  pacificDbStringToDate,
  formatDateInputValue,
  formatTimeInputValue,
  formatEventTimeRange,
} from '@/lib/timezone';

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
  // Anchor for the edit overlay: `topMin` = the event's start minute (so it
  // scales with zoom), `x` = horizontal viewport px. This is the TRUE click
  // anchor and is never mutated after being set — positioned imperatively
  // (see positionOverlay) so it tracks the event with no per-frame re-render.
  const [overlayCoords, setOverlayCoords] = useState<{ topMin: number; x: number } | null>(null);
  // One-time vertical nudge (in timeline minutes) applied on top of
  // overlayCoords.topMin so the popup opens fully on-screen even when the
  // click was near the end of the day. Computed fresh from the true anchor
  // whenever the overlay opens, and dropped back to 0 on zoom/resize so a
  // nudge sized for one viewport never lingers and drags the popup out of
  // sync with its event — see the effects below.
  const [verticalNudgeMin, setVerticalNudgeMin] = useState(0);
  // Adjust-state-during-render: reset the nudge as soon as zoom changes.
  const [prevZoomLevel, setPrevZoomLevel] = useState(zoomLevel);
  if (prevZoomLevel !== zoomLevel) {
    setPrevZoomLevel(zoomLevel);
    if (verticalNudgeMin !== 0) setVerticalNudgeMin(0);
  }
  const overlayRef = useRef<HTMLDivElement>(null);
  // Separate DOM subtree from overlayRef (the desktop popover, hidden on
  // mobile) — the click-outside listener below needs to know about both so a
  // tap inside the mobile sheet isn't mistaken for a click outside it.
  const mobileEditSheetRef = useRef<HTMLDivElement>(null);

  // --- Edit Form State ---
  const [editTitle, setEditTitle] = useState('');
  const [editTag, setEditTag] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editStartDate, setEditStartDate] = useState('');
  const [editStartTime, setEditStartTime] = useState('');
  const [editEndDate, setEditEndDate] = useState('');
  const [editEndTime, setEditEndTime] = useState('');

  // Ref so the keydown handler always reads the latest edit state.
  const editStateRef = useRef({ editTitle, editTag, editDesc, editStartDate, editStartTime, editEndDate, editEndTime });
  editStateRef.current = { editTitle, editTag, editDesc, editStartDate, editStartTime, editEndDate, editEndTime };

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

  // Depends only on sundayDate, so it stays referentially stable across the
  // frequent re-renders that don't change the week (zoom, overlay state).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const weekDates = useMemo(() => getWeekDates(), [sundayDate]);

  // Navigation
  const prevWeekStr = new Date(new Date(sundayDate + 'T00:00:00').getTime() - 7 * 24 * 60 * 60 * 1000).toLocaleDateString('en-CA');
  const nextWeekStr = new Date(new Date(sundayDate + 'T00:00:00').getTime() + 7 * 24 * 60 * 60 * 1000).toLocaleDateString('en-CA');
  const weekStartStr = weekDates[0].toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const weekEndStr = weekDates[6].toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  // Compact form for the mobile header — "8/2 - 8/8" instead of "Aug 2 - Aug 8, 2026".
  const weekStartCompact = weekDates[0].toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' });
  const weekEndCompact = weekDates[6].toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' });

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
        !overlayRef.current.contains(event.target as Node) &&
        !mobileEditSheetRef.current?.contains(event.target as Node)
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
    setZoomLevel((prev) => Math.max(30, Math.min(300, prev + delta)));
  };

  const resetZoom = () => {
    setZoomLevel(60);
  };

  // Persist the zoom level as an effect rather than from inside the setState
  // updater — updaters must be pure (React may invoke them more than once).
  // Writes are ~0.006ms, so doing this per change costs nothing measurable.
  const zoomHydratedRef = useRef(false);
  useEffect(() => {
    // Skip the first run so the default 60 can't clobber the stored value
    // before the load effect above has applied it.
    if (!zoomHydratedRef.current) {
      zoomHydratedRef.current = true;
      return;
    }
    localStorage.setItem('calendarZoomLevel', String(zoomLevel));
  }, [zoomLevel]);

  // Keyboard zoom (Cmd/Ctrl + '=', '-', '0'), arrow key navigation, and edit overlay shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isInput =
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement;

      // Escape closes the overlay regardless of focus
      if (e.key === 'Escape' && activeOverlayId !== null) {
        e.preventDefault();
        setActiveOverlayId(null);
        setEditingEvent(null);
        setOverlayCoords(null);
        return;
      }

      // Enter saves the event regardless of whether focus is in a form field
      if (e.key === 'Enter' && activeOverlayId !== null && editingEvent) {
        e.preventDefault();
        if (editingEvent.recurrenceId) {
          setRecurEvent(editingEvent);
          setShowEditRecurModal(true);
        } else {
          const s = editStateRef.current;
          saveScroll();
          updateEventAction(editingEvent.id, {
            title: s.editTitle,
            description: s.editDesc,
            tag: s.editTag,
            startDatetime: `${s.editStartDate}T${s.editStartTime}`,
            endDatetime: `${s.editEndDate}T${s.editEndTime}`,
            timeZone: getBrowserTimeZone(),
          }).then(() => {
            setActiveOverlayId(null);
            setEditingEvent(null);
            setOverlayCoords(null);
          });
        }
        return;
      }

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
        } else if ((e.key === 'Delete' || e.key === 'Backspace') && activeOverlayId !== null && editingEvent) {
          e.preventDefault();
          if (editingEvent.recurrenceId) {
            setRecurEvent(editingEvent);
            setShowDeleteRecurModal(true);
          } else {
            handleDeleteInstance(editingEvent.id);
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [router, prevWeekStr, nextWeekStr, activeOverlayId, editingEvent]);

  const saveScroll = () => {
    if (timelineContainerRef.current) {
      localStorage.setItem('calendarScrollPos', String(timelineContainerRef.current.scrollTop));
    }
  };

  // Position the edit overlay imperatively so it tracks its event as the
  // timeline scrolls/zooms — pinned to the event's on-screen position, and
  // clipped to the timeline box so it partially cuts off at the edges and
  // disappears entirely once the event scrolls out of view. Writing styles
  // directly (rather than via React state) keeps scrolling lag-free.
  const positionOverlay = () => {
    const el = overlayRef.current;
    const container = timelineContainerRef.current;
    if (!el || !container || !overlayCoords) return;

    const rect = container.getBoundingClientRect();
    const top = topMinToViewportTop(overlayCoords.topMin + verticalNudgeMin, rect.top, container.scrollTop, zoomLevel);
    el.style.top = `${top}px`;
    el.style.left = `${overlayCoords.x}px`;

    // Clip to the container's vertical bounds; hide once fully outside.
    const h = el.offsetHeight;
    const clipTop = Math.max(0, rect.top - top);
    const clipBottom = Math.max(0, top + h - rect.bottom);
    if (clipTop >= h || clipBottom >= h) {
      el.style.visibility = 'hidden';
    } else {
      el.style.visibility = 'visible';
      el.style.clipPath = overlayClipPath(clipTop, clipBottom);
    }
  };

  // Compute the one-time vertical nudge fresh from the TRUE click anchor
  // whenever the overlay opens (or a new click re-anchors it within the same
  // event) — never from a previously-nudged value, so it can't compound or
  // drift out of sync with the event after a later zoom/resize.
  useLayoutEffect(() => {
    if (activeOverlayId === null || !overlayCoords) return;
    const el = overlayRef.current;
    const container = timelineContainerRef.current;
    if (!el || !container) return;

    const rect = container.getBoundingClientRect();
    const naturalTop = topMinToViewportTop(overlayCoords.topMin, rect.top, container.scrollTop, zoomLevel);
    const nudge = clampOverlayTopMin(overlayCoords.topMin, naturalTop, el.offsetHeight, zoomLevel, window.innerHeight) - overlayCoords.topMin;
    setVerticalNudgeMin(nudge);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeOverlayId, overlayCoords]);

  // Reposition on scroll (tracking the current nudge as-is) and on resize
  // (dropping the nudge — a window resize can't be "clamped for" the way an
  // initial-open nudge is, so just let the popup crop/hide via the clip-path
  // above, same as when its event scrolls out of view).
  useLayoutEffect(() => {
    if (activeOverlayId === null || !overlayCoords) return;
    positionOverlay();
    const container = timelineContainerRef.current;
    const onScroll = () => positionOverlay();
    const onResize = () => {
      setVerticalNudgeMin(0);
      positionOverlay();
    };
    container?.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize);
    return () => {
      container?.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeOverlayId, overlayCoords, zoomLevel, verticalNudgeMin]);

  // Process events for a single day
  const getPositionedEventsForDay = (day: Date): PositionedEvent[] => {
    const processed: PositionedEvent[] = [];
    const dayStart = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, 0, 0).getTime();
    const dayEnd = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 23, 59, 59).getTime();

    for (const ev of initialEvents) {
      const startDt = pacificDbStringToDate(ev.startDatetime);
      const endDt = pacificDbStringToDate(ev.endDatetime);

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
        time_range: formatEventTimeRange(startDt, endDt),
        start_datetime_local: `${formatDateInputValue(startDt)}T${formatTimeInputValue(startDt)}`,
        end_datetime_local: `${formatDateInputValue(endDt)}T${formatTimeInputValue(endDt)}`,
        tag_color: tagColor,
        multi_day: startDt.toDateString() !== endDt.toDateString(),
        continues_before: startDt.getTime() < dayStart,
        continues_after: endDt.getTime() > dayEnd,
      });
    }

    return calculateOverlapColumns(processed);
  };

  // Positions here are in *minutes*, not pixels — zoom is applied at render
  // time — so this survives zooming unchanged. Memoizing it keeps a zoom
  // keystroke from re-deriving every event's dates 14 times over (7 days x
  // both the mobile agenda and the desktop grid), which is what made spamming
  // the zoom keys lag.
  const positionedEventsByDay = useMemo(
    () =>
      weekDates.map((day) =>
        getPositionedEventsForDay(day).sort((a, b) => (a.top_position || 0) - (b.top_position || 0))
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [weekDates, initialEvents, tags]
  );

  const handleOpenEditOverlay = (ev: PositionedEvent, e: React.MouseEvent) => {
    saveScroll();

    // Anchor the overlay to the exact click point: horizontal straight from the
    // click, vertical converted to a timeline minute so all subsequent
    // scroll/zoom anchoring stays relative to where the click landed.
    const container = timelineContainerRef.current;
    const rect = container?.getBoundingClientRect();
    const scrollTop = container?.scrollTop ?? 0;

    setOverlayCoords(
      computeInitialOverlayCoords(e.clientX, e.clientY, rect?.top ?? 0, scrollTop, zoomLevel, window.innerWidth)
    );
    setEditingEvent(ev);
    setActiveOverlayId(ev.id);
    setEditTitle(ev.title);
    setEditTag(ev.tag || '');
    setEditDesc(ev.description || '');
    const editStartDt = pacificDbStringToDate(ev.startDatetime);
    const editEndDt = pacificDbStringToDate(ev.endDatetime);
    setEditStartDate(formatDateInputValue(editStartDt));
    setEditStartTime(formatTimeInputValue(editStartDt));
    setEditEndDate(formatDateInputValue(editEndDt));
    setEditEndTime(formatTimeInputValue(editEndDt));
  };

  // Mobile agenda rows have no click-point to anchor a popover to (there's no
  // desktop-style overlay on mobile — see the bottom sheet below), so this just
  // populates the edit state without touching overlayCoords/positioning.
  const handleOpenEditMobile = (ev: PositionedEvent) => {
    saveScroll();
    setEditingEvent(ev);
    setActiveOverlayId(ev.id);
    setEditTitle(ev.title);
    setEditTag(ev.tag || '');
    setEditDesc(ev.description || '');
    const editStartDt = pacificDbStringToDate(ev.startDatetime);
    const editEndDt = pacificDbStringToDate(ev.endDatetime);
    setEditStartDate(formatDateInputValue(editStartDt));
    setEditStartTime(formatTimeInputValue(editStartDt));
    setEditEndDate(formatDateInputValue(editEndDt));
    setEditEndTime(formatTimeInputValue(editEndDt));
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
      timeZone: getBrowserTimeZone(),
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
      timeZone: getBrowserTimeZone(),
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

  const today = new Date();

  // Mobile: tapping Today should jump the agenda list to today's section, not
  // just land at the top (Sunday). Clicking Today navigates to a new `date`
  // (even within the same week), which fully remounts this component — so a
  // ref set before the click can't survive to the other side. Instead it's
  // driven by a `?scrollToday=` query param (same deep-link pattern as the
  // `?event=` scroll-to-event in the daily view), read fresh after whatever
  // navigation/remount happens. Polls briefly since the agenda list may render
  // a tick after mount.
  const agendaContainerRef = useRef<HTMLDivElement>(null);
  const searchParams = useSearchParams();
  const scrolledToTodayParam = useRef<string | null>(null);
  useEffect(() => {
    const flag = searchParams.get('scrollToday');
    if (!flag || scrolledToTodayParam.current === flag) return;

    let tries = 0;
    const attempt = () => {
      if (scrolledToTodayParam.current === flag) return;
      const container = agendaContainerRef.current;
      const target = container?.querySelector<HTMLElement>('[data-today-section]');
      if (container && target) {
        scrolledToTodayParam.current = flag;
        // offsetTop is relative to the nearest positioned ancestor, not
        // necessarily this container (neither is position:relative here) —
        // that overshot past the header height and landed on the first
        // event instead of the date label. getBoundingClientRect deltas give
        // the true offset within the scroll container regardless.
        const containerRect = container.getBoundingClientRect();
        const targetRect = target.getBoundingClientRect();
        const offset = targetRect.top - containerRect.top + container.scrollTop;
        container.scrollTo({ top: offset, behavior: 'smooth' });
        return;
      }
      if (tries++ < 20) setTimeout(attempt, 50);
    };
    attempt();
  }, [searchParams]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden relative">

      {/* Mobile FAB: opens the same Add Event modal used on desktop */}
      <button
        onClick={() => setShowAddModal(true)}
        className="md:hidden absolute right-4 bottom-4 z-30 h-14 w-14 rounded-full bg-primary text-primary-foreground shadow-2xl flex items-center justify-center cursor-pointer"
        aria-label="Add event"
      >
        <Plus className="h-6 w-6" />
      </button>

      {/* Navigation Header */}
      <div className="h-14 md:h-16 border-b border-border flex items-center justify-between px-3 md:px-6 gap-2 shrink-0 glass-panel">
        <div className="flex items-center gap-1.5 md:gap-3">
          <button
            onClick={() => {
              saveScroll();
              router.push(`/weekly/${prevWeekStr}`);
            }}
            className="p-1.5 md:p-2 rounded-lg bg-secondary hover:bg-muted text-foreground transition cursor-pointer"
          >
            <ChevronLeft className="h-4 w-4 md:h-5 md:w-5" />
          </button>
          <button
            onClick={() => {
              saveScroll();
              const todayStr = new Date().toLocaleDateString('en-CA');
              router.push(`/weekly/${todayStr}?scrollToday=${Date.now()}`);
            }}
            className="px-2 md:px-3 py-1.5 md:py-2 text-xs md:text-sm font-semibold rounded-lg bg-secondary hover:bg-muted text-foreground transition cursor-pointer"
          >
            Today
          </button>
          <button
            onClick={() => {
              saveScroll();
              router.push(`/weekly/${nextWeekStr}`);
            }}
            className="p-1.5 md:p-2 rounded-lg bg-secondary hover:bg-muted text-foreground transition cursor-pointer"
          >
            <ChevronRight className="h-4 w-4 md:h-5 md:w-5" />
          </button>
        </div>

        <h1 className="text-sm md:text-xl font-bold tracking-tight truncate min-w-0">
          <span className="md:hidden">{weekStartCompact} – {weekEndCompact}</span>
          <span className="hidden md:inline">{weekStartStr} – {weekEndStr}</span>
        </h1>

        <div className="flex items-center gap-3 md:gap-4 shrink-0">
          <div className="hidden md:flex items-center gap-1.5 bg-secondary border border-border rounded-lg p-0.5">
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
          <span className="hidden md:inline-block px-3 py-1.5 bg-accent/20 border border-accent text-accent-foreground text-xs font-semibold rounded-lg">
            Weekly
          </span>
          <EventSearch tags={tags} />
        </div>
      </div>

      {/* Mobile agenda list — the desktop hour grid doesn't fit 7 columns legibly on a
          phone, so mobile gets a scrollable day-by-day list instead. */}
      <div ref={agendaContainerRef} className="md:hidden flex-1 overflow-y-auto calendar-scrollbar divide-y divide-border">
        {weekDates.map((day, idx) => {
          const isToday = day.toDateString() === today.toDateString();
          const dayEvents = positionedEventsByDay[idx];
          return (
            <div key={idx} className="px-4 py-3" {...(isToday ? { 'data-today-section': true } : {})}>
              <div className="flex items-center gap-2 mb-2">
                <span
                  className={`text-xs font-bold uppercase tracking-wider ${
                    isToday ? 'text-primary' : 'text-muted-foreground'
                  }`}
                >
                  {day.toLocaleDateString('en-US', { weekday: 'short' })}
                </span>
                <span
                  className={`text-sm font-extrabold inline-flex items-center justify-center h-6 w-6 rounded-full ${
                    isToday ? 'bg-primary text-primary-foreground' : 'text-foreground'
                  }`}
                >
                  {day.getDate()}
                </span>
              </div>
              {dayEvents.length === 0 ? (
                <p className="text-xs text-muted-foreground pl-1">No events</p>
              ) : (
                <div className="space-y-1.5">
                  {dayEvents.map((ev) => (
                    <button
                      key={ev.id}
                      onClick={() => handleOpenEditMobile(ev)}
                      className="w-full flex items-start gap-2.5 text-left px-2.5 py-2 rounded-lg bg-secondary/60 hover:bg-secondary cursor-pointer event-card-clickable"
                    >
                      <Circle
                        className="h-2.5 w-2.5 shrink-0 mt-1.5"
                        style={{ fill: ev.tag_color, color: ev.tag_color }}
                      />
                      <span className="flex-1 min-w-0">
                        <span className="block truncate text-sm font-semibold text-foreground">
                          {ev.title}
                        </span>
                        {/* Full range, not just the start: an event that spans
                            several days is rendered once per day it covers, so
                            a bare start time reads identically on every one of
                            them. The dated form only kicks in when the event
                            actually crosses midnight. */}
                        <span className="block text-xs text-muted-foreground">
                          {ev.time_range}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Frozen day-header row (outside scroll) — desktop only, see mobile agenda above */}
      <div className="hidden md:flex shrink-0 border-b border-border bg-background">
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

      {/* Scrollable timeline area — desktop only, see mobile agenda above */}
      <div
        ref={timelineContainerRef}
        className="hidden md:block flex-1 overflow-y-auto calendar-scrollbar relative timeline-container"
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
              const dayEvents = positionedEventsByDay[colIdx];

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

                      const textClass = getContrastClass(ev.tag_color || '#6b7280');
                      const subtextClass = getContrastClass(ev.tag_color || '#6b7280') === 'text-black'
                        ? 'text-black/80 font-medium'
                        : 'text-white/80 font-medium';

                      return (
                        <div
                          key={ev.id}
                          className={`absolute rounded pointer-events-auto transition-all select-none cursor-pointer flex flex-col justify-center overflow-hidden shadow-sm event-card-clickable border border-black/10 hover:brightness-105 ${
                            heightPx < 46
                              ? 'px-1 items-start justify-center'
                              : 'pt-1 pb-1 px-1 items-start justify-start'
                          }`}
                          style={{
                            top: `${topPx}px`,
                            height: `${heightPx}px`,
                            left: `${leftPercent}%`,
                            width: `calc(${widthPercent}% - 2px)`,
                            backgroundColor: ev.tag_color
                              ? ev.isPending
                                ? `${ev.tag_color}66`
                                : ev.tag_color
                              : undefined,
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

      {/* EDIT OVERLAY POPOVER (desktop only — see the mobile bottom sheet below) */}
      {activeOverlayId && editingEvent && (
        <div
          ref={overlayRef}
          className="hidden md:block fixed bg-card border border-border rounded-lg shadow-2xl p-4 w-72 space-y-3 z-50 text-left"
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
            <TagSelect
              tags={tags}
              value={editTag}
              onChange={setEditTag}
              className="block w-full rounded bg-secondary border border-border px-2 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary cursor-pointer"
            />
          </div>

          {/* Date/Time Inputs */}
          <div className="space-y-2 text-xs">
            <div>
              <label className="block text-muted-foreground">Start</label>
              <div className="mt-1 grid grid-cols-2 gap-1">
                <input
                  type="date"
                  value={editStartDate}
                  onChange={(e) => setEditStartDate(e.target.value)}
                  className="block w-full rounded bg-secondary border border-border px-1 py-1 text-foreground focus:outline-none"
                />
                <input
                  type="time"
                  value={editStartTime}
                  onChange={(e) => setEditStartTime(e.target.value)}
                  className="block w-full rounded bg-secondary border border-border px-1 py-1 text-foreground focus:outline-none"
                />
              </div>
            </div>
            <div>
              <label className="block text-muted-foreground">End</label>
              <div className="mt-1 grid grid-cols-2 gap-1">
                <input
                  type="date"
                  value={editEndDate}
                  onChange={(e) => setEditEndDate(e.target.value)}
                  className="block w-full rounded bg-secondary border border-border px-1 py-1 text-foreground focus:outline-none"
                />
                <input
                  type="time"
                  value={editEndTime}
                  onChange={(e) => setEditEndTime(e.target.value)}
                  className="block w-full rounded bg-secondary border border-border px-1 py-1 text-foreground focus:outline-none"
                />
              </div>
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
                className="flex-1 py-1.5 bg-primary hover:bg-muted text-primary-foreground rounded text-xs font-semibold cursor-pointer text-center"
              >
                Save
              </button>
            ) : (
              <button
                type="button"
                onClick={() => handleUpdateInstance(editingEvent.id)}
                className="flex-1 py-1.5 bg-primary hover:bg-muted text-primary-foreground rounded text-xs font-semibold cursor-pointer text-center"
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

      {/* MOBILE EDIT EVENT SHEET (desktop uses the click-anchored popover above) */}
      {activeOverlayId && editingEvent && (
        <div className="md:hidden fixed inset-0 z-50 flex items-end">
          <div
            className="absolute inset-0 bg-black/60"
            onClick={() => {
              setActiveOverlayId(null);
              setEditingEvent(null);
              setOverlayCoords(null);
            }}
          />
          <div ref={mobileEditSheetRef} className="relative w-full max-h-[85vh] overflow-y-auto bg-card border-t border-border rounded-t-2xl p-5 pb-8 space-y-4">
            <div className="w-9 h-1 rounded-full bg-muted mx-auto" />
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold tracking-tight">Edit event</h2>
              <button
                onClick={() => {
                  setActiveOverlayId(null);
                  setEditingEvent(null);
                  setOverlayCoords(null);
                }}
                className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground cursor-pointer"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <input
              type="text"
              required
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              placeholder="Title"
              className="block w-full rounded bg-secondary border border-border px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />

            <div className="flex items-center gap-2">
              <span
                className="w-4 h-4 rounded-full border border-border flex-shrink-0"
                style={{ backgroundColor: getTagColor(editTag) }}
              ></span>
              <TagSelect
                tags={tags}
                value={editTag}
                onChange={setEditTag}
                className="block w-full rounded bg-secondary border border-border px-2 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary cursor-pointer"
              />
            </div>

            <div className="space-y-3 text-sm">
              <div>
                <label className="block text-muted-foreground text-xs mb-1">Start</label>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="date"
                    value={editStartDate}
                    onChange={(e) => setEditStartDate(e.target.value)}
                    className="block w-full rounded bg-secondary border border-border px-2 py-2 text-foreground focus:outline-none"
                  />
                  <input
                    type="time"
                    value={editStartTime}
                    onChange={(e) => setEditStartTime(e.target.value)}
                    className="block w-full rounded bg-secondary border border-border px-2 py-2 text-foreground focus:outline-none"
                  />
                </div>
              </div>
              <div>
                <label className="block text-muted-foreground text-xs mb-1">End</label>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="date"
                    value={editEndDate}
                    onChange={(e) => setEditEndDate(e.target.value)}
                    className="block w-full rounded bg-secondary border border-border px-2 py-2 text-foreground focus:outline-none"
                  />
                  <input
                    type="time"
                    value={editEndTime}
                    onChange={(e) => setEditEndTime(e.target.value)}
                    className="block w-full rounded bg-secondary border border-border px-2 py-2 text-foreground focus:outline-none"
                  />
                </div>
              </div>
            </div>

            <textarea
              value={editDesc}
              onChange={(e) => setEditDesc(e.target.value)}
              placeholder="Description"
              rows={2}
              className="block w-full rounded bg-secondary border border-border px-3 py-2 text-sm text-foreground focus:outline-none resize-none"
            />

            <div className="flex gap-2">
              {editingEvent.recurrenceId ? (
                <button
                  type="button"
                  onClick={() => {
                    setRecurEvent(editingEvent);
                    setShowEditRecurModal(true);
                  }}
                  className="flex-1 py-2.5 bg-primary hover:bg-muted text-primary-foreground rounded text-sm font-semibold cursor-pointer text-center"
                >
                  Save
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => handleUpdateInstance(editingEvent.id)}
                  className="flex-1 py-2.5 bg-primary hover:bg-muted text-primary-foreground rounded text-sm font-semibold cursor-pointer text-center"
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
                className="px-4 py-2.5 bg-secondary hover:bg-muted text-foreground rounded text-sm font-semibold cursor-pointer"
              >
                Cancel
              </button>
            </div>

            <div className="border-t border-border pt-3 flex justify-between gap-2">
              {editingEvent.recurrenceId ? (
                <button
                  type="button"
                  onClick={() => {
                    setRecurEvent(editingEvent);
                    setShowDeleteRecurModal(true);
                  }}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2.5 bg-red-650 hover:bg-red-700 text-white rounded text-sm font-semibold cursor-pointer"
                >
                  <Trash2 className="h-4 w-4" />
                  Delete
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => handleDeleteInstance(editingEvent.id)}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2.5 bg-red-650 hover:bg-red-700 text-white rounded text-sm font-semibold cursor-pointer"
                >
                  <Trash2 className="h-4 w-4" />
                  Delete
                </button>
              )}
              <button
                type="button"
                onClick={() => handleCopy(editingEvent.id)}
                className="px-4 py-2.5 bg-secondary hover:bg-muted text-foreground rounded text-sm font-semibold flex items-center justify-center gap-1.5 cursor-pointer"
                title="Copy Event"
              >
                <Copy className="h-4 w-4" />
                Copy
              </button>
            </div>
          </div>
        </div>
      )}

      {/* QUICK ADD MODAL */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/70 flex items-end md:items-center justify-center z-50">
          <div className="bg-card border border-border p-6 rounded-t-2xl md:rounded-lg w-full md:max-w-sm space-y-4 shadow-2xl">
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

              <div className="space-y-2 text-xs">
                <div>
                  <label className="block text-muted-foreground">Start</label>
                  <div className="mt-1 grid grid-cols-2 gap-1">
                    <input
                      type="date"
                      required
                      value={addStartDate}
                      onChange={(e) => setAddStartDate(e.target.value)}
                      className="block w-full rounded bg-secondary border border-border px-2 py-1 text-foreground"
                    />
                    <input
                      type="time"
                      required
                      value={addStartTime}
                      onChange={(e) => setAddStartTime(e.target.value)}
                      className="block w-full rounded bg-secondary border border-border px-2 py-1 text-foreground"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-muted-foreground">End</label>
                  <div className="mt-1 grid grid-cols-2 gap-1">
                    <input
                      type="date"
                      required
                      value={addEndDate}
                      onChange={(e) => setAddEndDate(e.target.value)}
                      className="block w-full rounded bg-secondary border border-border px-2 py-1 text-foreground"
                    />
                    <input
                      type="time"
                      required
                      value={addEndTime}
                      onChange={(e) => setAddEndTime(e.target.value)}
                      className="block w-full rounded bg-secondary border border-border px-2 py-1 text-foreground"
                    />
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-muted-foreground uppercase">Tag</label>
                <TagSelect tags={tags} value={addTag} onChange={setAddTag} className="mt-1 block w-full rounded bg-secondary border border-border px-3 py-1.5 text-sm text-foreground" />
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
                  className="w-full py-2 bg-primary hover:bg-muted text-primary-foreground rounded text-sm font-bold cursor-pointer transition"
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
        <div className="fixed inset-0 bg-black/70 flex items-end md:items-center justify-center z-50">
          <div className="bg-card border border-border p-6 rounded-t-2xl md:rounded-lg w-full md:max-w-sm space-y-4 shadow-2xl">
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
                className="w-full py-2 bg-primary hover:bg-muted text-primary-foreground text-sm font-semibold rounded cursor-pointer transition"
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
                className="w-full py-2 bg-primary hover:bg-muted text-primary-foreground text-sm font-semibold rounded cursor-pointer transition"
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
        <div className="fixed inset-0 bg-black/70 flex items-end md:items-center justify-center z-50">
          <div className="bg-card border border-border p-6 rounded-t-2xl md:rounded-lg w-full md:max-w-sm space-y-4 shadow-2xl">
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
