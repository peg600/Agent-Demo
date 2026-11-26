import { auctionRecommendationsQuerySchema, auctionSessionsQuerySchema } from '@gard/contracts';
import type { AuctionRepository } from '../repositories/auction-repository.js';
import type { AgentTask } from '../agent/planner.js';
import { bounded } from '../agent/errors.js';
import type { AgentAnswer } from '../agent/ports.js';

export async function answerAuctions(
  task: AgentTask,
  repository: AuctionRepository,
  signal: AbortSignal,
  timeout: number,
): Promise<AgentAnswer> {
  const args = task.arguments;
  const now = new Date();
  const data = await bounded(signal, timeout, async () => {
    if (args.recommend && !args.dateFrom && !args.dateTo && !args.status && !args.q) {
      const filters = auctionRecommendationsQuerySchema.parse({
        ...(args.city ? { city: args.city } : {}),
        ...(args.category ? { category: args.category } : {}),
        limit: 5,
      });
      return (await repository.recommendations(filters, now)).map((result) => result.session);
    }
    const filters = auctionSessionsQuerySchema.parse({
      page: 1,
      pageSize: 5,
      sort: 'startAsc',
      ...Object.fromEntries(
        Object.entries({
          q: args.q,
          city: args.city,
          category: args.category,
          status: args.status,
          dateFrom: args.dateFrom,
          dateTo: args.dateTo,
        }).filter(([, value]) => value !== null),
      ),
    });
    return (await repository.listSessions(filters, now)).data;
  });
  const date = (value: string) =>
    new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai',
      dateStyle: 'short',
      timeStyle: 'short',
      hour12: false,
    }).format(new Date(value));
  return {
    answer: data.length
      ? `以下为本地虚构演示拍场，非官网实时档期（北京时间），最多展示5场：\n${data.map((s) => `• ${s.title}｜${s.city}｜${date(s.startsAt)} 至 ${date(s.endsAt)}｜${s.status === 'ongoing' ? '进行中' : s.status === 'upcoming' ? '即将开始' : '已结束'}\n  目录：/sessions/${s.id}`).join('\n')}`
      : '本地演示目录中没有符合条件的拍场。请调整类别、城市或日期；这不代表中国嘉德官网没有相应场次。',
    sources: [],
  };
}
