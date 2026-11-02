import { describe, expect, it } from 'vitest';
import { OBSTACLE, PHYSICS, PLAYER, SCROLL } from '../../src/core/config';
import { advanceObstacles, type Obstacle, type ObstacleWorld } from '../../src/core/obstacles';
import { createInitialState } from '../../src/core/state';

const S = SCROLL.initialSpeed;
const W = OBSTACLE.width;
const HMIN = OBSTACLE.minHeight;
const HMAX = OBSTACLE.maxHeight;
const IMIN = OBSTACLE.minIntervalMs;
const IMAX = OBSTACLE.maxIntervalMs;
const FIRST = OBSTACLE.firstSpawnDelayMs;
const G = PHYSICS.gravity;
const V = PHYSICS.jumpVelocity;
const MAXDT = PHYSICS.maxDtMs;

const toWorld = ({ obstacles, spawnTimerMs, rngSeed, nextObstacleId, scrollSpeed }: ObstacleWorld): ObstacleWorld => ({
  obstacles,
  spawnTimerMs,
  rngSeed,
  nextObstacleId,
  scrollSpeed,
});

/** 自動生成を止めた world */
const noSpawn = (obstacles: Obstacle[], overrides: Partial<ObstacleWorld> = {}): ObstacleWorld => ({
  ...toWorld(createInitialState()),
  spawnTimerMs: 1e9,
  obstacles,
  ...overrides,
});

const seededWorld = (seed: number): ObstacleWorld => ({ ...toWorld(createInitialState(seed)), spawnTimerMs: FIRST });

const runDts = (world: ObstacleWorld, dts: number[]): ObstacleWorld => dts.reduce((w, dt) => advanceObstacles(w, dt), world);

const repeat = (pattern: number[], times: number): number[] => Array.from({ length: times }, () => pattern).flat();

