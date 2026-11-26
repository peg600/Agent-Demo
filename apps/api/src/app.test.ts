import { expect, it } from 'vitest';
import { liveHealthSchema } from '@gard/contracts';
import { buildApp } from './app.js';

it('serves a schema-checked live response without external services', async () => {
  const app = buildApp('silent');
  try {
    const response = await app.inject({ method: 'GET', url: '/health/live' });
    expect(response.statusCode).toBe(200);
    expect(liveHealthSchema.parse(response.json())).toEqual({ status: 'ok', service: 'gard-api' });
  } finally {
    await app.close();
  }
});
