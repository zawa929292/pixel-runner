import { describe, expect, it } from 'vitest';
import { nextRandom } from '../../src/core/random';

const UINT32_MAX = 0xffffffff;

describe('GAM-2 PRNG (nextRandom)', () => {
  it('AC-1: 同じシードなら同じ結果を返し、value は [0,1)、seed は uint32 の整数', () => {
    for (const seed of [0, 1, 12345, UINT32_MAX]) {
      const a = nextRandom(seed);
      const b = nextRandom(seed);
      expect(a).toEqual(b);
      expect(a.value).toBeGreaterThanOrEqual(0);
      expect(a.value).toBeLessThan(1);
      expect(Number.isInteger(a.seed)).toBe(true);
      expect(a.seed).toBeGreaterThanOrEqual(0);
      expect(a.seed).toBeLessThanOrEqual(UINT32_MAX);
    }
  });

  it('AC-2: 連鎖 10000 回で値域 [0,1) を守り、偏りが粗くなく、シードで列が変わる', () => {
    let seed = 12345;
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < 10000; i++) {
      const r = nextRandom(seed);
      expect(r.value).toBeGreaterThanOrEqual(0);
      expect(r.value).toBeLessThan(1);
      min = Math.min(min, r.value);
      max = Math.max(max, r.value);
      seed = r.seed;
    }
    expect(min).toBeLessThan(0.01);
    expect(max).toBeGreaterThan(0.99);

    const seq = (start: number) => {
      const out: number[] = [];
      let s = start;
      for (let i = 0; i < 10; i++) {
        const r = nextRandom(s);
        out.push(r.value);
        s = r.seed;
      }
      return out;
    };
    expect(seq(1)).not.toEqual(seq(2));
  });
});
