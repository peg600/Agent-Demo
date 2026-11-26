import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type {
  Conversation,
  ConversationMessage,
  ConversationListQuery,
  ConversationListResponse,
  CreateConversationInput,
  CreateConversationResponse,
  SendMessageInput,
  SendMessageResponse,
  MessageListQuery,
  MessageListResponse,
} from '@gard/contracts';
import { createLazyPool } from '../db/pool.js';

export class ConversationError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
export const unauthenticated = () =>
  new ConversationError(401, 'SESSION_REQUIRED', '访客身份已失效，请重新建立会话。');
export const notFound = () =>
  new ConversationError(404, 'CONVERSATION_NOT_FOUND', '未找到该会话。');
export const conflict = () =>
  new ConversationError(409, 'IDEMPOTENCY_CONFLICT', '重试标识已用于不同内容，请使用新的标识。');

export interface ConversationRepository {
  establishSession(
    existingDigest: string | undefined,
    newDigest: string,
    now: Date,
    expiresAt: Date,
  ): Promise<{ reused: boolean; expiresAt: string }>;
  create(
    digest: string,
    input: CreateConversationInput,
    now: Date,
  ): Promise<CreateConversationResponse>;
  list(digest: string, query: ConversationListQuery, now: Date): Promise<ConversationListResponse>;
  detail(digest: string, id: string, now: Date): Promise<Conversation>;
  send(
    digest: string,
    id: string,
    input: SendMessageInput,
    now: Date,
  ): Promise<SendMessageResponse>;
  history(
    digest: string,
    id: string,
    query: MessageListQuery,
    now: Date,
  ): Promise<MessageListResponse>;
  close(): Promise<void>;
}

type ConversationRow = Omit<Conversation, 'createdAt' | 'updatedAt'> & {
  createdAt: Date;
  updatedAt: Date;
  nextSequence: number;
};
type MessageRow = Omit<ConversationMessage, 'createdAt'> & { createdAt: Date };
const conversationColumns =
  'id, title, created_at AS "createdAt", updated_at AS "updatedAt", message_count AS "messageCount", next_sequence AS "nextSequence"';
const messageColumns =
  'id, conversation_id AS "conversationId", client_message_id AS "clientMessageId", role, content, sequence, created_at AS "createdAt", run_id AS "runId", sources';
const conversation = (row: ConversationRow): Conversation => ({
  id: row.id,
  title: row.title,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
  messageCount: row.messageCount,
});
const message = (row: MessageRow): ConversationMessage => ({
  ...row,
  createdAt: row.createdAt.toISOString(),
});

