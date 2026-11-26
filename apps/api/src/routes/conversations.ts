import { createHmac, randomBytes } from 'node:crypto';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  conversationIdSchema,
  createConversationSchema,
  conversationListQuerySchema,
  sendMessageSchema,
  messageListQuerySchema,
  visitorSessionResponseSchema,
  createConversationResponseSchema,
  conversationListResponseSchema,
  conversationDetailResponseSchema,
  sendMessageResponseSchema,
  messageListResponseSchema,
  workflowRunResponseSchema,
  workflowRunsResponseSchema,
  runEventsQuerySchema,
} from '@gard/contracts';
import type { WorkflowRepository } from '../agent/ports.js';
import { streamRunEvents } from './run-stream.js';
import {
  ConversationError,
  unauthenticated,
  type ConversationRepository,
} from '../repositories/conversation-repository.js';

export const VISITOR_COOKIE = 'gard_visitor';
const SESSION_SECONDS = 30 * 24 * 60 * 60;
export type ConversationConfig = { sessionSecret: string; webOrigin: string };

export function readConversationConfig(env: NodeJS.ProcessEnv = process.env): ConversationConfig {
  const sessionSecret = env.SESSION_SECRET ?? '';
  const webOrigin = env.WEB_ORIGIN ?? 'http://127.0.0.1:5173';
  if (sessionSecret.length < 32) throw new Error('Chat configuration unavailable');
  const origin = new URL(webOrigin);
  if (!['http:', 'https:'].includes(origin.protocol) || origin.origin !== webOrigin) {
    throw new Error('Chat configuration unavailable');
  }
  return { sessionSecret, webOrigin };
}

