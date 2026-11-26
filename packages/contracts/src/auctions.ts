import { z } from 'zod';

export const auctionStatusSchema = z.enum(['upcoming', 'ongoing', 'ended']);
export const auctionCategorySchema = z.enum([
  'painting',
  'porcelain',
  'jewelry',
  'wine',
  'books',
  'contemporary',
]);
export const auctionCategoryLabels: Record<z.infer<typeof auctionCategorySchema>, string> = {
  painting: '中国书画',
  porcelain: '瓷器与工艺品',
  jewelry: '珠宝翡翠',
  wine: '佳酿与茶',
  books: '古籍善本',
  contemporary: '二十世纪及当代艺术',
};
export const auctionStatusLabels: Record<z.infer<typeof auctionStatusSchema>, string> = {
  upcoming: '即将开始',
  ongoing: '进行中',
  ended: '已结束',
};
export const auctionIdSchema = z.string().regex(/^demo-[a-z0-9-]{1,70}$/);
const instant = z.iso.datetime({ offset: true });
const provenance = {
  isDemo: z.literal(true),
  sourceNote: z.string(),
  sourceUrl: z.url().nullable(),
};
export const auctionEventRecordSchema = z.object({
  id: auctionIdSchema,
  title: z.string(),
  city: z.string(),
  venue: z.string(),
  address: z.string(),
  startsAt: instant,
  endsAt: instant,
  previewStartsAt: instant,
  previewEndsAt: instant,
  description: z.string(),
  ...provenance,
});
export const auctionSessionRecordSchema = z.object({
  id: auctionIdSchema,
  eventId: auctionIdSchema,
  title: z.string(),
  category: auctionCategorySchema,
  startsAt: instant,
  endsAt: instant,
  hall: z.string(),
  lotCount: z.number().int().nonnegative(),
  description: z.string(),
  ...provenance,
});
export const auctionEventSchema = auctionEventRecordSchema.extend({
  status: auctionStatusSchema,
  sessionCount: z.number().int().nonnegative(),
});
export const auctionSessionSchema = auctionSessionRecordSchema.extend({
  status: auctionStatusSchema,
  eventTitle: z.string(),
  city: z.string(),
  venue: z.string(),
});
export const catalogueMetaSchema = z.object({ isDemo: z.literal(true), asOf: instant });
const paging = {
  page: z.coerce.number().int().min(1).max(10000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(12),
};
const filters = {
  q: z.string().trim().max(100).optional(),
  city: z.string().trim().min(1).max(40).optional(),
  status: auctionStatusSchema.optional(),
};
export const auctionEventsQuerySchema = z.object({ ...paging, ...filters }).strict();
export const auctionSessionsQuerySchema = z
  .object({
    ...paging,
    ...filters,
    eventId: auctionIdSchema.optional(),
    category: auctionCategorySchema.optional(),
    dateFrom: z.iso.date().optional(),
    dateTo: z.iso.date().optional(),
    sort: z.enum(['startAsc', 'startDesc']).default('startAsc'),
  })
  .strict()
  .refine((v) => !v.dateFrom || !v.dateTo || v.dateFrom <= v.dateTo, {
    message: 'dateFrom must not exceed dateTo',
    path: ['dateTo'],
  });
export const auctionRecommendationsQuerySchema = z
  .object({
    city: filters.city,
    category: auctionCategorySchema.optional(),
    limit: z.coerce.number().int().min(1).max(10).default(4),
  })
  .strict();
const pagination = {
  total: z.number().int().nonnegative(),
  page: z.number().int(),
  pageSize: z.number().int(),
  meta: catalogueMetaSchema,
};
export const auctionEventsResponseSchema = z.object({
  data: z.array(auctionEventSchema),
  ...pagination,
});
export const auctionSessionsResponseSchema = z.object({
  data: z.array(auctionSessionSchema),
  ...pagination,
});
export const auctionEventDetailResponseSchema = z.object({
  data: auctionEventSchema,
  sessions: z.array(auctionSessionSchema),
  meta: catalogueMetaSchema,
});
export const auctionSessionDetailResponseSchema = z.object({
  data: auctionSessionSchema,
  event: auctionEventSchema,
  meta: catalogueMetaSchema,
});
export const auctionRecommendationsResponseSchema = z.object({
  data: z.array(z.object({ session: auctionSessionSchema, reasons: z.array(z.string()) })),
  meta: catalogueMetaSchema,
});
export const apiErrorSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});

export type AuctionEventRecord = z.infer<typeof auctionEventRecordSchema>;
export type AuctionSessionRecord = z.infer<typeof auctionSessionRecordSchema>;
export type AuctionEvent = z.infer<typeof auctionEventSchema>;
export type AuctionSession = z.infer<typeof auctionSessionSchema>;
export type AuctionEventsQuery = z.infer<typeof auctionEventsQuerySchema>;
export type AuctionSessionsQuery = z.infer<typeof auctionSessionsQuerySchema>;
export type AuctionRecommendationsQuery = z.infer<typeof auctionRecommendationsQuerySchema>;
export type AuctionEventsResponse = z.infer<typeof auctionEventsResponseSchema>;
export type AuctionSessionsResponse = z.infer<typeof auctionSessionsResponseSchema>;
export type AuctionEventDetailResponse = z.infer<typeof auctionEventDetailResponseSchema>;
export type AuctionSessionDetailResponse = z.infer<typeof auctionSessionDetailResponseSchema>;
export type AuctionRecommendationsResponse = z.infer<typeof auctionRecommendationsResponseSchema>;
