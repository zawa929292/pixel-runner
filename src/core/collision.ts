import { PLAYER, WORLD } from './config';
import type { Obstacle } from './obstacles';
import type { PlayerState } from './state';

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** 開区間で判定する。辺・角が接するだけ（差が 0）は衝突ではない。 */
export function intersects(a: Rect, b: Rect): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

/** プレイヤーの矩形（左端 x、足元 y）。 */
export function playerRect(p: PlayerState): Rect {
  return { left: p.x, right: p.x + PLAYER.width, top: p.y - PLAYER.height, bottom: p.y };
}

/** 障害物の矩形（左端 x、下端は地面）。 */
export function obstacleRect(o: Obstacle): Rect {
  return { left: o.x, right: o.x + o.width, top: WORLD.groundY - o.height, bottom: WORLD.groundY };
}
