import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const workspaces = [
  {
    manifest: new URL('../apps/api/package.json', import.meta.url),
    packages: [
      'fastify',
      '@fastify/cookie',
      '@fastify/rate-limit',
      'zod',
      'pg',
      'drizzle-orm/node-postgres',
      'openai',
      '@langchain/openai',
      '@langchain/langgraph',
      '@langchain/langgraph-checkpoint-postgres',
      '@langfuse/langchain',
      '@langfuse/otel',
      '@langfuse/tracing',
      '@opentelemetry/sdk-trace-node',
    ],
  },
  {
    manifest: new URL('../apps/web/package.json', import.meta.url),
    packages: ['vue', 'vue-router', 'pinia', 'vite', '@vitejs/plugin-vue'],
  },
];

for (const workspace of workspaces) {
  const require = createRequire(workspace.manifest);
  for (const packageName of workspace.packages) {
    // Windows paths must be file URLs for dynamic import.
    await import(pathToFileURL(require.resolve(packageName)).href);
    console.log('OK ' + packageName);
  }
}
