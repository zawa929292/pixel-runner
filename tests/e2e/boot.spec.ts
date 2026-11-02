import { expect, test } from '@playwright/test';

test('ゲームが起動し、SPACE で開始できる', async ({ page }) => {
  await page.goto('/?test=1');
  await expect(page.locator('#game canvas')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__GAME__?.getState().status)).toBe('ready');

  await page.locator('#game canvas').click();
  await page.keyboard.press('Space');
  await expect.poll(() => page.evaluate(() => window.__GAME__?.getState().status)).toBe('playing');
});
