import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';

const configSchema = z.object({
  API_HOST: z.enum(['127.0.0.1', 'localhost', '::1']).default('127.0.0.1'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export function loadRootEnv() {
  dotenv.config({
    path: fileURLToPath(new URL('../../../.env', import.meta.url)),
    quiet: true,
    override: false,
  });
}

export function readConfig(environment: NodeJS.ProcessEnv = process.env) {
  const parsed = configSchema.parse(environment);
  return { host: parsed.API_HOST, port: parsed.API_PORT, logLevel: parsed.LOG_LEVEL };
}
