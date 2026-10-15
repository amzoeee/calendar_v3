'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Plus, Spline, X } from 'lucide-react';
import { saveNameMatchingAction } from '@/app/actions';
import { SEPARATORS, normalizeTitle, titleParts, type NameMatching } from '@/lib/titleParts';

const SAVE_DELAY_MS = 500;
const SAMPLE = '[train] yap w jerry, katherine + dwg :>';

type BoolKey = 'ignoreBrackets' | 'ignoreParens' | 'ignoreEmoticons' | 'ignoreCompany' | 'categoryPrefixes';

const TOGGLES: { key: BoolKey; label: string; hint: string }[] = [
  { key: 'ignoreBrackets', label: 'Ignore [brackets]', hint: '[train] dwg → dwg' },
  { key: 'ignoreParens', label: 'Ignore (parentheses)', hint: 'yt (long form) → yt' },
  { key: 'ignoreEmoticons', label: 'Ignore emoticons', hint: 'sleep :> → sleep' },
  { key: 'ignoreCompany', label: 'Ignore who it was with', hint: 'yap w jerry, hang out with cat → yap, hang out' },
  { key: 'categoryPrefixes', label: 'Category prefixes', hint: 'robo: website → robo, website' },
];

function WordList({
  label,
  hint,
  words,
  placeholder,
  onChange,
}: {
  label: string;
  hint: string;
  words: string[];
  placeholder: string;
  onChange: (words: string[]) => void;
}) {
  const [draft, setDraft] = useState('');
  const add = () => {
    const w = normalizeTitle(draft);
    if (w && !words.includes(w)) onChange([...words, w]);
    setDraft('');
  };
  return (
    <div className="space-y-2">
      <div>
        <p className="text-sm font-semibold text-foreground">{label}</p>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {words.map((w) => (
          <span
            key={w}
            className="flex items-center gap-1 pl-2.5 pr-1.5 py-1 text-xs font-medium rounded-md bg-secondary border border-border text-foreground"
          >
            {w}
            <button
              onClick={() => onChange(words.filter((x) => x !== w))}
              aria-label={`Remove ${w}`}
              className="text-muted-foreground hover:text-foreground cursor-pointer"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        <span className="flex items-center gap-1 rounded-md border border-dashed border-border pl-2 pr-1 focus-within:ring-1 focus-within:ring-primary">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                add();
              }
            }}
            placeholder={placeholder}
            className="bg-transparent text-xs text-foreground placeholder:text-muted-foreground focus:outline-none w-28 py-1"
          />
          <button onClick={add} aria-label={`Add to ${label}`} className="text-muted-foreground hover:text-foreground cursor-pointer">
            <Plus className="h-3.5 w-3.5" />
          </button>
        </span>
      </div>
    </div>
  );
}

/**
 * How the lifetime view splits titles into parts and decides which events
 * share a name. Saves as you change it.
 */
export default function NameMatchingSettings({ initial }: { initial: NameMatching }) {
  const [rules, setRules] = useState(initial);
  const [sample, setSample] = useState(SAMPLE);
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const update = (patch: Partial<NameMatching>) => {
    const next = { ...rules, ...patch };
    setRules(next);
    setStatus('saving');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try {
        await saveNameMatchingAction(next);
        setStatus('saved');
      } catch {
        setStatus('error');
      }
    }, SAVE_DELAY_MS);
  };

  const toggleSeparator = (sep: (typeof SEPARATORS)[number]) =>
    update({
      separators: rules.separators.includes(sep)
        ? rules.separators.filter((s) => s !== sep)
        : SEPARATORS.filter((s) => s === sep || rules.separators.includes(s)),
    });

  const parts = titleParts(sample, rules);

  return (
    <section className="bg-card rounded-xl border border-border p-4 lg:p-6 space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Spline className="h-5 w-5 text-primary" />
          <h2 className="text-xl font-bold tracking-tight">Name matching</h2>
        </div>
        <span className="text-xs text-muted-foreground" aria-live="polite">
          {status === 'saving' ? 'Saving…' : status === 'saved' ? 'Saved' : status === 'error' ? "Couldn't save" : 'Used by the lifetime view'}
        </span>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-semibold text-foreground">Split titles on</p>
        <div className="flex flex-wrap gap-1.5">
          {SEPARATORS.map((sep) => {
            const on = rules.separators.includes(sep);
            return (
              <button
                key={sep}
                onClick={() => toggleSeparator(sep)}
                aria-pressed={on}
                className={`min-w-9 px-3 py-1 text-sm font-mono rounded-full border transition cursor-pointer ${
                  on
                    ? 'bg-primary/20 border-primary text-primary'
                    : 'bg-secondary border-border text-muted-foreground hover:bg-muted hover:text-foreground'
                }`}
              >
                {sep}
              </button>
            );
          })}
        </div>
      </div>

      <div className="divide-y divide-border border-y border-border">
        {TOGGLES.map(({ key, label, hint }) => (
          <label key={key} className="flex items-center justify-between gap-4 py-2.5 cursor-pointer select-none">
            <span className="min-w-0">
              <span className="block text-sm text-foreground">{label}</span>
              <span className="block text-xs text-muted-foreground truncate">{hint}</span>
            </span>
            <input
              type="checkbox"
              checked={rules[key]}
              onChange={(e) => update({ [key]: e.target.checked })}
              className="rounded bg-secondary border-border text-primary focus:ring-primary w-4 h-4 cursor-pointer shrink-0"
            />
          </label>
        ))}
      </div>

      {rules.ignoreCompany && (
        <WordList
          label="Keep “w” after"
          hint="Where “w” or “with” is part of the activity: deal w bedding."
          words={rules.keepWithAfter}
          placeholder="add a word"
          onChange={(keepWithAfter) => update({ keepWithAfter })}
        />
      )}

      <WordList
        label="Never split"
        hint="Names that contain a separator but are one thing: cats and soup."
        words={rules.neverSplit}
        placeholder="add a name"
        onChange={(neverSplit) => update({ neverSplit })}
      />

      <div className="space-y-2 pt-1">
        <label htmlFor="name-matching-try" className="block text-sm font-semibold text-foreground">
          Try a title
        </label>
        <input
          id="name-matching-try"
          value={sample}
          onChange={(e) => setSample(e.target.value)}
          className="w-full rounded bg-secondary border border-border px-3 py-2 text-sm font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        />
        <div className="flex flex-wrap gap-1.5 min-h-7">
          {parts.length ? (
            parts.map((p) => (
              <span key={p} className="px-2.5 py-1 text-xs font-semibold rounded-full bg-primary/15 text-foreground">
                {p}
              </span>
            ))
          ) : (
            <span className="text-xs text-muted-foreground py-1">No parts, so it only matches itself.</span>
          )}
        </div>
      </div>
    </section>
  );
}
