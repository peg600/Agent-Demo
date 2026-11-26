import { expect, test } from '@playwright/test';

test('loads Vue and reaches Fastify through the development proxy', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '嘉德智能客服' })).toBeVisible();
  await expect(page.getByRole('status')).toHaveText('前后端连接正常');
});

test('shows a recoverable state when the backend is unavailable', async ({ page }) => {
  await page.route('**/health/live', (route) => route.abort());
  await page.goto('/');
  await expect(page.getByRole('status')).toHaveText('暂时无法连接后端');
  await page.unroute('**/health/live');
  await page.getByRole('button', { name: '重新检查' }).click();
  await expect(page.getByRole('status')).toHaveText('前后端连接正常');
});
