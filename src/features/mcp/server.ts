import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '@/db';
import { events } from '@/db/schema';
import { getEventsOverlapping, searchEvents } from '@/features/events/server/queries';
import { insertEventForUser, type EventRow } from '@/features/events/server/mutations';
import { getTags } from '@/features/tags/server/queries';
import { findMergeNeighbour, parseLogText } from '@/lib/discord-log';
import { planPendingMerge } from '@/lib/merge-pending';
import { isValidTimeZone, setMcpTokenTimeZone, type McpCaller } from '@/lib/mcp-tokens';
import { dateStrInTimeZone } from '@/lib/timezone';
import { track } from '@/lib/usage';
import type { UsageName } from '@/lib/usage-catalog';
import { timeStats } from './stats';
import { formatToolTime, nowContext, parseToolTime } from './time';

const MAX_EVENTS = 1500;
// Write results list at most this many events; a whole recurring series can run to hundreds.
const MAX_LISTED = 100;

type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean };

const TIME_HELP = 'YYYY-MM-DDTHH:MM in your timezone, YYYY-MM-DD for midnight, or ISO 8601 with an offset';

function instructions(caller: McpCaller) {
  return [
    `Personal time-tracking calendar for ${caller.username}. Events record what they actually did, so totals are real time spent.`,
    `Times: inputs take ${TIME_HELP}. Outputs are ISO 8601 with the offset of the token's timezone (currently ${caller.timeZone}; set_timezone changes it). Every response includes "now".`,
    'Ranges are [start, end): an event counts when it starts inside them (get_events also includes ones overlapping the start).',
    'Writes apply immediately and the app has no undo for them. Write tools return the previous values or the deleted events, so you can put things back.',
    'Tags are names from list_tags. Recurring events are stored as separate occurrences of a series; pass scope "series" to change every occurrence.',
  ].join('\n');
}

function eventOut(row: Pick<EventRow, 'id' | 'startDatetime' | 'endDatetime' | 'title' | 'tag'> & Partial<EventRow>, timeZone: string, withDescription = false) {
  return {
    id: row.id,
    start: formatToolTime(row.startDatetime, timeZone),
    end: formatToolTime(row.endDatetime, timeZone),
    title: row.title,
    tag: row.tag || null,
    ...(row.recurrenceId ? { series: true } : {}),
    ...(withDescription && row.description ? { description: row.description } : {}),
  };
}

/** Resolves a tag name case-insensitively to the stored spelling. */
async function resolveTag(userId: number, name: string | null | undefined): Promise<string | null | undefined> {
  if (name === undefined || name === null) return name;
  const tags = await getTags(userId);
  const wanted = name.trim().toLowerCase();
  const tag = tags.find((t) => t.name.toLowerCase() === wanted);
  if (!tag) throw new Error(`No tag named "${name}". Call list_tags for the names.`);
  return tag.name;
}

/** The caller's rows for `ids`, widened to whole series when `scope` is "series". */
async function targetRows(userId: number, ids: number[], scope: 'this' | 'series') {
  const own = await db
    .select()
    .from(events)
    .where(and(eq(events.userId, userId), eq(events.isPending, 0), inArray(events.id, ids)));
  const found = new Set(own.map((r) => r.id));
  const notFound = ids.filter((id) => !found.has(id));

  const seriesIds = scope === 'series' ? [...new Set(own.map((r) => r.recurrenceId).filter((s): s is string => !!s))] : [];
  if (seriesIds.length === 0) return { rows: own, notFound };

  const series = await db
    .select()
    .from(events)
    .where(and(eq(events.userId, userId), inArray(events.recurrenceId, seriesIds)));
  const rows = [...own.filter((r) => !r.recurrenceId), ...series];
  return { rows, notFound };
}

