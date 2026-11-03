import { SCORE } from './config';
import type { GameState } from './state';

const HI_LABEL = 'HI ';
const SEPARATOR = '  ';
const PAD_CHAR = '0';
const MAX_DISPLAY = 10 ** SCORE.hudDigits - 1;

const pad = (value: number): string => String(Math.min(value, MAX_DISPLAY)).padStart(SCORE.hudDigits, PAD_CHAR);

/** HUD の文字列。例: "HI 00123  00045"（ハイスコア → 今回のスコアの順） */
export function formatHud(s: Pick<GameState, 'score' | 'highScore'>): string {
  return HI_LABEL + pad(s.highScore) + SEPARATOR + pad(s.score);
}
