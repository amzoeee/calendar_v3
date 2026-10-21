'use client';

import type { RefObject } from 'react';
import { Copy, Trash2, X } from 'lucide-react';
import DateInput from '@/app/components/DateInput';
import TagSelect from '@/app/components/TagSelect';
import TimeInput from '@/app/components/TimeInput';
import type { EventEditorState } from '../useEventEditor';

interface Tag {
  id: number;
  name: string;
  color: string;
  isArchived: number;
  scope: string;
}

const SIZES = {
  popover: {
    gap: 'space-y-3',
    text: 'text-sm',
    small: 'text-xs',
    input: 'px-3 py-1.5',
    tagSelect: 'px-2 py-1.5 text-xs',
    dateTime: 'px-1 py-1',
    dateGrid: 'mt-1 gap-1',
    dateLabel: '',
    desc: 'px-3 py-1.5 text-xs',
    button: 'py-1.5 text-xs',
    buttonPad: 'px-3',
    icon: 'h-3.5 w-3.5',
    divider: 'pt-2',
  },
  sheet: {
    gap: 'space-y-4',
    text: 'text-sm',
    small: 'text-sm',
    input: 'px-3 py-2',
    tagSelect: 'px-2 py-2 text-sm',
    dateTime: 'px-2 py-2',
    dateGrid: 'gap-2',
    dateLabel: 'text-xs mb-1',
    desc: 'px-3 py-2 text-sm',
    button: 'py-2.5 text-sm',
    buttonPad: 'px-4',
    icon: 'h-4 w-4',
    divider: 'pt-3',
  },
};

function EditorFields({ editor, tags, size }: { editor: EventEditorState; tags: Tag[]; size: keyof typeof SIZES }) {
  const s = SIZES[size];
  const { fields, setField } = editor;
  const tagColor = tags.find((t) => t.name === fields.tag)?.color || 'transparent';
  const field = 'block w-full rounded bg-secondary border border-border text-foreground focus:outline-none';

  return (
    <>
      <input
        type="text"
        required
        value={fields.title}
        onChange={(e) => setField('title', e.target.value)}
        placeholder="Title"
        className={`${field} ${s.input} ${s.text} focus:ring-1 focus:ring-primary`}
      />

      <div className="flex items-center gap-2">
        <span className="w-4 h-4 rounded-full border border-border flex-shrink-0" style={{ backgroundColor: tagColor }} />
        <TagSelect
          tags={tags}
          value={fields.tag}
          onChange={(v) => setField('tag', v)}
          className={`w-full rounded bg-secondary border border-border ${s.tagSelect} text-foreground focus:outline-none focus:ring-1 focus:ring-primary cursor-pointer`}
        />
      </div>

      <div className={`${size === 'sheet' ? 'space-y-3' : 'space-y-2'} ${s.small}`}>
        {(['start', 'end'] as const).map((which) => (
          <div key={which}>
            <label className={`block text-muted-foreground ${s.dateLabel}`}>{which === 'start' ? 'Start' : 'End'}</label>
            <div className={`grid grid-cols-2 ${s.dateGrid}`}>
              <DateInput
                value={fields[`${which}Date`]}
                onChange={(v) => setField(`${which}Date`, v)}
                className={`${field} ${s.dateTime}`}
              />
              <TimeInput
                value={fields[`${which}Time`]}
                onChange={(v) => setField(`${which}Time`, v)}
                className={`${field} ${s.dateTime}`}
              />
            </div>
          </div>
        ))}
      </div>

      <textarea
        value={fields.desc}
        onChange={(e) => setField('desc', e.target.value)}
        placeholder="Description"
        rows={2}
        className={`${field} ${s.desc} resize-none`}
      />

      <div className="flex gap-2">
        <button
          type="button"
          onClick={editor.save}
          className={`flex-1 ${s.button} bg-primary hover:bg-muted text-primary-foreground rounded font-semibold cursor-pointer text-center`}
        >
          Save
        </button>
        <button
          type="button"
          onClick={editor.close}
          className={`${s.buttonPad} ${s.button} bg-secondary hover:bg-muted text-foreground rounded font-semibold cursor-pointer`}
        >
          Cancel
        </button>
      </div>

      <div className={`border-t border-border ${s.divider} flex justify-between gap-2`}>
        <button
          type="button"
          onClick={editor.remove}
          className={`flex-1 flex items-center justify-center gap-1.5 ${s.button} bg-red-650 hover:bg-red-700 text-white rounded font-semibold cursor-pointer`}
        >
          <Trash2 className={s.icon} />
          Delete
        </button>
        <button
          type="button"
          onClick={editor.copy}
          className={`${s.buttonPad} ${s.button} bg-secondary hover:bg-muted text-foreground rounded font-semibold flex items-center justify-center gap-1.5 cursor-pointer`}
          title="Copy Event"
        >
          <Copy className={s.icon} />
          Copy
        </button>
      </div>
    </>
  );
}

/**
 * The event editor: a popover on desktop (positioned by useEditorPlacement
 * through `popoverRef`) and a bottom sheet on mobile.
 */
export default function EventEditor({
  editor,
  tags,
  popoverRef,
}: {
  editor: EventEditorState;
  tags: Tag[];
  popoverRef: RefObject<HTMLDivElement | null>;
}) {
  if (!editor.event) return null;

  return (
    <>
      <div
        ref={popoverRef}
        data-event-editor
        className="hidden md:block fixed bg-card border border-border rounded-lg shadow-2xl p-4 w-72 space-y-3 z-50 text-left"
      >
        <div className="flex items-center justify-between border-b border-border pb-2">
          <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Edit Event</h4>
          <button
            onClick={editor.close}
            className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground cursor-pointer"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <EditorFields editor={editor} tags={tags} size="popover" />
      </div>

      <div className="md:hidden fixed inset-0 z-50 flex items-end">
        <div className="absolute inset-0 bg-black/60" onClick={editor.close} />
        <div
          data-event-editor
          className="relative w-full max-h-[85vh] overflow-y-auto bg-card border-t border-border rounded-t-2xl p-5 pb-8 space-y-4"
        >
          <div className="w-9 h-1 rounded-full bg-muted mx-auto" />
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold tracking-tight">Edit event</h2>
            <button
              onClick={editor.close}
              className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground cursor-pointer"
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <EditorFields editor={editor} tags={tags} size="sheet" />
        </div>
      </div>
    </>
  );
}
