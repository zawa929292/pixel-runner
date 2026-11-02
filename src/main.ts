import Phaser from 'phaser';
import { WORLD } from './core/config';
import type { GameState } from './core/state';
import { GameScene } from './scenes/GameScene';

const scene = new GameScene();

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: WORLD.width,
  height: WORLD.height,
  backgroundColor: '#87ceeb',
  scene,
});

declare global {
  interface Window {
    __GAME__?: { getState: () => GameState };
  }
}

// E2E テスト用に状態を公開する（?test=1 のときのみ）
if (new URLSearchParams(location.search).has('test')) {
  window.__GAME__ = { getState: () => scene.state };
}
