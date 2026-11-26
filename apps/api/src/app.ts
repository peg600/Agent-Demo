import Fastify from 'fastify';
import { z } from 'zod';
import { liveHealthSchema, type LiveHealth } from '@gard/contracts';

export function buildApp(logLevel = 'info') {
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

  return app;
}