export function createConversationRepository(pool = createLazyPool()): ConversationRepository {
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
  async function authenticated<T>(
    digest: string,
    now: Date,
    work: (client: PoolClient, owner: string) => Promise<T>,
    readOnly = false,
  ) {
    return transaction(async (client) => {
      const auth = await client.query<{ visitorId: string }>(
        'SELECT visitor_id AS "visitorId" FROM app.visitor_sessions WHERE token_digest = $1 AND expires_at > $2',
        [digest, now],
      );
      const owner = auth.rows[0]?.visitorId;
      if (!owner) throw unauthenticated();
      return work(client, owner);
    }, readOnly);
  }
  async function owned(client: PoolClient, owner: string, id: string, lock = false) {
    const found = await client.query<ConversationRow>(
      `SELECT ${conversationColumns} FROM app.conversations WHERE id = $1 AND visitor_id = $2${lock ? ' FOR UPDATE' : ''}`,
      [id, owner],
    );
    const row = found.rows[0];
    if (!row) throw notFound();
    return row;
  }
  return {
    establishSession(existingDigest, newDigest, now, expiresAt) {
      return transaction(async (client) => {
        if (existingDigest) {
          const existing = await client.query<{ expiresAt: Date }>(
            'SELECT expires_at AS "expiresAt" FROM app.visitor_sessions WHERE token_digest = $1 AND expires_at > $2',
            [existingDigest, now],
          );
          if (existing.rows[0])
            return { reused: true, expiresAt: existing.rows[0].expiresAt.toISOString() };
        }
        const owner = randomUUID();
        await client.query('INSERT INTO app.visitors (id, created_at) VALUES ($1, $2)', [
          owner,
          now,
        ]);
        await client.query(
          'INSERT INTO app.visitor_sessions (token_digest, visitor_id, created_at, expires_at) VALUES ($1, $2, $3, $4)',
          [newDigest, owner, now, expiresAt],
        );
        return { reused: false, expiresAt: expiresAt.toISOString() };
      });
    },
    create(digest, input, now) {
      return authenticated(digest, now, async (client, owner) => {
        // Serialize creation per owner, including retries with the same client ID.
        await client.query('SELECT id FROM app.visitors WHERE id = $1 FOR UPDATE', [owner]);
        const existing = await client.query<ConversationRow>(
          `SELECT ${conversationColumns} FROM app.conversations WHERE visitor_id = $1 AND client_conversation_id = $2`,
          [owner, input.clientConversationId],
        );
        const previous = existing.rows[0];
        if (previous) {
          if (previous.title !== input.title) throw conflict();
          return { data: conversation(previous), duplicate: true };
        }
        const inserted = await client.query<ConversationRow>(
          `INSERT INTO app.conversations (id, visitor_id, client_conversation_id, title, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $5) RETURNING ${conversationColumns}`,
          [randomUUID(), owner, input.clientConversationId, input.title, now],
        );
        return { data: conversation(inserted.rows[0]!), duplicate: false };
      });
    },
    list(digest, query, now) {
      return authenticated(
        digest,
        now,
        async (client, owner) => {
          const total = await client.query<{ count: number }>(
            'SELECT COUNT(*)::integer AS count FROM app.conversations WHERE visitor_id = $1',
            [owner],
          );
          const rows = await client.query<ConversationRow>(
            `SELECT ${conversationColumns} FROM app.conversations WHERE visitor_id = $1 ORDER BY updated_at DESC, id DESC LIMIT $2 OFFSET $3`,
            [owner, query.pageSize, (query.page - 1) * query.pageSize],
          );
          return {
            data: rows.rows.map(conversation),
            total: total.rows[0]!.count,
            page: query.page,
            pageSize: query.pageSize,
          };
        },
        true,
      );
    },
    detail(digest, id, now) {
      return authenticated(
        digest,
        now,
        async (client, owner) => conversation(await owned(client, owner, id)),
        true,
      );
    },
    send(digest, id, input, now) {
      return authenticated(digest, now, async (client, owner) => {
        const current = await owned(client, owner, id, true);
        const existing = await client.query<MessageRow>(
          `SELECT ${messageColumns} FROM app.messages WHERE conversation_id = $1 AND client_message_id = $2`,
          [id, input.clientMessageId],
        );
        const previous = existing.rows[0];
        if (previous) {
          if (previous.content !== input.content) throw conflict();
          return {
            data: message(previous),
            duplicate: true,
            processing: previous.runId ? 'queued' : 'not_configured',
            runId: previous.runId,
          };
        }
        const active = await client.query(
          "SELECT id FROM app.workflow_runs WHERE conversation_id = $1 AND status IN ('queued', 'running')",
          [id],
        );
        if (active.rowCount)
          throw new ConversationError(
            409,
            'RUN_ACTIVE',
            '当前会话还有任务正在处理，请等待完成或取消后再发送。',
          );
        if (current.nextSequence >= 2147483647)
          throw new ConversationError(
            409,
            'CONVERSATION_FULL',
            '该会话已达到消息数量上限，请新建会话。',
          );
        // Snapshot only prior turns, bounded independently of the model context window.
        const recent = await client.query<{ role: 'user' | 'assistant'; content: string }>(
          "SELECT role, LEFT(content, 4000) AS content FROM app.messages WHERE conversation_id = $1 AND role IN ('user', 'assistant') ORDER BY sequence DESC LIMIT 20",
          [id],
        );
        let remaining = 20000;
        const history = recent.rows
          .map((turn) => {
            const content = turn.content.slice(0, remaining);
            remaining -= content.length;
            return { role: turn.role, content };
          })
          .filter((turn) => turn.content.length > 0)
          .reverse();
        const inserted = await client.query<MessageRow>(
          `INSERT INTO app.messages (id, conversation_id, client_message_id, role, content, sequence, created_at) VALUES ($1, $2, $3, 'user', $4, $5, $6) RETURNING ${messageColumns}`,
          [randomUUID(), id, input.clientMessageId, input.content, current.nextSequence, now],
        );
        const runId = randomUUID();
        await client.query(
          'INSERT INTO app.workflow_runs (id, conversation_id, user_message_id, input, history, created_at, updated_at) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $6)',
          [runId, id, inserted.rows[0]!.id, input.content, JSON.stringify(history), now],
        );
        await client.query('UPDATE app.messages SET run_id = $2 WHERE id = $1', [
          inserted.rows[0]!.id,
          runId,
        ]);
        inserted.rows[0]!.runId = runId;
        await client.query(
          'UPDATE app.conversations SET next_sequence = next_sequence + 1, message_count = message_count + 1, updated_at = GREATEST(updated_at, $3) WHERE id = $1 AND visitor_id = $2',
          [id, owner, now],
        );
        return { data: message(inserted.rows[0]!), duplicate: false, processing: 'queued', runId };
      });
    },
    history(digest, id, query, now) {
      return authenticated(
        digest,
        now,
        async (client, owner) => {
          await owned(client, owner, id);
          const rows = await client.query<MessageRow>(
            `SELECT ${messageColumns} FROM app.messages WHERE conversation_id = $1 AND ($2::integer IS NULL OR sequence < $2) ORDER BY sequence DESC LIMIT $3`,
            [id, query.beforeSequence ?? null, query.limit + 1],
          );
          const hasMore = rows.rows.length > query.limit;
          const data = rows.rows.slice(0, query.limit).reverse().map(message);
          return { data, hasMore, nextBeforeSequence: hasMore ? data[0]!.sequence : null };
        },
        true,
      );
    },
    close: () => pool.close(),
  };
}
