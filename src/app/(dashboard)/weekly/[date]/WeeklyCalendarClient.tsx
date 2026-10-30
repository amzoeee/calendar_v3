'use client';

import React, { useState, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import TagSelect from '@/app/components/TagSelect';
import { selectStateOf } from '@/app/components/Select';
import { startOfWeek, type WeekStart } from '@/lib/week';
import {
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  X,
  Plus,
  Circle,
  List,
  CalendarRange,
} from 'lucide-react';
import type { PositionedEvent } from '@/lib/overlap';
import { useSwipeNavigation } from '@/lib/useSwipeNavigation';
import { track } from '@/lib/track';
import { useDateNavigation } from '@/lib/useDateNavigation';
import EventSearch from '@/app/components/EventSearch';
import { addEventAction } from '@/app/actions';
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
import Button from '@/app/components/Button';

interface Tag {
  id: number;
  name: string;
  color: string;
  isArchived: number;
  scope: string;
  parentId: number | null;
}

// The two ways mobile can read a week, and where the choice is remembered.
type MobileWeekView = 'list' | 'grid';
const MOBILE_VIEW_KEY = 'weeklyMobileView';
const MOBILE_ZOOM_KEY = 'weeklyMobileZoom';
// Ceiling for the mobile grid's pixels-per-hour. Well past the point where a
// day stops fitting on screen, which is as far in as this view is useful —
// past that the agenda list is the better tool.
const MOBILE_MAX_ZOOM = 240;
// Each press changes the scale by this much. A ratio rather than a fixed step,
// so zooming feels the same at 25px/hour as at 200.
const MOBILE_ZOOM_STEP = 1.5;
// Blocks thinner than this are a hairline you can neither see nor tap, so
// short events are floored here. Costs a couple of pixels of accuracy at the
// most zoomed-out scale and buys back a hit target: with the day fitted to a
// phone an hour is ~23px, so a quarter-hour event would otherwise come out
// under 6px tall.
const MOBILE_MIN_BLOCK_PX = 8;
// One radius for every block, short or long. Small enough that it doesn't eat
// the interior of a block at the 8px floor, which is what turned quarter-hour
// events into lenses when this scaled with height.
const MOBILE_BLOCK_RADIUS = '2px';

interface WeeklyCalendarClientProps {
  date: string;
  weekStartDate: string;
  /** 0 = Sunday. Only the Today button needs it; the grid follows weekStartDate. */
  weekStart: WeekStart;
  initialEvents: any[];
  tags: Tag[];
  subtagDisplay: SubtagDisplay;
}

export default function WeeklyCalendarClient({ date, weekStartDate, weekStart, initialEvents, tags, subtagDisplay }: WeeklyCalendarClientProps) {

  // --- Zoom & Scroll ---
  const timelineContainerRef = useRef<HTMLDivElement>(null);
  const { zoomLevel, changeZoom, resetZoom } = useTimelineZoom(timelineContainerRef);

  // --- Mobile week grid ---
  // Mobile can read the week two ways: the agenda list (the default) and a
  // shrunk-down version of the desktop grid. The grid shows colours and blocks
  // only — a seventh of a phone's width can't hold a legible title — so what
  // it gives you is the shape of the week at a glance.
  const [mobileView, setMobileView] = useState<MobileWeekView>('list');
  // Pixels per hour in that grid. `null` means "fit the whole day on screen",
  // which is both the starting point and the fully-zoomed-out stop: seeing a
  // whole day without scrolling is the point of the view, so it's where the
  // zoom bottoms out rather than at some fixed pixel scale.
  const [mobileZoom, setMobileZoom] = useState<number | null>(null);
  const mobileGridRef = useRef<HTMLDivElement>(null);
  const [mobileGridHeight, setMobileGridHeight] = useState(0);

  const editorPopoverRef = useRef<HTMLDivElement>(null);

  // --- Add Event Modal State ---
  const [showAddModal, setShowAddModal] = useState(false);
  const [addTitle, setAddTitle] = useState('');
  const [addTag, setAddTag] = useState('');
  const [addDesc, setAddDesc] = useState('');
  const [addStartDate, setAddStartDate] = useState(date);
  const [addStartTime, setAddStartTime] = useState('09:00');
  const [addEndDate, setAddEndDate] = useState(date);
  const [addEndTime, setAddEndTime] = useState('10:00');

  // Get week dates (7 dates from the given first day of the week)
  const getWeekDates = (first: string): Date[] => {
    const dates: Date[] = [];
    const start = new Date(first + 'T00:00:00');
    for (let i = 0; i < 7; i++) {
      dates.push(new Date(start.getTime() + i * 24 * 60 * 60 * 1000));
    }
    return dates;
  };

  // Depends only on weekStartDate, so it stays referentially stable across the
  // frequent re-renders that don't change the week (zoom, overlay state).
  const weekDates = useMemo(() => getWeekDates(weekStartDate), [weekStartDate]);

  // Navigation. Paging is debounced, so `activeWeekStart` is the week the user
  // has paged to, which is `weekStartDate` except while a coalesced fetch is
  // catching up. Navigation and the header title read it so a held arrow key
  // keeps stepping; the grid below keeps rendering `weekDates` — the week the
  // server actually sent — until the new one arrives.
  const { active: activeWeekStart, navigateTo } = useDateNavigation(weekStartDate, (d) => `/weekly/${d}`);
  const prevWeekStr = new Date(new Date(activeWeekStart + 'T00:00:00').getTime() - 7 * 24 * 60 * 60 * 1000).toLocaleDateString('en-CA');
  const nextWeekStr = new Date(new Date(activeWeekStart + 'T00:00:00').getTime() + 7 * 24 * 60 * 60 * 1000).toLocaleDateString('en-CA');
  const titleWeekDates = useMemo(() => getWeekDates(activeWeekStart), [activeWeekStart]);
  const weekStartStr = titleWeekDates[0].toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const weekEndStr = titleWeekDates[6].toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  // Compact form for the mobile header — "8/2 - 8/8" instead of "Aug 2 - Aug 8, 2026".
  const weekStartCompact = titleWeekDates[0].toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' });
  const weekEndCompact = titleWeekDates[6].toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' });

  // Load state
  useEffect(() => {
    const savedScroll = localStorage.getItem('calendarScrollPos');
    if (savedScroll && timelineContainerRef.current) {
      timelineContainerRef.current.scrollTop = parseInt(savedScroll, 10);
    }

    const savedView = localStorage.getItem(MOBILE_VIEW_KEY);
    if (savedView === 'grid' || savedView === 'list') setMobileView(savedView);

    const savedMobileZoom = Number(localStorage.getItem(MOBILE_ZOOM_KEY));
    if (Number.isFinite(savedMobileZoom) && savedMobileZoom > 0) setMobileZoom(savedMobileZoom);
  }, []);

  // The zoom at which 24 hours exactly fill the grid's viewport. Measured
  // rather than assumed, since it depends on the device height, the header and
  // the tab bar; 0 until the first measurement lands.
  const mobileFitZoom = mobileGridHeight > 0 ? mobileGridHeight / 24 : 0;
  const mobileZoomLevel = mobileZoom ?? mobileFitZoom;

  // useLayoutEffect so the first paint of the grid already has a real height —
  // measuring in a passive effect would flash a zero-height day first.
  useLayoutEffect(() => {
    const el = mobileGridRef.current;
    if (!el) return;
    const measure = () => setMobileGridHeight(el.clientHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [mobileView]);

  // At the fitted scale an hour is roughly 25px tall, and labelling every one
  // turns the gutter into a grey smear and the columns into a stack of lines.
  // Thin both out until they have room to breathe.
  const hourLabelStep = mobileZoomLevel >= 44 ? 1 : mobileZoomLevel >= 22 ? 2 : 3;

  const changeMobileZoom = (factor: number) => {
    if (mobileFitZoom <= 0) return;
    setMobileZoom((prev) => {
      const next = (prev ?? mobileFitZoom) * factor;
      // Snapping back to null at the bottom keeps "fully zoomed out" tied to
      // the viewport, so rotating the device or losing the browser chrome
      // re-fits the day instead of leaving a stale pixel scale behind.
      if (next <= mobileFitZoom) return null;
      return Math.min(MOBILE_MAX_ZOOM, next);
    });
  };

  // Skip the first run so the defaults can't overwrite what the load effect
  // is about to restore.
  const mobilePrefsHydratedRef = useRef(false);
  useEffect(() => {
    if (!mobilePrefsHydratedRef.current) {
      mobilePrefsHydratedRef.current = true;
      return;
    }
    localStorage.setItem(MOBILE_VIEW_KEY, mobileView);
    // Fit-to-day is stored as "no stored zoom" rather than as the pixel value
    // it happens to work out to on this device.
    if (mobileZoom == null) localStorage.removeItem(MOBILE_ZOOM_KEY);
    else localStorage.setItem(MOBILE_ZOOM_KEY, String(mobileZoom));
  }, [mobileView, mobileZoom]);

  // Arrow keys page between weeks (zoom keys live in useTimelineZoom)
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
          navigateTo(prevWeekStr);
        } else if (e.key === 'ArrowRight') {
          e.preventDefault();
          track('nav.keyboard');
          saveScroll();
          navigateTo(nextWeekStr);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [navigateTo, prevWeekStr, nextWeekStr]);

  const saveScroll = () => {
    if (timelineContainerRef.current) {
      localStorage.setItem('calendarScrollPos', String(timelineContainerRef.current.scrollTop));
    }
  };

  // Positions here are in *minutes*, not pixels — zoom is applied at render
  // time — so this survives zooming unchanged. Memoizing it keeps a zoom
  // keystroke from re-deriving every event's dates 14 times over (7 days x
  // both the mobile agenda and the desktop grid), which is what made spamming
  // the zoom keys lag.
  const positionedEventsByDay = useMemo(
    () =>
      weekDates.map((day) =>
        positionEventsForDay(initialEvents, day, tags, subtagDisplay).sort((a, b) => (a.top_position || 0) - (b.top_position || 0))
      ),
    [weekDates, initialEvents, tags, subtagDisplay]
  );

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

  // Mobile has no click point to anchor a popover to; it gets the bottom sheet.
  const handleOpenEditMobile = (ev: PositionedEvent) => {
    saveScroll();
    editor.open(ev);
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
      timeZone: getBrowserTimeZone(),
    });
    // Reset inputs
    setAddTitle('');
    setAddDesc('');
    setAddTag('');
    setShowAddModal(false);
  };

  const today = new Date();

  // Mobile: tapping Today should jump the agenda list to today's section, not
  // just land at the top (the week's first day). Clicking Today navigates to a new `date`
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

      // The grid has today as a column rather than a section, so "go to today"
      // is a vertical move to the current hour. At the fitted zoom the day
      // already fits and this is a no-op, which is the right answer.
      if (mobileView === 'grid') {
        const grid = mobileGridRef.current;
        if (grid && mobileZoomLevel > 0) {
          scrolledToTodayParam.current = flag;
          const now = new Date();
          const nowPx = ((now.getHours() * 60 + now.getMinutes()) / 60) * mobileZoomLevel;
          grid.scrollTo({
            top: Math.max(0, nowPx - grid.clientHeight / 2),
            behavior: 'smooth',
          });
          return;
        }
        if (tries++ < 20) setTimeout(attempt, 50);
        return;
      }

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
  }, [searchParams, mobileView, mobileZoomLevel]);

  // Mobile paging: swipe the agenda sideways to change weeks, mirroring the
  // arrow-key shortcuts above. Suspended while an editor is open so a gesture
  // inside a sheet or modal can't page the week out from under it.
  const swipeRef = useSwipeNavigation<HTMLDivElement>({
    onSwipeLeft: () => {
      saveScroll();
      navigateTo(nextWeekStr);
    },
    onSwipeRight: () => {
      saveScroll();
      navigateTo(prevWeekStr);
    },
    enabled: activeOverlayId === null && !showAddModal,
  });

  return (
    <div ref={swipeRef} className="flex-1 flex flex-col overflow-hidden relative">

      {/* Mobile FAB: opens the same Add Event modal used on desktop. Not in
          the week grid — a 56px circle parked over a column that's only ~48px
          wide covers most of a day, and the grid is there to be read. */}
      {mobileView === 'list' && (
        <Button
          onClick={() => setShowAddModal(true)}
          size="none"
          className="md:hidden absolute right-4 bottom-4 z-30 h-14 w-14 rounded-full shadow-2xl justify-center"
          aria-label="Add event"
        >
          <Plus className="h-6 w-6" />
        </Button>
      )}

      {/* Navigation Header */}
      <div className="h-14 md:h-16 border-b border-border flex items-center justify-between px-3 md:px-6 gap-2 shrink-0 glass-panel">
        <div className="flex items-center gap-1.5 md:gap-3">
          <button
            onClick={() => {
              saveScroll();
              navigateTo(prevWeekStr);
            }}
            className="p-1.5 md:p-2 rounded-lg bg-secondary hover:bg-muted text-foreground transition cursor-pointer"
          >
            <ChevronLeft className="h-4 w-4 md:h-5 md:w-5" />
          </button>
          <button
            onClick={() => {
              saveScroll();
              const now = new Date();
              const todayStr = now.toLocaleDateString('en-CA');
              // The route derives the week's first day itself, but the title needs
              // it up front to show the right range while the fetch is queued.
              const todayWeekStart = startOfWeek(now, weekStart)
                .toLocaleDateString('en-CA');
              navigateTo(todayWeekStart, `/weekly/${todayStr}?scrollToday=${Date.now()}`);
            }}
            className="px-2 md:px-3 py-1.5 md:py-2 text-xs md:text-sm font-semibold rounded-lg bg-secondary hover:bg-muted text-foreground transition cursor-pointer"
          >
            Today
          </button>
          <button
            onClick={() => {
              saveScroll();
              navigateTo(nextWeekStr);
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
          {/* Mobile: agenda list vs. the blocks-only week grid. Two buttons
              rather than one that flips, so which mode you're in is readable
              without first working out what the icon is offering. */}
          <EventSearch tags={tags} />
        </div>
      </div>

      {/* Mobile control strip. The view toggle can't go in the header above:
          at 375px the date buttons and the search box leave it about 70px, all
          of which the week range needs. Its own row also gives the grid's zoom
          buttons a home that isn't floating over the day. */}
      <div className="md:hidden shrink-0 flex items-center justify-between gap-2 border-b border-border px-3 py-1.5">
        <div className="flex items-center bg-secondary border border-border rounded-lg p-0.5">
          {(['list', 'grid'] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => setMobileView(mode)}
              aria-pressed={mobileView === mode}
              className={`flex items-center gap-1 px-2 py-1 rounded text-[11px] font-semibold transition cursor-pointer ${
                mobileView === mode
                  ? 'bg-muted text-foreground'
                  : 'text-muted-foreground'
              }`}
            >
              {mode === 'list' ? <List className="h-3.5 w-3.5" /> : <CalendarRange className="h-3.5 w-3.5" />}
              {mode === 'list' ? 'List' : 'Week'}
            </button>
          ))}
        </div>

        {/* Zooming out stops at "the whole day fits", which is where this view
            starts — so the minus greys out exactly when there's nothing left
            off-screen to reveal. */}
        {mobileView === 'grid' && (
          <div className="flex items-center gap-1">
            <button
              onClick={() => changeMobileZoom(1 / MOBILE_ZOOM_STEP)}
              disabled={mobileZoom === null}
              aria-label="Zoom out"
              className="p-1.5 rounded-lg bg-secondary text-foreground disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
            >
              <ZoomOut className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => changeMobileZoom(MOBILE_ZOOM_STEP)}
              aria-label="Zoom in"
              className="p-1.5 rounded-lg bg-secondary text-foreground cursor-pointer"
            >
              <ZoomIn className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* Mobile agenda list — the desktop hour grid doesn't fit 7 columns legibly on a
          phone, so mobile gets a scrollable day-by-day list instead. */}
      <div
        ref={agendaContainerRef}
        className={`${mobileView === 'grid' ? 'hidden' : ''} md:hidden flex-1 overflow-y-auto divide-y divide-border`}
      >
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

      {/* Mobile week grid — the desktop layout shrunk to a phone: a time
          gutter down the side, seven dated columns, and coloured blocks. No
          titles, deliberately; at a seventh of the screen a label is a smear,
          and the shape and colour of the day is what this view is for. Tapping
          a block opens the same bottom sheet the agenda rows do. */}
      {mobileView === 'grid' && (
        <div className="md:hidden flex-1 min-h-0 flex flex-col">
          {/* Dated day headers, frozen above the scroll like the desktop row */}
          <div className="shrink-0 flex border-b border-border bg-background">
            <div className="w-9 shrink-0 border-r border-border" />
            <div className="flex-1 grid grid-cols-7">
              {weekDates.map((day, idx) => {
                const isToday = day.toDateString() === today.toDateString();
                return (
                  <div
                    key={idx}
                    className={`border-r border-border/40 py-1 text-center select-none ${
                      isToday ? 'bg-primary/5' : ''
                    }`}
                  >
                    <p className="text-[9px] uppercase font-bold text-muted-foreground leading-none">
                      {day.toLocaleDateString('en-US', { weekday: 'short' })}
                    </p>
                    <p
                      className={`text-[11px] font-extrabold mt-0.5 inline-flex items-center justify-center h-5 w-5 rounded-full ${
                        isToday ? 'bg-primary text-primary-foreground' : 'text-foreground'
                      }`}
                    >
                      {day.getDate()}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>

          <div ref={mobileGridRef} className="flex-1 min-h-0 overflow-y-auto">
            <div className="relative flex" style={{ height: `${mobileZoomLevel * 24}px` }}>
              {/* Hour gutter */}
              <div className="w-9 shrink-0 border-r border-border bg-card/30 select-none relative">
                {Array.from({ length: 24 }).map((_, hour) => {
                  if (hour % hourLabelStep !== 0) return null;
                  const suffix = hour < 12 ? 'a' : 'p';
                  return (
                    <div
                      key={hour}
                      className="absolute right-1.5 text-[9px] font-bold text-muted-foreground"
                      style={
                        hour === 0
                          ? { top: 0 }
                          : { top: `${hour * mobileZoomLevel}px`, transform: 'translateY(-50%)' }
                      }
                    >
                      {hour % 12 === 0 ? 12 : hour % 12}
                      {suffix}
                    </div>
                  );
                })}
              </div>

              {/* Seven day columns */}
              <div className="flex-1 grid grid-cols-7">
                {weekDates.map((day, colIdx) => {
                  const isToday = day.toDateString() === today.toDateString();
                  const dayEvents = positionedEventsByDay[colIdx];
                  return (
                    <div
                      key={colIdx}
                      className={`border-r border-border/40 relative ${isToday ? 'bg-primary/5' : ''}`}
                    >
                      <div className="absolute inset-0 pointer-events-none">
                        {Array.from({ length: 24 }).map((_, hour) =>
                          hour % hourLabelStep === 0 ? (
                            <div
                              key={hour}
                              className="absolute left-0 right-0 border-t border-border/20"
                              style={{ top: `${hour * mobileZoomLevel}px` }}
                            />
                          ) : null
                        )}
                      </div>

                      {dayEvents.map((ev) => {
                        const widthPercent = 100 / (ev.overlap_total || 1);
                        const leftPercent = (ev.overlap_column || 0) * widthPercent;
                        const topPx = ((ev.top_position || 0) / 60) * mobileZoomLevel;
                        // The 1px comes back as a gap below the block, which
                        // is the one thing the border and the shadow were
                        // still earning: without it two same-coloured events
                        // back to back merge into a single long block.
                        const heightPx = Math.max(
                          MOBILE_MIN_BLOCK_PX,
                          ((ev.height || 0) / 60) * mobileZoomLevel - 1
                        );
                        return (
                          <button
                            key={ev.id}
                            onClick={() => handleOpenEditMobile(ev)}
                            // The block carries no text, so the label is the
                            // only thing a screen reader has to go on.
                            aria-label={`${ev.title}, ${ev.time_range}`}
                            className="absolute cursor-pointer event-card-clickable"
                            style={{
                              top: `${topPx}px`,
                              height: `${heightPx}px`,
                              left: `${leftPercent}%`,
                              width: `calc(${widthPercent}% - 2px)`,
                              borderRadius: MOBILE_BLOCK_RADIUS,
                              backgroundColor: ev.isPending ? `${ev.tag_color}66` : ev.tag_color,
                            }}
                          />
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

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
        className="hidden md:block flex-1 overflow-y-auto relative timeline-container"
        id="timeline-container"
      >
        {/* Weekly grid wrapper */}
        <div className="relative w-full flex" style={{ height: `${zoomLevel * 24}px` }}>

          {/* Hour labels sidebar */}
          <div className="w-16 h-full border-r border-border bg-card/30 shrink-0 select-none relative z-10">
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
                    {dayEvents.map((ev) => (
                      <EventBlock key={ev.id} ev={ev} zoomLevel={zoomLevel} density="week" onOpen={handleOpenEditOverlay} />
                    ))}
                  </div>

                </div>
              );
            })}
          </div>

        </div>
      </div>

      <EventEditor editor={editor} tags={tags} popoverRef={editorPopoverRef} />

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
                    <DateInput
                      required
                      value={addStartDate}
                      onChange={setAddStartDate}
                      className="block w-full rounded bg-secondary border border-border px-2 py-1 text-foreground"
                    />
                    <TimeInput
                      required
                      value={addStartTime}
                      onChange={setAddStartTime}
                      className="block w-full rounded bg-secondary border border-border px-2 py-1 text-foreground"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-muted-foreground">End</label>
                  <div className="mt-1 grid grid-cols-2 gap-1">
                    <DateInput
                      required
                      value={addEndDate}
                      onChange={setAddEndDate}
                      className="block w-full rounded bg-secondary border border-border px-2 py-1 text-foreground"
                    />
                    <TimeInput
                      required
                      value={addEndTime}
                      onChange={setAddEndTime}
                      className="block w-full rounded bg-secondary border border-border px-2 py-1 text-foreground"
                    />
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-muted-foreground uppercase">Tag</label>
                <TagSelect tags={tags} value={addTag} onChange={setAddTag} className="mt-1 w-full rounded bg-secondary border border-border px-3 py-1.5 text-sm text-foreground" />
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
                <Button
                  type="submit"
                  size="none"
                  className="w-full justify-center py-2 rounded text-sm font-bold"
                >
                  Create Event
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}


    </div>
  );
}
