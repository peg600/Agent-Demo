import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import {
  answerSourceSchema,
  runEventSchema,
  workflowRunSchema,
  type WorkflowRun,
} from '@gard/contracts';
import type { AgentEvent, WorkflowRepository } from '../agent/ports.js';
import { createLazyPool } from '../db/pool.js';
import { ConversationError, unauthenticated } from './conversation-repository.js';

const missing = () => new ConversationError(404, 'RUN_NOT_FOUND', '未找到该运行。');
const columns =
  'r.id, r.conversation_id AS "conversationId", r.user_message_id AS "userMessageId", r.status, r.created_at AS "createdAt", r.updated_at AS "updatedAt", r.error_code AS "errorCode", r.error_message AS "errorMessage", r.next_event_sequence - 1 AS "lastEventSequence"';
type RunRow = Omit<WorkflowRun, 'createdAt' | 'updatedAt'> & { createdAt: Date; updatedAt: Date };
function run(row: RunRow): WorkflowRun {
  return workflowRunSchema.parse({
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}
const historySchema = z
  .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(4000) }))
  .max(20);
const answerSchema = z.object({
  answer: z.string().min(1).max(20000),
  sources: z.array(answerSourceSchema).max(50),
});

export function createWorkflowRepository(pool = createLazyPool()): WorkflowRepository {
  async function transaction<T>(
    work: (client: PoolClient) => Promise<T>,
    readOnly = false,
  ): Promise<T> {
    const client = await pool.get().connect();
    try {
      await client.query(readOnly ? 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY' : 'BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
  async function owner(client: PoolClient, digest: string, now: Date) {
    const result = await client.query<{ id: string }>(
      'SELECT visitor_id AS id FROM app.visitor_sessions WHERE token_digest = $1 AND expires_at > $2',
      [digest, now],
    );
    if (!result.rows[0]) throw unauthenticated();
    return result.rows[0].id;
  }
  async function owned(client: PoolClient, digest: string, id: string, now: Date, lock = false) {
    const visitor = await owner(client, digest, now);
    const result = await client.query<RunRow>(
      `SELECT ${columns} FROM app.workflow_runs r JOIN app.conversations c ON c.id = r.conversation_id WHERE r.id = $1 AND c.visitor_id = $2${lock ? ' FOR UPDATE OF r' : ''}`,
      [id, visitor],
    );
    if (!result.rows[0]) throw missing();
    return result.rows[0];
  }
  async function event(client: PoolClient, id: string, data: AgentEvent, now: Date) {
    const parsed = runEventSchema
      .omit({ id: true, runId: true, seq: true, createdAt: true })
      .parse(data);
    const sequence = await client.query<{ seq: number }>(
      'UPDATE app.workflow_runs SET next_event_sequence = next_event_sequence + 1, updated_at = GREATEST(updated_at, $2) WHERE id = $1 RETURNING next_event_sequence - 1 AS seq',
      [id, now],
    );
    await client.query(
      'INSERT INTO app.run_events (id, run_id, seq, type, message, task_id, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [randomUUID(), id, sequence.rows[0]!.seq, parsed.type, parsed.message, parsed.taskId, now],
    );
  }
  async function leased(client: PoolClient, id: string, token: string, now: Date) {
    const result = await client.query<{ conversationId: string }>(
      'SELECT conversation_id AS "conversationId" FROM app.workflow_runs WHERE id = $1 AND lease_token = $2 AND status = \'running\' AND lease_until > $3 FOR UPDATE',
      [id, token, now],
    );
    return result.rows[0];
  }
  async function failed(client: PoolClient, id: string, code: string, message: string, now: Date) {
    await client.query(
      "UPDATE app.workflow_runs SET status = 'failed', error_code = $2, error_message = $3, lease_token = NULL, lease_until = NULL, updated_at = GREATEST(updated_at, $4) WHERE id = $1",
      [id, code, message, now],
    );
    await event(client, id, { type: 'run.failed', message, taskId: null }, now);
  }
  return {
    detail(digest, id, now) {
      return transaction(async (client) => run(await owned(client, digest, id, now)), true);
    },
    list(digest, conversationId, now) {
      return transaction(async (client) => {
        const visitor = await owner(client, digest, now);
        const conversation = await client.query(
          'SELECT id FROM app.conversations WHERE id = $1 AND visitor_id = $2',
          [conversationId, visitor],
        );
        if (!conversation.rows[0]) throw missing();
        const result = await client.query<RunRow>(
          `SELECT ${columns} FROM app.workflow_runs r WHERE r.conversation_id = $1 ORDER BY (r.status IN ('queued', 'running')) DESC, r.created_at DESC, r.id DESC LIMIT 20`,
          [conversationId],
        );
        return result.rows.map(run);
      }, true);
    },
    events(digest, id, after, now) {
      return transaction(async (client) => {
        const current = await owned(client, digest, id, now);
        if (!Number.isInteger(after) || after < 0 || after > current.lastEventSequence)
          throw new ConversationError(
            400,
            'INVALID_EVENT_CURSOR',
            '事件游标无效，请重新读取运行状态。',
          );
        const events = await client.query<{
          id: string;
          runId: string;
          seq: number;
          type: string;
          message: string | null;
          taskId: string | null;
          createdAt: Date;
        }>(
          'SELECT id, run_id AS "runId", seq, type, message, task_id AS "taskId", created_at AS "createdAt" FROM app.run_events WHERE run_id = $1 AND seq > $2 ORDER BY seq ASC LIMIT 100',
          [id, after],
        );
        return {
          data: events.rows.map((row) =>
            runEventSchema.parse({ ...row, createdAt: row.createdAt.toISOString() }),
          ),
          run: run(current),
        };
      }, true);
    },
    cancel(digest, id, now) {
      return transaction(async (client) => {
        const current = await owned(client, digest, id, now, true);
        if (!['queued', 'running'].includes(current.status)) return run(current);
        await client.query(
          "UPDATE app.workflow_runs SET status = 'cancelled', lease_token = NULL, lease_until = NULL WHERE id = $1",
          [id],
        );
        await event(
          client,
          id,
          { type: 'run.cancelled', message: '任务已取消。', taskId: null },
          now,
        );
        const result = await client.query<RunRow>(
          `SELECT ${columns} FROM app.workflow_runs r WHERE r.id = $1`,
          [id],
        );
        return run(result.rows[0]!);
      });
    },
    claim(now, leaseSeconds) {
      return transaction(async (client) => {
        // Bound the scan per tick; invalid/poisoned runs cannot block later work forever.
        for (let scanned = 0; scanned < 10; scanned++) {
          const result = await client.query<{
            id: string;
            conversationId: string;
            input: string;
            history: unknown;
            attempts: number;
            graphVersion: string;
          }>(
            'SELECT id, conversation_id AS "conversationId", input, history, attempts, graph_version AS "graphVersion" FROM app.workflow_runs WHERE status = \'queued\' OR (status = \'running\' AND lease_until <= $1) ORDER BY created_at, id FOR UPDATE SKIP LOCKED LIMIT 1',
            [now],
          );
          const row = result.rows[0];
          if (!row) return null;
          if (row.attempts >= 3 || row.graphVersion !== 'qa-v1') {
            await failed(
              client,
              row.id,
              row.attempts >= 3 ? 'RECOVERY_EXHAUSTED' : 'GRAPH_VERSION_UNSUPPORTED',
              '任务无法继续恢复，请重新发送问题。',
              now,
            );
            continue;
          }
          const history = historySchema.safeParse(row.history);
          if (
            !history.success ||
            row.input.length > 4000 ||
            history.data.reduce((length, turn) => length + turn.content.length, 0) > 20000
          ) {
            await failed(
              client,
              row.id,
              'INVALID_RUN_INPUT',
              '任务输入不可用，请重新发送问题。',
              now,
            );
            continue;
          }
          const token = randomUUID();
          const until = new Date(now.getTime() + leaseSeconds * 1000);
          await client.query(
            "UPDATE app.workflow_runs SET status = 'running', lease_token = $2, lease_until = $3, attempts = attempts + 1, updated_at = GREATEST(updated_at, $4) WHERE id = $1",
            [row.id, token, until, now],
          );
          await event(
            client,
            row.id,
            {
              type: 'run.started',
              message: row.attempts ? '正在恢复任务。' : '开始处理问题。',
              taskId: null,
            },
            now,
          );
          return {
            runId: row.id,
            conversationId: row.conversationId,
            input: row.input,
            history: history.data,
            leaseToken: token,
            attempt: row.attempts + 1,
          };
        }
        return null;
      });
    },
    heartbeat(id, token, now, leaseSeconds) {
      return transaction(async (client) => {
        if (!(await leased(client, id, token, now))) return false;
        await client.query('UPDATE app.workflow_runs SET lease_until = $2 WHERE id = $1', [
          id,
          new Date(now.getTime() + leaseSeconds * 1000),
        ]);
        return true;
      });
    },
    append(id, token, data, now) {
      return transaction(async (client) => {
        if (!(await leased(client, id, token, now))) return false;
        await event(client, id, data, now);
        return true;
      });
    },
    complete(id, token, answer, now) {
      const parsed = answerSchema.parse(answer);
      return transaction(async (client) => {
        const current = await leased(client, id, token, now);
        if (!current) return false;
        const conversation = await client.query<{ sequence: number }>(
          'SELECT next_sequence AS sequence FROM app.conversations WHERE id = $1 FOR UPDATE',
          [current.conversationId],
        );
        const sequence = conversation.rows[0]?.sequence;
        if (!sequence || sequence >= 2147483647)
          throw new ConversationError(409, 'CONVERSATION_FULL', '会话已达到消息数量上限。');
        await client.query(
          "INSERT INTO app.messages (id, conversation_id, role, content, sequence, created_at, run_id, sources) VALUES ($1, $2, 'assistant', $3, $4, $5, $6, $7::jsonb)",
          [
            randomUUID(),
            current.conversationId,
            parsed.answer,
            sequence,
            now,
            id,
            JSON.stringify(parsed.sources),
          ],
        );
        await client.query(
          'UPDATE app.conversations SET next_sequence = next_sequence + 1, message_count = message_count + 1, updated_at = GREATEST(updated_at, $2) WHERE id = $1',
          [current.conversationId, now],
        );
        await client.query(
          "UPDATE app.workflow_runs SET status = 'completed', lease_token = NULL, lease_until = NULL WHERE id = $1",
          [id],
        );
        // Persist delivery with the final message; recovery never replays uncommitted text.
        await event(
          client,
          id,
          { type: 'answer.delta', message: parsed.answer, taskId: null },
          now,
        );
        for (const source of parsed.sources) {
          await event(client, id, { type: 'source', message: source.title, taskId: null }, now);
        }
        await event(
          client,
          id,
          { type: 'run.completed', message: '回答已保存。', taskId: null },
          now,
        );
        return true;
      });
    },
    fail(id, token, code, message, now) {
      return transaction(async (client) => {
        if (!(await leased(client, id, token, now))) return false;
        await failed(client, id, code.slice(0, 100), message.slice(0, 1000), now);
        return true;
      });
    },
    close: () => pool.close(),
  };
}
