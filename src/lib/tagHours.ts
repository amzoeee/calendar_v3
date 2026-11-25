interface GroupableTag {
  id: number;
  name: string;
  parentId: number | null;
}

export interface TagHoursGroup {
  root: string;
  members: string[];
  total: number;
  hasSubtags: boolean;
}

/** Hours per tag name, with subtags grouped under their parent, largest first. */
export function groupTagHours(hours: Record<string, number>, tags: GroupableTag[]): TagHoursGroup[] {
  const parentName = (name: string) => {
    const parentId = tags.find((t) => t.name === name)?.parentId;
    return parentId == null ? undefined : tags.find((t) => t.id === parentId)?.name;
  };

  const groups = new Map<string, { root: string; members: string[]; total: number }>();
  for (const [name, h] of Object.entries(hours)) {
    const root = parentName(name) ?? name;
    const group = groups.get(root) ?? { root, members: [], total: 0 };
    group.members.push(name);
    group.total += h;
    groups.set(root, group);
  }

  return [...groups.values()]
    .map((g) => ({
      ...g,
      hasSubtags: g.members.some((m) => m !== g.root),
      members: g.members.sort((a, b) => hours[b] - hours[a]),
    }))
    .sort((a, b) => b.total - a.total);
}

/** What the stats hours panel covers: the range's average, or one day. */
export const HOURS_MODE_COOKIE = 'statsHoursMode';
export type HoursMode = 'range' | 'day';

export function parseHoursMode(value: string | undefined): HoursMode {
  return value === 'day' ? 'day' : 'range';
}

/**
 * The latest of `days` ('YYYY-MM-DD', ascending) that isn't after `today`, or
 * the first when they all are.
 */
export function defaultDay(days: string[], today: string): string | undefined {
  return days.findLast((d) => d <= today) ?? days[0];
}
