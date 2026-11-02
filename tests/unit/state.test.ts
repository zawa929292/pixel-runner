import { describe, expect, it } from 'vitest';
import { OBSTACLE, PHYSICS, PLAYER, RANDOM, SCROLL, WORLD } from '../../src/core/config';
import type { Obstacle } from '../../src/core/obstacles';
import { createInitialState, startGame, step, type GameInput, type GameState } from '../../src/core/state';

describe('state', () => {
  it('初期状態は ready で、プレイヤーは地面に立っている', () => {
    const s = createInitialState();
    expect(s.status).toBe('ready');
    expect(s.player.y).toBe(WORLD.groundY);
    expect(s.player.onGround).toBe(true);
  });

  it('startGame で playing になりスコアがリセットされる', () => {
    const s = startGame({ ...createInitialState(), score: 99 });
    expect(s.status).toBe('playing');
    expect(s.score).toBe(0);
  });
});

const G = PHYSICS.gravity;
const V = PHYSICS.jumpVelocity;
const GY = WORLD.groundY;
const MAXDT = PHYSICS.maxDtMs;

const NO_INPUT = { jumpPressed: false } as const;
const JUMP = { jumpPressed: true } as const;

const playingOnGround = (): GameState => ({ ...createInitialState(), status: 'playing' });
const playingInAir = (y: number, vy: number): GameState => ({
  ...playingOnGround(),
  player: { x: PLAYER.x, y, vy, onGround: false },
});

/** dts を順に step し、各フレーム後の state 列を返す。jumpFirst なら最初のフレームだけ jumpPressed=true。 */
function simulate(state: GameState, dts: number[], jumpFirst = false): GameState[] {
  const frames: GameState[] = [];
  let s = state;
  dts.forEach((dt, i) => {
    s = step(s, { jumpPressed: jumpFirst && i === 0 }, dt);
    frames.push(s);
  });
  return frames;
}

/** 地上からジャンプし、着地するまで固定 dt で step する。 */
function jumpUntilLanding(dt: number) {
  let s = step(playingOnGround(), JUMP, dt);
  let elapsed = dt;
  let minY = s.player.y;
  const maxFrames = 100000;
  for (let i = 0; i < maxFrames && !s.player.onGround; i++) {
    s = step(s, NO_INPUT, dt);
    elapsed += dt;
    minY = Math.min(minY, s.player.y);
  }
  return { final: s, tLand: elapsed, minY };
}

