import { z } from 'zod';
export * from './auctions.js';
export * from './conversations.js';
export * from './workflows.js';

export const liveHealthSchema = z.object({
  status: z.literal('ok'),
  service: z.literal('gard-api'),
});

export type LiveHealth = z.infer<typeof liveHealthSchema>;
