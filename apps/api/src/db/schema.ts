import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, pgSchema, text, timestamp } from 'drizzle-orm/pg-core';

// Only the catalogue belongs here; LangGraph checkpoint tables are managed separately.
export const appSchema = pgSchema('app');

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
