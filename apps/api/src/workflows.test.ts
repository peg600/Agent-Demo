import { createHmac, randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RunEvent, WorkflowRun } from '@gard/contracts';
import { buildApp } from './app.js';
import {
  ConversationError,
  notFound,
  unauthenticated,
} from './repositories/conversation-repository.js';
import type { WorkflowRepository } from './agent/ports.js';
import type { ConversationRepository } from './repositories/conversation-repository.js';

const secret = 'test-secret-at-least-32-characters-long';
const origin = 'http://127.0.0.1:5173';
const token = 'a'.repeat(43);
const digest = createHmac('sha256', secret).update(token).digest('hex');
const headers = { cookie: `gard_visitor=${token}`, origin };
const apps: ReturnType<typeof buildApp>[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});
function setup() {
  const run: WorkflowRun = {
    id: randomUUID(),
    conversationId: randomUUID(),
    userMessageId: randomUUID(),
    status: 'completed',
    createdAt: '2026-11-27T00:00:00Z',
    updatedAt: '2026-11-27T00:00:00Z',
    errorCode: null,
    errorMessage: null,
    lastEventSequence: 2,
  };
  const events: RunEvent[] = [
    {
      id: randomUUID(),
      runId: run.id,
      seq: 1,
      type: 'run.started',
      message: '开始',
      taskId: null,
      createdAt: run.createdAt,
    },
    {
      id: randomUUID(),
      runId: run.id,
      seq: 2,
      type: 'run.completed',
      message: '完成',
      taskId: null,
      createdAt: run.createdAt,
    },
  ];
  function owned(auth: string, id: string) {
    if (auth !== digest) throw unauthenticated();
    if (id !== run.id && id !== run.conversationId) throw notFound();
  }
  const repository: WorkflowRepository = {
    detail: vi.fn(async (auth, id) => {
      owned(auth, id);
      return run;
    }),
    list: vi.fn(async (auth, id) => {
      owned(auth, id);
      return [run];
    }),
    events: vi.fn(async (auth, id, after) => {
      owned(auth, id);
      return { data: events.filter((e) => e.seq > after), run };
    }),
    cancel: vi.fn(async (auth, id) => {
      owned(auth, id);
      return run;
    }),
    claim: vi.fn(),
    heartbeat: vi.fn(),
    append: vi.fn(),
    complete: vi.fn(),
    fail: vi.fn(),
    close: vi.fn(),
  };
  const app = buildApp('silent', {
    workflowRepository: repository,
    conversationConfig: () => ({ sessionSecret: secret, webOrigin: origin }),
  });
  apps.push(app);
  return { app, repository, run };
}
describe('workflow HTTP and SSE boundaries', () => {
  it('returns 202 with the durable run ID and 200 for a duplicate send', async () => {
    const runId = randomUUID();
    const conversationId = randomUUID();
    const data = {
      id: randomUUID(),
      conversationId,
      clientMessageId: randomUUID(),
      role: 'user' as const,
      content: '问题',
      sequence: 1,
      createdAt: '2026-11-27T00:00:00Z',
      runId,
      sources: [],
    };
    const repository: ConversationRepository = {
      establishSession: vi.fn(),
      create: vi.fn(),
      list: vi.fn(),
      detail: vi.fn(),
      history: vi.fn(),
      close: vi.fn(),
      send: vi
        .fn()
        .mockResolvedValueOnce({ data, duplicate: false, processing: 'queued', runId })
        .mockResolvedValue({ data, duplicate: true, processing: 'queued', runId }),
    };
    const app = buildApp('silent', {
      conversationRepository: repository,
      conversationConfig: () => ({ sessionSecret: secret, webOrigin: origin }),
    });
    apps.push(app);
    for (const status of [202, 200]) {
      const response = await app.inject({
        method: 'POST',
        url: `/api/conversations/${conversationId}/messages`,
        headers,
        payload: { clientMessageId: data.clientMessageId, content: data.content },
      });
      expect(response.statusCode).toBe(status);
      expect(response.json()).toMatchObject({ runId, processing: 'queued' });
    }
  });
  it('checks identity and ownership for status, run lists, events and cancel', async () => {
    const { app, run } = setup();
    for (const url of [
      `/api/runs/${run.id}`,
      `/api/runs/${run.id}/events`,
      `/api/conversations/${run.conversationId}/runs`,
    ]) {
      expect((await app.inject({ url })).statusCode).toBe(401);
      expect(
        (await app.inject({ url, headers: { cookie: `gard_visitor=${'b'.repeat(43)}` } }))
          .statusCode,
      ).toBe(401);
    }
    for (const suffix of ['', '/events'])
      expect(
        (await app.inject({ url: `/api/runs/${randomUUID()}${suffix}`, headers })).statusCode,
      ).toBe(404);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/runs/${randomUUID()}/cancel`,
          headers,
          payload: {},
        })
      ).statusCode,
    ).toBe(404);
  });
  it('requires exact Origin and strict body before cancelling', async () => {
    const { app, run, repository } = setup();
    const url = `/api/runs/${run.id}/cancel`;
    expect(
      (await app.inject({ method: 'POST', url, headers: { cookie: headers.cookie }, payload: {} }))
        .statusCode,
    ).toBe(403);
    expect(
      (await app.inject({ method: 'POST', url, headers, payload: { ownerId: randomUUID() } }))
        .statusCode,
    ).toBe(400);
    expect(repository.cancel).not.toHaveBeenCalled();
    expect((await app.inject({ method: 'POST', url, headers, payload: {} })).statusCode).toBe(200);
  });
  it('replays SSE after the Last-Event-ID without resending previous events', async () => {
    const { app, run } = setup();
    const response = await app.inject({
      url: `/api/runs/${run.id}/events?after=0`,
      headers: { ...headers, 'last-event-id': '1' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/event-stream');
    expect(response.body).toContain('id: 2\nevent: run-event');
    expect(response.body).not.toContain('id: 1\n');
    expect(response.body).toContain('run.completed');
  });
  it('rejects malformed/future cursors before starting the stream', async () => {
    const { app, run } = setup();
    for (const cursor of ['-1', 'garbage', '3']) {
      expect(
        (await app.inject({ url: `/api/runs/${run.id}/events?after=${cursor}`, headers }))
          .statusCode,
      ).toBe(400);
    }
  });
  it('does not expose raw database failures or another owner stream', async () => {
    const { app, run, repository } = setup();
    vi.mocked(repository.events).mockRejectedValue(new Error('postgres://private-password'));
    const failed = await app.inject({ url: `/api/runs/${run.id}/events`, headers });
    expect(failed.statusCode).toBe(503);
    expect(failed.body).not.toContain('private-password');
    vi.mocked(repository.events).mockRejectedValue(
      new ConversationError(404, 'CONVERSATION_NOT_FOUND', '未找到该会话。'),
    );
    expect((await app.inject({ url: `/api/runs/${run.id}/events`, headers })).statusCode).toBe(404);
  });
});
