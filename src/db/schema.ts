import { sqliteTable, text, integer, unique, primaryKey } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
});

export const tags = sqliteTable('tags', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  color: text('color').notNull(),
  orderIndex: integer('order_index').notNull(),
  userId: integer('user_id').notNull().references(() => users.id),
  isArchived: integer('is_archived').notNull().default(0),
  // Which pickers this tag appears in: event | task | both. Existing tags
  // default to 'both' so nothing disappears when tasks arrive.
  scope: text('scope').notNull().default('both'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
}, (t) => ({
  nameUserUnique: unique().on(t.name, t.userId),
}));

export const events = sqliteTable('events', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  startDatetime: text('start_datetime').notNull(),
  endDatetime: text('end_datetime').notNull(),
  title: text('title').notNull(),
  description: text('description'),
  tag: text('tag'),
  userId: integer('user_id').notNull().references(() => users.id),
  recurrenceId: text('recurrence_id'),
  rrule: text('rrule'),
  originalStart: text('original_start'),
  isPending: integer('is_pending').notNull().default(0),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
});

// ==========================================
// Tasks
// ==========================================

export const taskBoards = sqliteTable('task_boards', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  orderIndex: integer('order_index').notNull(),
  // manual | alpha | created | remind | deadline
  sortMode: text('sort_mode').notNull().default('manual'),
  userId: integer('user_id').notNull().references(() => users.id),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
});

// A single table for tasks and subtasks: `parentId` is a self-reference, so the
// shape is a tree of any depth. Only one level of nesting is *allowed* today —
// that limit lives in MAX_TASK_DEPTH (src/lib/tasks.ts), not in the schema, so
// lifting it later doesn't need a migration. `orderIndex` is scoped to
// (boardId, parentId): siblings order among themselves, not board-wide.
//
// The deadline/reminder/recurrence columns are declared here but not yet
// written by any action — creating the table once is kinder to the deployed
// SQLite file than four ALTERs across the phases that fill them in.
export const tasks = sqliteTable('tasks', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull().references(() => users.id),
  boardId: integer('board_id').notNull().references(() => taskBoards.id),
  parentId: integer('parent_id'),
  depth: integer('depth').notNull().default(0),
  orderIndex: integer('order_index').notNull(),

  title: text('title').notNull(),
  description: text('description'),

  // Pacific wall-clock strings, same convention as events.
  dueDatetime: text('due_datetime'),
  dueHasTime: integer('due_has_time').notNull().default(0),

  // Materialised from the offset below whenever the deadline changes, so the
  // reminder scheduler stays a plain indexed comparison.
  remindAt: text('remind_at'),
  remindOffsetMinutes: integer('remind_offset_minutes'),
  remindOffsetDays: integer('remind_offset_days'),
  remindTimeOfDay: text('remind_time_of_day'),

  isStarred: integer('is_starred').notNull().default(0),
  completedAt: text('completed_at'),

  // Rolling recurrence: one row per series, advanced on completion.
  rrule: text('rrule'),
  counterValue: integer('counter_value'),
  counterEnd: integer('counter_end'),

  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
});

// Keyed by tag id rather than name, so renaming a tag costs nothing here.
// (events.tag stores the name and cascades renames instead — the older
// convention, not one worth repeating.)
export const taskTags = sqliteTable('task_tags', {
  taskId: integer('task_id').notNull().references(() => tasks.id),
  tagId: integer('tag_id').notNull().references(() => tags.id),
}, (t) => ({
  pk: primaryKey({ columns: [t.taskId, t.tagId] }),
}));

// Append-only completion history, and the source of truth for task stats.
// tasks.completedAt is *state* ("is this done right now"); this is *history*.
// The two aren't redundant: a rolling recurring task clears completedAt every
// time it advances, so without this table its past completions would vanish.
export const taskCompletions = sqliteTable('task_completions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull().references(() => users.id),
  taskId: integer('task_id').notNull().references(() => tasks.id),
  completedAt: text('completed_at').notNull(),
  titleSnapshot: text('title_snapshot').notNull(),
});
