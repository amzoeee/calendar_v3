import { sqliteTable, text, integer, unique } from 'drizzle-orm/sqlite-core';
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
