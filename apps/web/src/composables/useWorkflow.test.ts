import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorkflowRun } from '@gard/contracts';
import { useWorkflow } from './useWorkflow.js';

const conversationA = '857a9b9c-849c-48dc-af02-e1094ba56bf2';
const conversationB = '93d49f78-51e7-4077-88c3-73053f112351';
const runId = 'c80de3f1-57be-400b-bbda-69369a5769b3';
function run(conversationId: string, status: WorkflowRun['status']): WorkflowRun {
  return {
    id: runId,
    conversationId,
    userMessageId: 'a93dcf07-466c-408e-8e23-684f57d516ad',
    status,
    createdAt: '2026-11-27T00:00:00Z',
    updatedAt: '2026-11-27T00:00:00Z',
    errorCode: null,
    errorMessage: null,
    lastEventSequence: 0,
  };
}
const json = (data: unknown) =>
  new Response(JSON.stringify({ data }), { headers: { 'Content-Type': 'application/json' } });
afterEach(() => vi.unstubAllGlobals());

describe('workflow lifecycle without external services', () => {
  it('ignores a late result from a previously selected conversation', async () => {
    let release!: (value: Response) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        url.includes(conversationA)
          ? new Promise<Response>((resolve) => {
              release = resolve;
            })
          : Promise.resolve(json([run(conversationB, 'completed')])),
      ),
    );
    const onTerminal = vi.fn(async () => {});
    const state = useWorkflow({ onUnauthorized: vi.fn(), onTerminal });
    const pending = state.load(conversationA);
    await state.load(conversationB);
    release(json([run(conversationA, 'failed')]));
    await pending;
    expect(state.run.value?.conversationId).toBe(conversationB);
    expect(onTerminal).toHaveBeenCalledTimes(1);
    state.reset();
  });
  it('does not invalidate the new page identity for a stale stream 401', async () => {
    let release!: (value: Response) => void;
    const started = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url.includes('/events')) {
          started();
          return new Promise<Response>((resolve) => {
            release = resolve;
          });
        }
        return Promise.resolve(
          json(
            url.includes('/conversations/')
              ? [run(conversationA, 'running')]
              : run(conversationA, 'running'),
          ),
        );
      }),
    );
    const onUnauthorized = vi.fn();
    const state = useWorkflow({ onUnauthorized, onTerminal: vi.fn(async () => {}) });
    await state.load(conversationA);
    await vi.waitFor(() => expect(started).toHaveBeenCalledOnce());
    state.reset();
    release(new Response(null, { status: 401 }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onUnauthorized).not.toHaveBeenCalled();
    expect(state.run.value).toBeNull();
  });
  it('finishes a streamed answer by refreshing persisted history once', async () => {
    let statusRequests = 0;
    const events = [
      { seq: 1, type: 'answer.delta', message: '演示回答' },
      { seq: 2, type: 'run.completed', message: null },
    ]
      .map(
        (event) =>
          `id: ${event.seq}\nevent: run-event\ndata: ${JSON.stringify({ id: 'a62c81ad-09fb-4df3-aae1-87bbfa399068', runId, taskId: null, createdAt: '2026-11-27T00:00:00Z', ...event })}\n\n`,
      )
      .join('');
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url.includes('/events'))
          return Promise.resolve(
            new Response(events, { headers: { 'Content-Type': 'text/event-stream' } }),
          );
        if (url.includes('/conversations/'))
          return Promise.resolve(json([run(conversationA, 'running')]));
        statusRequests += 1;
        return Promise.resolve(
          json(run(conversationA, statusRequests === 1 ? 'running' : 'completed')),
        );
      }),
    );
    const onTerminal = vi.fn(async () => {});
    const state = useWorkflow({ onUnauthorized: vi.fn(), onTerminal });
    await state.load(conversationA);
    await vi.waitFor(() => expect(onTerminal).toHaveBeenCalledOnce());
    expect(state.busy.value).toBe(false);
    expect(state.events.value.map((event) => event.seq)).toEqual([1, 2]);
    expect(state.partialAnswer.value).toBe('');
    expect(state.connection.value).toBe('idle');
    state.reset();
  });
  it('surfaces a current 401 for explicit identity recovery', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 401 })),
    );
    const onUnauthorized = vi.fn();
    const state = useWorkflow({ onUnauthorized, onTerminal: vi.fn(async () => {}) });
    await state.load(conversationA);
    expect(onUnauthorized).toHaveBeenCalledOnce();
    state.reset();
  });
});
