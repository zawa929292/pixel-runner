import { OBSTACLE, PHYSICS, PLAYER, RANDOM, SCROLL, WORLD } from './config';
import { intersects, obstacleRect, playerRect } from './collision';
import { advanceObstacles, type Obstacle } from './obstacles';
import { jump, updatePlayer } from './player';
import { advanceDistance, sanitizeHighScore, scoreFromDistance } from './score';

export type GameStatus = 'ready' | 'playing' | 'gameover';

export interface PlayerState {
  x: number;
  /** 足元の y 座標（地面にいるとき WORLD.groundY） */
  y: number;
  vy: number;
  onGround: boolean;
}

export interface GameState {
  status: GameStatus;
  player: PlayerState;
  /** 今回のスコア = scoreFromDistance(distance)。0 以上の整数 */
  score: number;
  /** 今回の走行距離 [px]。playing 中に scrollSpeed × dt を積算する */
  distance: number;
  /** ハイスコア。gameover への遷移時に max(highScore, score) で更新する */
  highScore: number;
  obstacles: Obstacle[];
  /** 次の障害物生成までの残り時間 [ms] */
  spawnTimerMs: number;
  /** PRNG の状態（uint32） */
  rngSeed: number;
  nextObstacleId: number;
  /** 障害物（＝世界）が左へ流れる速度 [px/s]。GAM-5 で時間とともに変える */
  scrollSpeed: number;
}

export function createInitialState(seed: number = RANDOM.defaultSeed, highScore: number = 0): GameState {
  return {
    status: 'ready',
    player: { x: PLAYER.x, y: WORLD.groundY, vy: 0, onGround: true },
    score: 0,
    distance: 0,
    highScore: sanitizeHighScore(highScore),
    obstacles: [],
    spawnTimerMs: OBSTACLE.firstSpawnDelayMs,
    rngSeed: seed >>> 0,
    nextObstacleId: 1,
    scrollSpeed: SCROLL.initialSpeed,
  };
}

/** playing でなければ、シードとハイスコアだけ引き継いで初期化した playing の state を返す。 */
export function startGame(state: GameState): GameState {
  if (state.status === 'playing') return state;
  return { ...createInitialState(state.rngSeed, state.highScore), status: 'playing' };
}

/** 1 フレーム分の入力。jumpPressed は「前フレーム以降に SPACE が新たに押されたか」（押下の瞬間だけ true）。 */
export interface GameInput {
  jumpPressed: boolean;
}

/** 1 フレーム分ゲームを進める。dtMs はミリ秒（Phaser の delta）。 */
export function step(state: GameState, input: GameInput, dtMs: number): GameState {
  if (!Number.isFinite(dtMs) || dtMs <= 0) return state;
  const dt = Math.min(dtMs, PHYSICS.maxDtMs);

  switch (state.status) {
    case 'ready':
      // 開始に使った押下ではジャンプしない
      return input.jumpPressed ? startGame(state) : state;
    case 'gameover':
      return state;
    case 'playing': {
      const jumped = input.jumpPressed ? jump(state.player) : state.player;
      const player = updatePlayer(jumped, dt);
      const world = advanceObstacles(state, dt);
      const body = playerRect(player);
      const hit = world.obstacles.some((o) => intersects(body, obstacleRect(o)));
      // クランプ後の dt と、障害物の移動と同じフレーム開始時の速度で積算する（衝突フレームの移動ぶんも含める）
      const distance = advanceDistance(state.distance, state.scrollSpeed, dt);
      const score = scoreFromDistance(distance);
      // ハイスコアは gameover への遷移フレームでだけ更新する
      const highScore = hit ? Math.max(state.highScore, score) : state.highScore;
      return { ...state, ...world, player, distance, score, highScore, status: hit ? 'gameover' : 'playing' };
    }
  }
}
