import Link from 'next/link';
import { count, gte, isNotNull, max, sql } from 'drizzle-orm';
import { BarChart3, Users } from 'lucide-react';
import { db } from '@/db';
import { events, usageEvents, users } from '@/db/schema';
import { requireAdmin } from '@/lib/admin';
import { USAGE_CATALOG } from '@/lib/usage-catalog';
import ResetPasswordButton from './ResetPasswordButton';

const PERIODS = [7, 30, 90];

// Stored as UTC 'YYYY-MM-DD HH:MM:SS' by SQLite's CURRENT_TIMESTAMP.
function ago(timestamp: string | null): string {
  if (!timestamp) return '—';
  const days = Math.floor((Date.now() - Date.parse(`${timestamp.replace(' ', 'T')}Z`)) / 86_400_000);
  return days <= 0 ? 'today' : `${days}d ago`;
}

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  await requireAdmin();
  const requested = Number((await searchParams).days);
  const days = PERIODS.includes(requested) ? requested : 30;
  const since = sql`datetime('now', ${`-${days} days`})`;

  const allUsers = await db
    .select({ id: users.id, username: users.username, createdAt: users.createdAt })
    .from(users)
    .orderBy(users.id);

  const rows = await db
    .select({
      name: usageEvents.name,
      userId: usageEvents.userId,
      uses: count(),
      last: max(usageEvents.createdAt),
      mobile: sql<number>`sum(json_extract(${usageEvents.props}, '$.mobile') = 1)`,
      withDevice: sql<number>`sum(json_extract(${usageEvents.props}, '$.mobile') is not null)`,
    })
    .from(usageEvents)
    .where(gte(usageEvents.createdAt, since))
    .groupBy(usageEvents.name, usageEvents.userId);

  const lastActive = new Map(
    (
      await db
        .select({ userId: usageEvents.userId, last: max(usageEvents.createdAt) })
        .from(usageEvents)
        .where(isNotNull(usageEvents.userId))
        .groupBy(usageEvents.userId)
    ).map((r) => [r.userId, r.last]),
  );
  const eventCounts = new Map(
    (
      await db
        .select({ userId: events.userId, n: count() })
        .from(events)
        .groupBy(events.userId)
    ).map((r) => [r.userId, r.n]),
  );

  type Stat = { total: number; byUser: Map<number | null, number>; last: string | null; mobile: number; withDevice: number };
  const stats = new Map<string, Stat>();
  for (const r of rows) {
    const s = stats.get(r.name) ?? { total: 0, byUser: new Map(), last: null, mobile: 0, withDevice: 0 };
    s.total += r.uses;
    s.byUser.set(r.userId, (s.byUser.get(r.userId) ?? 0) + r.uses);
    if (r.last && (!s.last || r.last > s.last)) s.last = r.last;
    s.mobile += r.mobile ?? 0;
    s.withDevice += r.withDevice ?? 0;
    stats.set(r.name, s);
  }

  // Catalogued features in catalog order, then anything recorded under a name
  // the catalog no longer has.
  const groups = new Map<string, { name: string; label: string }[]>();
  for (const [name, { group, label }] of Object.entries(USAGE_CATALOG)) {
    groups.set(group, [...(groups.get(group) ?? []), { name, label }]);
  }
  const unknown = [...stats.keys()].filter((name) => !Object.hasOwn(USAGE_CATALOG, name));
  if (unknown.length) groups.set('Other', unknown.map((name) => ({ name, label: name })));

  const hasUnlinked = rows.some((r) => r.userId === null);
  const columns: { id: number | null; label: string }[] = [
    ...allUsers.map((u) => ({ id: u.id, label: u.username })),
    ...(hasUnlinked ? [{ id: null, label: 'unlinked' }] : []),
  ];

  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <div className="p-4 lg:p-8 space-y-6 lg:space-y-8 max-w-6xl mx-auto">
        <section className="bg-card rounded-xl border border-border p-4 lg:p-6 space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <BarChart3 className="h-5 w-5 text-primary" />
            <h2 className="text-xl font-bold tracking-tight flex-1">Feature usage</h2>
            <div className="flex gap-2">
              {PERIODS.map((p) => (
                <Link
                  key={p}
                  href={`/admin?days=${p}`}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition ${
                    p === days
                      ? 'bg-primary/20 border-primary text-primary'
                      : 'bg-secondary border-border text-foreground hover:bg-muted'
                  }`}
                >
                  {p} days
                </Link>
              ))}
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Uses per feature over the last {days} days. Mobile % only covers in-browser interactions.
          </p>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground border-b border-border">
                  <th className="py-2 pr-4 font-semibold">Feature</th>
                  <th className="py-2 px-2 font-semibold text-right">Total</th>
                  {columns.map((c) => (
                    <th key={c.id ?? 'unlinked'} className="py-2 px-2 font-semibold text-right">
                      {c.label}
                    </th>
                  ))}
                  <th className="py-2 px-2 font-semibold text-right">Mobile</th>
                  <th className="py-2 pl-2 font-semibold text-right">Last used</th>
                </tr>
              </thead>
              {[...groups].map(([group, features]) => (
                <tbody key={group}>
                  <tr>
                    <td colSpan={columns.length + 4} className="pt-5 pb-1 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                      {group}
                    </td>
                  </tr>
                  {features.map(({ name, label }) => {
                    const s = stats.get(name);
                    return (
                      <tr key={name} className={`border-b border-border/50 ${s ? '' : 'text-muted-foreground/60'}`}>
                        <td className="py-1.5 pr-4">
                          {label} <span className="ml-1 font-mono text-[11px] text-muted-foreground">{name}</span>
                        </td>
                        <td className="py-1.5 px-2 text-right font-semibold tabular-nums">{s?.total ?? 0}</td>
                        {columns.map((c) => (
                          <td key={c.id ?? 'unlinked'} className="py-1.5 px-2 text-right tabular-nums">
                            {s?.byUser.get(c.id) || '·'}
                          </td>
                        ))}
                        <td className="py-1.5 px-2 text-right tabular-nums">
                          {s?.withDevice ? `${Math.round((s.mobile / s.withDevice) * 100)}%` : '·'}
                        </td>
                        <td className="py-1.5 pl-2 text-right whitespace-nowrap">{ago(s?.last ?? null)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              ))}
            </table>
          </div>
        </section>

        <section className="bg-card rounded-xl border border-border p-4 lg:p-6 space-y-4">
          <div className="flex items-center gap-3">
            <Users className="h-5 w-5 text-primary" />
            <h2 className="text-xl font-bold tracking-tight">Users</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground border-b border-border">
                  <th className="py-2 pr-4 font-semibold">Username</th>
                  <th className="py-2 px-2 font-semibold">Joined</th>
                  <th className="py-2 px-2 font-semibold">Last active</th>
                  <th className="py-2 px-2 font-semibold text-right">Events</th>
                  <th className="py-2 pl-2" />
                </tr>
              </thead>
              <tbody>
                {allUsers.map((u) => (
                  <tr key={u.id} className="border-b border-border/50">
                    <td className="py-2 pr-4 font-semibold">{u.username}</td>
                    <td className="py-2 px-2 whitespace-nowrap">{u.createdAt?.slice(0, 10) ?? '—'}</td>
                    <td className="py-2 px-2 whitespace-nowrap">{ago(lastActive.get(u.id) ?? null)}</td>
                    <td className="py-2 px-2 text-right tabular-nums">{eventCounts.get(u.id) ?? 0}</td>
                    <td className="py-2 pl-2 text-right">
                      <ResetPasswordButton userId={u.id} username={u.username} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
