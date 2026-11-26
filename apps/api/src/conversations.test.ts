import { createHmac, randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Conversation, ConversationMessage } from '@gard/contracts';
import { buildApp } from './app.js';
import {
  conflict,
  notFound,
  unauthenticated,
  type ConversationRepository,
} from './repositories/conversation-repository.js';
import { readConversationConfig, VISITOR_COOKIE } from './routes/conversations.js';

// An in-memory test double exercises the HTTP/authentication contract only.
// PostgreSQL locking, constraints and concurrency require separate integration tests.
function fakeRepository() {
  const sessions = new Map<string, { owner: string; expiresAt: Date }>();
  const conversations = new Map<
    string,
    { owner: string; clientId: string; data: Conversation; messages: ConversationMessage[] }
  >();
  function owner(digest: string, now: Date) {
    const session = sessions.get(digest);
    if (!session || session.expiresAt <= now) throw unauthenticated();
    return session.owner;
  }
  function owned(digest: string, id: string, now: Date) {
    const visitor = owner(digest, now);
    const record = conversations.get(id);
    if (!record || record.owner !== visitor) throw notFound();
    return record;
  }
  const repository: ConversationRepository = {
    async establishSession(existing, digest, now, expiresAt) {
      const previous = existing ? sessions.get(existing) : undefined;
      if (previous && previous.expiresAt > now)
        return { reused: true, expiresAt: previous.expiresAt.toISOString() };
      sessions.set(digest, { owner: randomUUID(), expiresAt });
      return { reused: false, expiresAt: expiresAt.toISOString() };
    },
    async create(digest, input, now) {
      const visitor = owner(digest, now);
      const existing = [...conversations.values()].find(
        (record) => record.owner === visitor && record.clientId === input.clientConversationId,
      );
      if (existing) {
        if (existing.data.title !== input.title) throw conflict();
        return { data: existing.data, duplicate: true };
      }
      const data = {
        id: randomUUID(),
        title: input.title,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
        messageCount: 0,
      };
      conversations.set(data.id, {
        owner: visitor,
        clientId: input.clientConversationId,
        data,
        messages: [],
      });
      return { data, duplicate: false };
    },
    async list(digest, query, now) {
      const visitor = owner(digest, now);
      const data = [...conversations.values()]
        .filter((record) => record.owner === visitor)
        .map((record) => record.data)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id));
      return {
        data: data.slice((query.page - 1) * query.pageSize, query.page * query.pageSize),
        total: data.length,
        ...query,
      };
    },
    async detail(digest, id, now) {
      return owned(digest, id, now).data;
    },
    async send(digest, id, input, now) {
      const record = owned(digest, id, now);
      const previous = record.messages.find(
        (item) => item.clientMessageId === input.clientMessageId,
      );
      if (previous) {
        if (previous.content !== input.content) throw conflict();
        return { data: previous, duplicate: true, processing: 'not_configured' };
      }
      const data: ConversationMessage = {
        id: randomUUID(),
        conversationId: id,
        ...input,
        role: 'user',
        sequence: record.messages.length + 1,
        createdAt: now.toISOString(),
      };
      record.messages.push(data);
      record.data.messageCount += 1;
      record.data.updatedAt = now.toISOString();
      return { data, duplicate: false, processing: 'not_configured' };
    },
    async history(digest, id, query, now) {
      const records = owned(digest, id, now).messages.filter(
        (item) => query.beforeSequence === undefined || item.sequence < query.beforeSequence,
      );
      const data = records.slice(-query.limit);
      const hasMore = records.length > data.length;
      return { data, hasMore, nextBeforeSequence: hasMore ? data[0]!.sequence : null };
    },
    async close() {},
  };
  return { repository, sessions };
}

const origin = 'http://127.0.0.1:5173';
const secret = 'test-session-secret-with-at-least-32-characters';
const apps: ReturnType<typeof buildApp>[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});
function setup() {
  const fake = fakeRepository();
  let now = new Date('2026-11-27T00:00:00.000Z');
  const app = buildApp('silent', {
    conversationRepository: fake.repository,
    conversationConfig: () => ({ sessionSecret: secret, webOrigin: origin }),
    clock: () => now,
  });
  apps.push(app);
  const bootstrap = () =>
    app.inject({ method: 'POST', url: '/api/visitor-session', headers: { origin }, payload: {} });
  const session = async () => {
    const response = await bootstrap();
    expect(response.statusCode).toBe(201);
    return String(response.headers['set-cookie']).split(';')[0]!;
  };
  const create = (cookie: string, clientConversationId = randomUUID(), title = '拍卖咨询') =>
    app.inject({
      method: 'POST',
      url: '/api/conversations',
      headers: { origin, cookie },
      payload: { clientConversationId, title },
    });
  return {
    app,
    ...fake,
    bootstrap,
    session,
    create,
    setNow: (value: Date) => {
      now = value;
    },
  };
}

