import { test, expect } from '@playwright/test';

async function studio(page, query = '') {
  await page.goto(`/studio${query}`);
  const skip = page.getByRole('button', { name: 'Skip tour', exact: true });
  await expect(page.getByText("The Last Dragon's Keep", { exact: true })).toBeVisible();
  // The first-run tour opens after a deliberate 500ms delay.
  await skip.waitFor({ state: 'visible' });
  await skip.click();
}

test('Studio applies Director output and completes simulated generation', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await studio(page);
  await page.getByRole('button', { name: 'Director D', exact: true }).click();
  await page.getByText('Make it more cinematic', { exact: true }).click();
  await page.getByRole('button', { name: 'Use this', exact: true }).click();
  await expect(page.getByText("Director's draft applied. Autosaving.")).toBeVisible();
  await page.getByRole('button', { name: 'Generate', exact: true }).first().click();
  await expect(page.getByText('Step 1 · Make the stills first?', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Make stills', exact: true }).click();
  await expect(page.getByText('Demo mode: generation simulated. Nothing was spent.', { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('project navigation discards the previous project confirmation', async ({ page }) => {
  await studio(page, '?project=project-a');
  await page.getByRole('button', { name: 'Generate', exact: true }).first().click();
  await expect(page.getByText('Step 1 · Make the stills first?', { exact: true })).toBeVisible();
  await page.evaluate(() => window.history.pushState(null, '', '/studio?project=project-b'));
  await expect(page.getByText('Step 1 · Make the stills first?', { exact: true })).not.toBeVisible();
  await expect(page.getByText("The Last Dragon's Keep", { exact: true })).toBeVisible();
});

test('mobile Studio fits viewport and exposes the main action', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await studio(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await expect(page.getByRole('button', { name: 'Generate', exact: true }).first()).toBeVisible();
  await page.screenshot({ path: 'test-results/studio-mobile.png', fullPage: true });
});

for (const route of ['/', '/dashboard', '/create', '/create/story', '/create/script', '/create/director', '/create/review', '/templates', '/pricing', '/account', '/auth', '/privacy', '/terms', '/refunds', '/content-policy', '/premieres', '/payouts', '/music-video', '/music-video/new', '/music-video/projects', '/music-video/director', '/music-video/storyboard', '/music-video/review', '/editor']) {
  test(`page smoke ${route}`, async ({ page }) => {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const response = await page.goto(route);
    expect(response.status()).toBeLessThan(400);
    await expect(page.locator('body')).not.toBeEmpty();
    await expect(page.getByText('Application error: a client-side exception')).not.toBeVisible();
    expect(errors).toEqual([]);
  });
}

test('admin pages remain protected even in demo mode', async ({ page }) => {
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/auth\?next=/);
});

test('protected API routes reject anonymous calls', async ({ request }) => {
  for (const path of ['/api/me', '/api/projects', '/api/admin/summary']) {
    const response = await request.get(path);
    expect(response.status(), path).toBe(401);
  }
  for (const path of ['/api/director', '/api/generate', '/api/exports/video']) {
    const response = await request.post(path, { data: {} });
    expect(response.status(), path).toBe(401);
  }
});
