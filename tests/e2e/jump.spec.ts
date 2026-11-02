import { expect, test } from '@playwright/test';
import { WORLD } from '../../src/core/config';

test('AC-15: SPACE でジャンプし、地面に着地する', async ({ page }) => {
  await page.goto('/?test=1');
  await expect(page.locator('#game canvas')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__GAME__?.getState().status)).toBe('ready');

  await page.locator('#game canvas').click();
  await page.keyboard.press('Space');
  await expect.poll(() => page.evaluate(() => window.__GAME__?.getState().status)).toBe('playing');

  await page.keyboard.press('Space');

  // 空中にいる瞬間（onGround=false かつ y < groundY）を観測する
  await expect
    .poll(() =>
      page.evaluate((groundY) => {
        const p = window.__GAME__?.getState().player;
        return p !== undefined && p.onGround === false && p.y < groundY;
      }, WORLD.groundY),
    )
    .toBe(true);

  // 着地して地面で静止する
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const p = window.__GAME__?.getState().player;
          return p ? { onGround: p.onGround, y: p.y, vy: p.vy } : null;
        }),
      { timeout: 5000 },
    )
    .toEqual({ onGround: true, y: WORLD.groundY, vy: 0 });
});
