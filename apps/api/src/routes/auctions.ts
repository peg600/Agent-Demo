import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import {
  auctionEventsQuerySchema,
  auctionSessionsQuerySchema,
  auctionRecommendationsQuerySchema,
  auctionIdSchema,
  auctionEventsResponseSchema,
  auctionSessionsResponseSchema,
  auctionEventDetailResponseSchema,
  auctionSessionDetailResponseSchema,
  auctionRecommendationsResponseSchema,
  apiErrorSchema,
} from '@gard/contracts';
import type { AuctionRepository } from '../repositories/auction-repository.js';

function fail(reply: FastifyReply, status: number, code: string, message: string) {
  return reply.status(status).send({ error: { code, message } });
}
export function registerAuctionRoutes(
  app: FastifyInstance,
  repository: AuctionRepository,
  clock: () => Date,
) {
  const errorSchema = z.toJSONSchema(apiErrorSchema, { target: 'draft-7' });
  function route<I, O>(
    path: string,
    input: z.ZodType<I>,
    output: z.ZodType<O>,
    read: (input: I, now: Date) => Promise<unknown>,
    params = false,
  ) {
    app.get(
      path,
      {
        schema: {
          response: {
            200: z.toJSONSchema(output, { target: 'draft-7' }),
            400: errorSchema,
            404: errorSchema,
            503: errorSchema,
            500: errorSchema,
          },
        },
      },
      async (request, reply) => {
        const parsed = input.safeParse(params ? request.params : request.query);
        if (!parsed.success)
          return fail(reply, 400, 'INVALID_QUERY', '请求参数格式不正确，请检查筛选条件。');
        const now = clock();
        try {
          const result = await read(parsed.data, now);
          if (result === null)
            return fail(reply, 404, 'AUCTION_NOT_FOUND', '未找到该演示拍卖会或拍场。');
          return output.parse(result);
        } catch (error) {
          // Do not serialize DB error objects: they can contain SQL or connection details.
          if (error instanceof z.ZodError) {
            request.log.error(
              { catalogueError: 'invalid_record' },
              'Catalogue data did not satisfy its response contract',
            );
            return fail(reply, 500, 'INVALID_CATALOGUE_DATA', '拍卖目录数据暂时不可用。');
          }
          request.log.warn(
            { catalogueError: 'database_unavailable' },
            'Catalogue database request failed',
          );
          return fail(reply, 503, 'CATALOGUE_UNAVAILABLE', '拍卖目录暂不可用，请稍后重试。');
        }
      },
    );
  }
  const meta = (now: Date) => ({ isDemo: true as const, asOf: now.toISOString() });
  const idInput = z.object({ id: auctionIdSchema });
  route(
    '/api/auction-events',
    auctionEventsQuerySchema,
    auctionEventsResponseSchema,
    async (query, now) => ({
      ...(await repository.listEvents(query, now)),
      page: query.page,
      pageSize: query.pageSize,
      meta: meta(now),
    }),
  );
  route(
    '/api/auction-events/:id',
    idInput,
    auctionEventDetailResponseSchema,
    async ({ id }, now) => {
      const found = await repository.eventDetail(id, now);
      return found ? { ...found, meta: meta(now) } : null;
    },
    true,
  );
  route(
    '/api/auction-sessions',
    auctionSessionsQuerySchema,
    auctionSessionsResponseSchema,
    async (query, now) => ({
      ...(await repository.listSessions(query, now)),
      page: query.page,
      pageSize: query.pageSize,
      meta: meta(now),
    }),
  );
  route(
    '/api/auction-sessions/:id',
    idInput,
    auctionSessionDetailResponseSchema,
    async ({ id }, now) => {
      const found = await repository.sessionDetail(id, now);
      return found ? { ...found, meta: meta(now) } : null;
    },
    true,
  );
  route(
    '/api/auction-recommendations',
    auctionRecommendationsQuerySchema,
    auctionRecommendationsResponseSchema,
    async (query, now) => ({ data: await repository.recommendations(query, now), meta: meta(now) }),
  );
}
