'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import TagSelect from '@/app/components/TagSelect';
import { selectStateOf } from '@/app/components/Select';
import { useSearchParams } from 'next/navigation';
import {
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  X,
  Plus,
} from 'lucide-react';
import type { PositionedEvent } from '@/lib/overlap';
import { useSwipeNavigation } from '@/lib/useSwipeNavigation';
import { track } from '@/lib/track';
import { useDateNavigation } from '@/lib/useDateNavigation';
import EventSearch from '@/app/components/EventSearch';
import { addEventAction } from '@/features/events/server/actions';
import { getBrowserTimeZone } from '@/lib/timezone';
import DateInput from '@/app/components/DateInput';
import TimeInput from '@/app/components/TimeInput';
import { isInsideModal } from '@/app/components/ConfirmDialog';
import { useEventEditor } from '@/features/events/useEventEditor';
import { useEditorPlacement } from '@/features/events/useEditorPlacement';
import EventEditor from '@/features/events/components/EventEditor';
import EventBlock from '@/features/events/components/EventBlock';
import { hourLabel, positionEventsForDay } from '@/features/events/positionEvents';
import { useTimelineZoom } from '@/features/events/useTimelineZoom';
import type { SubtagDisplay } from '@/lib/tags';

interface Tag {
  id: number;
  name: string;
  color: string;
  isArchived: number;
  scope: string;
  parentId: number | null;
}

interface DailyCalendarClientProps {
  date: string;
  initialEvents: any[];
  tags: Tag[];
  subtagDisplay: SubtagDisplay;
}

