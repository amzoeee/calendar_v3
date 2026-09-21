// Which pickers a tag appears in. The column has existed since tasks landed
// (see tags.scope in db/schema.ts) but nothing set it away from 'both' until
// Settings grew a control for it.

export const TAG_SCOPES = ['both', 'event', 'task'] as const;
export type TagScope = (typeof TAG_SCOPES)[number];

export const TAG_SCOPE_LABELS: Record<TagScope, string> = {
  both: 'Events and tasks',
  event: 'Events only',
  task: 'Tasks only',
};

/** Short form for the badge on a tag row — 'both' gets none, so it's absent here. */
export const TAG_SCOPE_BADGES: Record<Exclude<TagScope, 'both'>, string> = {
  event: 'events only',
  task: 'tasks only',
};

export function isTagScope(value: string): value is TagScope {
  return (TAG_SCOPES as readonly string[]).includes(value);
}

/** True when a tag with this scope belongs in the picker for `kind`. */
export function scopeAllows(scope: string, kind: 'event' | 'task'): boolean {
  return scope === 'both' || scope === kind;
}
