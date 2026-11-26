import Fastify from 'fastify';
import { z } from 'zod';
import { liveHealthSchema, type LiveHealth } from '@gard/contracts';
import {
  createAuctionRepository,
  type AuctionRepository,
} from './repositories/auction-repository.js';
import { registerAuctionRoutes } from './routes/auctions.js';

export function buildApp(
  logLevel = 'info',
  options: { auctionRepository?: AuctionRepository; clock?: () => Date } = {},
) {
  const app = Fastify({
    logger: {
      level: logLevel,
      redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
    },
  });

  app.get<{ Reply: LiveHealth }>(
    '/health/live',
    { schema: { response: { 200: z.toJSONSchema(liveHealthSchema, { target: 'draft-7' }) } } },
    async () => ({ status: 'ok', service: 'gard-api' }),
  );

  const repository = options.auctionRepository ?? createAuctionRepository();
  registerAuctionRoutes(app, repository, options.clock ?? (() => new Date()));
  app.addHook('onClose', () => repository.close());

  return app;
}
