import { describe, expect, it, vi } from 'vitest';
import { createHighScoreStore, HIGH_SCORE_KEY, type KeyValueStorage } from '../../src/highScoreStore';

const KEY = HIGH_SCORE_KEY;

const throwing = (name: string) =>
  vi.fn(() => {
    throw new Error(name);
  });

/** Map を裏に持つフェイク（往復確認用） */
function mapStorage() {
  const map = new Map<string, string>();
  return {
    map,
    storage: {
      getItem: vi.fn((key: string) => map.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => {
        map.set(key, value);
      }),
    } satisfies KeyValueStorage,
  };
}

describe('GAM-3 highScoreStore', () => {
  it('AC-20: load は getItem(KEY) の値をパースする（不正値は 0）', () => {
    const cases: [string | null, number][] = [
      ['123', 123],
      [null, 0],
      ['abc', 0],
      ['-5', 0],
    ];
    for (const [raw, expected] of cases) {
      const fake = { getItem: vi.fn(() => raw), setItem: vi.fn() };
      const store = createHighScoreStore(() => fake);
      expect(store.load()).toBe(expected);
      expect(fake.getItem).toHaveBeenCalledWith(KEY);
    }
  });

  it('AC-21: ストレージが使えない環境でも load は例外を投げず 0 を返す', () => {
    const getters: (() => KeyValueStorage | null | undefined)[] = [
      throwing('SecurityError'),
      () => null,
      () => undefined,
      () => ({ getItem: throwing('SecurityError'), setItem: vi.fn() }),
    ];
    for (const getStorage of getters) {
      const store = createHighScoreStore(getStorage);
      expect(() => store.load()).not.toThrow();
      expect(store.load()).toBe(0);
    }
  });

  it('AC-22: save は setItem(KEY, 10 進文字列) を呼び、load で往復できる', () => {
    const { storage } = mapStorage();
    const store = createHighScoreStore(() => storage);
    store.save(123);
    expect(storage.setItem).toHaveBeenLastCalledWith(KEY, '123');
    expect(store.load()).toBe(123);
    store.save(0);
    expect(storage.setItem).toHaveBeenLastCalledWith(KEY, '0');
    expect(store.load()).toBe(0);
  });

  it('AC-23: 使えない環境・不正値でも save は例外を投げず、不正値は書かない', () => {
    const getters: (() => KeyValueStorage | null | undefined)[] = [
      throwing('SecurityError'),
      () => null,
      () => ({ getItem: vi.fn(() => null), setItem: throwing('QuotaExceededError') }),
    ];
    for (const getStorage of getters) {
      const store = createHighScoreStore(getStorage);
      expect(() => store.save(123)).not.toThrow();
    }

    const { storage } = mapStorage();
    const store = createHighScoreStore(() => storage);
    for (const n of [-1, 1.5, Number.NaN]) {
      expect(() => store.save(n)).not.toThrow();
    }
    expect(storage.setItem).not.toHaveBeenCalled();
  });
});
