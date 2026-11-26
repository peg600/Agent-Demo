import { describe, expect, it } from 'vitest';
import { readConfig } from './config.js';

describe('local development configuration', () => {
  it('starts without database or external API credentials', () => {
    expect(readConfig({ OPENAI_API_KEY: '', DATABASE_URL: '' })).toEqual({
      host: '127.0.0.1',
      port: 3001,
      logLevel: 'info',
    });
  });

  it('accepts an explicit test port', () => {
    expect(readConfig({ API_PORT: '3101' }).port).toBe(3101);
  });

  it.each(['0', '65536', 'not-a-port'])('rejects invalid port %s', (API_PORT) => {
    expect(() => readConfig({ API_PORT })).toThrow();
  });

  it('does not expose the unauthenticated scaffold to the network', () => {
    expect(() => readConfig({ API_HOST: '0.0.0.0' })).toThrow();
  });
});
