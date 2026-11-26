import { z } from 'zod';
import { answerSourceSchema } from './workflows.js';

const instant = z.iso.datetime({ offset: true });
export const conversationIdSchema = z.uuid();
export const visitorSessionResponseSchema = z.object({
  data: z.object({ expiresAt: instant }),
});
export const createConversationSchema = z
  .object({
    clientConversationId: z.uuid(),
    title: z.string().trim().min(1).max(100).default('新会话'),
  })
  .strict();
export const conversationSchema = z.object({
  id: conversationIdSchema,
  title: z.string(),
  createdAt: instant,
  updatedAt: instant,
  messageCount: z.number().int().nonnegative(),
});
export const conversationListQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(10000).default(1),
    pageSize: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict();
export const conversationListResponseSchema = z.object({
  data: z.array(conversationSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
});
export const createConversationResponseSchema = z.object({
  data: conversationSchema,
  duplicate: z.boolean(),
});
export const conversationDetailResponseSchema = z.object({ data: conversationSchema });
export const sendMessageSchema = z
  .object({
    clientMessageId: z.uuid(),
    content: z.string().trim().min(1).max(4000),
  })
  .strict();
export const conversationMessageSchema = z.object({
  id: z.uuid(),
  conversationId: conversationIdSchema,
  clientMessageId: z.uuid().nullable(),
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string(),
  sequence: z.number().int().positive(),
  createdAt: instant,
  runId: z.uuid().nullable().default(null),
  sources: z.array(answerSourceSchema).max(50).default([]),
});
export const messageListQuerySchema = z
  .object({
    beforeSequence: z.coerce.number().int().min(1).max(2147483647).optional(),
    limit: z.coerce.number().int().min(1).max(50).default(30),
  })
  .strict();
export const messageListResponseSchema = z.object({
  data: z.array(conversationMessageSchema),
  nextBeforeSequence: z.number().int().positive().nullable(),
  hasMore: z.boolean(),
});
// Old stored messages remain readable; new messages enqueue a durable workflow.
export const sendMessageResponseSchema = z.object({
  data: conversationMessageSchema,
  duplicate: z.boolean(),
  processing: z.enum(['not_configured', 'queued']),
  runId: z.uuid().nullable().default(null),
});
export type Conversation = z.infer<typeof conversationSchema>;
export type ConversationMessage = z.infer<typeof conversationMessageSchema>;
export type CreateConversationInput = z.infer<typeof createConversationSchema>;
export type ConversationListQuery = z.infer<typeof conversationListQuerySchema>;
export type SendMessageInput = z.infer<typeof sendMessageSchema>;
export type MessageListQuery = z.infer<typeof messageListQuerySchema>;
export type VisitorSessionResponse = z.infer<typeof visitorSessionResponseSchema>;
export type ConversationListResponse = z.infer<typeof conversationListResponseSchema>;
export type CreateConversationResponse = z.infer<typeof createConversationResponseSchema>;
export type ConversationDetailResponse = z.infer<typeof conversationDetailResponseSchema>;
export type MessageListResponse = z.infer<typeof messageListResponseSchema>;
export type SendMessageResponse = z.infer<typeof sendMessageResponseSchema>;
