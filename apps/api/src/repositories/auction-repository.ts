import type { PoolClient } from 'pg';
import {
  auctionEventSchema,
  auctionSessionSchema,
  auctionCategoryLabels,
  type AuctionEvent,
  type AuctionSession,
  type AuctionEventsQuery,
  type AuctionSessionsQuery,
  type AuctionRecommendationsQuery,
  type AuctionRecommendationsResponse,
} from '@gard/contracts';
import { createLazyPool } from '../db/pool.js';

export interface AuctionRepository {
  listEvents(
    query: AuctionEventsQuery,
    now: Date,
  ): Promise<{ data: AuctionEvent[]; total: number }>;
  eventDetail(
    id: string,
    now: Date,
  ): Promise<{ data: AuctionEvent; sessions: AuctionSession[] } | null>;
  listSessions(
    query: AuctionSessionsQuery,
    now: Date,
  ): Promise<{ data: AuctionSession[]; total: number }>;
  sessionDetail(
    id: string,
    now: Date,
  ): Promise<{ data: AuctionSession; event: AuctionEvent } | null>;
  recommendations(
    query: AuctionRecommendationsQuery,
    now: Date,
  ): Promise<AuctionRecommendationsResponse['data']>;
  close(): Promise<void>;
}

const eventColumns = `e.id, e.title, e.city, e.venue, e.address, e.starts_at AS "startsAt", e.ends_at AS "endsAt",
  e.preview_starts_at AS "previewStartsAt", e.preview_ends_at AS "previewEndsAt", e.description,
  e.is_demo AS "isDemo", e.source_note AS "sourceNote", e.source_url AS "sourceUrl",
  (SELECT count(*)::integer FROM app.auctions a WHERE a.event_id=e.id AND a.is_demo=true) AS "sessionCount"`;
const sessionColumns = `a.id, a.event_id AS "eventId", a.title, a.category, a.starts_at AS "startsAt", a.ends_at AS "endsAt",
  a.hall, a.lot_count AS "lotCount", a.description, a.is_demo AS "isDemo", a.source_note AS "sourceNote", a.source_url AS "sourceUrl",
  e.title AS "eventTitle", e.city, e.venue`;
const sessionFrom = 'FROM app.auctions a JOIN app.auction_events e ON e.id=a.event_id';

type DbRow = Record<string, unknown>;
function normalized(row: DbRow, now: Date) {
  const result = { ...row };
  for (const key of ['startsAt', 'endsAt', 'previewStartsAt', 'previewEndsAt']) {
    const value = result[key];
    if (value instanceof Date) result[key] = value.toISOString();
  }
  const startsAt = new Date(String(result.startsAt)).getTime();
  const endsAt = new Date(String(result.endsAt)).getTime();
  result.status =
    now.getTime() < startsAt ? 'upcoming' : now.getTime() >= endsAt ? 'ended' : 'ongoing';
  return result;
}
function event(row: DbRow, now: Date) {
  return auctionEventSchema.parse(normalized(row, now));
}
function session(row: DbRow, now: Date) {
  return auctionSessionSchema.parse(normalized(row, now));
}

class Conditions {
  values: unknown[] = [];
  clauses: string[];
  constructor(initial: string[]) {
    this.clauses = [...initial];
  }
  parameter(value: unknown) {
    this.values.push(value);
    return `$${this.values.length}`;
  }
  equals(column: string, value: string | undefined) {
    if (value !== undefined) this.clauses.push(`${column}=${this.parameter(value)}`);
  }
  search(columns: string[], value: string | undefined) {
    if (!value) return;
    const pattern = this.parameter(`%${value.replace(/[\\%_]/g, '\\$&')}%`);
    this.clauses.push(`(${columns.map((column) => `${column} ILIKE ${pattern}`).join(' OR ')})`);
  }
  status(alias: string, status: string | undefined, now: Date) {
    if (!status) return;
    const time = this.parameter(now);
    if (status === 'upcoming') this.clauses.push(`${alias}.starts_at > ${time}`);
    else if (status === 'ongoing')
      this.clauses.push(`${alias}.starts_at <= ${time} AND ${alias}.ends_at > ${time}`);
    else this.clauses.push(`${alias}.ends_at <= ${time}`);
  }
  get where() {
    return `WHERE ${this.clauses.join(' AND ')}`;
  }
}

