import { describe, expect, it } from 'vitest';
import { SCORE } from '../../src/core/config';
import { formatHud } from '../../src/core/hud';
import { createInitialState, type GameState } from '../../src/core/state';

const D = SCORE.hudDigits;
const MAXD = 10 ** D - 1;
const pad = (n: number) => String(n).padStart(D, '0');
const expected = (hi: number, score: number) => `HI ${pad(hi)}  ${pad(score)}`;

describe('GAM-3 HUD', () => {
  it('AC-18: "HI " + D 桁ゼロ埋めのハイスコア + 空白 2 つ + D 桁ゼロ埋めのスコア（MAXD で頭打ち）', () => {
    expect(formatHud({ score: 45, highScore: 123 })).toBe(expected(123, 45));
    expect(formatHud({ score: 0, highScore: 0 })).toBe(expected(0, 0));
    expect(formatHud({ score: MAXD, highScore: MAXD })).toBe(expected(MAXD, MAXD));
    expect(formatHud({ score: MAXD + 1, highScore: 10 ** 7 })).toBe(expected(MAXD, MAXD));
    // 現行値（D = 5）での例
    if (D === 5) {
      expect(formatHud({ score: 45, highScore: 123 })).toBe('HI 00123  00045');
      expect(formatHud({ score: MAXD + 1, highScore: 10 ** 7 })).toBe('HI 99999  99999');
    }
  });

  it('AC-19: GameState をそのまま渡せる', () => {
    const s: GameState = { ...createInitialState(1, 7), status: 'playing', score: 42, distance: 425 };
    expect(formatHud(s)).toBe(formatHud({ score: s.score, highScore: s.highScore }));
    const init = createInitialState(1, 7);
    expect(formatHud(init)).toBe(formatHud({ score: init.score, highScore: init.highScore }));
    expect(formatHud(init)).toBe(expected(7, 0));
  });
});