export function buildMcpServer(caller: McpCaller): McpServer {
  const server = new McpServer(
    { name: 'calendar', version: '1.0.0' },
    { instructions: instructions(caller) },
  );
  const { userId } = caller;

  const reply = (payload: object): ToolResult => ({
    content: [{ type: 'text', text: JSON.stringify({ ...nowContext(caller.timeZone), ...payload }) }],
  });

  // Errors go back to the model as tool results it can read and correct.
  const run = <A>(name: UsageName, fn: (args: A) => Promise<object>) => async (args: A): Promise<ToolResult> => {
    track(userId, name);
    try {
      return reply(await fn(args));
    } catch (e) {
      return { content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }], isError: true };
    }
  };

  const changed = () => {
    revalidatePath('/calendar', 'layout');
    revalidatePath('/weekly', 'layout');
    revalidatePath('/stats', 'layout');
  };

  // ---- Read ---------------------------------------------------------------

  server.registerTool(
    'get_events',
    {
      description: 'Lists events overlapping [start, end), oldest first.',
      inputSchema: {
        start: z.string().describe(TIME_HELP),
        end: z.string().describe(TIME_HELP),
        include_description: z.boolean().optional().describe('Include each event\'s description. Off by default to keep results small.'),
      },
      annotations: { readOnlyHint: true },
    },
    run('mcp.get_events', async ({ start, end, include_description }: { start: string; end: string; include_description?: boolean }) => {
      const startDb = parseToolTime(start, caller.timeZone);
      const endDb = parseToolTime(end, caller.timeZone);
      const rows = (await getEventsOverlapping(userId, startDb, endDb)).filter(
        (r) => r.isPending === 0 && r.endDatetime > startDb && r.startDatetime < endDb,
      );
      return {
        events: rows.slice(0, MAX_EVENTS).map((r) => eventOut(r, caller.timeZone, include_description)),
        ...(rows.length > MAX_EVENTS ? { truncated: `Only the first ${MAX_EVENTS} of ${rows.length}; narrow the range.` } : {}),
      };
    }),
  );

  server.registerTool(
    'search_events',
    {
      description:
        'Finds events whose title, description or tag contains `query` (case-insensitive substring, the same as the app\'s search box). Newest first.',
      inputSchema: {
        query: z.string().min(1),
        start: z.string().optional().describe(`Only events starting at or after this. ${TIME_HELP}`),
        end: z.string().optional().describe(`Only events starting before this. ${TIME_HELP}`),
        limit: z.number().int().min(1).max(100).optional().describe('Default 25.'),
        offset: z.number().int().min(0).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    run('mcp.search_events', async (args: { query: string; start?: string; end?: string; limit?: number; offset?: number }) => {
      const limit = args.limit ?? 25;
      const rows = await searchEvents(userId, args.query.trim(), limit + 1, args.offset ?? 0, {
        from: args.start ? parseToolTime(args.start, caller.timeZone) : undefined,
        to: args.end ? parseToolTime(args.end, caller.timeZone) : undefined,
      });
      return { events: rows.slice(0, limit).map((r) => eventOut(r, caller.timeZone)), more: rows.length > limit };
    }),
  );

  server.registerTool(
    'get_time_stats',
    {
      description:
        'Time spent on an activity or tag between start and end, counted the same way as the app\'s Lifetime stats. ' +
        'With `query`, "exact" is events named exactly that (ignoring case and [bracketed] context) and "related" is ' +
        'titles that contain it, like "get ready + drive" for "drive". Give either `query` or `tag`. Future time is not counted.',
      inputSchema: {
        query: z.string().optional().describe('Activity name.'),
        tag: z.string().optional().describe('Tag name from list_tags.'),
        include_subtags: z.boolean().optional().describe('For `tag`: count its subtags too. Default true.'),
        start: z.string().describe(TIME_HELP),
        end: z.string().describe(TIME_HELP),
        group_by: z.enum(['day', 'week', 'month']).optional().describe('Also break the exact matches down by period. Weeks start on Monday.'),
      },
      annotations: { readOnlyHint: true },
    },
    run('mcp.get_time_stats', async (args: { query?: string; tag?: string; include_subtags?: boolean; start: string; end: string; group_by?: 'day' | 'week' | 'month' }) => {
      if (!args.query === !args.tag) throw new Error('Give exactly one of `query` or `tag`.');
      return timeStats(userId, caller.timeZone, {
        query: args.query,
        tag: args.tag,
        includeSubtags: args.include_subtags ?? true,
        startDb: parseToolTime(args.start, caller.timeZone),
        endDb: parseToolTime(args.end, caller.timeZone),
        groupBy: args.group_by,
      });
    }),
  );

  server.registerTool(
    'list_tags',
    {
      description: 'Lists tags in the order the app shows them. Subtags name their parent. Scope says whether a tag is for events, tasks or both.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    run('mcp.list_tags', async () => {
      const tags = await getTags(userId);
      const nameOf = new Map(tags.map((t) => [t.id, t.name]));
      return {
        tags: tags.map((t) => ({
          name: t.name,
          color: t.color,
          ...(t.parentId != null ? { parent: nameOf.get(t.parentId) ?? null } : {}),
          ...(t.isArchived ? { archived: true } : {}),
          scope: t.scope,
        })),
      };
    }),
  );

  // ---- Write --------------------------------------------------------------

  server.registerTool(
    'create_event',
    {
      description: 'Adds one event.',
      inputSchema: {
        title: z.string().min(1),
        start: z.string().describe(TIME_HELP),
        end: z.string().describe(TIME_HELP),
        tag: z.string().optional().describe('Tag name from list_tags.'),
        description: z.string().optional(),
      },
    },
    run('mcp.create_event', async (args: { title: string; start: string; end: string; tag?: string; description?: string }) => {
      const startDb = parseToolTime(args.start, caller.timeZone);
      const endDb = parseToolTime(args.end, caller.timeZone);
      if (endDb <= startDb) throw new Error('`end` must be after `start`.');
      const row = await insertEventForUser(userId, {
        title: args.title.trim(),
        description: args.description ?? '',
        tag: (await resolveTag(userId, args.tag)) ?? null,
        startDatetime: startDb,
        endDatetime: endDb,
      });
      changed();
      return { created: eventOut(row, caller.timeZone, true) };
    }),
  );

  server.registerTool(
    'update_events',
    {
      description:
        'Changes title, tag or description on one or more events at once, or the time of a single event. ' +
        'Fields left out are kept; tag null clears it. Returns the previous values.',
      inputSchema: {
        ids: z.array(z.number().int()).min(1).max(500),
        scope: z.enum(['this', 'series']).optional().describe('"series" applies to every occurrence of a recurring event. Default "this".'),
        title: z.string().min(1).optional(),
        tag: z.string().nullable().optional(),
        description: z.string().nullable().optional(),
        start: z.string().optional().describe(`Only with a single id and scope "this". ${TIME_HELP}`),
        end: z.string().optional().describe(`Only with a single id and scope "this". ${TIME_HELP}`),
      },
      annotations: { idempotentHint: true },
    },
    run('mcp.update_events', async (args: {
      ids: number[];
      scope?: 'this' | 'series';
      title?: string;
      tag?: string | null;
      description?: string | null;
      start?: string;
      end?: string;
    }) => {
      const scope = args.scope ?? 'this';
      const retime = args.start !== undefined || args.end !== undefined;
      if (retime && (args.ids.length !== 1 || scope !== 'this')) {
        throw new Error('`start` and `end` can only change a single event with scope "this".');
      }
      if (!retime && args.title === undefined && args.tag === undefined && args.description === undefined) {
        throw new Error('Nothing to change.');
      }

      const tag = await resolveTag(userId, args.tag);
      const { rows, notFound } = await targetRows(userId, args.ids, scope);
      const updates = rows.map((row) => {
        const startDb = args.start !== undefined ? parseToolTime(args.start, caller.timeZone) : row.startDatetime;
        const endDb = args.end !== undefined ? parseToolTime(args.end, caller.timeZone) : row.endDatetime;
        if (endDb <= startDb) throw new Error(`Event ${row.id} would end before it starts.`);
        return {
          row,
          set: {
            ...(args.title !== undefined ? { title: args.title.trim() } : {}),
            ...(tag !== undefined ? { tag } : {}),
            ...(args.description !== undefined ? { description: args.description ?? '' } : {}),
            ...(retime ? { startDatetime: startDb, endDatetime: endDb } : {}),
          },
        };
      });

      db.transaction((tx) => {
        for (const { row, set } of updates) tx.update(events).set(set).where(eq(events.id, row.id)).run();
      });
      if (updates.length > 0) changed();

      return {
        updated_count: updates.length,
        updated: updates.slice(0, MAX_LISTED).map(({ row, set }) => eventOut({ ...row, ...set }, caller.timeZone, true)),
        previous: updates.slice(0, MAX_LISTED).map(({ row }) => eventOut(row, caller.timeZone, true)),
        ...(notFound.length ? { not_found: notFound } : {}),
      };
    }),
  );

  server.registerTool(
    'delete_events',
    {
      description: 'Deletes events. Returns them in full, so they can be recreated if this was a mistake.',
      inputSchema: {
        ids: z.array(z.number().int()).min(1).max(500),
        scope: z.enum(['this', 'series']).optional().describe('"series" deletes every occurrence of a recurring event. Default "this".'),
      },
      annotations: { destructiveHint: true, idempotentHint: true },
    },
    run('mcp.delete_events', async (args: { ids: number[]; scope?: 'this' | 'series' }) => {
      const { rows, notFound } = await targetRows(userId, args.ids, args.scope ?? 'this');
      const ids = rows.map((r) => r.id);
      if (ids.length > 0) {
        await db.delete(events).where(and(eq(events.userId, userId), inArray(events.id, ids)));
        changed();
      }
      return {
        deleted_count: rows.length,
        deleted: rows.slice(0, MAX_LISTED).map((r) => eventOut(r, caller.timeZone, true)),
        ...(notFound.length ? { not_found: notFound } : {}),
      };
    }),
  );

  server.registerTool(
    'log_activities',
    {
      description: [
        'Adds events from a shorthand activity log, the same format as the app\'s log import and Discord bot. One activity per line: "<time> <name>", e.g.',
        '"930 breakfast", "1:15pm gym", "1430 study". The time is when that activity ENDED; it started when the previous one ended.',
        'The first line starts at the end of the latest event already on that day, or midnight if there is none.',
        'A line "---10am" first makes the log start at 10am instead. Leading-zero times like 0130 are 24-hour.',
        'Lines that would overlap existing events are trimmed around them, and dropped (listed in skipped_lines) when fully covered. Back-to-back lines with the same name, and a first line',
        'matching the event right before it, merge into one event. Tags are guessed from past events with the same name.',
        'Applies immediately. Returns the created events (delete_events undoes them) and any existing event it extended.',
      ].join(' '),
      inputSchema: {
        text: z.string().min(1),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('Day the log is for (YYYY-MM-DD). Default today.'),
      },
    },
    run('mcp.log_activities', async (args: { text: string; date?: string }) => {
      const parsed = await parseLogText(args.text, userId, args.date ?? null, caller.timeZone, dateStrInTimeZone(caller.timeZone));

      // Same folding approve does for a pending import, applied before insert.
      const [neighbour] = await findMergeNeighbour(userId, parsed.events[0].start, parsed.events[0].title);
      const drafts = parsed.events.map((e, i) => ({
        id: -(i + 1),
        startDatetime: e.start,
        endDatetime: e.end,
        title: e.title,
        tag: e.tag || null,
        isPending: 1,
      }));
      const { newEnds, absorbed } = planPendingMerge(neighbour ? [neighbour, ...drafts] : drafts);

      const toInsert = drafts
        .filter((d) => !absorbed.has(d.id))
        .map((d) => ({
          startDatetime: d.startDatetime,
          endDatetime: newEnds.get(d.id) ?? d.endDatetime,
          title: d.title,
          tag: d.tag,
          userId,
          isPending: 0,
        }));
      const extendedEnd = neighbour ? newEnds.get(neighbour.id) : undefined;

      const created = db.transaction((tx) => {
        if (neighbour && extendedEnd) {
          tx.update(events).set({ endDatetime: extendedEnd }).where(eq(events.id, neighbour.id)).run();
        }
        return toInsert.length ? tx.insert(events).values(toInsert).returning().all() : [];
      });
      changed();

      return {
        date: parsed.dateUsed,
        created: created.map((r) => eventOut(r, caller.timeZone)),
        ...(neighbour && extendedEnd
          ? {
              extended: {
                id: neighbour.id,
                title: neighbour.title,
                start: formatToolTime(neighbour.startDatetime, caller.timeZone),
                previous_end: formatToolTime(neighbour.endDatetime, caller.timeZone),
                end: formatToolTime(extendedEnd, caller.timeZone),
              },
            }
          : {}),
        ...(parsed.skipped.length ? { skipped_lines: parsed.skipped, skipped_reason: 'Existing events already cover these lines\' whole time.' } : {}),
        // The "Scheduling starts after" note is in the server's locale and zone; the events say it better.
        notes: parsed.warnings.filter((w) => !w.startsWith('Scheduling starts after')),
      };
    }),
  );

  server.registerTool(
    'set_timezone',
    {
      description: 'Changes the timezone this connection reads and writes times in, e.g. when travelling. Takes an IANA name like "America/New_York".',
      inputSchema: { timezone: z.string() },
      annotations: { idempotentHint: true },
    },
    run('mcp.set_timezone', async ({ timezone }: { timezone: string }) => {
      if (!isValidTimeZone(timezone)) throw new Error(`Unknown timezone "${timezone}". Use an IANA name like "Europe/London".`);
      await setMcpTokenTimeZone(userId, caller.tokenId, timezone);
      caller.timeZone = timezone;
      return { timezone };
    }),
  );

  return server;
}
