import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { z } from 'zod';
import type { AnswerSource } from '@gard/contracts';
import { AgentError, bounded, integerSetting } from '../agent/errors.js';

const sourceSchema = z
  .object({
    documentId: z.string().min(1).max(200),
    datasetId: z.string().min(1).max(200),
    title: z.string().min(1).max(300),
    version: z.string().min(1).max(100),
    url: z
      .url()
      .nullable()
      .refine((url) => url === null || ['http:', 'https:'].includes(new URL(url).protocol)),
    approved: z.boolean(),
    effectiveAt: z.iso.datetime({ offset: true }),
    expiresAt: z.iso.datetime({ offset: true }),
  })
  .strict()
  .refine((s) => new Date(s.effectiveAt).getTime() < new Date(s.expiresAt).getTime());
export const sourceManifestSchema = z
  .object({ sources: z.array(sourceSchema).max(1000) })
  .strict()
  .refine((m) => new Set(m.sources.map((s) => s.documentId)).size === m.sources.length);
export type SourceManifest = z.infer<typeof sourceManifestSchema>;
export type KnowledgeChunk = AnswerSource & { text: string; score: number };
export interface KnowledgeRetriever {
  retrieve(question: string, signal: AbortSignal): Promise<KnowledgeChunk[]>;
}
const responseSchema = z.object({
  code: z.number(),
  data: z
    .object({
      chunks: z
        .array(
          z.object({
            id: z.string().min(1).max(200),
            document_id: z.string(),
            dataset_id: z.string(),
            content: z.string().max(100000),
            similarity: z.number().finite(),
          }),
        )
        .max(100),
    })
    .optional(),
});

export function normalizeRetrieval(
  payload: unknown,
  manifest: SourceManifest,
  datasetIds: string[],
  now: Date,
): KnowledgeChunk[] {
  const parsed = responseSchema.safeParse(payload);
  if (!parsed.success || parsed.data.code !== 0 || !parsed.data.data)
    throw new AgentError('RETRIEVAL_RESPONSE', '知识检索返回无效结果。');
  const sources = new Map(
    manifest.sources
      .filter(
        (s) =>
          s.approved &&
          datasetIds.includes(s.datasetId) &&
          new Date(s.effectiveAt) <= now &&
          new Date(s.expiresAt) > now,
      )
      .map((s) => [s.documentId, s]),
  );
  const seen = new Set<string>();
  return parsed.data.data.chunks
    .flatMap((chunk) => {
      const source = sources.get(chunk.document_id);
      if (
        !source ||
        source.datasetId !== chunk.dataset_id ||
        chunk.similarity < 0.2 ||
        !chunk.content.trim() ||
        seen.has(chunk.id)
      )
        return [];
      seen.add(chunk.id);
      return [
        {
          id: chunk.id,
          documentId: chunk.document_id,
          title: source.title,
          url: source.url,
          version: source.version,
          excerpt: chunk.content.slice(0, 2000),
          text: chunk.content.slice(0, 6000),
          score: chunk.similarity,
        },
      ];
    })
    .slice(0, 10);
}

export function createKnowledgeRetriever(
  env: NodeJS.ProcessEnv = process.env,
  fetcher: typeof fetch = fetch,
): KnowledgeRetriever {
  return {
    async retrieve(question, signal) {
      const datasetIds = (env.RAGFLOW_DATASET_IDS ?? '')
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean);
      if (!env.RAGFLOW_API_KEY || !datasetIds.length || datasetIds.length > 20)
        throw new AgentError('KNOWLEDGE_NOT_CONFIGURED', '知识库尚未配置完成。');
      const base = new URL(env.RAGFLOW_BASE_URL ?? 'http://127.0.0.1:8080');
      if (
        !['http:', 'https:'].includes(base.protocol) ||
        base.username ||
        base.password ||
        base.search ||
        base.hash
      )
        throw new AgentError('AGENT_CONFIG', '知识库配置不完整。');
      const root = fileURLToPath(new URL('../../../../', import.meta.url));
      let manifest: SourceManifest;
      try {
        const sourceText = await readFile(
          resolve(root, env.KNOWLEDGE_SOURCES_PATH ?? 'knowledge/sources.local.json'),
          'utf8',
        );
        if (sourceText.length > 1_000_000) throw new Error('manifest size');
        manifest = sourceManifestSchema.parse(JSON.parse(sourceText));
      } catch {
        throw new AgentError('KNOWLEDGE_SOURCES', '知识来源清单尚未配置或格式无效。');
      }
      return bounded(
        signal,
        integerSetting(env, 'TOOL_TIMEOUT_MS', 15000, 60000),
        async (requestSignal) => {
          let response: Response;
          try {
            response = await fetcher(new URL('/api/v1/retrieval', base), {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${env.RAGFLOW_API_KEY}`,
              },
              body: JSON.stringify({
                question,
                dataset_ids: datasetIds,
                page: 1,
                page_size: 10,
                similarity_threshold: 0.2,
                keywords_similarity_weight: 0.7,
                highlight: false,
                include_knowledge_compilation: false,
              }),
              signal: requestSignal,
            });
          } catch {
            throw new AgentError('RETRIEVAL_UNAVAILABLE', '知识检索暂不可用。', true);
          }
          if (!response.ok)
            throw new AgentError(
              'RETRIEVAL_UNAVAILABLE',
              '知识检索暂不可用。',
              [408, 500, 502, 503, 504].includes(response.status),
            );
          const text = await response.text();
          if (text.length > 2_000_000)
            throw new AgentError('RETRIEVAL_RESPONSE', '知识检索返回无效结果。');
          let payload: unknown;
          try {
            payload = JSON.parse(text);
          } catch {
            throw new AgentError('RETRIEVAL_RESPONSE', '知识检索返回无效结果。');
          }
          return normalizeRetrieval(payload, manifest, datasetIds, new Date());
        },
      );
    },
  };
}
