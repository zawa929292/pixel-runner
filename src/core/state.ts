import { OBSTACLE, PHYSICS, PLAYER, RANDOM, SCROLL, WORLD } from './config';
import { intersects, obstacleRect, playerRect } from './collision';
import { advanceObstacles, type Obstacle } from './obstacles';
import { jump, updatePlayer } from './player';

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
  score: number;
  obstacles: Obstacle[];
  /** 次の障害物生成までの残り時間 [ms] */
  spawnTimerMs: number;
  /** PRNG の状態（uint32） */
  rngSeed: number;
  nextObstacleId: number;
  /** 障害物（＝世界）が左へ流れる速度 [px/s]。GAM-5 で時間とともに変える */
  scrollSpeed: number;
}

export function createInitialState(seed: number = RANDOM.defaultSeed): GameState {
  return {
    status: 'ready',
    player: { x: PLAYER.x, y: WORLD.groundY, vy: 0, onGround: true },
    score: 0,
    obstacles: [],
    spawnTimerMs: OBSTACLE.firstSpawnDelayMs,
    rngSeed: seed >>> 0,
    nextObstacleId: 1,
    scrollSpeed: SCROLL.initialSpeed,
  };
}

/** playing でなければ、シードだけ引き継いで初期化した playing の state を返す。 */
export function startGame(state: GameState): GameState {
  if (state.status === 'playing') return state;
  return { ...createInitialState(state.rngSeed), status: 'playing' };
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
      return { ...state, ...world, player, status: hit ? 'gameover' : 'playing' };
    }
  }
}
