import { PLAYER, WORLD } from './config';

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