export function createAuctionRepository(getUrl?: () => string | undefined): AuctionRepository {
  const pool = createLazyPool(getUrl);
  async function read<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await pool.get().connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const result = await operation(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }
  async function getEvent(client: PoolClient, id: string, now: Date) {
    const result = await client.query<DbRow>(
      `SELECT ${eventColumns} FROM app.auction_events e WHERE e.id=$1 AND e.is_demo=true`,
      [id],
    );
    return result.rows[0] ? event(result.rows[0], now) : null;
  }
  return {
    close: () => pool.close(),
    listEvents: (query, now) =>
      read(async (client) => {
        const c = new Conditions(['e.is_demo=true']);
        c.equals('e.city', query.city);
        c.search(['e.title', 'e.description'], query.q);
        c.status('e', query.status, now);
        const count = await client.query<{ total: number }>(
          `SELECT count(*)::integer AS total FROM app.auction_events e ${c.where}`,
          c.values,
        );
        const rows = await client.query<DbRow>(
          `SELECT ${eventColumns} FROM app.auction_events e ${c.where} ORDER BY e.starts_at ASC,e.id ASC LIMIT ${c.parameter(query.pageSize)} OFFSET ${c.parameter((query.page - 1) * query.pageSize)}`,
          c.values,
        );
        return { data: rows.rows.map((row) => event(row, now)), total: count.rows[0]?.total ?? 0 };
      }),
    eventDetail: (id, now) =>
      read(async (client) => {
        const data = await getEvent(client, id, now);
        if (!data) return null;
        const rows = await client.query<DbRow>(
          `SELECT ${sessionColumns} ${sessionFrom} WHERE a.event_id=$1 AND a.is_demo=true AND e.is_demo=true ORDER BY a.starts_at,a.id`,
          [id],
        );
        return { data, sessions: rows.rows.map((row) => session(row, now)) };
      }),
    listSessions: (query, now) =>
      read(async (client) => {
        const c = new Conditions(['a.is_demo=true', 'e.is_demo=true']);
        c.equals('e.city', query.city);
        c.equals('a.category', query.category);
        c.equals('a.event_id', query.eventId);
        c.search(['a.title', 'a.description', 'e.title'], query.q);
        c.status('a', query.status, now);
        if (query.dateFrom)
          c.clauses.push(
            `a.starts_at >= ${c.parameter(new Date(`${query.dateFrom}T00:00:00+08:00`))}`,
          );
        if (query.dateTo)
          c.clauses.push(
            `a.starts_at < ${c.parameter(new Date(new Date(`${query.dateTo}T00:00:00+08:00`).getTime() + 86400000))}`,
          );
        const count = await client.query<{ total: number }>(
          `SELECT count(*)::integer AS total ${sessionFrom} ${c.where}`,
          c.values,
        );
        const direction = query.sort === 'startDesc' ? 'DESC' : 'ASC';
        const rows = await client.query<DbRow>(
          `SELECT ${sessionColumns} ${sessionFrom} ${c.where} ORDER BY a.starts_at ${direction},a.id ASC LIMIT ${c.parameter(query.pageSize)} OFFSET ${c.parameter((query.page - 1) * query.pageSize)}`,
          c.values,
        );
        return {
          data: rows.rows.map((row) => session(row, now)),
          total: count.rows[0]?.total ?? 0,
        };
      }),
    sessionDetail: (id, now) =>
      read(async (client) => {
        const rows = await client.query<DbRow>(
          `SELECT ${sessionColumns} ${sessionFrom} WHERE a.id=$1 AND a.is_demo=true AND e.is_demo=true`,
          [id],
        );
        if (!rows.rows[0]) return null;
        const data = session(rows.rows[0], now);
        const parent = await getEvent(client, data.eventId, now);
        return parent ? { data, event: parent } : null;
      }),
    recommendations: (query, now) =>
      read(async (client) => {
        const c = new Conditions(['a.is_demo=true', 'e.is_demo=true']);
        c.equals('e.city', query.city);
        c.equals('a.category', query.category);
        const time = c.parameter(now);
        c.clauses.push(`a.ends_at > ${time}`);
        const rows = await client.query<DbRow>(
          `SELECT ${sessionColumns} ${sessionFrom} ${c.where} ORDER BY CASE WHEN a.starts_at <= ${time} THEN 0 ELSE 1 END,a.starts_at,a.id LIMIT ${c.parameter(query.limit)}`,
          c.values,
        );
        return rows.rows.map((row) => {
          const item = session(row, now);
          const reasons = [
            item.status === 'ongoing' ? '该演示拍场正在进行' : '按开拍时间优先推荐近期演示拍场',
          ];
          if (query.city) reasons.push(`符合城市：${query.city}`);
          if (query.category) reasons.push(`符合类别：${auctionCategoryLabels[query.category]}`);
          return { session: item, reasons };
        });
      }),
  };
}
