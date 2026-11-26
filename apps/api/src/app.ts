import Fastify from 'fastify';
import { z } from 'zod';
import { liveHealthSchema, type LiveHealth } from '@gard/contracts';
import {
  createAuctionRepository,
  type AuctionRepository,
} from './repositories/auction-repository.js';
import { registerAuctionRoutes } from './routes/auctions.js';
import {
  createConversationRepository,
  type ConversationRepository,
} from './repositories/conversation-repository.js';
import { registerConversationRoutes, type ConversationConfig } from './routes/conversations.js';
import { createWorkflowRepository } from './repositories/workflow-repository.js';
import { createAgentEngine } from './agent/engine.js';
import { createWorkflowWorker } from './agent/worker.js';
import type { AgentEngine, WorkflowRepository } from './agent/ports.js';

export function buildApp(
  logLevel = 'info',
  options: {
    auctionRepository?: AuctionRepository;
    conversationRepository?: ConversationRepository;
    conversationConfig?: () => ConversationConfig;
    workflowRepository?: WorkflowRepository;
    agentEngine?: AgentEngine;
    workflowWorkerEnabled?: boolean;
    clock?: () => Date;
  } = {},
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
  const conversationRepository = options.conversationRepository ?? createConversationRepository();
  const workflowRepository = options.workflowRepository ?? createWorkflowRepository();
  const engine = options.agentEngine ?? createAgentEngine(repository);
  const worker = createWorkflowWorker(workflowRepository, engine, {
    clock: options.clock ?? (() => new Date()),
    report: () => app.log.warn({ workflow: 'unavailable' }, 'Workflow scheduler unavailable'),
  });
  if (options.workflowWorkerEnabled)
    app.addHook('onReady', async () => {
      worker.start();
    });
  app.addHook('preClose', async () => {
    await worker.stop();
  });
  app.register(async (scope) => {
    await registerConversationRoutes(
      scope,
      conversationRepository,
      options.clock ?? (() => new Date()),
      options.conversationConfig,
      { repository: workflowRepository, wake: worker.wake },
    );
  });
  app.addHook('onClose', () => conversationRepository.close());
  app.addHook('onClose', async () => {
    await engine.close();
    await workflowRepository.close();
  });

  return app;
}
