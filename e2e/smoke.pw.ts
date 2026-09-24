import { expect, test } from '@playwright/test';

const routes = [
  '/', '/home', '/governance', '/teams', '/fighters', '/events', '/rankings', '/rules',
  '/public', '/team-hq', '/me', '/ops', '/ops/roster', '/ops/bracket', '/ops/standings',
  '/ops/manage', '/ops/admin', '/ops/discipline', '/ops/notes', '/ops/foundation',
  '/ops/rulesets', '/ops/sync', '/ops/setup', '/register', '/live'
];

for (const route of routes) {
  test(`demo screen loads: ${route}`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`./#${route}`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('h1').first()).toBeVisible();
    await expect(page.locator('#root')).not.toBeEmpty();
    await expect(page.locator('.state-card.error')).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}

test('operations navigation keeps the selected event', async ({ page }) => {
  await page.goto('./#/ops?event=selected-event');
  await expect(page.getByRole('heading', { name: 'Marshal Console' })).toBeVisible();
  // Desktop and mobile navigation are both rendered; only one is visible at each width.
  const roster = page.locator('a[href*="/ops/roster"]:visible').first();
  await roster.click();
  await expect(page.getByRole('heading', { name: 'Compliance Gate' })).toBeVisible();
  await expect(page).toHaveURL(/event=selected-event/);
});

test('demo roster edits persist after reload', async ({ page }) => {
  await page.goto('./#/ops/roster');
  const checkbox = page.getByRole('checkbox').first();
  await expect(checkbox).toBeVisible();
  const initial = await checkbox.isChecked();
  await checkbox.setChecked(!initial);
  await page.reload();
  await expect(page.getByRole('checkbox').first()).toBeChecked({ checked: !initial });
});
