import { test, expect } from '@playwright/test';

const status = { configured: false, verified: false, encryptionReady: true, accountId: 'a'.repeat(32), bucket: 'cinexvideo-vault', jurisdiction: 'default' };
async function setup(page, { fail = false, canChange = true, encryptionReady = true } = {}) {
  const calls = [];
  await page.route('**/fixture/connection', async (route) => {
    if (route.request().method() === 'POST') {
      calls.push(route.request().postDataJSON());
      if (fail) await route.fulfill({ status: 422, json: { error: 'R2 verification failed. Existing settings were not changed.' } });
      else await route.fulfill({ json: { storage: { ...status, configured: true, verified: true, keyHint: 'aaaa', verifiedAt: '2026-10-11T00:00:00Z' }, canChange: true } });
    } else await route.fulfill({ json: { storage: { ...status, encryptionReady }, canChange } });
  });
  await page.goto('http://127.0.0.1:3110');
  return calls;
}

test('R2 settings connect with just two keys and clear both fields', async ({ page }) => {
  const calls = await setup(page);
  const access = page.getByLabel('R2 Access Key ID', { exact: true });
  const secret = page.getByLabel('R2 Secret Access Key', { exact: true });
  await expect(access).toBeEnabled();
  await expect(page.getByLabel('Cloudflare account ID', { exact: true })).not.toBeVisible();
  await access.fill('a'.repeat(32));
  await secret.fill('b'.repeat(64));
  await expect(secret).toHaveAttribute('type', 'password');
  await page.getByRole('button', { name: 'Connect Cloudflare R2' }).click();
  await expect(page.getByText('Connected and verified', { exact: true })).toBeVisible();
  await expect(access).toHaveValue('');
  await expect(secret).toHaveValue('');
  expect(calls).toHaveLength(1);
  expect(calls[0].binding.bucket).toBe('cinexvideo-vault');
  expect(await page.locator('body').innerText()).not.toContain('b'.repeat(64));
  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([]);
  await page.screenshot({ path: 'test-results/r2-settings-desktop.png', fullPage: true });
});

test('R2 failure is actionable, does not say connected, and clears entered keys', async ({ page }) => {
  await setup(page, { fail: true });
  await page.getByLabel('R2 Access Key ID', { exact: true }).fill('a'.repeat(32));
  await page.getByLabel('R2 Secret Access Key', { exact: true }).fill('b'.repeat(64));
  await page.getByRole('button', { name: 'Connect Cloudflare R2' }).click();
  await expect(page.getByRole('alert')).toContainText('Existing settings were not changed');
  await expect(page.getByText('Not connected', { exact: true })).toBeVisible();
  await expect(page.getByLabel('R2 Secret Access Key', { exact: true })).toHaveValue('');
});

test('R2 settings enforce super-admin and server-encryption readiness', async ({ page }) => {
  await setup(page, { canChange: false });
  await expect(page.getByLabel('R2 Access Key ID', { exact: true })).toBeDisabled();
  await expect(page.getByText('Only the super admin can connect or rotate storage credentials.')).toBeVisible();
  await page.unrouteAll();
  await setup(page, { encryptionReady: false });
  await expect(page.getByRole('alert')).toContainText('server encryption key');
  await expect(page.getByLabel('R2 Secret Access Key', { exact: true })).toBeDisabled();
});

test('R2 settings fit a mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await setup(page);
  await expect(page.getByLabel('R2 Access Key ID', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await page.screenshot({ path: 'test-results/r2-settings-mobile.png', fullPage: true });
});
