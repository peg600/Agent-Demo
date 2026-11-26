import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { auctionEventRecordSchema, auctionSessionRecordSchema } from '@gard/contracts';
import { loadRootEnv } from '../config.js';
import { auctionEvents, auctions } from './schema.js';
import { demoEvents, demoSessions } from './seeds/catalog.js';

function validateCatalogue() {
  const events = demoEvents.map((row) => auctionEventRecordSchema.parse(row));
  const sessions = demoSessions.map((row) => auctionSessionRecordSchema.parse(row));
  if (
    new Set(events.map((row) => row.id)).size !== events.length ||
    new Set(sessions.map((row) => row.id)).size !== sessions.length
  ) {
    throw new Error('Demo seed contains duplicate identifiers.');
  }
  for (const event of events) {
    if (
      Date.parse(event.startsAt) >= Date.parse(event.endsAt) ||
      Date.parse(event.previewStartsAt) >= Date.parse(event.previewEndsAt)
    ) {
      throw new Error(`Demo event has invalid time bounds: ${event.id}`);
    }
  }
  for (const session of sessions) {
    const event = events.find((row) => row.id === session.eventId);
    if (
      !event ||
      Date.parse(session.startsAt) >= Date.parse(session.endsAt) ||
      Date.parse(session.startsAt) < Date.parse(event.startsAt) ||
      Date.parse(session.endsAt) > Date.parse(event.endsAt)
    ) {
      throw new Error(`Demo session has invalid event or time bounds: ${session.id}`);
    }
  }
  return { events, sessions };
}

loadRootEnv();
const { events, sessions } = validateCatalogue();
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('Set DATABASE_URL before seeding the catalogue.');
const pool = new Pool({
  connectionString,
  max: 1,
  connectionTimeoutMillis: 3000,
  statement_timeout: 10000,
});
pool.on('error', () => {});
try {
  await drizzle(pool).transaction(async (tx) => {
    // Serializes concurrent invocations of this seed without locking unrelated data.
    await tx.execute(`SELECT pg_advisory_xact_lock(2061127, 6)`);
    for (const row of events) {
      const saved = await tx
        .insert(auctionEvents)
        .values(row)
        .onConflictDoUpdate({
          target: auctionEvents.id,
          set: row,
          setWhere: eq(auctionEvents.isDemo, true),
        })
        .returning({ id: auctionEvents.id });
      if (saved.length !== 1) throw new Error(`Refusing to overwrite non-demo event: ${row.id}`);
    }
    for (const row of sessions) {
      const saved = await tx
        .insert(auctions)
        .values(row)
        .onConflictDoUpdate({
          target: auctions.id,
          set: row,
          setWhere: eq(auctions.isDemo, true),
        })
        .returning({ id: auctions.id });
      if (saved.length !== 1) throw new Error(`Refusing to overwrite non-demo session: ${row.id}`);
    }
  });
  console.info(`Seeded ${events.length} demo events and ${sessions.length} demo sessions.`);
} catch {
  // Never print DB driver errors, which may include credentials or SQL parameters.
  console.error(
    'Catalogue seed failed. Check DATABASE_URL, database migrations and existing non-demo IDs. No transaction changes were committed.',
  );
  process.exitCode = 1;
} finally {
  await pool.end();
}