describe('conversation HTTP boundary (no external services)', () => {
  it('requires a strong-length secret and an exact HTTP origin', () => {
    expect(() => readConversationConfig({})).toThrow();
    expect(() => readConversationConfig({ SESSION_SECRET: 'short' })).toThrow();
    expect(readConversationConfig({ SESSION_SECRET: secret })).toEqual({
      sessionSecret: secret,
      webOrigin: origin,
    });
    for (const webOrigin of [
      'null',
      'file:///tmp',
      `${origin}/`,
      `${origin}/chat`,
      'http://user:password@example.com',
    ]) {
      expect(() =>
        readConversationConfig({ SESSION_SECRET: secret, WEB_ORIGIN: webOrigin }),
      ).toThrow();
    }
  });
  it('sets an opaque HttpOnly cookie, hashes tokens and reuses without extending expiry', async () => {
    const { app, bootstrap, sessions } = setup();
    const response = await bootstrap();
    const cookie = String(response.headers['set-cookie']);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Path=/');
    expect(cookie).toContain('Max-Age=2592000');
    expect(cookie).not.toContain('Secure');
    const token = cookie.split(';')[0]!.split('=')[1]!;
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(sessions.has(createHmac('sha256', secret).update(token).digest('hex'))).toBe(true);
    expect(response.body).not.toContain(token);
    expect(Object.keys(response.json().data)).toEqual(['expiresAt']);
    const reused = await app.inject({
      method: 'POST',
      url: '/api/visitor-session',
      headers: { origin, cookie: cookie.split(';')[0]! },
      payload: {},
    });
    expect(reused.statusCode).toBe(200);
    expect(reused.headers['set-cookie']).toBeUndefined();
    expect(reused.json()).toEqual(response.json());
  });

  it('rejects missing or foreign origins on every POST', async () => {
    const { app, session } = setup();
    const cookie = await session();
    for (const url of [
      '/api/visitor-session',
      '/api/conversations',
      `/api/conversations/${randomUUID()}/messages`,
    ]) {
      for (const headers of [{ cookie }, { cookie, origin: 'http://evil.example' }]) {
        expect((await app.inject({ method: 'POST', url, headers, payload: {} })).statusCode).toBe(
          403,
        );
      }
    }
  });

  it('rejects forged/expired identities, creates a fresh identity after expiry', async () => {
    const { app, session, create, setNow } = setup();
    const cookie = await session();
    const created = await create(cookie);
    for (const headers of [
      {},
      { cookie: `${VISITOR_COOKIE}=invalid` },
      { cookie: `${VISITOR_COOKIE}=${'a'.repeat(43)}` },
    ]) {
      expect((await app.inject({ url: '/api/conversations', headers })).statusCode).toBe(401);
    }
    setNow(new Date('2026-12-27T00:00:00.000Z'));
    expect((await app.inject({ url: '/api/conversations', headers: { cookie } })).statusCode).toBe(
      401,
    );
    const fresh = await app.inject({
      method: 'POST',
      url: '/api/visitor-session',
      headers: { cookie, origin },
      payload: {},
    });
    expect(fresh.statusCode).toBe(201);
    const newCookie = String(fresh.headers['set-cookie']).split(';')[0]!;
    expect(
      (
        await app.inject({
          url: `/api/conversations/${created.json().data.id}`,
          headers: { cookie: newCookie },
        })
      ).statusCode,
    ).toBe(404);
  });

  it('isolates lists, details, history and writes between anonymous visitors', async () => {
    const { app, session, create } = setup();
    const first = await session();
    const second = await session();
    const id = (await create(first)).json().data.id as string;
    const headers = { cookie: second, origin };
    expect((await app.inject({ url: '/api/conversations', headers })).json().total).toBe(0);
    for (const target of [id, randomUUID()]) {
      expect((await app.inject({ url: `/api/conversations/${target}`, headers })).statusCode).toBe(
        404,
      );
      expect(
        (await app.inject({ url: `/api/conversations/${target}/messages`, headers })).statusCode,
      ).toBe(404);
      expect(
        (
          await app.inject({
            method: 'POST',
            url: `/api/conversations/${target}/messages`,
            headers,
            payload: { clientMessageId: randomUUID(), content: '你好' },
          })
        ).statusCode,
      ).toBe(404);
    }
  });

  it('deduplicates conversations and messages and rejects changed payloads or client roles', async () => {
    const { app, session, create, repository } = setup();
    const cookie = await session();
    const clientId = randomUUID();
    const first = await create(cookie, clientId);
    expect(first.statusCode).toBe(201);
    const repeat = await create(cookie, clientId);
    expect(repeat.statusCode).toBe(200);
    expect(repeat.json().duplicate).toBe(true);
    expect(repeat.json().data.id).toBe(first.json().data.id);
    expect((await create(cookie, clientId, '不同标题')).statusCode).toBe(409);
    const url = `/api/conversations/${first.json().data.id}/messages`;
    const headers = { cookie, origin };
    const payload = { clientMessageId: randomUUID(), content: '  如何参拍？  ' };
    const sent = await app.inject({ method: 'POST', url, headers, payload });
    expect(sent.statusCode).toBe(201);
    expect(sent.json()).toMatchObject({
      duplicate: false,
      processing: 'not_configured',
      data: { role: 'user', content: '如何参拍？', sequence: 1 },
    });
    expect((await app.inject({ method: 'POST', url, headers, payload })).statusCode).toBe(200);
    expect(
      (
        await app.inject({
          method: 'POST',
          url,
          headers,
          payload: { ...payload, content: '改内容' },
        })
      ).statusCode,
    ).toBe(409);
    const sendSpy = vi.spyOn(repository, 'send');
    for (const extra of [
      { role: 'assistant' },
      { visitorId: randomUUID() },
      { runId: randomUUID() },
    ]) {
      expect(
        (await app.inject({ method: 'POST', url, headers, payload: { ...payload, ...extra } }))
          .statusCode,
      ).toBe(400);
    }
    expect(sendSpy).not.toHaveBeenCalled();
    expect((await app.inject({ url, headers })).json().data).toHaveLength(1);
    expect(
      (await app.inject({ url: '/api/conversations', headers })).json().data[0].messageCount,
    ).toBe(1);
  });

  it('paginates history in ascending sequence without including newer arrivals', async () => {
    const { app, session, create } = setup();
    const cookie = await session();
    const id = (await create(cookie)).json().data.id as string;
    const url = `/api/conversations/${id}/messages`;
    const headers = { cookie, origin };
    for (let n = 1; n <= 4; n++)
      await app.inject({
        method: 'POST',
        url,
        headers,
        payload: { clientMessageId: randomUUID(), content: `消息${n}` },
      });
    const latest = (await app.inject({ url: `${url}?limit=2`, headers })).json();
    expect(latest.data.map((item: ConversationMessage) => item.sequence)).toEqual([3, 4]);
    expect(latest).toMatchObject({ hasMore: true, nextBeforeSequence: 3 });
    await app.inject({
      method: 'POST',
      url,
      headers,
      payload: { clientMessageId: randomUUID(), content: '新消息' },
    });
    const older = (await app.inject({ url: `${url}?limit=2&beforeSequence=3`, headers })).json();
    expect(older.data.map((item: ConversationMessage) => item.sequence)).toEqual([1, 2]);
    expect(older).toMatchObject({ hasMore: false, nextBeforeSequence: null });
    expect((await app.inject({ url: `${url}?beforeSequence=0`, headers })).statusCode).toBe(400);
  });

  it('rejects malformed JSON and client-supplied ownership', async () => {
    const { app, session, repository } = setup();
    const cookie = await session();
    const createSpy = vi.spyOn(repository, 'create');
    const malformed = await app.inject({
      method: 'POST',
      url: '/api/conversations',
      headers: { cookie, origin, 'content-type': 'application/json' },
      payload: '{"bad":',
    });
    expect(malformed.statusCode).toBe(400);
    expect(malformed.json().error.code).toBe('INVALID_REQUEST');
    const ownership = await app.inject({
      method: 'POST',
      url: '/api/conversations',
      headers: { cookie, origin },
      payload: { clientConversationId: randomUUID(), owner: randomUUID() },
    });
    expect(ownership.statusCode).toBe(400);
    expect(createSpy).not.toHaveBeenCalled();
  });

  it('contains unavailable configuration/database errors and leaves health independent', async () => {
    const { app, repository, session } = setup();
    const cookie = await session();
    vi.spyOn(repository, 'list').mockRejectedValue(
      new Error('postgres://user:secret@private-host SQL SELECT'),
    );
    const failed = await app.inject({ url: '/api/conversations', headers: { cookie } });
    expect(failed.statusCode).toBe(503);
    expect(failed.body).not.toMatch(/private-host|SELECT|postgres|secret/);
    const missing = buildApp('silent', {
      conversationConfig: () => {
        throw new Error('missing secret');
      },
    });
    apps.push(missing);
    expect((await missing.inject({ url: '/api/conversations' })).statusCode).toBe(503);
    expect((await missing.inject({ url: '/health/live' })).statusCode).toBe(200);
  });

  it('limits session creation without limiting health requests', async () => {
    const { app, bootstrap } = setup();
    for (let n = 0; n < 20; n++) expect((await bootstrap()).statusCode).toBe(201);
    expect((await bootstrap()).statusCode).toBe(429);
    for (let n = 0; n < 25; n++)
      expect((await app.inject({ url: '/health/live' })).statusCode).toBe(200);
  });
});
