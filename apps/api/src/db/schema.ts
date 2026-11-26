import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

// Business tables belong here; LangGraph checkpoint tables are managed separately.
export const appSchema = pgSchema('app');

export const visitors = appSchema.table('visitors', {
  id: uuid('id').primaryKey(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});

export const visitorSessions = appSchema.table(
  'visitor_sessions',
  {
    tokenDigest: text('token_digest').primaryKey(),
    visitorId: uuid('visitor_id')
      .notNull()
      .references(() => visitors.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    index('visitor_sessions_visitor_idx').on(t.visitorId),
    index('visitor_sessions_expiry_idx').on(t.expiresAt),
    check('visitor_sessions_expiry_order', sql`${t.expiresAt} > ${t.createdAt}`),
  ],
);

export const conversations = appSchema.table(
  'conversations',
  {
    id: uuid('id').primaryKey(),
    visitorId: uuid('visitor_id')
      .notNull()
      .references(() => visitors.id, { onDelete: 'cascade' }),
    clientConversationId: uuid('client_conversation_id').notNull(),
    title: text('title').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
    messageCount: integer('message_count').notNull().default(0),
    nextSequence: integer('next_sequence').notNull().default(1),
  },
  (t) => [
    uniqueIndex('conversations_visitor_client_idx').on(t.visitorId, t.clientConversationId),
    index('conversations_visitor_updated_idx').on(t.visitorId, t.updatedAt, t.id),
    check('conversations_count', sql`${t.messageCount} >= 0 AND ${t.nextSequence} > 0`),
  ],
);

export const messages = appSchema.table(
  'messages',
  {
    id: uuid('id').primaryKey(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    clientMessageId: uuid('client_message_id'),
    role: text('role').notNull(),
    content: text('content').notNull(),
    sequence: integer('sequence').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    runId: uuid('run_id').references((): AnyPgColumn => workflowRuns.id, { onDelete: 'set null' }),
    sources: jsonb('sources').notNull().default([]),
  },
  (t) => [
    uniqueIndex('messages_conversation_client_idx').on(t.conversationId, t.clientMessageId),
    uniqueIndex('messages_conversation_sequence_idx').on(t.conversationId, t.sequence),
    uniqueIndex('messages_assistant_run_idx')
      .on(t.runId)
      .where(sql`${t.role} = 'assistant'`),
    check('messages_sequence', sql`${t.sequence} > 0`),
    check('messages_role', sql`${t.role} in ('user', 'assistant', 'system')`),
  ],
);

export const workflowRuns = appSchema.table(
  'workflow_runs',
  {
    id: uuid('id').primaryKey(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    userMessageId: uuid('user_message_id')
      .notNull()
      .references((): AnyPgColumn => messages.id, { onDelete: 'cascade' }),
    status: text('status').notNull().default('queued'),
    input: text('input').notNull(),
    history: jsonb('history').notNull().default([]),
    graphVersion: text('graph_version').notNull().default('qa-v1'),
    leaseToken: uuid('lease_token'),
    leaseUntil: timestamp('lease_until', { withTimezone: true }),
    attempts: integer('attempts').notNull().default(0),
    nextEventSequence: integer('next_event_sequence').notNull().default(1),
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex('workflow_runs_message_idx').on(t.userMessageId),
    uniqueIndex('workflow_runs_active_conversation_idx')
      .on(t.conversationId)
      .where(sql`${t.status} in ('queued', 'running')`),
    index('workflow_runs_claim_idx').on(t.status, t.leaseUntil, t.createdAt),
    index('workflow_runs_conversation_idx').on(t.conversationId, t.createdAt),
    check(
      'workflow_runs_status',
      sql`${t.status} in ('queued', 'running', 'completed', 'failed', 'cancelled')`,
    ),
    check('workflow_runs_counts', sql`${t.attempts} >= 0 AND ${t.nextEventSequence} > 0`),
  ],
);

export const runEvents = appSchema.table(
  'run_events',
  {
    id: uuid('id').primaryKey(),
    runId: uuid('run_id')
      .notNull()
      .references(() => workflowRuns.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    type: text('type').notNull(),
    message: text('message'),
    taskId: text('task_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex('run_events_sequence_idx').on(t.runId, t.seq),
    check('run_events_sequence', sql`${t.seq} > 0`),
  ],
);

export const auctionEvents = appSchema.table(
  'auction_events',
  {
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    city: text('city').notNull(),
    venue: text('venue').notNull(),
    address: text('address').notNull(),
    startsAt: timestamp('starts_at', { withTimezone: true, mode: 'string' }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true, mode: 'string' }).notNull(),
    previewStartsAt: timestamp('preview_starts_at', {
      withTimezone: true,
      mode: 'string',
    }).notNull(),
    previewEndsAt: timestamp('preview_ends_at', { withTimezone: true, mode: 'string' }).notNull(),
    description: text('description').notNull(),
    isDemo: boolean('is_demo').notNull().default(true),
    sourceNote: text('source_note').notNull(),
    sourceUrl: text('source_url'),
  },
  (t) => [
    check('auction_events_time_order', sql`${t.endsAt} > ${t.startsAt}`),
    check('auction_events_preview_order', sql`${t.previewEndsAt} > ${t.previewStartsAt}`),
    index('auction_events_city_start_idx').on(t.city, t.startsAt),
  ],
);

export const auctions = appSchema.table(
  'auctions',
  {
    id: text('id').primaryKey(),
    eventId: text('event_id')
      .notNull()
      .references(() => auctionEvents.id, { onDelete: 'restrict' }),
    title: text('title').notNull(),
    category: text('category').notNull(),
    startsAt: timestamp('starts_at', { withTimezone: true, mode: 'string' }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true, mode: 'string' }).notNull(),
    hall: text('hall').notNull(),
    lotCount: integer('lot_count').notNull(),
    description: text('description').notNull(),
    isDemo: boolean('is_demo').notNull().default(true),
    sourceNote: text('source_note').notNull(),
    sourceUrl: text('source_url'),
  },
  (t) => [
    check('auctions_time_order', sql`${t.endsAt} > ${t.startsAt}`),
    check('auctions_nonnegative_lots', sql`${t.lotCount} >= 0`),
    check(
      'auctions_category',
      sql`${t.category} in ('painting', 'porcelain', 'jewelry', 'wine', 'books', 'contemporary')`,
    ),
    index('auctions_event_start_idx').on(t.eventId, t.startsAt),
    index('auctions_category_start_idx').on(t.category, t.startsAt),
  ],
);
