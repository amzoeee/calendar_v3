// Toast wording for deletes that can be undone.

export const quoted = (name: string) => `“${name}”`;

export function deletedEventsMessage(rows: { title: string }[]): string {
  if (rows.length === 0) return 'Nothing to delete';
  if (rows.length === 1) return `Deleted ${quoted(rows[0].title)}`;
  return `Deleted ${rows.length} events of ${quoted(rows[0].title)}`;
}
