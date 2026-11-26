import { z } from 'zod';

export const answerSourceSchema = z.object({
  id: z.string().min(1).max(200),
  documentId: z.string().min(1).max(200),
  title: z.string().max(300),
  url: z.url().nullable(),
  version: z.string().max(100),
  excerpt: z.string().max(2000),
});
export const runStatusSchema = z.enum(['queued', 'running', 'completed', 'failed', 'cancelled']);
export const workflowRunSchema = z.object({
  id: z.uuid(),
  conversationId: z.uuid(),
  userMessageId: z.uuid(),
  status: runStatusSchema,
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  lastEventSequence: z.number().int().nonnegative(),
});
export const runEventTypeSchema = z.enum([
  'run.started',
  'plan.ready',
  'task.started',
  'task.completed',
  'answer.delta',
  'source',
  'run.completed',
  'run.failed',
  'run.cancelled',
]);
export const runEventSchema = z.object({
  id: z.uuid(),
  runId: z.uuid(),
  seq: z.number().int().positive(),
  type: runEventTypeSchema,
  message: z.string().max(20000).nullable(),
  taskId: z.string().max(80).nullable(),
  createdAt: z.iso.datetime({ offset: true }),
});
export const workflowRunResponseSchema = z.object({ data: workflowRunSchema });
export const workflowRunsResponseSchema = z.object({ data: z.array(workflowRunSchema) });
export const runEventsQuerySchema = z
  .object({ after: z.coerce.number().int().min(0).max(2147483647).default(0) })
  .strict();
export type AnswerSource = z.infer<typeof answerSourceSchema>;
export type WorkflowRun = z.infer<typeof workflowRunSchema>;
export type RunEvent = z.infer<typeof runEventSchema>;
export type RunEventType = z.infer<typeof runEventTypeSchema>;
