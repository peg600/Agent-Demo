import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  createKnowledgeRetriever,
  normalizeRetrieval,
  sourceManifestSchema,
  type KnowledgeChunk,
} from './ragflow.js';
import { createStructuredModel, type StructuredModel } from './openai.js';
import { answerKnowledge, validateGroundedAnswer } from '../tools/knowledge.js';

const now = new Date('2026-11-27T12:00:00Z');
const source = {
  documentId: 'doc',
  datasetId: 'dataset',
  title: 'demo',
  version: 'v1',
  url: null,
  approved: true,
  effectiveAt: '2026-11-27T00:00:00Z',
  expiresAt: '2027-11-27T00:00:00Z',
};
const rawChunk = {
  id: 'chunk',
  document_id: 'doc',
  dataset_id: 'dataset',
  content: '演示内容',
  similarity: 0.8,
};
const payload = (chunks = [rawChunk]) => ({ code: 0, data: { chunks } });
const chunk: KnowledgeChunk = {
  id: 'chunk',
  documentId: 'doc',
  title: 'demo',
  version: 'v1',
  url: null,
  excerpt: 'test',
  text: 'test',
  score: 0.8,
};
const signal = () => new AbortController().signal;

describe('knowledge evidence and adapter boundaries', () => {
  it('accepts only approved, current mapped sources and relevant chunks from the configured dataset', () => {
    expect(normalizeRetrieval(payload(), { sources: [source] }, ['dataset'], now)).toHaveLength(1);
    for (const changed of [
      { ...source, approved: false },
      { ...source, expiresAt: now.toISOString() },
      { ...source, effectiveAt: '2028-01-01T00:00:00Z' },
      { ...source, datasetId: 'other' },
    ]) {
      expect(normalizeRetrieval(payload(), { sources: [changed] }, ['dataset'], now)).toEqual([]);
    }
    expect(
      normalizeRetrieval(
        payload([{ ...rawChunk, similarity: 0.1 }]),
        { sources: [source] },
        ['dataset'],
        now,
      ),
    ).toEqual([]);
    expect(normalizeRetrieval(payload(), { sources: [] }, ['dataset'], now)).toEqual([]);
    expect(
      normalizeRetrieval(payload([rawChunk, rawChunk]), { sources: [source] }, ['dataset'], now),
    ).toHaveLength(1);
  });
  it('rejects HTTP-success business errors and malformed payloads', () => {
    for (const value of [
      { code: 102, data: { chunks: [] } },
      { code: 0 },
      { code: 0, data: { chunks: [{}] } },
    ]) {
      expect(() => normalizeRetrieval(value, { sources: [source] }, ['dataset'], now)).toThrow();
    }
  });
  it('validates timestamps by instant, rejects unsafe URLs and duplicate mappings', () => {
    expect(
      sourceManifestSchema.safeParse({
        sources: [
          {
            ...source,
            effectiveAt: '2026-11-27T08:00:00+08:00',
            expiresAt: '2026-11-27T01:00:00Z',
          },
        ],
      }).success,
    ).toBe(true);
    expect(
      sourceManifestSchema.safeParse({ sources: [{ ...source, url: 'javascript:alert(1)' }] })
        .success,
    ).toBe(false);
    expect(sourceManifestSchema.safeParse({ sources: [source, source] }).success).toBe(false);
  });
  it('rejects fabricated citations and retains only selected evidence', () => {
    expect(
      validateGroundedAnswer({ answer: 'made up', citationIds: ['unknown'] }, [chunk]).answer,
    ).not.toBe('made up');
    expect(validateGroundedAnswer({ answer: 'test', citationIds: [] }, [chunk]).sources).toEqual(
      [],
    );
    expect(
      validateGroundedAnswer({ answer: 'test', citationIds: ['chunk', 'chunk'] }, [chunk]).sources,
    ).toHaveLength(1);
  });
  it('falls back to retrieval ordering for invalid rerank IDs but validates the final answer', async () => {
    const model: StructuredModel = {
      async generate<T>(name: string, schema: z.ZodType<T>) {
        return schema.parse(
          name === 'knowledge_ranking'
            ? { ids: ['not-a-candidate'] }
            : { answer: 'grounded', citationIds: ['chunk'] },
        );
      },
    };
    expect(
      (await answerKnowledge('question', [], model, { retrieve: async () => [chunk] }, signal()))
        .answer,
    ).toBe('grounded');
  });
  it('fails closed before any network call when model or knowledge configuration is absent', async () => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(
      createKnowledgeRetriever({}, fetcher).retrieve('question', signal()),
    ).rejects.toMatchObject({ code: 'KNOWLEDGE_NOT_CONFIGURED' });
    expect(fetcher).not.toHaveBeenCalled();
    await expect(
      createStructuredModel({}).generate(
        'test',
        z.object({ text: z.string() }),
        'system',
        {},
        signal(),
      ),
    ).rejects.toMatchObject({ code: 'MODEL_NOT_CONFIGURED' });
  });
});
