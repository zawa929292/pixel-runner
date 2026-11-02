import { describe, expect, it } from 'vitest';
import { PHYSICS, PLAYER, WORLD } from '../../src/core/config';
import { createInitialState, startGame, step, type GameState } from '../../src/core/state';

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
          expect(r.player === s.player && r.status === s.status).toBe(false);
        }
      }
    }
  });
});
