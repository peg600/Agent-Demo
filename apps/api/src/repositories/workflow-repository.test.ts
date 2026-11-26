import { describe, expect, it, vi } from 'vitest';
import { createWorkflowRepository } from './workflow-repository.js';
import { createConversationRepository } from './conversation-repository.js';

// Driver doubles verify transaction boundaries, not PostgreSQL locking or SQL execution.
function driver(reply: (sql: string, values: unknown[]) => unknown[]) {
  const query = vi.fn(async (sql: string, values: unknown[] = []) => {
    const rows = reply(sql, values);
    return { rows, rowCount: rows.length };
  });
  const release = vi.fn();
  const pool = {
    get: () => ({ connect: async () => ({ query, release }) }),
    close: async () => {},
  };
  return {
    query,
    release,
    conversations: createConversationRepository(
      pool as unknown as Parameters<typeof createConversationRepository>[0],
    ),
    repository: createWorkflowRepository(
      pool as unknown as Parameters<typeof createWorkflowRepository>[0],
    ),
  };
}
const now = new Date('2026-11-27T00:00:00Z');
const id = '8ce38706-96c9-4c57-8bf4-6f3b18faf1be';
const token = 'e26ff7ad-011d-4daf-a272-09fca9b11148';

describe('workflow repository transaction boundary', () => {
  it('does not publish an answer after cancellation or lease loss', async () => {
    const { repository, query, release } = driver(() => []);
    await expect(
      repository.complete(id, token, { answer: '回答', sources: [] }, now),
    ).resolves.toBe(false);
    expect(query.mock.calls.map(([sql]) => sql)).toHaveLength(3);
    expect(query.mock.calls.some(([sql]) => sql.startsWith('INSERT'))).toBe(false);
    expect(query.mock.calls.at(-1)?.[0]).toBe('COMMIT');
    expect(release).toHaveBeenCalledOnce();
  });
  it('rolls back the final message when its durable event cannot be written', async () => {
    const { repository, query, release } = driver((sql) => {
      if (sql.includes('lease_token = $2') && sql.startsWith('SELECT'))
        return [{ conversationId: id }];
      if (sql.includes('SELECT next_sequence')) return [{ sequence: 2 }];
      if (sql.includes('RETURNING next_event_sequence')) return [{ seq: 1 }];
      if (sql.startsWith('INSERT INTO app.run_events'))
        throw new Error('simulated storage failure');
      return [];
    });
    await expect(
      repository.complete(id, token, { answer: '回答', sources: [] }, now),
    ).rejects.toThrow('simulated storage failure');
    expect(query.mock.calls.some(([sql]) => sql.startsWith('INSERT INTO app.messages'))).toBe(true);
    expect(query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK');
    expect(query.mock.calls.some(([sql]) => sql === 'COMMIT')).toBe(false);
    expect(release).toHaveBeenCalledOnce();
  });
  it('rejects an invalid answer before acquiring a database connection', () => {
    const { repository, query } = driver(() => []);
    expect(() =>
      repository.complete(id, token, { answer: 'x'.repeat(20001), sources: [] }, now),
    ).toThrow();
    expect(query).not.toHaveBeenCalled();
  });
  it('rejects unauthenticated reads without querying workflow data', async () => {
    const { repository, query } = driver(() => []);
    await expect(repository.detail('unknown-digest', id, now)).rejects.toMatchObject({
      status: 401,
    });
    expect(query.mock.calls.some(([sql]) => sql.includes('app.workflow_runs'))).toBe(false);
    expect(query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK');
  });
  it('saves final text, sources and completion events in one successful transaction', async () => {
    let seq = 0;
    const { repository, query } = driver((sql) => {
      if (sql.includes('lease_token = $2') && sql.startsWith('SELECT'))
        return [{ conversationId: id }];
      if (sql.includes('SELECT next_sequence')) return [{ sequence: 2 }];
      if (sql.includes('RETURNING next_event_sequence')) return [{ seq: ++seq }];
      return [];
    });
    await expect(
      repository.complete(
        id,
        token,
        {
          answer: '回答',
          sources: [
            {
              id: 's1',
              documentId: 'd1',
              title: '演示须知',
              url: null,
              version: '1',
              excerpt: '证据',
            },
          ],
        },
        now,
      ),
    ).resolves.toBe(true);
    const events = query.mock.calls.filter(([sql]) => sql.startsWith('INSERT INTO app.run_events'));
    expect(events.map(([, values]) => values?.[3])).toEqual([
      'answer.delta',
      'source',
      'run.completed',
    ]);
    expect(query.mock.calls.at(-1)?.[0]).toBe('COMMIT');
  });
});

describe('conversation message and run atomicity', () => {
  const turn = {
    id,
    conversationId: id,
    clientMessageId: id,
    role: 'user',
    content: '问题',
    sequence: 1,
    createdAt: now,
    runId: null,
    sources: [],
  };
  function response(sql: string) {
    if (sql.includes('FROM app.visitor_sessions')) return [{ visitorId: id }];
    if (sql.includes('FROM app.conversations'))
      return [
        { id, title: '新会话', createdAt: now, updatedAt: now, messageCount: 0, nextSequence: 1 },
      ];
    if (sql.startsWith('INSERT INTO app.messages')) return [{ ...turn }];
    return [];
  }
  it('atomically queues a new user message with bounded prior history', async () => {
    const { conversations, query } = driver((sql) =>
      sql.includes('LEFT(content, 4000)')
        ? Array.from({ length: 20 }, () => ({ role: 'user', content: 'a'.repeat(4000) }))
        : response(sql),
    );
    const result = await conversations.send(
      'digest',
      id,
      { clientMessageId: id, content: '问题' },
      now,
    );
    expect(result.processing).toBe('queued');
    expect(result.runId).toBe(result.data.runId);
    const createRun = query.mock.calls.find(([sql]) =>
      sql.startsWith('INSERT INTO app.workflow_runs'),
    );
    expect(createRun).toBeDefined();
    const history = JSON.parse(String(createRun![1]![4])) as { content: string }[];
    expect(history.reduce((sum, item) => sum + item.content.length, 0)).toBe(20000);
    expect(query.mock.calls.at(-1)?.[0]).toBe('COMMIT');
  });
  it('rolls back the user message if queue insertion fails', async () => {
    const { conversations, query } = driver((sql) => {
      if (sql.startsWith('INSERT INTO app.workflow_runs')) throw new Error('queue unavailable');
      return response(sql);
    });
    await expect(
      conversations.send('digest', id, { clientMessageId: id, content: '问题' }, now),
    ).rejects.toThrow('queue unavailable');
    expect(query.mock.calls.some(([sql]) => sql.startsWith('INSERT INTO app.messages'))).toBe(true);
    expect(query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK');
  });
  it('returns an old saved message without creating a workflow on retry', async () => {
    const { conversations, query } = driver((sql) =>
      sql.includes('client_message_id = $2') ? [turn] : response(sql),
    );
    const result = await conversations.send(
      'digest',
      id,
      { clientMessageId: id, content: '问题' },
      now,
    );
    expect(result).toMatchObject({ duplicate: true, processing: 'not_configured', runId: null });
    expect(query.mock.calls.some(([sql]) => sql.includes('app.workflow_runs'))).toBe(false);
  });
  it('rejects another active run before creating a new message', async () => {
    const { conversations, query } = driver((sql) =>
      sql.includes('FROM app.workflow_runs') ? [{ id }] : response(sql),
    );
    await expect(
      conversations.send('digest', id, { clientMessageId: id, content: '问题' }, now),
    ).rejects.toMatchObject({ status: 409, code: 'RUN_ACTIVE' });
    expect(query.mock.calls.some(([sql]) => sql.startsWith('INSERT'))).toBe(false);
  });
});
