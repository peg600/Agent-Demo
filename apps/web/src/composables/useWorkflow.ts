import { computed, ref, shallowRef } from 'vue';
import {
  workflowRunResponseSchema,
  workflowRunsResponseSchema,
  type WorkflowRun,
  type RunEvent,
} from '@gard/contracts';
import { createRunEventParser } from './runEvents.js';

class WorkflowRequestError extends Error {
  constructor(readonly status: number) {
    super(`Workflow request failed: ${status}`);
  }
}
const terminal = (run: WorkflowRun) => !['queued', 'running'].includes(run.status);

export function useWorkflow(options: { onUnauthorized(): void; onTerminal(): Promise<void> }) {
  const run = shallowRef<WorkflowRun | null>(null);
  const events = shallowRef<RunEvent[]>([]);
  const partialAnswer = ref('');
  const loading = ref(false);
  const cancelling = ref(false);
  const error = ref('');
  const connection = ref<'idle' | 'connecting' | 'connected' | 'reconnecting' | 'disconnected'>(
    'idle',
  );
  const busy = computed(() => loading.value || !!(run.value && !terminal(run.value)));
  let generation = 0;
  let lifecycle = new AbortController();
  let conversationId = '';
  let cursor = 0;

  function valid(version: number) {
    return version === generation && !lifecycle.signal.aborted;
  }
  function reset() {
    generation += 1;
    lifecycle.abort();
    lifecycle = new AbortController();
    run.value = null;
    events.value = [];
    partialAnswer.value = '';
    loading.value = false;
    cancelling.value = false;
    error.value = '';
    connection.value = 'idle';
    conversationId = '';
    cursor = 0;
  }
  function report(cause: unknown, version: number) {
    if (!valid(version)) return;
    if (cause instanceof WorkflowRequestError && cause.status === 401) {
      options.onUnauthorized();
      return;
    }
    error.value =
      cause instanceof WorkflowRequestError && cause.status === 404
        ? '此运行不存在或不属于当前身份。'
        : '运行状态暂时无法读取，请重试连接。后台任务不会因页面断线自动取消。';
  }
  async function json<T>(
    path: string,
    schema: { parse(value: unknown): T },
    signal: AbortSignal,
    body?: object,
  ) {
    const response = await fetch(path, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
      credentials: 'same-origin',
      ...(body === undefined
        ? {}
        : {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          }),
    });
    if (!response.ok) throw new WorkflowRequestError(response.status);
    return schema.parse(await response.json());
  }
  async function refreshTerminal(version: number) {
    if (!valid(version)) return;
    connection.value = 'idle';
    partialAnswer.value = '';
    await options.onTerminal();
  }
  async function delay(ms: number, signal: AbortSignal) {
    if (signal.aborted) return;
    await new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        signal.removeEventListener('abort', done);
        resolve();
      };
      const timer = setTimeout(done, ms);
      signal.addEventListener('abort', done, { once: true });
    });
  }
  async function consume(id: string, version: number, signal: AbortSignal) {
    const connectionController = new AbortController();
    const streamSignal = AbortSignal.any([signal, connectionController.signal]);
    let idleTimer: ReturnType<typeof setTimeout>;
    const touch = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => connectionController.abort(), 45000);
    };
    touch();
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const response = await fetch(`/api/runs/${id}/events?after=${cursor}`, {
        credentials: 'same-origin',
        signal: streamSignal,
        headers: { Accept: 'text/event-stream' },
      });
      if (!response.ok) throw new WorkflowRequestError(response.status);
      if (!response.headers.get('content-type')?.includes('text/event-stream') || !response.body)
        throw new Error('Invalid event response');
      if (!valid(version)) return;
      connection.value = 'connected';
      error.value = '';
      reader = response.body.getReader();
      const decoder = new TextDecoder();
      const parser = createRunEventParser(id, cursor);
      while (valid(version)) {
        const result = await reader.read();
        if (result.done) break;
        touch();
        const incoming = parser.push(decoder.decode(result.value, { stream: true }));
        if (!valid(version)) return;
        for (const event of incoming) {
          cursor = event.seq;
          events.value = [...events.value, event].slice(-80);
          if (event.type === 'answer.delta')
            partialAnswer.value = (partialAnswer.value + (event.message ?? '')).slice(0, 20000);
          if (['run.completed', 'run.failed', 'run.cancelled'].includes(event.type)) return;
        }
      }
    } finally {
      clearTimeout(idleTimer!);
      connectionController.abort();
      await reader?.cancel().catch(() => undefined);
    }
  }
  async function follow(version: number) {
    const id = run.value?.id;
    if (!id || !valid(version)) return;
    const signal = lifecycle.signal;
    for (let attempt = 0; attempt <= 5 && valid(version); attempt++) {
      if (attempt) {
        connection.value = 'reconnecting';
        await delay(Math.min(1000 * 2 ** (attempt - 1), 10000), signal);
        if (!valid(version)) return;
      }
      try {
        const status = await json(`/api/runs/${id}`, workflowRunResponseSchema, signal);
        if (!valid(version)) return;
        run.value = status.data;
        if (terminal(status.data)) {
          await refreshTerminal(version);
          return;
        }
        connection.value = attempt ? 'reconnecting' : 'connecting';
        await consume(id, version, signal);
        if (!valid(version)) return;
        const latest = await json(`/api/runs/${id}`, workflowRunResponseSchema, signal);
        if (!valid(version)) return;
        run.value = latest.data;
        if (terminal(latest.data)) {
          await refreshTerminal(version);
          return;
        }
      } catch (cause) {
        if (!valid(version)) return;
        report(cause, version);
        if (cause instanceof WorkflowRequestError && [401, 404].includes(cause.status)) break;
      }
    }
    if (valid(version)) {
      connection.value = 'disconnected';
      error.value ||= '事件连接已断开，请点击重新连接查看最新状态。';
    }
  }
  async function load(id: string, preferredRunId?: string) {
    reset();
    conversationId = id;
    const version = generation;
    const signal = lifecycle.signal;
    loading.value = true;
    try {
      const result = await json(
        `/api/conversations/${id}/runs`,
        workflowRunsResponseSchema,
        signal,
      );
      if (!valid(version)) return;
      run.value =
        result.data.find((item) => !terminal(item)) ??
        result.data.find((item) => item.id === preferredRunId) ??
        result.data[0] ??
        null;
      if (run.value) {
        if (terminal(run.value)) await refreshTerminal(version);
        else void follow(version);
      }
    } catch (cause) {
      report(cause, version);
    } finally {
      if (valid(version)) loading.value = false;
    }
  }
  async function reconnect() {
    if (!conversationId) return;
    await load(conversationId, run.value?.id);
  }
  async function cancelRun() {
    if (!run.value || terminal(run.value) || cancelling.value) return;
    const version = generation;
    const id = run.value.id;
    cancelling.value = true;
    try {
      const result = await json(
        `/api/runs/${id}/cancel`,
        workflowRunResponseSchema,
        lifecycle.signal,
        {},
      );
      if (!valid(version)) return;
      run.value = result.data;
      error.value = '';
      if (terminal(result.data)) {
        cancelling.value = false;
        lifecycle.abort();
        lifecycle = new AbortController();
        generation += 1;
        await refreshTerminal(generation);
      }
    } catch (cause) {
      report(cause, version);
    } finally {
      if (valid(version)) cancelling.value = false;
    }
  }
  return {
    run,
    events,
    partialAnswer,
    loading,
    cancelling,
    error,
    connection,
    busy,
    load,
    reset,
    reconnect,
    cancelRun,
  };
}
