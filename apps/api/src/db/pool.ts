import { Pool } from 'pg';

export class CatalogueUnavailableError extends Error {
  constructor() {
    super('Auction catalogue database is unavailable.');
  }
}

// Construction is lazy: /health/live remains usable before database setup.
export function createLazyPool(getUrl: () => string | undefined = () => process.env.DATABASE_URL) {
  let pool: Pool | undefined;
  return {
    get() {
      if (!pool) {
        const connectionString = getUrl();
        if (!connectionString) throw new CatalogueUnavailableError();
        pool = new Pool({
          connectionString,
          max: 5,
          connectionTimeoutMillis: 3000,
          idleTimeoutMillis: 30000,
          statement_timeout: 5000,
          query_timeout: 6000,
        });
        // Handle errors from idle clients; failed requests are reported by the route.
        pool.on('error', () => {});
      }
      return pool;
    },
    async close() {
      if (pool) await pool.end();
    },
  };
}
