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
