import { expect, test, type Page } from '@playwright/test';
import { OBSTACLE, PHYSICS, PLAYER, SCORE, SCROLL } from '../../src/core/config';
import { formatHud } from '../../src/core/hud';
import type { GameState } from '../../src/core/state';
import { HIGH_SCORE_KEY } from '../../src/highScoreStore';

/**
 * spec の根拠: dt は PHYSICS.maxDtMs でクランプされるので 10fps でもゲーム内時間は実時間の半分で進み、
 * 10 点まで約 0.7 秒・衝突まで約 6.3 秒。timeout 5 秒／15 秒、poll 間隔 100ms。
 */
const POLL = { intervals: [100] };
const SCORE_TIMEOUT_MS = 5000;
const GAMEOVER_TIMEOUT_MS = 15000;
const MIN_PLAYING_SCORE = 10;

const S = SCROLL.initialSpeed;
const P = SCORE.pxPerPoint;
const MAXDT = PHYSICS.maxDtMs;
const PR = PLAYER.x + PLAYER.width;
/** 何も入力しない場合の最初の衝突時刻 [ms]（GAM-2） */
const T0 = OBSTACLE.firstSpawnDelayMs + ((OBSTACLE.spawnX - PR) / S) * 1000;
const MIN_GAMEOVER_SCORE = Math.floor((S * T0) / 1000 / P);
const MAX_GAMEOVER_SCORE = Math.floor((S * (T0 + MAXDT)) / 1000 / P);

const getState = (page: Page): Promise<GameState | undefined> =>
  page.evaluate(() => window.__GAME__?.getState());

const getHudText = (page: Page): Promise<string | undefined> =>
  page.evaluate(() => window.__GAME__?.getHudText());

async function requireState(page: Page): Promise<GameState> {
  const s = await getState(page);
  expect(s).toBeDefined();
  return s as GameState;
}

/** ブラウザで 10 アニメーションフレーム待つ（固定 sleep は使わない） */
const waitFrames = (page: Page): Promise<void> =>
  page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        let n = 0;
        const tick = (): void => {
          n += 1;
          if (n >= 10) resolve();
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
  );

/**
 * HUD は scene の create() で生成されるため、ready を観測した直後はまだ空の可能性がある。
 * ready の state は静止しているので、HUD 文字列が formatHud(state) に一致するまで poll する。
 */
async function expectHudMatches(page: Page, s: GameState): Promise<void> {
  await expect.poll(() => getHudText(page), POLL).toBe(formatHud(s));
}

async function openReady(page: Page): Promise<void> {
  await page.goto('/?test=1&seed=12345');
  const canvas = page.locator('#game canvas');
  await expect(canvas).toBeVisible();
  await expect.poll(async () => (await getState(page))?.status).toBe('ready');
}

async function startPlaying(page: Page): Promise<void> {
  await page.locator('#game canvas').click();
  await page.keyboard.press('Space');
  await expect.poll(async () => (await getState(page))?.status).toBe('playing');
}

async function waitGameover(page: Page): Promise<GameState> {
  await expect
    .poll(async () => (await getState(page))?.status, { ...POLL, timeout: GAMEOVER_TIMEOUT_MS })
    .toBe('gameover');
  return requireState(page);
}

test('GAM-3 AC-25: スコアが増え、gameover で止まり、ハイスコアと HUD に反映される', async ({
  page,
}) => {
  await openReady(page);
  await startPlaying(page);

  // (1) playing 中に score >= 10 を同一サンプルの {status, score} で観測する
  let sample: Pick<GameState, 'status' | 'score'> | undefined;
  await expect
    .poll(
      async () => {
        const s = await getState(page);
        sample = s && { status: s.status, score: s.score };
        return sample?.score ?? 0;
      },
      { ...POLL, timeout: SCORE_TIMEOUT_MS },
    )
    .toBeGreaterThanOrEqual(MIN_PLAYING_SCORE);
  expect(sample?.status).toBe('playing');

  // (2) 何もしなければ gameover
  const s1 = await waitGameover(page);

  // (3) ハイスコアに反映され、スコアは衝突フレームの範囲内
  expect(s1.highScore).toBe(s1.score);
  expect(s1.score).toBeGreaterThanOrEqual(MIN_GAMEOVER_SCORE);
  expect(s1.score).toBeLessThanOrEqual(MAX_GAMEOVER_SCORE);

  // (4) gameover ではスコア・距離・ハイスコアが止まる
  await waitFrames(page);
  const s2 = await requireState(page);
  expect(s2.score).toBe(s1.score);
  expect(s2.distance).toBe(s1.distance);
  expect(s2.highScore).toBe(s1.highScore);

  // (5) HUD 文字列
  expect(await getHudText(page)).toBe(formatHud(s2));
});

test('GAM-3 AC-26: ハイスコアがリロード後も残る', async ({ page }) => {
  await openReady(page);

  // リロード前の最初の ready（localStorage 空）
  const first = await requireState(page);
  expect(first.highScore).toBe(0);
  await expectHudMatches(page, first);

  await startPlaying(page);
  const over = await waitGameover(page);
  const H = over.highScore;

  // 同じコンテキストでリロード（localStorage は残る）
  await page.reload();
  await expect.poll(async () => (await getState(page))?.status).toBe('ready');

  const s = await requireState(page);
  expect(s.highScore).toBe(H);
  expect(s.score).toBe(0);
  expect(s.distance).toBe(0);
  expect(await page.evaluate((key) => window.localStorage.getItem(key), HIGH_SCORE_KEY)).toBe(
    String(H),
  );
  await expectHudMatches(page, s);

  // ready ではスコアが増えない
  await waitFrames(page);
  expect((await requireState(page)).score).toBe(0);
});
