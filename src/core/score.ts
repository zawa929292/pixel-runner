import { SCORE } from './config';

const MS_PER_SECOND = 1000;
/** 保存されたハイスコアとして受け付ける文字列（10 進の数字のみ） */
const DIGITS_ONLY = /^\d+$/;

/** 1 フレームぶん距離を進める。dtMs はクランプ済み。 */
export function advanceDistance(distance: number, scrollSpeed: number, dtMs: number): number {
  return distance + (scrollSpeed * dtMs) / MS_PER_SECOND;
}

/** 走行距離 [px] → スコア（0 以上の整数） */
export function scoreFromDistance(distance: number): number {
  return Math.max(0, Math.floor(distance / SCORE.pxPerPoint + SCORE.floorEpsilon));
}

/** 0 以上の安全な整数ならそのまま、それ以外は 0 */
export function sanitizeHighScore(n: number): number {
  return Number.isSafeInteger(n) && n >= 0 ? n : 0;
}

/** 保存された文字列 → ハイスコア。10 進の数字のみで安全な整数のときだけその値、それ以外は 0 */
export function parseHighScore(raw: string | null): number {
  return raw !== null && DIGITS_ONLY.test(raw) ? sanitizeHighScore(Number(raw)) : 0;
}