describe('GAM-2 advanceObstacles', () => {
  const pair = (): Obstacle[] => [
    { id: 1, x: 500, width: W, height: HMIN },
    { id: 2, x: 700, width: W, height: HMAX },
  ];

  const expectMovedBy = (speed: number) => {
    for (const dt of [10, 16, MAXDT]) {
      const before = pair();
      const r = advanceObstacles(noSpawn(before, { scrollSpeed: speed }), dt);
      expect(r.obstacles).toHaveLength(before.length);
      r.obstacles.forEach((o, i) => {
        expect(Math.abs(o.x - (before[i].x - (speed * dt) / 1000))).toBeLessThanOrEqual(1e-9);
        expect(o.id).toBe(before[i].id);
        expect(o.width).toBe(before[i].width);
        expect(o.height).toBe(before[i].height);
      });
    }
  };

  it('AC-6: 各障害物が S*dt/1000 だけ左へ動き、id・幅・高さ・順序は不変', () => {
    expectMovedBy(S);
  });

  it('AC-7: 移動量は state の scrollSpeed から計算される（2*S なら 2 倍）', () => {
    expectMovedBy(2 * S);
  });

  it('AC-8: 移動後に右端が 0 以下なら削除、0 より大きければ残り、順序は保たれる', () => {
    const dt = 10;
    const d = (S * dt) / 1000;
    const r = advanceObstacles(
      noSpawn([
        { id: 1, x: -W + d, width: W, height: HMIN }, // 移動後の右端がちょうど 0 → 削除
        { id: 2, x: -W + d + 0.5, width: W, height: HMIN }, // 右端 0.5 → 残る
        { id: 3, x: 300, width: W, height: HMAX }, // 残る
      ]),
      dt,
    );
    expect(r.obstacles.map((o) => o.id)).toEqual([2, 3]);
    expect(r.obstacles[0].x + r.obstacles[0].width).toBeGreaterThan(0);
  });

  it('AC-10: 600 秒間、隣り合う障害物の間隔と高さが範囲内で、HMIN と HMAX が出現する', () => {
    const minGap = (S * IMIN) / 1000 - 1e-6;
    const maxGap = (S * IMAX) / 1000 + 1e-6;
    const allHeights = new Map<string, number>();
    for (const seed of [1, 42, 12345]) {
      let w = seededWorld(seed);
      for (let i = 0; i < 12000; i++) {
        w = advanceObstacles(w, 50);
        for (let j = 0; j + 1 < w.obstacles.length; j++) {
          const gap = w.obstacles[j + 1].x - w.obstacles[j].x;
          expect(gap).toBeGreaterThanOrEqual(minGap);
          expect(gap).toBeLessThanOrEqual(maxGap);
        }
        for (const o of w.obstacles) allHeights.set(`${seed}:${o.id}`, o.height);
      }
    }
    const heights = [...allHeights.values()];
    expect(heights.length).toBeGreaterThan(800);
    for (const h of heights) {
      expect(Number.isInteger(h)).toBe(true);
      expect(h).toBeGreaterThanOrEqual(HMIN);
      expect(h).toBeLessThanOrEqual(HMAX);
    }
    expect(heights).toContain(HMIN);
    expect(heights).toContain(HMAX);
  });

  it('AC-11: dt の分割方法によらず 10000ms 後の障害物が一致する', () => {
    const splits = [repeat([10], 1000), repeat([50], 200), repeat([7, 43, 25, 25], 100)];
    for (const seed of [1, 42]) {
      const results = splits.map((dts) => {
        expect(dts.reduce((a, b) => a + b, 0)).toBe(10000);
        return runDts(seededWorld(seed), dts);
      });
      const base = results[0];
      expect(base.obstacles.length).toBeGreaterThan(0);
      for (const r of results) {
        expect(r.obstacles.length).toBe(base.obstacles.length);
        expect(r.rngSeed).toBe(base.rngSeed);
        expect(r.nextObstacleId).toBe(base.nextObstacleId);
        expect(Math.abs(r.spawnTimerMs - base.spawnTimerMs)).toBeLessThanOrEqual(1e-6);
        r.obstacles.forEach((o, i) => {
          expect(o.id).toBe(base.obstacles[i].id);
          expect(o.height).toBe(base.obstacles[i].height);
          expect(Math.abs(o.x - base.obstacles[i].x)).toBeLessThanOrEqual(1e-6);
        });
      }
    }
  });

  it('AC-16: 定数は最大高さ・最小間隔でもジャンプで越えられる値になっている', () => {
    // (a) HMAX より上にいられる時間が x 方向の重なり時間の 2 倍以上
    const timeAboveHmax = (2 * Math.sqrt(V * V - 2 * G * HMAX)) / G;
    const overlapTime = (PLAYER.width + W) / S;
    expect(timeAboveHmax).toBeGreaterThanOrEqual(2 * overlapTime);
    // (b) 最小間隔 ≥ 滞空時間 + 1 フレーム + 反応猶予 200ms
    const reactionMs = 200;
    expect(IMIN).toBeGreaterThanOrEqual(((2 * Math.abs(V)) / G) * 1000 + MAXDT + reactionMs);
    // (c) 範囲の整合と x 方向のすり抜け防止
    expect(HMIN).toBeGreaterThanOrEqual(1);
    expect(HMIN).toBeLessThanOrEqual(HMAX);
    expect(IMIN).toBeGreaterThan(0);
    expect(IMIN).toBeLessThanOrEqual(IMAX);
    expect((S * MAXDT) / 1000).toBeLessThan(W);
  });

  it('AC-22 (advanceObstacles): 入力 world を書き換えず、新しいオブジェクトと配列を返す', () => {
    const worlds: ObstacleWorld[] = [
      noSpawn(pair()),
      { ...seededWorld(42), obstacles: pair() },
      { ...seededWorld(42), obstacles: pair(), spawnTimerMs: 10 }, // このフレームで生成される
    ];
    for (const w of worlds) {
      const copy = structuredClone(w);
      const r = advanceObstacles(w, 16);
      expect(w).toEqual(copy);
      expect(r).not.toBe(w);
      expect(r.obstacles).not.toBe(w.obstacles);
    }
  });
});
