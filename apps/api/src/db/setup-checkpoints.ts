import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';
import { Pool } from 'pg';
import { loadRootEnv } from '../config.js';

loadRootEnv();
const connectionString = process.env.CHECKPOINT_DATABASE_URL;
if (!connectionString) throw new Error('CHECKPOINT_DATABASE_URL is required.');
const pool = new Pool({
  connectionString,
  max: 1,
  connectionTimeoutMillis: 3000,
  query_timeout: 30000,
});
const saver = new PostgresSaver(pool, undefined, { schema: 'workflow' });
try {
  await saver.setup();
  process.stdout.write('Workflow checkpoint schema initialized.\n');
} catch {
  process.stderr.write('Checkpoint initialization failed; check local database settings.\n');
  process.exitCode = 1;
} finally {
  await pool.end();
}
