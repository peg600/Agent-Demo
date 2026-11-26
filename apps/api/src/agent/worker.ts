import { AgentExecutionError, type AgentEngine, type WorkflowRepository } from './ports.js';

const failureMessages: Record<string, string> = {
  AGENT_NOT_CONFIGURED: '智能问答尚未配置完整，请配置模型、知识库和检查点后重试。',
  RETRIEVAL_UNAVAILABLE: '知识检索暂不可用，请稍后重新提问。',
  MODEL_UNAVAILABLE: '模型服务暂不可用，请检查模型配置后重新提问。',
  INVALID_PLAN: '暂时无法可靠拆解问题，请将问题分开或补充说明。',
  RUN_TIMEOUT: '本次处理已超时，请缩短问题后重新提问。',
  RUN_FAILED: '本次处理未完成，请稍后重新提问。',
  AGENT_CONFIG: '工作流配置无效，请检查服务端配置。',
  MODEL_NOT_CONFIGURED: '模型尚未配置，请填写模型名与API密钥。',
  MODEL_OUTPUT: '模型未返回可靠的结构化结果，请换一种方式提问。',
  KNOWLEDGE_NOT_CONFIGURED: '知识库尚未配置，请先准备知识库及文档映射。',
  KNOWLEDGE_SOURCES: '知识来源配置不可用，请检查已审核的来源清单。',
  RETRIEVAL_RESPONSE: '知识检索返回格式异常，请检查知识库配置。',
  TOOL_TIMEOUT: '业务工具调用超时，请稍后重新提问。',
  TOOL_BUDGET: '本次问题超过工具执行上限，请拆分问题。',
  CHECKPOINT_UNAVAILABLE: '工作流检查点不可用，请完成检查点初始化后重试。',
  CHECKPOINT_BUSY: '该任务的检查点仍在处理，请稍后重新提问。',
  CHECKPOINT_INVALID: '任务检查点不匹配，无法安全恢复，请重新提问。',
  AGENT_OUTPUT: '本次任务未生成有效答案，请重新提问。',
};

// One process executes one run at a time; DB leases also guard against another process.
export function createWorkflowWorker(
  repository: WorkflowRepository,
  engine: AgentEngine,
  options: {
    clock?: () => Date;
    pollMs?: number;
    heartbeatMs?: number;
    timeoutMs?: number;
    report?: () => void;
  } = {},
) {
  const now = options.clock ?? (() => new Date());
  const leaseSeconds = 120;
  let stopped = true;
  let timer: ReturnType<typeof setInterval> | undefined;
  let current: Promise<void> | undefined;
  let controller: AbortController | undefined;
  let lastReport = -Infinity;

  async function executeOne() {
    const run = await repository.claim(now(), leaseSeconds);
    if (!run || stopped) return;
    const abort = new AbortController();
    controller = abort;
    let timeout = false;
    let lostLease = false;
    let renewing = false;
    const deadline = setTimeout(() => {
      timeout = true;
      abort.abort();
    }, options.timeoutMs ?? 270_000);
    const heartbeat = setInterval(() => {
      if (renewing || abort.signal.aborted) return;
      renewing = true;
      void repository
        .heartbeat(run.runId, run.leaseToken, now(), leaseSeconds)
        .then((valid) => {
          if (!valid) {
            lostLease = true;
            abort.abort();
          }
        })
        .catch(() => {
          lostLease = true;
          abort.abort();
        })
        .finally(() => {
          renewing = false;
        });
    }, options.heartbeatMs ?? 20_000);
    try {
      const emit = async (event: Parameters<WorkflowRepository['append']>[2]) => {
        abort.signal.throwIfAborted();
        if (!(await repository.append(run.runId, run.leaseToken, event, now()))) {
          lostLease = true;
          abort.abort();
          throw new Error('Lease lost');
        }
      };
      // claim() has already persisted run.started atomically with the lease.
      const answer = await engine.execute(
        {
          runId: run.runId,
          conversationId: run.conversationId,
          input: run.input,
          history: run.history,
        },
        { signal: abort.signal, emit },
      );
      abort.signal.throwIfAborted();
      // The final message, delivery chunks and terminal event commit atomically.
      await repository.complete(run.runId, run.leaseToken, answer, now());
    } catch (error) {
      if (!stopped && !lostLease) {
        const requested = timeout
          ? 'RUN_TIMEOUT'
          : error instanceof AgentExecutionError
            ? error.code
            : 'RUN_FAILED';
        const code = Object.hasOwn(failureMessages, requested) ? requested : 'RUN_FAILED';
        await repository.fail(run.runId, run.leaseToken, code, failureMessages[code]!, now());
      }
    } finally {
      clearInterval(heartbeat);
      clearTimeout(deadline);
      if (controller === abort) controller = undefined;
    }
  }
  function wake() {
    if (stopped || current) return;
    current = executeOne()
      .catch(() => {
        if (now().getTime() - lastReport >= 30_000) {
          lastReport = now().getTime();
          options.report?.();
        }
      })
      .finally(() => {
        current = undefined;
      });
  }
  return {
    start() {
      if (!stopped) return;
      stopped = false;
      timer = setInterval(wake, options.pollMs ?? 1000);
      timer.unref();
      wake();
    },
    wake,
    async stop() {
      stopped = true;
      clearInterval(timer);
      controller?.abort();
      await current;
    },
  };
}
