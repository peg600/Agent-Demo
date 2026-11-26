import { buildApp } from './app.js';
import { loadRootEnv, readConfig } from './config.js';

loadRootEnv();
const config = readConfig();
const app = buildApp(config.logLevel);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void app.close().catch(() => {
      process.exitCode = 1;
    });
  });
}

try {
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  app.log.error(error, 'API startup failed');
  process.exitCode = 1;
  await app.close();
}
