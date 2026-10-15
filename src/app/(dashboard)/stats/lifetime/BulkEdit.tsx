'use client';

import React, { useState } from 'react';
import Select from '@/app/components/Select';
import { useConfirm } from '@/app/components/ConfirmDialog';
import { bulkEditEventsAction, type EventSnapshot } from '@/app/actions';
import { scopeAllows } from '@/lib/tags';

interface Tag {
  id: number;
  name: string;
  isArchived: number;
  scope: string;
}

export interface BulkTarget {
  // Shown in the rename box as the starting text.
  label: string;
  exactIds: number[];
  relatedIds: number[];
  // Text replaced inside each title; null replaces whole titles.
  renameFrom: string | null;
  renameMode: 'word' | 'substring';
}

export interface BulkResult {
  newName: string | null;
  renamed: number;
  retagged: number;
  previous: EventSnapshot[];
}

interface BulkEditProps {
  target: BulkTarget;
  tags: Tag[];
  onApplied: (result: BulkResult) => void;
  onClose: () => void;
}

const KEEP = '\u0000keep';

const plural = (n: number) => `${n.toLocaleString()} event${n === 1 ? '' : 's'}`;

export default function BulkEdit({ target, tags, onApplied, onClose }: BulkEditProps) {
  const { confirm } = useConfirm();
  // A substring search often has no exact matches at all.
  const [includeRelated, setIncludeRelated] = useState(target.exactIds.length === 0);
  const [name, setName] = useState(target.label);
  const [tag, setTag] = useState(KEEP);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasRelated = target.relatedIds.length > 0;
  // Without a single part to swap, related titles have nothing to rename.
  const canRenameRelated = target.renameFrom !== null;
  const ids = includeRelated ? [...target.exactIds, ...target.relatedIds] : target.exactIds;
  const renameIds = includeRelated && canRenameRelated ? ids : target.exactIds;

  const newName = name.trim();
  const renaming = newName !== '' && newName !== target.label;
  const retagging = tag !== KEEP;

  const apply = async () => {
    const lines: string[] = [];
    if (renaming) {
      lines.push(
        target.renameFrom
          ? `Replace “${target.renameFrom}” with “${newName}” in ${plural(renameIds.length)}.`
          : `Rename ${plural(renameIds.length)} to “${newName}”.`,
      );
    }
    if (retagging) lines.push(`Tag ${plural(ids.length)} as ${tag ? `“${tag}”` : 'untagged'}.`);
    const ok = await confirm({
      title: 'Edit these events?',
      message: (
        <>
          {lines.map((l) => (
            <span key={l} className="block">
              {l}
            </span>
          ))}
        </>
      ),
      confirmLabel: 'Apply',
    });
    if (!ok) return;

    setBusy(true);
    setError(null);
    try {
      const res = await bulkEditEventsAction({
        renameIds: renaming ? renameIds : [],
        renameFrom: target.renameFrom,
        renameMode: target.renameMode,
        renameTo: renaming ? newName : null,
        retagIds: retagging ? ids : [],
        tag: retagging ? tag || null : undefined,
      });
      if ('error' in res) {
        setError(res.error ?? 'Something went wrong.');
        return;
      }
      onClose();
      onApplied({
        newName: renaming ? newName : null,
        renamed: res.renamed,
        retagged: res.retagged,
        previous: res.previous,
      });
    } catch {
      setError('Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  const fieldClass =
    'w-full rounded bg-secondary border border-border px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary';

  return (
    <div className="border border-border rounded-lg p-3 space-y-3 bg-secondary/30">
      {hasRelated && (
        <div className="space-y-1 text-xs">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="radio" checked={!includeRelated} onChange={() => setIncludeRelated(false)} />
            Same name only ({target.exactIds.length.toLocaleString()})
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="radio" checked={includeRelated} onChange={() => setIncludeRelated(true)} />
            Also the ones it&apos;s part of ({(target.exactIds.length + target.relatedIds.length).toLocaleString()})
          </label>
        </div>
      )}

      <div>
        <label className="block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
          Rename
        </label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (renaming || retagging) && !busy) apply();
          }}
          className={fieldClass}
        />
        <p className="text-[10px] text-muted-foreground mt-1">
          {target.renameFrom
            ? `Replaces “${target.renameFrom}” inside each title.`
            : includeRelated
              ? 'Renames same-name events only; the others are just retagged.'
              : 'Replaces the whole title.'}
        </p>
      </div>

      <div>
        <label className="block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
          Tag
        </label>
        <Select
          value={tag}
          onChange={setTag}
          className={`${fieldClass} cursor-pointer`}
          options={[
            { value: KEEP, label: 'Keep current tags' },
            { value: '', label: 'None' },
            ...tags
              .filter((t) => !t.isArchived && scopeAllows(t.scope, 'event'))
              .map((t) => ({ value: t.name, label: t.name })),
          ]}
        />
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}

      <div className="flex justify-end gap-2">
        <button
          onClick={onClose}
          className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-secondary hover:bg-muted text-foreground transition cursor-pointer"
        >
          Cancel
        </button>
        <button
          onClick={apply}
          disabled={busy || !(renaming || retagging)}
          className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-primary text-primary-foreground hover:opacity-90 transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {busy ? 'Applying…' : 'Apply'}
        </button>
      </div>
    </div>
  );
}
