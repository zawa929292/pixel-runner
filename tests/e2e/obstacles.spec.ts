import { expect, test, type Page } from '@playwright/test';
import { PLAYER, WORLD } from '../../src/core/config';

/**
 * E2E で参照する state の部分型（specs/GAM-2.md の GameState に対応）。
 * 実装と並行して書くため、GameState 型に依存せずここで必要なフィールドだけ定義する。
 */
interface ObstacleSnapshot {
  id: number;
  x: number;
  width: number;
  height: number;
}

interface StateSnapshot {
  status: 'ready' | 'playing' | 'gameover';
  player: { x: number; y: number; onGround: boolean };
  obstacles: ObstacleSnapshot[];
}

/** spec の根拠: dt クランプで 10fps でも出現まで約 2 秒・衝突まで約 6.3 秒。poll 間隔 100ms */
const POLL = { intervals: [100] };

const getState = (page: Page): Promise<StateSnapshot | undefined> =>
  page.evaluate(() => window.__GAME__?.getState() as unknown as StateSnapshot | undefined);

async function startPlaying(page: Page): Promise<void> {
  await page.goto('/?test=1&seed=12345');
  const canvas = page.locator('#game canvas');
  await expect(canvas).toBeVisible();
  await expect.poll(async () => (await getState(page))?.status).toBe('ready');

  await canvas.click();
  await page.keyboard.press('Space');
  await expect.poll(async () => (await getState(page))?.status).toBe('playing');
}

test('GAM-2 AC-24: 障害物が出現して左へ動く', async ({ page }) => {
  await startPlaying(page);

  await expect
    .poll(async () => (await getState(page))?.obstacles.length ?? 0, {
      ...POLL,
      timeout: 5000,
    })
    .toBeGreaterThanOrEqual(1);

  const first = (await getState(page))?.obstacles[0];
  expect(first).toBeDefined();
  const { id, x: x0 } = first as ObstacleSnapshot;

  // 同じ id の障害物が記録時から 30px 以上左へ動く
  await expect
    .poll(
      async () => {
        const o = (await getState(page))?.obstacles.find((ob) => ob.id === id);
        return o !== undefined && o.x <= x0 - 30;
      },
      { ...POLL, timeout: 5000 },
    )
    .toBe(true);

  expect((await getState(page))?.status).toBe('playing');
});

test('GAM-2 AC-25: 何もしなければ障害物に衝突して gameover になる', async ({ page }) => {
  await startPlaying(page);

  await expect
    .poll(async () => (await getState(page))?.status, {
      ...POLL,
      timeout: 15000,
    })
    .toBe('gameover');

  const s = await getState(page);
  expect(s).toBeDefined();
  const { player, obstacles } = s as StateSnapshot;

  const pLeft = player.x;
  const pRight = player.x + PLAYER.width;
  const pTop = player.y - PLAYER.height;
  const pBottom = player.y;

  // 辺の接触は重なりに含めない（厳密不等号）
  const overlapping = obstacles.filter((o) => {
    const oLeft = o.x;
    const oRight = o.x + o.width;
    const oTop = WORLD.groundY - o.height;
    const oBottom = WORLD.groundY;
    return pLeft < oRight && oLeft < pRight && pTop < oBottom && oTop < pBottom;
  });

  expect(overlapping.length).toBeGreaterThanOrEqual(1);
  expect(player.onGround).toBe(true);
});
