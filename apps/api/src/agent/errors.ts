import { AgentExecutionError } from './ports.js';

export class AgentError extends AgentExecutionError {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable = false,
  ) {
    super(code);
    this.message = message;
  }
}

export function checkAbort(signal: AbortSignal) {
  if (signal.aborted) throw new AgentError('RUN_CANCELLED', '运行已停止。');
}

export async function bounded<T>(
  signal: AbortSignal,
  milliseconds: number,
  action: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  checkAbort(signal);
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener('abort', abort, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stopped = new Promise<never>((_resolve, reject) => {
    controller.signal.addEventListener(
      'abort',
      () =>
        reject(
          new AgentError(
            signal.aborted ? 'RUN_CANCELLED' : 'TOOL_TIMEOUT',
            signal.aborted ? '运行已停止。' : '服务调用超时。',
            !signal.aborted,
          ),
        ),
      { once: true },
    );
    timer = setTimeout(abort, milliseconds);
  });
  try {
    return await Promise.race([action(controller.signal), stopped]);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', abort);
  }
}

export function integerSetting(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  max: number,
) {
  const value = Number(env[name] ?? fallback);
  if (!Number.isInteger(value) || value < 1 || value > max)
    throw new AgentError('AGENT_CONFIG', '智能服务配置不完整。');
  return value;
}
