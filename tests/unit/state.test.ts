import { describe, expect, it } from 'vitest';
import { WORLD } from '../../src/core/config';
import { createInitialState, startGame } from '../../src/core/state';

describe('state', () => {
  it('初期状態は ready で、プレイヤーは地面に立っている', () => {
    const s = createInitialState();
    expect(s.status).toBe('ready');
    expect(s.player.y).toBe(WORLD.groundY);
    expect(s.player.onGround).toBe(true);
  });

  it('startGame で playing になりスコアがリセットされる', () => {
    const s = startGame({ ...createInitialState(), score: 99 });
    expect(s.status).toBe('playing');
    expect(s.score).toBe(0);
  });
});
