import { PHYSICS, WORLD } from './config';
import type { PlayerState } from './state';

const MS_PER_SECOND = 1000;

/** 地上にいればジャンプを開始した PlayerState を返す。空中なら同じ参照をそのまま返す。 */
export function jump(player: PlayerState): PlayerState {
  if (!player.onGround) return player;
  return { ...player, vy: PHYSICS.jumpVelocity, onGround: false };
}

/**
 * dtMs（呼び出し側でクランプ済み、0 より大きい前提）ぶん重力を適用して位置を進め、着地を判定する。
 * 等加速度運動の厳密解で積分するため、dt の分割方法によらず同じ時刻で同じ位置・速度になる。
 */
export function updatePlayer(player: PlayerState, dtMs: number): PlayerState {
  if (player.onGround) return player;
  const t = dtMs / MS_PER_SECOND;
  const g = PHYSICS.gravity;
  const y = player.y + player.vy * t + 0.5 * g * t * t;
  const vy = player.vy + g * t;
  if (y >= WORLD.groundY && vy >= 0) {
    return { ...player, y: WORLD.groundY, vy: 0, onGround: true };
  }
  return { ...player, y, vy, onGround: false };
}