export default function DailyCalendarClient({ date, initialEvents, tags, subtagDisplay }: DailyCalendarClientProps) {
  // --- Popovers & Modals ---
  // Mobile-only: the always-visible desktop "Add Event" panel becomes a FAB +
  // bottom sheet on small screens (there's no room for a persistent side panel).
  const [showMobileAddSheet, setShowMobileAddSheet] = useState<boolean>(false);

  // --- Scroll Restoration ---
  const timelineContainerRef = useRef<HTMLDivElement>(null);
  const { zoomLevel, changeZoom, resetZoom } = useTimelineZoom(timelineContainerRef);
  const editorPopoverRef = useRef<HTMLDivElement>(null);

  // --- Add Event Form State ---
  const [formTitle, setFormTitle] = useState('');
  const [formTag, setFormTag] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [formStartDate, setFormStartDate] = useState(date);
  const [formStartTime, setFormStartTime] = useState('09:00');
  const [formEndDate, setFormEndDate] = useState(date);
  const [formEndTime, setFormEndTime] = useState('10:00');

  // --- Date navigation ---
  // Paging is debounced: `activeDate` is the day the user has paged to, which
  // is `date` except during the moment a coalesced fetch is still catching up.
  // Everything about *navigation* reads `activeDate` so a held arrow key keeps
  // stepping forward; everything about the *events* keeps reading `date`,
  // since those are what the server actually rendered.
  const { active: activeDate, navigateTo } = useDateNavigation(date, (d) => `/calendar/${d}`);
  const prevDayStr = new Date(new Date(activeDate + 'T00:00:00').getTime() - 24 * 60 * 60 * 1000).toLocaleDateString('en-CA');
  const nextDayStr = new Date(new Date(activeDate + 'T00:00:00').getTime() + 24 * 60 * 60 * 1000).toLocaleDateString('en-CA');
  const displayDate = new Date(activeDate + 'T00:00:00').toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
  // Compact form for the mobile header — "Wed 8/5" instead of "Wednesday, August 5, 2026".
  const displayDateCompact = new Date(activeDate + 'T00:00:00').toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'numeric',
    day: 'numeric',
  });

  // Restore the timeline's scroll position
  useEffect(() => {
    // Skip scroll restore on a search deep link — the deep-link handler owns the
    // scroll position in that case, and restoring would fight it.
    const isDeepLink =
      typeof window !== 'undefined' &&
      new URLSearchParams(window.location.search).has('event');
    const savedScroll = localStorage.getItem('calendarScrollPos');
    if (!isDeepLink && savedScroll && timelineContainerRef.current) {
      timelineContainerRef.current.scrollTop = parseInt(savedScroll, 10);
    }
  }, []);

  // Arrow keys page between days (zoom keys live in useTimelineZoom)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isInsideModal(e.target)) return;
      // An open dropdown owns the keyboard; a closed one is a form field.
      const select = selectStateOf(e.target);
      if (select === 'open') return;
      const isInput =
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        select !== null;

      if (!e.metaKey && !e.ctrlKey && !isInput) {
        if (e.key === 'ArrowLeft') {
          e.preventDefault();
          track('nav.keyboard');
          saveScroll();
          navigateTo(prevDayStr);
        } else if (e.key === 'ArrowRight') {
          e.preventDefault();
          track('nav.keyboard');
          saveScroll();
          navigateTo(nextDayStr);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [navigateTo, prevDayStr, nextDayStr]);

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

  // Positions are in minutes, not pixels, so zooming doesn't recompute them.
  const positionedEvents = useMemo(
    () => positionEventsForDay(initialEvents, new Date(date + 'T00:00:00'), tags, subtagDisplay),
    [date, initialEvents, tags, subtagDisplay]
  );

  // Tag color lookup
  const getTagColor = (tagName: string) => {
    return tags.find((t) => t.name === tagName)?.color || 'transparent';
  };

  const editor = useEventEditor({ beforeMutate: saveScroll });
  const placement = useEditorPlacement({
    open: editor.event !== null,
    popoverRef: editorPopoverRef,
    containerRef: timelineContainerRef,
    zoomLevel,
  });
  const activeOverlayId = editor.event?.id ?? null;

  const handleOpenEditOverlay = (ev: PositionedEvent, e: React.MouseEvent) => {
    saveScroll();
    placement.anchorAt(e);
    editor.open(ev);
  };

  // Deep link from search: when arriving with ?event=<id>, the matching event is
  // ring-highlighted purely from the URL during render (see the card's class),
  // so it needs no state/timer and clears on navigation. This effect only scrolls
  // that event into view once. A ref guards against re-scrolling.
  const searchParams = useSearchParams();
  const highlightEventId = searchParams.get('event')
    ? parseInt(searchParams.get('event') as string, 10)
    : null;
  const scrolledToEventParam = useRef<string | null>(null);
  useEffect(() => {
    const idParam = searchParams.get('event');
    if (!idParam || scrolledToEventParam.current === idParam) return;

    const ev = positionedEvents.find((e) => e.id === parseInt(idParam, 10));
    if (!ev) return;

    // The event card renders a little after mount (dev renders can lag), so poll
    // for it before scrolling rather than guessing a fixed delay. Uses setTimeout
    // (not requestAnimationFrame, which is paused while the tab is backgrounded).
    let tries = 0;
    const scrollToEvent = () => {
      if (scrolledToEventParam.current === idParam) return; // already done
      const container = timelineContainerRef.current;
      const card = container?.querySelector<HTMLElement>(`[data-event-id="${ev.id}"]`);
      if (container && card) {
        scrolledToEventParam.current = idParam;
        // Scroll the event's start ~120px below the top of the timeline.
        const rect = container.getBoundingClientRect();
        container.scrollTop += card.getBoundingClientRect().top - (rect.top + 120);
        return;
      }
      if (tries++ < 40) setTimeout(scrollToEvent, 60);
    };
    setTimeout(scrollToEvent, 60);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

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
      timeZone: getBrowserTimeZone(),
    });
    // Reset basic input fields
    setFormTitle('');
    setFormDesc('');
    setFormTag('');
    setShowMobileAddSheet(false);
  };

  // Shared Add Event form fields, rendered both in the desktop side panel and
  // the mobile FAB bottom sheet — kept as one JSX value so the two surfaces
  // can't drift apart. `idPrefix` keeps input ids unique since both can be in
  // the DOM at once (one hidden via CSS depending on viewport).
  const renderAddEventForm = (idPrefix: string) => (
    <form onSubmit={handleAddSubmit} className="space-y-4">
      {/* Title */}
      <div>
        <label htmlFor={`${idPrefix}title`} className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Title
        </label>
        <input
          id={`${idPrefix}title`}
          type="text"
          required
          placeholder="Event Title"
          value={formTitle}
          onChange={(e) => setFormTitle(e.target.value)}
          className="mt-1 block w-full rounded bg-secondary border border-border px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-transparent"
        />
      </div>

      {/* Start Date/Time */}
      <div>
        <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground">Start</label>
        <div className="mt-1 grid grid-cols-2 gap-2">
          <DateInput
            required
            value={formStartDate}
            onChange={setFormStartDate}
            className="block w-full rounded bg-secondary border border-border px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-transparent"
          />
          <TimeInput
            required
            value={formStartTime}
            onChange={setFormStartTime}
            className="block w-full rounded bg-secondary border border-border px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-transparent"
          />
        </div>
      </div>

      {/* End Date/Time */}
      <div>
        <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground">End</label>
        <div className="mt-1 grid grid-cols-2 gap-2">
          <DateInput
            required
            value={formEndDate}
            onChange={setFormEndDate}
            className="block w-full rounded bg-secondary border border-border px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-transparent"
          />
          <TimeInput
            required
            value={formEndTime}
            onChange={setFormEndTime}
            className="block w-full rounded bg-secondary border border-border px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-transparent"
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
          <TagSelect tags={tags} value={formTag} onChange={setFormTag} />
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

      <button
        type="submit"
        className="w-full flex justify-center py-2 px-4 border border-transparent rounded bg-primary text-sm font-bold text-primary-foreground shadow-sm hover:bg-muted focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-ring cursor-pointer transition"
      >
        Add Event
      </button>
    </form>
  );

  // Mobile paging: swipe the timeline sideways to change days, mirroring the
  // arrow-key shortcuts above. Suspended while an editor is open so a gesture
  // inside a sheet or modal can't page the day out from under it.
  const swipeRef = useSwipeNavigation<HTMLDivElement>({
    onSwipeLeft: () => {
      saveScroll();
      navigateTo(nextDayStr);
    },
    onSwipeRight: () => {
      saveScroll();
      navigateTo(prevDayStr);
    },
    enabled:
      activeOverlayId === null && !showMobileAddSheet,
  });

  return (
    <div ref={swipeRef} className="flex-1 flex flex-col md:flex-row overflow-hidden relative">

      {/* Side Pane: Event Form & Info (desktop only — mobile uses the FAB + bottom sheet below) */}
      <div className="hidden md:flex md:flex-col md:w-80 bg-card md:border-r border-border p-6 overflow-y-auto shrink-0 space-y-6">
        <div>
          <h2 className="text-xl font-extrabold tracking-tight">Add Event</h2>
          <div className="mt-4">{renderAddEventForm('desktop-')}</div>
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
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
        {/* Mobile FAB: opens the Add Event bottom sheet (desktop uses the always-visible side panel) */}
        <button
          onClick={() => setShowMobileAddSheet(true)}
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
                navigateTo(prevDayStr);
              }}
              className="p-1.5 md:p-2 rounded-lg bg-secondary hover:bg-muted text-foreground transition cursor-pointer"
            >
              <ChevronLeft className="h-4 w-4 md:h-5 md:w-5" />
            </button>
            <button
              onClick={() => {
                saveScroll();
                const today = new Date().toLocaleDateString('en-CA');
                navigateTo(today);
              }}
              className="px-2 md:px-3 py-1.5 md:py-2 text-xs md:text-sm font-semibold rounded-lg bg-secondary hover:bg-muted text-foreground transition cursor-pointer"
            >
              Today
            </button>
            <button
              onClick={() => {
                saveScroll();
                navigateTo(nextDayStr);
              }}
              className="p-1.5 md:p-2 rounded-lg bg-secondary hover:bg-muted text-foreground transition cursor-pointer"
            >
              <ChevronRight className="h-4 w-4 md:h-5 md:w-5" />
            </button>
          </div>

          <h1 className="text-sm md:text-xl font-bold tracking-tight truncate min-w-0">
            <span className="md:hidden">{displayDateCompact}</span>
            <span className="hidden md:inline">{displayDate}</span>
          </h1>

          <div className="flex items-center gap-3 shrink-0">
            <span className="hidden md:inline-block px-3 py-1.5 bg-accent/20 border border-accent text-accent-foreground text-xs font-semibold rounded-lg">
              Daily
            </span>
            <EventSearch tags={tags} />
          </div>
        </div>

        {/* Scrollable Timeline Grid */}
        <div
          ref={timelineContainerRef}
          className="flex-1 overflow-y-auto relative timeline-container"
          id="timeline-container"
        >
          {/* Timeline Wrapper (24 hours * zoomLevel) */}
          <div className="relative w-full" style={{ height: `${zoomLevel * 24}px` }}>
            
            {/* Hour Labels */}
            <div className="absolute left-0 top-0 w-16 h-full border-r border-border bg-card/30 flex flex-col z-10 select-none">
              {Array.from({ length: 24 }).map((_, hour) => {
                return (
                  <div
                    key={hour}
                    className="absolute right-3 text-[10px] font-bold text-muted-foreground"
                    style={{ top: `${hour * zoomLevel}px`, transform: 'translateY(-50%)' }}
                  >
                    {hourLabel(hour)}
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
              {positionedEvents.map((ev) => (
                <EventBlock
                  key={ev.id}
                  ev={ev}
                  zoomLevel={zoomLevel}
                  density="day"
                  highlighted={highlightEventId === ev.id}
                  onOpen={handleOpenEditOverlay}
                />
              ))}
            </div>

          </div>
        </div>
      </div>

      <EventEditor editor={editor} tags={tags} popoverRef={editorPopoverRef} />

      {/* MOBILE ADD EVENT SHEET (mirrors the desktop side panel's form) */}
      {showMobileAddSheet && (
        <div className="md:hidden fixed inset-0 z-50 flex items-end">
          <div
            className="absolute inset-0 bg-black/60"
            onClick={() => setShowMobileAddSheet(false)}
          />
          <div className="relative w-full max-h-[85vh] overflow-y-auto bg-card border-t border-border rounded-t-2xl p-5 pb-8 space-y-4">
            <div className="w-9 h-1 rounded-full bg-muted mx-auto" />
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold tracking-tight">Add event</h2>
              <button
                onClick={() => setShowMobileAddSheet(false)}
                className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground cursor-pointer"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            {renderAddEventForm('mobile-')}
          </div>
        </div>
      )}


    </div>
  );
}
