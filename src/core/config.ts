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

export const SCROLL = {
  /** 開始時のスクロール速度 [px/s]。GameState.scrollSpeed の初期値 */
  initialSpeed: 300,
} as const;

export const OBSTACLE = {
  /** 幅 [px]（固定） */
  width: 24,
  /** 高さの範囲 [px]（整数、両端含む一様分布） */
  minHeight: 24,
  maxHeight: 56,
  /** 生成位置（左端の x）。画面右端のすぐ外 */
  spawnX: WORLD.width,
  /** 開始から最初の生成までの時間 [ms] */
  firstSpawnDelayMs: 1000,
  /** 生成間隔の範囲 [ms]（[min, max) の一様分布） */
  minIntervalMs: 1400,
  maxIntervalMs: 2400,
} as const;

export const RANDOM = {
  /** createInitialState にシードを渡さなかったときの既定値 */
  defaultSeed: 1,
} as const;

export const SCORE = {
  /** 走行距離 [px] をスコア 1 点に換算する量。300 px/s で 30 点/秒 */
  pxPerPoint: 10,
  /** scoreFromDistance の floor で、浮動小数誤差により境界をわずかに下回るのを吸収する量 [点] */
  floorEpsilon: 1e-6,
  /** HUD に表示する桁数（ゼロ埋め）。超えたら 10^digits - 1 で頭打ち */
  hudDigits: 5,
} as const;

export const HUD = {
  /** 画面右上からの余白 [px] */
  marginPx: 16,
  fontSizePx: 20,
} as const;
