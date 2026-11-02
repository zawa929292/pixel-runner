import { defineConfig } from 'vitest/config';

export default defineConfig({
  // GitHub Pages はサブパス配信のため相対パスでビルドする
  base: './',
  // Phaser 本体が大きいため警告閾値を上げる
  build: { chunkSizeWarningLimit: 1600 },
  test: {
    include: ['tests/unit/**/*.test.ts'],
  },
});
