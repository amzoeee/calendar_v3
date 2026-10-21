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

interface TreeTag {
  id: number;
  orderIndex: number;
  parentId: number | null;
}

/**
 * Parents in orderIndex order, each followed by its own subtags. A subtag whose
 * parent is missing from `tags` is placed as a top-level tag.
 */
export function tagTreeOrder<T extends TreeTag>(tags: T[]): T[] {
  const ids = new Set(tags.map((t) => t.id));
  const byOrder = [...tags].sort((a, b) => a.orderIndex - b.orderIndex || a.id - b.id);
  const isRoot = (t: T) => t.parentId == null || !ids.has(t.parentId);
  const out: T[] = [];
  for (const root of byOrder.filter(isRoot)) {
    out.push(root, ...byOrder.filter((t) => !isRoot(t) && t.parentId === root.id));
  }
  return out;
}

/**
 * Why `parents` (tag id → parent id, for every tag the user has) breaks the
 * one-level rule, or null when it doesn't.
 */
export function tagNestingError(
  parents: Map<number, number | null>,
  nameOf: (id: number) => string,
): string | null {
  for (const [id, parentId] of parents) {
    if (parentId == null) continue;
    if (parentId === id) return `“${nameOf(id)}” can’t be its own subtag`;
    if (!parents.has(parentId)) return 'Parent tag not found';
    if (parents.get(parentId) != null) {
      return `“${nameOf(parentId)}” is already a subtag, so it can’t have subtags`;
    }
    for (const [childId, childParent] of parents) {
      if (childParent === id) {
        return `“${nameOf(id)}” has subtags (“${nameOf(childId)}”), so it can’t be a subtag`;
      }
    }
  }
  return null;
}

/**
 * Whether an event tagged with a subtag is drawn in the subtag's color or its
 * parent's. Kept in a cookie, like weekStart, so pages read it on the server.
 */
export const SUBTAG_DISPLAY_COOKIE = 'subtagDisplay';
export type SubtagDisplay = 'child' | 'parent';

export function parseSubtagDisplay(value: string | undefined): SubtagDisplay {
  return value === 'parent' ? 'parent' : 'child';
}

interface ColorTag {
  id: number;
  name: string;
  color: string;
  parentId: number | null;
}

/** The tag an event tagged `name` is shown as, or undefined for an unknown tag. */
export function displayTag<T extends ColorTag>(tags: T[], name: string | null, display: SubtagDisplay): T | undefined {
  const tag = tags.find((t) => t.name === name);
  if (display === 'parent' && tag?.parentId != null) {
    return tags.find((t) => t.id === tag.parentId) ?? tag;
  }
  return tag;
}

export function eventTagColor(tags: ColorTag[], name: string | null, display: SubtagDisplay): string | undefined {
  return displayTag(tags, name, display)?.color;
}
