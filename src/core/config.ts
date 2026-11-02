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

export const PHYSICS = {
  /** 重力加速度 [px/s²]（y 下向きが正）。上昇中・下降中とも一定 */
  gravity: 1000,
  /** ジャンプ初速 [px/s]（上向きなので負） */
  jumpVelocity: -550,
  /** 1 step で積分する dt の上限 [ms]。タブ復帰時などの巨大な delta 対策 */
  maxDtMs: 50,
} as const;
