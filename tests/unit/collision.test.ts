import { describe, expect, it } from 'vitest';
import { OBSTACLE, PLAYER, WORLD } from '../../src/core/config';
import { intersects, obstacleRect, playerRect, type Rect } from '../../src/core/collision';

const GY = WORLD.groundY;
const W = OBSTACLE.width;
const HMAX = OBSTACLE.maxHeight;

const rect = (left: number, top: number, right: number, bottom: number): Rect => ({ left, top, right, bottom });

describe('GAM-2 AABB', () => {
  it('AC-3: 重なりは true、辺・角の接触と離れているものは false（引数の順序によらない）', () => {
    const A = rect(0, 0, 10, 10);
    const cases: [Rect, boolean][] = [
      [rect(5, 5, 15, 15), true], // 一部が重なる
      [rect(2, 2, 8, 8), true], // B が A に内包
      [rect(-5, -5, 15, 15), true], // A が B に内包
      [rect(10, 0, 20, 10), false], // 右辺が接する
      [rect(-10, 0, 0, 10), false], // 左辺が接する
      [rect(0, 10, 10, 20), false], // 下辺が接する
      [rect(0, -10, 10, 0), false], // 上辺が接する
      [rect(10, 10, 20, 20), false], // 角だけ接する
      [rect(11, 0, 20, 10), false], // 離れている
    ];
    for (const [B, expected] of cases) {
      expect(intersects(A, B)).toBe(expected);
      expect(intersects(B, A)).toBe(expected);
    }
  });

  it('AC-4: playerRect / obstacleRect は PLAYER・groundY から矩形を作る', () => {
    const player = { x: 120, y: 340, vy: 0, onGround: true };
    const obstacle = { id: 1, x: 200, width: 24, height: 40 };
    expect(playerRect(player)).toEqual({ left: 120, top: 308, right: 152, bottom: 340 });
    expect(playerRect(player)).toEqual({
      left: player.x,
      top: player.y - PLAYER.height,
      right: player.x + PLAYER.width,
      bottom: player.y,
    });
    expect(obstacleRect(obstacle)).toEqual({ left: 200, top: 300, right: 224, bottom: 340 });
    expect(obstacleRect(obstacle)).toEqual({
      left: obstacle.x,
      top: GY - obstacle.height,
      right: obstacle.x + obstacle.width,
      bottom: GY,
    });
  });

  it('AC-5: 障害物の上端に足元がちょうど接するときは false、0.5 めり込むと true', () => {
    const o = { id: 1, x: PLAYER.x, width: W, height: HMAX };
    const at = (y: number) => intersects(playerRect({ x: PLAYER.x, y, vy: 0, onGround: false }), obstacleRect(o));
    expect(at(GY - HMAX)).toBe(false);
    expect(at(GY - HMAX + 0.5)).toBe(true);
  });
});
