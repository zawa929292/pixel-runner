import { describe, expect, it } from 'vitest';
import { PHYSICS, SCORE, SCROLL } from '../../src/core/config';
import { advanceDistance, parseHighScore, sanitizeHighScore, scoreFromDistance } from '../../src/core/score';

const S = SCROLL.initialSpeed;
const P = SCORE.pxPerPoint;
const EPS = SCORE.floorEpsilon;
const MAXDT = PHYSICS.maxDtMs;

describe('GAM-3 score', () => {
  it('AC-1: advanceDistance は distance + scrollSpeed * dtMs / 1000 を返す', () => {
    const cases: [number, number, number][] = [
      [0, S, 10],
      [100, S, 16],
      [100, 2 * S, 16],
      [0, S, MAXDT],
    ];
    for (const [d, v, dt] of cases) {
      expect(Math.abs(advanceDistance(d, v, dt) - (d + (v * dt) / 1000))).toBeLessThanOrEqual(1e-9);
    }
  });

  it('AC-2: scoreFromDistance は距離を P で割った値の floor（EPS で浮動小数誤差を吸収）', () => {
    const cases: [number, number][] = [
      [0, 0],
      [P - 0.5, 0],
      [P, 1],
      [90 * P - 1e-9, 90],
      [90 * P - P * 10 * EPS, 89],
      [948, Math.floor(948 / P)],
    ];
    for (const [d, expected] of cases) {
      const r = scoreFromDistance(d);
      expect(r).toBe(expected);
      expect(Number.isInteger(r)).toBe(true);
      expect(r).toBeGreaterThanOrEqual(0);
    }
  });

  it('AC-3: sanitizeHighScore は 0 以上の安全な整数だけを通し、それ以外は 0', () => {
    const cases: [number, number][] = [
      [0, 0],
      [123, 123],
      [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
      [-1, 0],
      [1.5, 0],
      [Number.NaN, 0],
      [Number.POSITIVE_INFINITY, 0],
      [Number.MAX_SAFE_INTEGER + 2, 0],
    ];
    for (const [n, expected] of cases) expect(sanitizeHighScore(n)).toBe(expected);
  });

  it('AC-4: parseHighScore は 10 進整数の文字列だけを受け付け、それ以外は 0', () => {
    expect(parseHighScore('123')).toBe(123);
    expect(parseHighScore('00123')).toBe(123);
    expect(parseHighScore('0')).toBe(0);
    expect(parseHighScore(String(Number.MAX_SAFE_INTEGER))).toBe(Number.MAX_SAFE_INTEGER);
    for (const raw of [null, '', 'abc', '-5', '1.5', '1e3', ' 12', '12 ', '0x10', '9007199254740993']) {
      expect(parseHighScore(raw)).toBe(0);
    }
  });
});
