import Phaser from 'phaser';
import { WORLD } from './core/config';
import type { GameState } from './core/state';
import { GameScene } from './scenes/GameScene';

/** uint32 の値の個数（2^32）。シードをランダムに作るときの範囲 */
const UINT32_RANGE = 2 ** 32;

/** `?seed=<整数>` があればそれを、なければ起動ごとにランダムなシードを使う（乱数生成は core の外で行う）。 */
function readSeed(): number {
  const seedParam = new URLSearchParams(location.search).get('seed');
  if (seedParam !== null && /^\d+$/.test(seedParam)) return Number(seedParam) >>> 0;
  return Math.floor(Math.random() * UINT32_RANGE);
}

const scene = new GameScene(readSeed());

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
