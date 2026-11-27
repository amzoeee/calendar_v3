import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getEventsOverlapping, searchEvents } from '@/features/events/server/queries';
import type { EventRow } from '@/features/events/server/mutations';
import { getTags } from '@/features/tags/server/queries';
import type { McpCaller } from '@/lib/mcp-tokens';
import { track } from '@/lib/usage';
import type { UsageName } from '@/lib/usage-catalog';
import { timeStats } from './stats';
import { formatToolTime, nowContext, parseToolTime } from './time';

const MAX_EVENTS = 1500;

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

  return server;
}
