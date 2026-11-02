/** mulberry32 のアルゴリズム固有定数（ゲームの調整値ではない） */
const MULBERRY_INCREMENT = 0x6d2b79f5;
const MULBERRY_MIX = 61;
const SHIFT_A = 15;
const SHIFT_B = 7;
const SHIFT_C = 14;
/** 2^32。uint32 を [0, 1) に写すための除数 */
const UINT32_RANGE = 4294967296;

/** mulberry32。seed は uint32。戻り値の seed を次の呼び出しに渡す。 */
export function nextRandom(seed: number): { value: number; seed: number } {
  const s = (seed + MULBERRY_INCREMENT) >>> 0;
  let t = s;
  t = Math.imul(t ^ (t >>> SHIFT_A), t | 1);
  t ^= t + Math.imul(t ^ (t >>> SHIFT_B), t | MULBERRY_MIX);
  const value = ((t ^ (t >>> SHIFT_C)) >>> 0) / UINT32_RANGE;
  return { value, seed: s };
}