describe('step', () => {
  it('AC-1: playing・地上でジャンプ入力すると空中に出て vy が V + G*dt になる', () => {
    for (const dt of [1, 16, 1000 / 60, MAXDT]) {
      const r = step(playingOnGround(), JUMP, dt);
      expect(r.player.onGround).toBe(false);
      expect(r.player.y).toBeLessThan(GY);
      expect(Math.abs(r.player.vy - (V + (G * dt) / 1000))).toBeLessThanOrEqual(1e-9);
    }
  });

  it('AC-2: 空中（上昇中・下降中）のジャンプ入力は無視される', () => {
    for (const s of [playingInAir(GY - 50, -200), playingInAir(GY - 50, 200)]) {
      for (const dt of [1, 16, MAXDT]) {
        expect(step(s, JUMP, dt)).toEqual(step(s, NO_INPUT, dt));
      }
    }
  });

  it('AC-3: 300ms 後の y, vy が解析解と一致する', () => {
    const frames = simulate(playingOnGround(), Array(30).fill(10), true);
    const last = frames[frames.length - 1].player;
    const t = 0.3;
    expect(Math.abs(last.y - (GY + V * t + 0.5 * G * t * t))).toBeLessThanOrEqual(1e-6);
    expect(Math.abs(last.vy - (V + G * t))).toBeLessThanOrEqual(1e-6);
  });

  it('AC-4: dt の分割方法によらず 300ms 後の y, vy が一致する', () => {
    const splits = [Array(30).fill(10), Array(15).fill(20), Array(6).fill(50), [5, 45, 30, 20, 50, 50, 50, 50]];
    const results = splits.map((dts) => {
      expect(dts.reduce((a, b) => a + b, 0)).toBe(300);
      const frames = simulate(playingOnGround(), dts, true);
      return frames[frames.length - 1].player;
    });
    for (const r of results) {
      expect(Math.abs(r.y - results[0].y)).toBeLessThanOrEqual(1e-6);
      expect(Math.abs(r.vy - results[0].vy)).toBeLessThanOrEqual(1e-6);
    }
  });

  const DTS = [1000 / 144, 1000 / 60, 1000 / 30, 50];

  it('AC-5: 各固定 dt で最高到達点が解析解と 1.0px 以内で一致する', () => {
    const expected = GY - (V * V) / (2 * G);
    for (const dt of DTS) {
      const { minY } = jumpUntilLanding(dt);
      expect(Math.abs(minY - expected)).toBeLessThanOrEqual(1.0);
    }
  });

  it('AC-6: 各固定 dt で着地時刻が [T, T+dt] に収まり、着地フレームでスナップする', () => {
    const T = ((2 * Math.abs(V)) / G) * 1000;
    for (const dt of DTS) {
      const { final, tLand } = jumpUntilLanding(dt);
      expect(final.player.onGround).toBe(true);
      expect(final.player.y).toBe(GY);
      expect(final.player.vy).toBe(0);
      expect(tLand).toBeGreaterThanOrEqual(T - 1e-6);
      expect(tLand).toBeLessThanOrEqual(T + dt + 1e-6);
    }
  });

  it('AC-9: 地上で入力なしに 100 回 step しても変化しない', () => {
    let s = playingOnGround();
    for (let i = 0; i < 100; i++) {
      s = step(s, NO_INPUT, 1 + (i % MAXDT));
      expect(s.player.y).toBe(GY);
      expect(s.player.vy).toBe(0);
      expect(s.player.onGround).toBe(true);
    }
  });

  it('AC-10: gameover では入力の有無にかかわらず state が変わらない', () => {
    const s: GameState = { ...createInitialState(), status: 'gameover' };
    expect(step(s, NO_INPUT, 16)).toEqual(s);
    expect(step(s, JUMP, 16)).toEqual(s);
  });

  it('AC-11: ready でジャンプ入力すると playing になるが、同じ押下ではジャンプしない', () => {
    const r = step(createInitialState(), JUMP, 16);
    expect(r.status).toBe('playing');
    expect(r.player.y).toBe(GY);
    expect(r.player.vy).toBe(0);
    expect(r.player.onGround).toBe(true);
  });

  it('AC-11 補足: ready で入力なしなら state は変わらない', () => {
    const s = createInitialState();
    expect(step(s, NO_INPUT, 16)).toEqual(s);
  });

  it('AC-12: dt は MAXDT にクランプされる（MAXDT ちょうどはそのまま）', () => {
    const s = playingInAir(GY - 100, -200);
    for (const input of [NO_INPUT, JUMP]) {
      expect(step(s, input, 1000)).toEqual(step(s, input, MAXDT));
      expect(step(s, input, MAXDT + 1)).toEqual(step(s, input, MAXDT));
    }
    // MAXDT ちょうどはクランプされず、厳密解どおり MAXDT ぶん進む
    const t = MAXDT / 1000;
    const r = step(s, NO_INPUT, MAXDT);
    expect(Math.abs(r.player.vy - (-200 + G * t))).toBeLessThanOrEqual(1e-9);
  });

  it('AC-13: dt が 0・負・NaN・Infinity なら state は変わらない', () => {
    const states = [createInitialState(), playingOnGround(), playingInAir(GY - 100, -200)];
    for (const s of states) {
      for (const dt of [0, -16, Number.NaN, Number.POSITIVE_INFINITY]) {
        expect(step(s, JUMP, dt)).toEqual(s);
        expect(step(s, NO_INPUT, dt)).toEqual(s);
      }
    }
  });

  it('AC-14: step は入力 state を書き換えず、変化時は別オブジェクトを返す', () => {
    const states: GameState[] = [
      createInitialState(),
      playingOnGround(),
      playingInAir(GY - 100, -200),
      playingInAir(GY - 1, 500),
      { ...createInitialState(), status: 'gameover' },
    ];
    for (const s of states) {
      const copy = structuredClone(s);
      for (const input of [NO_INPUT, JUMP]) {
        const r = step(s, input, 16);
        expect(s).toEqual(copy);
        if (JSON.stringify(r) !== JSON.stringify(copy)) {
          expect(r).not.toBe(s);
          // AC-23 (GAM-2): playing・地上では spawnTimerMs など障害物まわりだけが変わるため、
          // 変化したフィールドの少なくとも 1 つが入力と別の参照・値になっていることを検証する
          expect(
            r.player !== s.player || r.status !== s.status || r.obstacles !== s.obstacles || r.spawnTimerMs !== s.spawnTimerMs,
          ).toBe(true);
          if (s.status === 'playing') {
            // playing では障害物タイマーが dt ぶん進む（このケースでは生成はまだ起きない）
            expect(r.spawnTimerMs).toBe(s.spawnTimerMs - 16);
          }
        }
      }
    }
  });
});

