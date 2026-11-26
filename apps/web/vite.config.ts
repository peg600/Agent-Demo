import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import vue from '@vitejs/plugin-vue';

const projectRoot = fileURLToPath(new URL('../..', import.meta.url));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, projectRoot, ['API_HOST', 'API_PORT', 'WEB_PORT']);
  const host = env.API_HOST || '127.0.0.1';
  const authority = host.includes(':') ? '[' + host + ']' : host;
  const target = 'http://' + authority + ':' + (env.API_PORT || '3001');

  return {
    plugins: [vue()],
    envDir: projectRoot,
    server: {
      host: '127.0.0.1',
      port: Number(env.WEB_PORT || 5173),
      strictPort: true,
      proxy: { '/api': { target }, '/health': { target } },
    },
    preview: { host: '127.0.0.1', port: 4173, strictPort: true },
  };
});
