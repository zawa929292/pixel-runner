import { PHYSICS, PLAYER, WORLD } from './config';
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
}

export function createInitialState(): GameState {
  return {
    status: 'ready',
    player: { x: PLAYER.x, y: WORLD.groundY, vy: 0, onGround: true },
    score: 0,
  };
}

export function startGame(state: GameState): GameState {
  if (state.status === 'playing') return state;
  return { ...createInitialState(), status: 'playing' };
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
      return player === state.player ? state : { ...state, player };
    }
  }
}