export async function registerConversationRoutes(
  app: FastifyInstance,
  repository: ConversationRepository,
  clock: () => Date,
  config: () => ConversationConfig = readConversationConfig,
  workflows?: { repository: WorkflowRepository; wake: () => void },
) {
  await app.register(cookie);
  await app.register(rateLimit, { global: false });
  app.setErrorHandler((error, _request, reply) => {
    const candidate =
      error && typeof error === 'object' && 'statusCode' in error ? error.statusCode : undefined;
    const status =
      candidate === 429
        ? 429
        : candidate === 400 || candidate === 413 || candidate === 415
          ? candidate
          : 500;
    return reply.status(status).send({
      error: {
        code: status === 429 ? 'RATE_LIMITED' : 'INVALID_REQUEST',
        message: status === 429 ? '请求过于频繁，请稍后重试。' : '请求无法处理。',
      },
    });
  });
  const hash = (token: string, secret: string) =>
    createHmac('sha256', secret).update(token).digest('hex');
  function digest(request: FastifyRequest, settings: ConversationConfig) {
    const token = request.cookies[VISITOR_COOKIE];
    return token && /^[A-Za-z0-9_-]{43}$/.test(token)
      ? hash(token, settings.sessionSecret)
      : undefined;
  }
  function requiredDigest(request: FastifyRequest, settings: ConversationConfig) {
    const value = digest(request, settings);
    if (!value) throw unauthenticated();
    return value;
  }
  function endpoint<T>(
    output: z.ZodType<T>,
    work: (
      request: FastifyRequest,
      reply: FastifyReply,
      settings: ConversationConfig,
      now: Date,
    ) => Promise<T>,
  ) {
    return async (request: FastifyRequest, reply: FastifyReply) => {
      reply.header('Cache-Control', 'no-store');
      try {
        const settings = config();
        if (request.method === 'POST' && request.headers.origin !== settings.webOrigin) {
          throw new ConversationError(403, 'ORIGIN_REJECTED', '请求来源不受信任。');
        }
        const result = await work(request, reply, settings, clock());
        const parsed = output.safeParse(result);
        if (!parsed.success)
          throw new ConversationError(500, 'INVALID_CONVERSATION_DATA', '会话数据暂不可用。');
        return parsed.data;
      } catch (error) {
        if (error instanceof z.ZodError)
          return reply
            .status(400)
            .send({ error: { code: 'INVALID_REQUEST', message: '请求参数格式不正确。' } });
        if (error instanceof ConversationError)
          return reply
            .status(error.status)
            .send({ error: { code: error.code, message: error.message } });
        // Never log SQL, connection information, messages, or session tokens.
        request.log.warn({ conversationError: 'unavailable' }, 'Conversation request unavailable');
        return reply.status(503).send({
          error: {
            code: 'CONVERSATION_UNAVAILABLE',
            message: '会话服务暂不可用，请检查服务配置后重试。',
          },
        });
      }
    };
  }
  const id = (request: FastifyRequest) =>
    z.object({ id: conversationIdSchema }).strict().parse(request.params).id;
  app.post(
    '/api/visitor-session',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    endpoint(visitorSessionResponseSchema, async (request, reply, settings, now) => {
      z.object({}).strict().parse(request.body);
      const token = randomBytes(32).toString('base64url');
      const expiresAt = new Date(now.getTime() + SESSION_SECONDS * 1000);
      const session = await repository.establishSession(
        digest(request, settings),
        hash(token, settings.sessionSecret),
        now,
        expiresAt,
      );
      if (!session.reused) {
        reply.setCookie(VISITOR_COOKIE, token, {
          path: '/',
          httpOnly: true,
          sameSite: 'lax',
          secure: false,
          expires: expiresAt,
          maxAge: SESSION_SECONDS,
        });
        reply.status(201);
      }
      return { data: { expiresAt: session.expiresAt } };
    }),
  );
  app.post(
    '/api/conversations',
    endpoint(createConversationResponseSchema, async (request, reply, settings, now) => {
      const auth = requiredDigest(request, settings);
      const result = await repository.create(
        auth,
        createConversationSchema.parse(request.body),
        now,
      );
      reply.status(result.duplicate ? 200 : 201);
      return result;
    }),
  );
  app.get(
    '/api/conversations',
    endpoint(conversationListResponseSchema, async (request, _reply, settings, now) =>
      repository.list(
        requiredDigest(request, settings),
        conversationListQuerySchema.parse(request.query),
        now,
      ),
    ),
  );
  app.get(
    '/api/conversations/:id',
    endpoint(conversationDetailResponseSchema, async (request, _reply, settings, now) => ({
      data: await repository.detail(requiredDigest(request, settings), id(request), now),
    })),
  );
  app.post(
    '/api/conversations/:id/messages',
    endpoint(sendMessageResponseSchema, async (request, reply, settings, now) => {
      const result = await repository.send(
        requiredDigest(request, settings),
        id(request),
        sendMessageSchema.parse(request.body),
        now,
      );
      reply.status(result.duplicate ? 200 : result.processing === 'queued' ? 202 : 201);
      if (result.processing === 'queued') workflows?.wake();
      return result;
    }),
  );
  app.get(
    '/api/conversations/:id/messages',
    endpoint(messageListResponseSchema, async (request, _reply, settings, now) =>
      repository.history(
        requiredDigest(request, settings),
        id(request),
        messageListQuerySchema.parse(request.query),
        now,
      ),
    ),
  );
  if (workflows) {
    const runs = workflows.repository;
    const streams = new Set<() => void>();
    app.addHook('preClose', async () => {
      for (const close of streams) close();
    });
    app.get(
      '/api/conversations/:id/runs',
      endpoint(workflowRunsResponseSchema, async (request, _reply, settings, now) => ({
        data: await runs.list(requiredDigest(request, settings), id(request), now),
      })),
    );
    app.get(
      '/api/runs/:id',
      endpoint(workflowRunResponseSchema, async (request, _reply, settings, now) => ({
        data: await runs.detail(requiredDigest(request, settings), id(request), now),
      })),
    );
    app.post(
      '/api/runs/:id/cancel',
      endpoint(workflowRunResponseSchema, async (request, _reply, settings, now) => {
        z.object({}).strict().parse(request.body);
        return { data: await runs.cancel(requiredDigest(request, settings), id(request), now) };
      }),
    );
    app.get('/api/runs/:id/events', async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      try {
        const settings = config();
        const auth = requiredDigest(request, settings);
        const runId = id(request);
        const query = runEventsQuerySchema.parse(request.query);
        const header = request.headers['last-event-id'];
        const after =
          header === undefined
            ? query.after
            : z.coerce.number().int().min(0).max(2147483647).parse(header);
        const initial = await runs.events(auth, runId, after, clock());
        if (after > initial.run.lastEventSequence)
          throw new ConversationError(400, 'INVALID_CURSOR', '事件游标超出范围。');
        return await streamRunEvents(
          reply,
          initial,
          after,
          (cursor) => runs.events(auth, runId, cursor, clock()),
          streams,
        );
      } catch (error) {
        if (reply.sent) return;
        if (error instanceof z.ZodError)
          return reply
            .status(400)
            .send({ error: { code: 'INVALID_REQUEST', message: '请求参数格式不正确。' } });
        if (error instanceof ConversationError)
          return reply
            .status(error.status)
            .send({ error: { code: error.code, message: error.message } });
        return reply
          .status(503)
          .send({ error: { code: 'RUN_UNAVAILABLE', message: '运行状态暂不可用。' } });
      }
    });
  }
}
