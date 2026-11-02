/** ゲーム全体の定数。数値調整はここに集約する（docs/game-design.md と対応）。 */
export const WORLD = {
  width: 800,
  height: 400,
  groundY: 340,
} as const;

export const PLAYER = {
  x: 120,
  width: 32,
  height: 32,
} as const;
