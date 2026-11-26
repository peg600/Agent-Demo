import OpenAI from 'openai';
import { z } from 'zod';
import { AgentError, bounded, checkAbort, integerSetting } from '../agent/errors.js';

export interface StructuredModel {
  generate<T>(
    name: string,
    schema: z.ZodType<T>,
    system: string,
    input: unknown,
    signal: AbortSignal,
  ): Promise<T>;
}

export function createStructuredModel(env: NodeJS.ProcessEnv = process.env): StructuredModel {
  let client: OpenAI | undefined;
  return {
    async generate(name, schema, system, input, signal) {
      checkAbort(signal);
      const model = env.OPENAI_CHAT_MODEL;
      if (!env.OPENAI_API_KEY || !model)
        throw new AgentError('MODEL_NOT_CONFIGURED', '尚未配置模型服务，请检查服务端配置。');
      if (!client) {
        const baseURL = env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1';
        const parsed = new URL(baseURL);
        if (
          !['https:', 'http:'].includes(parsed.protocol) ||
          parsed.username ||
          parsed.password ||
          parsed.search ||
          parsed.hash
        ) {
          throw new AgentError('AGENT_CONFIG', '智能服务配置不完整。');
        }
        client = new OpenAI({ apiKey: env.OPENAI_API_KEY, baseURL, maxRetries: 0 });
      }
      const timeout = integerSetting(env, 'MODEL_TIMEOUT_MS', 60000, 120000);
      for (let attempt = 0; ; attempt++) {
        try {
          const response = await bounded(signal, timeout, (requestSignal) =>
            client!.chat.completions.create(
              {
                model,
                messages: [
                  { role: 'system', content: system },
                  { role: 'user', content: JSON.stringify(input) },
                ],
                response_format: {
                  type: 'json_schema',
                  json_schema: {
                    name,
                    strict: true,
                    schema: z.toJSONSchema(schema, { target: 'draft-7' }) as Record<
                      string,
                      unknown
                    >,
                  },
                },
                max_completion_tokens: 4000,
              },
              { signal: requestSignal },
            ),
          );
          const choice = response.choices[0];
          if (
            !choice ||
            choice.finish_reason !== 'stop' ||
            choice.message.refusal ||
            !choice.message.content
          ) {
            throw new AgentError('MODEL_OUTPUT', '模型未能生成有效结果。');
          }
          try {
            return schema.parse(JSON.parse(choice.message.content));
          } catch {
            throw new AgentError('MODEL_OUTPUT', '模型未能生成有效结果。');
          }
        } catch (error) {
          checkAbort(signal);
          const transient =
            error instanceof OpenAI.APIConnectionError ||
            (error instanceof OpenAI.APIError &&
              [408, 500, 502, 503, 504].includes(error.status ?? 0)) ||
            (error instanceof AgentError && error.retryable);
          // Quota/rate/authorization failures are not retried automatically.
          if (transient && attempt === 0) {
            await bounded(
              signal,
              1000,
              () => new Promise<void>((resolve) => setTimeout(resolve, 250)),
            );
            continue;
          }
          if (error instanceof AgentError) throw error;
          throw new AgentError('MODEL_UNAVAILABLE', '模型服务暂不可用，请稍后重试。', transient);
        }
      }
    },
  };
}
