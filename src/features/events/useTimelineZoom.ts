'use client';

import { useEffect, useRef, useState, type RefObject } from 'react';
import { isInsideModal } from '@/app/components/ConfirmDialog';
import { selectStateOf } from '@/app/components/Select';
import { track } from '@/lib/track';
import { usePinchZoom } from '@/lib/usePinchZoom';

const ZOOM_KEY = 'calendarZoomLevel';
const DEFAULT_ZOOM = 60;
const STEP = 15;

/**
 * Pixels per hour for a timeline, shared by the day and week views through
 * localStorage. Cmd/Ctrl + `=` / `-` / `0` and pinching change it.
 */
export function useTimelineZoom(containerRef: RefObject<HTMLDivElement | null>) {
  const [zoomLevel, setZoomLevel] = useState(DEFAULT_ZOOM);

  useEffect(() => {
    const saved = localStorage.getItem(ZOOM_KEY);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- restoring a stored preference after hydration
    if (saved) setZoomLevel(parseInt(saved, 10));
  }, []);

  // Persisted from an effect, not the updater (updaters must be pure). The
  // first run is skipped so the default can't clobber the stored value
  // before the restore above lands.
  const hydrated = useRef(false);
  useEffect(() => {
    if (!hydrated.current) {
      hydrated.current = true;
      return;
    }
    localStorage.setItem(ZOOM_KEY, String(zoomLevel));
  }, [zoomLevel]);

  usePinchZoom(containerRef, zoomLevel, setZoomLevel);

  const changeZoom = (delta: number) => setZoomLevel((prev) => Math.max(30, Math.min(300, prev + delta)));
  const resetZoom = () => setZoomLevel(DEFAULT_ZOOM);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isInsideModal(e.target) || selectStateOf(e.target) === 'open' || !(e.metaKey || e.ctrlKey)) return;
      if (e.key === '=' || e.key === '+' || e.key === '-') {
        e.preventDefault();
        track('nav.zoom_key');
        changeZoom(e.key === '-' ? -STEP : STEP);
      } else if (e.key === '0') {
        e.preventDefault();
        track('nav.zoom_reset');
        resetZoom();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, []);

  return { zoomLevel, changeZoom, resetZoom };
}