describe('GAM-2 step（障害物・衝突・シード）', () => {
  const S = SCROLL.initialSpeed;
  const W = OBSTACLE.width;
  const HMIN = OBSTACLE.minHeight;
  const HMAX = OBSTACLE.maxHeight;
  const IMIN = OBSTACLE.minIntervalMs;
  const IMAX = OBSTACLE.maxIntervalMs;
  const FIRST = OBSTACLE.firstSpawnDelayMs;
  const SX = OBSTACLE.spawnX;
  const PR = PLAYER.x + PLAYER.width;
  const TEN_SECONDS = 10000;

  /** 自動生成を止めた playing・地上の state */
  const noSpawn = (obstacles: Obstacle[], overrides: Partial<GameState> = {}): GameState => ({
    ...createInitialState(),
    status: 'playing',
    spawnTimerMs: 1e9,
    obstacles,
    ...overrides,
  });

  const repeat = (pattern: number[], times: number): number[] => Array.from({ length: times }, () => pattern).flat();
  const runDts = (state: GameState, dts: number[]): GameState => dts.reduce((st, dt) => step(st, NO_INPUT, dt), state);

  /** policy で入力を決めながら固定 dt で step し、各フレームの { before, input, after } を返す。stop が true で終了。 */
  function runFixedDt(
    state: GameState,
    dt: number,
    policy: (s: GameState) => GameInput,
    maxMs: number,
    stop: (s: GameState) => boolean,
  ) {
    const frames: { before: GameState; input: GameInput; after: GameState }[] = [];
    let s = state;
    for (let elapsed = 0; elapsed < maxMs && !stop(s); elapsed += dt) {
      const input = policy(s);
      const after = step(s, input, dt);
      frames.push({ before: s, input, after });
      s = after;
    }
    return frames;
  }

  const expectSameObstacles = (a: GameState, b: GameState) => {
    expect(a.obstacles.length).toBe(b.obstacles.length);
    expect(a.rngSeed).toBe(b.rngSeed);
    expect(a.nextObstacleId).toBe(b.nextObstacleId);
    expect(Math.abs(a.spawnTimerMs - b.spawnTimerMs)).toBeLessThanOrEqual(1e-6);
    a.obstacles.forEach((o, i) => {
      expect(o.id).toBe(b.obstacles[i].id);
      expect(o.height).toBe(b.obstacles[i].height);
      expect(Math.abs(o.x - b.obstacles[i].x)).toBeLessThanOrEqual(1e-6);
    });
  };

  /** AC-14 の状況（最大高さの障害物 1 つ、入力なし）で gameover まで進める */
  const runUntilGameover = (dt: number) =>
    runFixedDt(noSpawn([{ id: 1, x: SX, width: W, height: HMAX }]), dt, () => NO_INPUT, TEN_SECONDS, (s) => s.status === 'gameover');

  it('AC-9: 開始から FIRST ms 後のフレームで最初の障害物が SX に生成される', () => {
    const dt = 10;
    for (const seed of [1, 42, 12345]) {
      let s = startGame(createInitialState(seed));
      for (let elapsed = dt; elapsed <= FIRST - dt; elapsed += dt) {
        s = step(s, NO_INPUT, dt);
        expect(s.obstacles.length).toBe(0);
      }
      s = step(s, NO_INPUT, dt);
      expect(s.obstacles.length).toBe(1);
      const o = s.obstacles[0];
      expect(o.x).toBe(SX);
      expect(o.width).toBe(W);
      expect(Number.isInteger(o.height)).toBe(true);
      expect(o.height).toBeGreaterThanOrEqual(HMIN);
      expect(o.height).toBeLessThanOrEqual(HMAX);
      expect(o.id).toBe(1);
      expect(s.spawnTimerMs).toBeGreaterThanOrEqual(IMIN);
      expect(s.spawnTimerMs).toBeLessThan(IMAX);
      expect(s.nextObstacleId).toBe(2);
    }
  });

  it('AC-12: step 全体でも dt の分割方法によらず 3000ms 後の障害物が一致する', () => {
    const splits = [repeat([10], 300), repeat([20], 150), repeat([50], 60), repeat([5, 45, 30, 20, 50, 50], 15)];
    const results = splits.map((dts) => {
      expect(dts.reduce((a, b) => a + b, 0)).toBe(3000);
      return runDts(startGame(createInitialState(12345)), dts);
    });
    expect(results[0].obstacles.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(r.status).toBe('playing');
      expectSameObstacles(r, results[0]);
    }
  });

  it('AC-13: プレイヤー右端と接するだけでは playing、重なった次のフレームで gameover', () => {
    const d = (S * 10) / 1000;
    const s0 = noSpawn([{ id: 1, x: PR + d, width: W, height: HMIN }]);
    const s1 = step(s0, NO_INPUT, 10);
    expect(s1.obstacles[0].x).toBe(PR);
    expect(s1.status).toBe('playing');
    const s2 = step(s1, NO_INPUT, 10);
    expect(s2.obstacles[0].x).toBe(PR - d);
    expect(s2.status).toBe('gameover');
  });

  it('AC-14: 何もしなければ衝突し、初めて重なったフレームで gameover になる', () => {
    for (const dt of [1000 / 60, 50]) {
      const frames = runUntilGameover(dt);
      const last = frames[frames.length - 1];
      expect(last.after.status).toBe('gameover');
      expect(last.after.obstacles[0].x).toBeLessThan(PR);
      expect(last.before.obstacles[0].x).toBeGreaterThanOrEqual(PR);
      for (const f of frames.slice(0, -1)) expect(f.after.status).toBe('playing');
    }
  });

  it('AC-15: 最大高さ・最小間隔の 2 連続でも、方針どおり跳べば両方越えられる', () => {
    const XJ = PLAYER.x + PLAYER.width / 2 - W / 2 + (S * Math.abs(V)) / G;
    for (const dt of [1000 / 144, 1000 / 60, 1000 / 30, 50]) {
      const start = noSpawn([
        { id: 1, x: SX, width: W, height: HMAX },
        { id: 2, x: SX + (S * IMIN) / 1000, width: W, height: HMAX },
      ]);
      const jumpedIds = new Set<number>();
      const policy = (s: GameState): GameInput => {
        const next = s.obstacles.find((o) => !jumpedIds.has(o.id));
        if (next && next.x <= XJ) {
          jumpedIds.add(next.id);
          return JUMP;
        }
        return NO_INPUT;
      };
      const allPassed = (s: GameState) => s.obstacles.every((o) => o.x + o.width <= PLAYER.x);
      const frames = runFixedDt(start, dt, policy, TEN_SECONDS, allPassed);
      expect(allPassed(frames[frames.length - 1].after)).toBe(true);
      for (const f of frames) expect(f.after.status).toBe('playing');
      const jumpFrames = frames.filter((f) => f.input.jumpPressed);
      expect(jumpFrames).toHaveLength(2);
      for (const f of jumpFrames) expect(f.before.player.onGround).toBe(true);
    }
  });

  it('AC-17: gameover では入力の有無にかかわらず障害物・タイマー・乱数も止まる', () => {
    const frames = runUntilGameover(1000 / 60);
    const over = frames[frames.length - 1].after;
    expect(over.status).toBe('gameover');
    let s = { ...over, spawnTimerMs: 5 }; // タイマーが動いていれば生成されてしまう値
    for (let i = 0; i < 100; i++) {
      const r = step(s, i % 2 === 0 ? JUMP : NO_INPUT, 16);
      expect(r).toEqual(s);
      s = r;
    }
    s = over;
    for (let i = 0; i < 100; i++) {
      const r = step(s, i % 2 === 0 ? JUMP : NO_INPUT, 16);
      expect(r).toEqual(s);
      s = r;
    }
  });

  it('AC-18: ready では入力がなければ障害物もタイマーも動かない', () => {
    for (const seed of [1, 12345]) {
      const s0 = createInitialState(seed);
      let s = s0;
      for (let i = 0; i < 100; i++) {
        s = step(s, NO_INPUT, 50);
        expect(s).toEqual(s0);
      }
      expect(s.obstacles).toEqual([]);
      expect(s.spawnTimerMs).toBe(FIRST);
    }
  });

  it('AC-19: createInitialState はシードを uint32 に正規化し、障害物まわりを初期化する', () => {
    const cases: [number, number][] = [
      [0, 0],
      [12345, 12345],
      [2 ** 32 + 5, 5],
      [-1, 4294967295],
    ];
    for (const [seed, expected] of cases) {
      expect(createInitialState(seed).rngSeed).toBe(seed >>> 0);
      expect(createInitialState(seed).rngSeed).toBe(expected);
    }
    for (const s of [createInitialState(), createInitialState(12345)]) {
      expect(s.obstacles).toEqual([]);
      expect(s.spawnTimerMs).toBe(FIRST);
      expect(s.nextObstacleId).toBe(1);
      expect(s.scrollSpeed).toBe(S);
    }
    expect(createInitialState().rngSeed).toBe(RANDOM.defaultSeed);
  });

  it('AC-20: startGame はシードだけ引き継ぎ、他は初期化して playing にする', () => {
    const s: GameState = {
      ...createInitialState(777),
      obstacles: [{ id: 3, x: 100, width: W, height: HMIN }],
      spawnTimerMs: 5,
      nextObstacleId: 9,
      scrollSpeed: 999,
      score: 42,
      status: 'gameover',
    };
    const r = startGame(s);
    expect(r.status).toBe('playing');
    expect(r.rngSeed).toBe(777);
    expect(r.obstacles).toEqual([]);
    expect(r.spawnTimerMs).toBe(FIRST);
    expect(r.nextObstacleId).toBe(1);
    expect(r.scrollSpeed).toBe(S);
    expect(r.score).toBe(0);
  });

  it('AC-21: 同じシードなら同じ結果、異なるシードなら障害物が変わる', () => {
    const dts = repeat([16], 150);
    const a = runDts(startGame(createInitialState(12345)), dts);
    const b = runDts(startGame(createInitialState(12345)), dts);
    const c = runDts(startGame(createInitialState(54321)), dts);
    expect(a).toEqual(b);
    expect(a.obstacles.length).toBeGreaterThan(0);
    expect(c.obstacles.length).toBeGreaterThan(0);
    expect(a.obstacles[0].height !== c.obstacles[0].height || a.spawnTimerMs !== c.spawnTimerMs).toBe(true);
  });

  it('AC-22 (step): 入力 state と obstacles を書き換えず、変化時は別参照を返す', () => {
    const two: Obstacle[] = [
      { id: 1, x: 400, width: W, height: HMIN },
      { id: 2, x: 700, width: W, height: HMAX },
    ];
    const states: GameState[] = [
      noSpawn(two),
      { ...startGame(createInitialState(42)), obstacles: two, nextObstacleId: 3, spawnTimerMs: 10 }, // このフレームで生成
      { ...createInitialState(), status: 'gameover', obstacles: two },
    ];
    for (const s of states) {
      const copy = structuredClone(s);
      for (const input of [NO_INPUT, JUMP]) {
        const r = step(s, input, 16);
        expect(s).toEqual(copy);
        if (JSON.stringify(r) !== JSON.stringify(copy)) {
          expect(r).not.toBe(s);
          expect(r.obstacles).not.toBe(s.obstacles);
        }
      }
    }
  });
});
