import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AuctionRepository } from '../repositories/auction-repository.js';

const state = vi.hoisted(() => ({
  query: vi.fn(),
  release: vi.fn(),
  end: vi.fn(),
}));
vi.mock('pg', () => ({
  Pool: class {
    on() {}
    async connect() {
      return { query: state.query, release: state.release };
    }
    async end() {
      await state.end();
    }
  },
}));
import { createAgentEngine } from './engine.js';

const input = {
  runId: 'lock-test-run',
  conversationId: 'lock-test-conversation',
  input: '问题',
  history: [],
};
function fixture() {
  state.query.mockReset();
  state.release.mockReset();
  state.end.mockReset();
  vi.stubEnv('CHECKPOINT_DATABASE_URL', 'postgres://test-only.invalid/test');
  vi.stubEnv('OPENAI_API_KEY', 'test-key-never-sent');
  vi.stubEnv('OPENAI_CHAT_MODEL', 'test-model');
  vi.stubEnv('MAX_TASKS_PER_MESSAGE', '5');
  vi.stubEnv('MAX_TOOL_CALLS_PER_RUN', '8');
  vi.stubEnv('TOOL_TIMEOUT_MS', '15000');
  vi.stubEnv('RERANK_MODE', 'none');
  return createAgentEngine({} as AuctionRepository);
}
afterEach(() => vi.unstubAllEnvs());

describe('checkpoint advisory lock connection lifecycle (mock driver)', () => {
  it('waits for an in-flight acquire query to settle after abort, then unlocks before release', async () => {
    const engine = fixture();
    let finish!: (result: { rows: { locked: boolean }[] }) => void;
    state.query.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    state.query.mockResolvedValueOnce({ rows: [{ pg_advisory_unlock: true }] });
    const controller = new AbortController();
    const execution = engine.execute(input, { signal: controller.signal, emit: async () => {} });
    await vi.waitFor(() => expect(state.query).toHaveBeenCalledOnce());
    controller.abort();
    await Promise.resolve();
    await Promise.resolve();
    expect(state.release).not.toHaveBeenCalled();
    finish({ rows: [{ locked: true }] });
    await expect(execution).rejects.toMatchObject({ code: 'RUN_CANCELLED' });
    expect(state.query.mock.calls[1]?.[0]).toContain('pg_advisory_unlock');
    expect(state.release).toHaveBeenCalledWith(false);
    expect(state.query.mock.invocationCallOrder[1]!).toBeLessThan(
      state.release.mock.invocationCallOrder[0]!,
    );
    await engine.close();
  });

  it('destroys a connection when the lock acquisition result is uncertain', async () => {
    const engine = fixture();
    state.query.mockRejectedValueOnce(new Error('simulated query failure'));
    await expect(
      engine.execute(input, { signal: new AbortController().signal, emit: async () => {} }),
    ).rejects.toMatchObject({ code: 'CHECKPOINT_UNAVAILABLE' });
    expect(state.query).toHaveBeenCalledOnce();
    expect(state.release).toHaveBeenCalledWith(true);
    await engine.close();
  });

  it('destroys a connection when unlock fails after an aborted acquisition', async () => {
    const engine = fixture();
    const controller = new AbortController();
    state.query.mockImplementationOnce(async () => {
      controller.abort();
      return { rows: [{ locked: true }] };
    });
    state.query.mockRejectedValueOnce(new Error('simulated unlock failure'));
    await expect(
      engine.execute(input, { signal: controller.signal, emit: async () => {} }),
    ).rejects.toMatchObject({ code: 'RUN_CANCELLED' });
    expect(state.release).toHaveBeenCalledWith(true);
    await engine.close();
  });
});
