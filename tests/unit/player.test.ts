import { describe, expect, it } from 'vitest';
import { PHYSICS, PLAYER, WORLD } from '../../src/core/config';
import { jump, updatePlayer } from '../../src/core/player';
import type { PlayerState } from '../../src/core/state';

const G = PHYSICS.gravity;
const V = PHYSICS.jumpVelocity;
const GY = WORLD.groundY;

const grounded = (): PlayerState => ({ x: PLAYER.x, y: GY, vy: 0, onGround: true });
const airborne = (y: number, vy: number): PlayerState => ({ x: PLAYER.x, y, vy, onGround: false });

describe('jump', () => {
  it('地上なら vy=V・onGround=false になり、y は変わらない', () => {
    const p = grounded();
    const r = jump(p);
    expect(r.vy).toBe(V);
    expect(r.onGround).toBe(false);
    expect(r.y).toBe(GY);
    expect(r.x).toBe(p.x);
    expect(r).not.toBe(p);
  });

  it('空中（上昇中）なら同じ参照を返す', () => {
    const p = airborne(GY - 50, -100);
    expect(jump(p)).toBe(p);
  });

  it('空中（下降中）なら同じ参照を返す', () => {
    const p = airborne(GY - 50, 100);
    expect(jump(p)).toBe(p);
  });
});

describe('updatePlayer', () => {
  it('AC-9: 地上なら同じ参照を返す', () => {
    const p = grounded();
    expect(updatePlayer(p, 16)).toBe(p);
  });

  it('空中で 1 step 進めた結果が等加速度の厳密解と一致する', () => {
    const p = airborne(GY - 100, -200);
    const dtMs = 16;
    const t = dtMs / 1000;
    const r = updatePlayer(p, dtMs);
    expect(r.y).toBeCloseTo(p.y + p.vy * t + 0.5 * G * t * t, 9);
    expect(r.vy).toBeCloseTo(p.vy + G * t, 9);
    expect(r.onGround).toBe(false);
    expect(r.x).toBe(p.x);
  });

  it('境界: 着地の 1 フレーム前（y\' < GY）は onGround=false のまま', () => {
    const dtMs = 16;
    const t = dtMs / 1000;
    const vy = 100;
    // y' = GY - 1 になるように開始位置を決める
    const y = GY - 1 - (vy * t + 0.5 * G * t * t);
    const r = updatePlayer(airborne(y, vy), dtMs);
    expect(r.onGround).toBe(false);
    expect(r.y).toBeLessThan(GY);
  });

  it('AC-8: y\' がちょうど GY のときスナップする', () => {
    const p = airborne(GY - 0.5 * G * 0.25, 0);
    const r = updatePlayer(p, 500);
    expect(r.y).toBe(GY);
    expect(r.vy).toBe(0);
    expect(r.onGround).toBe(true);
  });

  it('AC-7: y\' が GY を越えると地面にスナップする（めり込まない）', () => {
    const p = airborne(GY - 1, 500);
    const r = updatePlayer(p, 16);
    expect(r.y).toBe(GY);
    expect(r.vy).toBe(0);
    expect(r.onGround).toBe(true);
    expect(r.x).toBe(p.x);
  });

  it('境界: 上昇中（vy\' < 0）は y\' >= GY でも着地にしない', () => {
    const dtMs = 16;
    const t = dtMs / 1000;
    const vy = -G * t - 10; // t 後も vy' = -10 < 0（上昇中）
    // y' = GY + 1（>= GY）になるように開始位置を決める
    const y = GY + 1 - (vy * t + 0.5 * G * t * t);
    const r = updatePlayer(airborne(y, vy), dtMs);
    expect(vy + G * t).toBeLessThan(0);
    expect(r.y).toBeGreaterThanOrEqual(GY);
    expect(r.onGround).toBe(false);
    expect(r.vy).toBeCloseTo(vy + G * t, 9);
  });

  it('AC-14: jump / updatePlayer は入力を書き換えない', () => {
    const inputs = [grounded(), airborne(GY - 50, -100), airborne(GY - 1, 500)];
    for (const p of inputs) {
      const copy = structuredClone(p);
      jump(p);
      updatePlayer(p, 16);
      expect(p).toEqual(copy);
    }
    const g = grounded();
    expect(jump(g)).not.toBe(g);
    const a = airborne(GY - 50, -100);
    expect(updatePlayer(a, 16)).not.toBe(a);
  });
});
