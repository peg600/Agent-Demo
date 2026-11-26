import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createWorkflowWorker } from './worker.js';
import { AgentExecutionError, type AgentEngine, type WorkflowRepository } from './ports.js';

function fixture() {
  const claim = {
    runId: randomUUID(),
    conversationId: randomUUID(),
    input: '参拍流程',
    history: [],
    leaseToken: randomUUID(),
    attempt: 1,
  };
  const repository: WorkflowRepository = {
    detail: vi.fn(),
    list: vi.fn(),
    events: vi.fn(),
    cancel: vi.fn(),
    claim: vi.fn().mockResolvedValueOnce(claim).mockResolvedValue(null),
    heartbeat: vi.fn().mockResolvedValue(true),
    append: vi.fn().mockResolvedValue(true),
    complete: vi.fn().mockResolvedValue(true),
    fail: vi.fn().mockResolvedValue(true),
    close: vi.fn(),
  };
  const engine: AgentEngine = {
    execute: vi.fn().mockResolvedValue({ answer: '演示回答', sources: [] }),
    close: vi.fn(),
  };
  return { repository, engine, claim };
}
const waitingEngine: AgentEngine['execute'] = async (_input, { signal }) =>
  new Promise((_resolve, reject) => {
    signal.throwIfAborted();
    signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  });

describe('durable workflow worker without external services', () => {
  it('claims once, fences writes, and commits the answer through the repository', async () => {
    const { repository, engine, claim } = fixture();
    const worker = createWorkflowWorker(repository, engine);
    worker.start();
    worker.wake();
    await vi.waitFor(() => expect(repository.complete).toHaveBeenCalledOnce());
    await worker.stop();
    expect(repository.claim).toHaveBeenCalledOnce();
    expect(repository.complete).toHaveBeenCalledWith(
      claim.runId,
      claim.leaseToken,
      { answer: '演示回答', sources: [] },
      expect.any(Date),
    );
    expect(repository.append).not.toHaveBeenCalled(); // no uncommitted deltas
    expect(repository.fail).not.toHaveBeenCalled();
  });
  it('does not publish an answer or terminal failure after its lease is lost', async () => {
    const { repository, engine } = fixture();
    vi.mocked(engine.execute).mockImplementation(waitingEngine);
    vi.mocked(repository.heartbeat).mockResolvedValue(false);
    const worker = createWorkflowWorker(repository, engine, { heartbeatMs: 5 });
    worker.start();
    await vi.waitFor(() => expect(repository.heartbeat).toHaveBeenCalled());
    await worker.stop();
    expect(repository.complete).not.toHaveBeenCalled();
    expect(repository.fail).not.toHaveBeenCalled();
  });
  it('marks timeouts with a fixed safe failure', async () => {
    const { repository, engine } = fixture();
    vi.mocked(engine.execute).mockImplementation(waitingEngine);
    const worker = createWorkflowWorker(repository, engine, { timeoutMs: 5 });
    worker.start();
    await vi.waitFor(() => expect(repository.fail).toHaveBeenCalled());
    await worker.stop();
    expect(vi.mocked(repository.fail).mock.calls[0]?.[2]).toBe('RUN_TIMEOUT');
    expect(repository.complete).not.toHaveBeenCalled();
  });
  it('shutdown aborts work without making a recoverable lease terminal', async () => {
    const { repository, engine } = fixture();
    vi.mocked(engine.execute).mockImplementation(waitingEngine);
    const worker = createWorkflowWorker(repository, engine);
    worker.start();
    await vi.waitFor(() => expect(engine.execute).toHaveBeenCalled());
    await worker.stop();
    expect(repository.fail).not.toHaveBeenCalled();
    expect(repository.complete).not.toHaveBeenCalled();
  });
  it('never persists raw provider errors or unknown error codes', async () => {
    for (const error of [
      new Error('secret postgres://password'),
      new AgentExecutionError('api-key-secret'),
    ]) {
      const { repository, engine } = fixture();
      vi.mocked(engine.execute).mockRejectedValue(error);
      const worker = createWorkflowWorker(repository, engine);
      worker.start();
      await vi.waitFor(() => expect(repository.fail).toHaveBeenCalled());
      await worker.stop();
      const args = vi.mocked(repository.fail).mock.calls[0]!;
      expect(args[2]).toBe('RUN_FAILED');
      expect(args[3]).not.toMatch(/secret|password|postgres/);
    }
  });
});
