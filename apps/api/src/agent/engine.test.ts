import { MemorySaver } from '@langchain/langgraph';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createCheckpointedEngine } from './engine.js';
import { orderedTasks, planTasks, type AgentTask } from './planner.js';
import { AgentError, bounded } from './errors.js';
import type { StructuredModel } from '../adapters/openai.js';
import type { AuctionRepository } from '../repositories/auction-repository.js';
import type { KnowledgeRetriever, KnowledgeChunk } from '../adapters/ragflow.js';
import type { AgentEvent, RunInput } from './ports.js';

const input: RunInput = {
  runId: 'test-run',
  conversationId: 'test-conversation',
  input: '须知和拍场',
  history: [],
};
const signal = () => new AbortController().signal;
const args = {
  q: null,
  city: null,
  category: null,
  status: null,
  dateFrom: null,
  dateTo: null,
  recommend: false,
};
const task = (id: string, dependsOn: string[] = []): AgentTask => ({
  taskId: id,
  type: 'knowledge',
  question: id,
  dependsOn,
  arguments: args,
});
const chunk: KnowledgeChunk = {
  id: 'chunk',
  documentId: 'doc',
  title: '演示资料',
  url: null,
  version: '1',
  excerpt: '演示内容',
  text: '演示内容',
  score: 0.9,
};
function model(tasks: AgentTask[]): StructuredModel {
  return {
    async generate<T>(name: string, schema: z.ZodType<T>) {
      return schema.parse(
        name === 'customer_plan'
          ? { tasks }
          : name === 'knowledge_ranking'
            ? { ids: ['chunk'] }
            : { answer: '演示回答', citationIds: ['chunk'] },
      );
    },
  };
}
function fixture(
  tasks = [task('one')],
  retrieve: KnowledgeRetriever['retrieve'] = async () => [chunk],
  maxTools = 8,
) {
  const retriever = { retrieve: vi.fn(retrieve) };
  const engine = createCheckpointedEngine({
    model: model(tasks),
    retriever,
    auctions: {} as AuctionRepository,
    checkpointer: new MemorySaver(),
    maxTools,
  });
  return { engine, retriever };
}

describe('LangGraph plan and checkpointed execution (no services)', () => {
  it('orders dependencies and rejects duplicate, missing, cyclic, oversize and invalid dates', () => {
    expect(
      orderedTasks({ tasks: [task('two', ['one']), task('one')] }).map((t) => t.taskId),
    ).toEqual(['one', 'two']);
    for (const tasks of [
      [task('one'), task('one')],
      [task('one', ['absent'])],
      [task('one', ['two']), task('two', ['one'])],
      Array.from({ length: 6 }, (_, i) => task(`a${i}`)),
      [{ ...task('one'), arguments: { ...args, dateFrom: '2027-01-02', dateTo: '2027-01-01' } }],
    ]) {
      expect(() => orderedTasks({ tasks })).toThrow();
    }
  });
  it('repairs an invalid plan once, then asks for clarification', async () => {
    const generate = vi.fn(async () => {
      throw new AgentError('MODEL_OUTPUT', 'invalid');
    });
    const result = await planTasks({ generate }, input, signal(), 5, new Date());
    expect(generate).toHaveBeenCalledTimes(2);
    expect(result[0]?.type).toBe('clarify');
  });
  it('reuses a completed checkpoint without calling tools or emitting twice', async () => {
    const { engine, retriever } = fixture();
    const emit = vi.fn(async () => {});
    const first = await engine.execute(input, { signal: signal(), emit });
    const count = emit.mock.calls.length;
    const second = await engine.execute(input, { signal: signal(), emit });
    expect(second).toEqual(first);
    expect(first.answer).toBe('演示回答');
    expect(first.sources[0]?.id).toBe('chunk');
    expect(retriever.retrieve).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledTimes(count);
  });
  it('resumes at a persisted task boundary after a failure without repeating completed retrieval', async () => {
    const { engine, retriever } = fixture([task('first'), task('second', ['first'])]);
    await expect(
      engine.execute(input, {
        signal: signal(),
        emit: async (event) => {
          if (event.type === 'task.started' && event.taskId === 'second')
            throw new Error('simulated process failure');
        },
      }),
    ).rejects.toThrow('simulated process failure');
    const answer = await engine.execute(input, { signal: signal(), emit: async () => {} });
    expect(answer.answer).toContain('second');
    expect(retriever.retrieve.mock.calls.map((call) => call[0])).toEqual(['first', 'second']);
  });
  it('reserves each retry against the durable tool budget', async () => {
    const { engine, retriever } = fixture(
      [task('one'), task('two')],
      async () => {
        throw new AgentError('RETRIEVAL_UNAVAILABLE', 'offline', true);
      },
      2,
    );
    await expect(
      engine.execute(input, { signal: signal(), emit: async () => {} }),
    ).rejects.toMatchObject({ code: 'TOOL_BUDGET' });
    expect(retriever.retrieve).toHaveBeenCalledTimes(2);
  });
  it('does not call tools after cancellation and aborts a stuck operation', async () => {
    const { engine, retriever } = fixture();
    const controller = new AbortController();
    controller.abort();
    await expect(
      engine.execute(input, { signal: controller.signal, emit: async () => {} }),
    ).rejects.toMatchObject({ code: 'RUN_CANCELLED' });
    expect(retriever.retrieve).not.toHaveBeenCalled();
    await expect(bounded(signal(), 5, async () => new Promise(() => {}))).rejects.toMatchObject({
      code: 'TOOL_TIMEOUT',
    });
  });
  it('does not fabricate answers when retrieval is empty and emits only application events', async () => {
    const { engine } = fixture([task('one')], async () => []);
    const events: AgentEvent[] = [];
    const result = await engine.execute(input, {
      signal: signal(),
      emit: async (event) => {
        events.push(event);
      },
    });
    expect(result.sources).toEqual([]);
    expect(result.answer).toContain('无法确认');
    expect(events.map((event) => event.type)).toEqual([
      'plan.ready',
      'task.started',
      'task.completed',
    ]);
  });
  it('charges a replayed execute node after checkpoint recovery against the same budget', async () => {
    const { engine, retriever } = fixture([task('one')], async () => [chunk], 1);
    await expect(
      engine.execute(input, {
        signal: signal(),
        emit: async (event) => {
          if (event.type === 'task.completed') throw new Error('crash before task checkpoint');
        },
      }),
    ).rejects.toThrow();
    expect(retriever.retrieve).toHaveBeenCalledTimes(1);
    await expect(
      engine.execute(input, { signal: signal(), emit: async () => {} }),
    ).rejects.toMatchObject({ code: 'TOOL_BUDGET' });
    expect(retriever.retrieve).toHaveBeenCalledTimes(1);
  });
});
