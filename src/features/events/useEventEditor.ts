'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  copyEventAction,
  deleteEventAction,
  deleteRecurringSeriesAction,
  reinsertEventsAction,
  updateEventAction,
  updateRecurringSeriesAction,
  type EventRow,
} from '@/app/actions';
import { isInsideModal, useConfirm } from '@/app/components/ConfirmDialog';
import { selectStateOf } from '@/app/components/Select';
import { useUndo } from '@/app/components/UndoToast';
import type { PositionedEvent } from '@/lib/overlap';
import { formatDateInputValue, formatTimeInputValue, getBrowserTimeZone, pacificDbStringToDate } from '@/lib/timezone';
import { deletedEventsMessage } from '@/lib/undoMessages';

export interface EditFields {
  title: string;
  tag: string;
  desc: string;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
}

const EMPTY: EditFields = { title: '', tag: '', desc: '', startDate: '', startTime: '', endDate: '', endTime: '' };

/**
 * Editing one event from a calendar view: the form's state, save / delete /
 * copy (asking "this event or the series?" for recurring ones), Enter /
 * Escape / Delete, and closing on a click outside the editor.
 *
 * `beforeMutate` runs before every write, which the views use to save their
 * scroll position.
 */
export function useEventEditor({ beforeMutate }: { beforeMutate?: () => void } = {}) {
  const { confirm, choose } = useConfirm();
  const { raiseUndo } = useUndo();
  const [event, setEvent] = useState<PositionedEvent | null>(null);
  const [fields, setFields] = useState<EditFields>(EMPTY);

  const open = (ev: PositionedEvent) => {
    const start = pacificDbStringToDate(ev.startDatetime);
    const end = pacificDbStringToDate(ev.endDatetime);
    setEvent(ev);
    setFields({
      title: ev.title,
      tag: ev.tag || '',
      desc: ev.description || '',
      startDate: formatDateInputValue(start),
      startTime: formatTimeInputValue(start),
      endDate: formatDateInputValue(end),
      endTime: formatTimeInputValue(end),
    });
  };

  const close = () => setEvent(null);

  const setField = <K extends keyof EditFields>(key: K, value: EditFields[K]) =>
    setFields((f) => ({ ...f, [key]: value }));

  const restore = async (rows: EventRow[]) => {
    beforeMutate?.();
    await reinsertEventsAction(rows);
  };

  const save = async () => {
    if (!event) return;
    const scope = event.recurrenceId
      ? await choose({
          title: 'Edit recurring event',
          message: 'This is a recurring event. How would you like to edit it?',
          choices: [
            { label: 'This event only', value: 'one' as const, tone: 'primary' },
            { label: 'Entire series', value: 'series' as const, tone: 'primary' },
          ],
        })
      : 'one';
    if (!scope) return;

    beforeMutate?.();
    if (scope === 'series' && event.recurrenceId) {
      await updateRecurringSeriesAction(event.recurrenceId, { title: fields.title, description: fields.desc, tag: fields.tag });
    } else {
      await updateEventAction(event.id, {
        title: fields.title,
        description: fields.desc,
        tag: fields.tag,
        startDatetime: `${fields.startDate}T${fields.startTime}`,
        endDatetime: `${fields.endDate}T${fields.endTime}`,
        timeZone: getBrowserTimeZone(),
      });
    }
    close();
  };

  const remove = async () => {
    if (!event) return;
    const scope = event.recurrenceId
      ? await choose({
          title: 'Delete recurring event',
          message: 'This is a recurring event. How would you like to delete it?',
          choices: [
            { label: 'This event only', value: 'one' as const, tone: 'danger' },
            { label: 'Entire series', value: 'series' as const, tone: 'danger' },
          ],
        })
      : (await confirm({ title: 'Delete this event?', confirmLabel: 'Delete', destructive: true })) && 'one';
    if (!scope) return;

    beforeMutate?.();
    const deleted =
      scope === 'series' && event.recurrenceId
        ? await deleteRecurringSeriesAction(event.recurrenceId)
        : await deleteEventAction(event.id);
    close();
    raiseUndo({ message: deletedEventsMessage(deleted), undo: () => restore(deleted) });
  };

  const copy = async () => {
    if (!event) return;
    beforeMutate?.();
    await copyEventAction(event.id);
    close();
  };

  // Listeners below are bound once per open; this keeps them on the latest closures.
  const actions = useRef({ save, remove, close });
  useLayoutEffect(() => {
    actions.current = { save, remove, close };
  });

  const isOpen = event !== null;

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (isInsideModal(e.target)) return;
      // An open dropdown owns the keyboard; a closed one is a form field.
      const select = selectStateOf(e.target);
      if (select === 'open') return;
      const isInput =
        e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || select !== null;

      if (e.key === 'Escape') {
        e.preventDefault();
        actions.current.close();
      } else if (e.key === 'Enter') {
        // Saves regardless of which field has focus.
        e.preventDefault();
        actions.current.save();
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && !isInput && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        actions.current.remove();
      }
    };
    const onMouseDown = (e: MouseEvent) => {
      if (isInsideModal(e.target)) return;
      const target = e.target as Element;
      if (target.closest('[data-event-editor]')) return;
      // Clicking another event re-targets the editor instead.
      if (target.closest('.event-card-clickable')) return;
      actions.current.close();
    };
    window.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('mousedown', onMouseDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('mousedown', onMouseDown);
    };
  }, [isOpen]);

  return { event, fields, setField, open, close, save, remove, copy };
}

export type EventEditorState = ReturnType<typeof useEventEditor>;
