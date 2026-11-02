# 見本: テストの書き方

> 注: コード例は GAM-1 実装後に存在する想定の API（`step`, `PHYSICS`）を使った見本です。

## Unit（tests/unit/*.test.ts）
テスト名に受入条件 ID を入れ、spec と 1:1 で追えるようにする。境界値を必ず含める。

```ts
import { describe, expect, it } from 'vitest';
import { createInitialState, startGame } from '../../src/core/state';
import { step } from '../../src/core/step';
import { PHYSICS, WORLD } from '../../src/core/config';

describe('GAM-1 ジャンプ', () => {
  const playing = () => startGame(createInitialState());

  it('AC-1: 地上で jump 入力すると上向きの速度を持つ', () => {
    const s = step(playing(), { jump: true }, 16);
    expect(s.player.vy).toBeLessThan(0);
    expect(s.player.onGround).toBe(false);
  });

  it('AC-3: 空中では jump 入力を無視する（二段ジャンプ不可）', () => {
    const inAir = step(playing(), { jump: true }, 16);
    const s = step(inAir, { jump: true }, 16);
    expect(s.player.vy).toBeGreaterThan(inAir.player.vy); // 重力で減速しているだけ
  });

  it('AC-4: 着地の瞬間に地面へ吸着する（めり込まない）', () => {
    let s = step(playing(), { jump: true }, 16);
    for (let i = 0; i < 200 && !s.player.onGround; i++) s = step(s, { jump: false }, 16);
    expect(s.player.y).toBe(WORLD.groundY);
    expect(s.player.vy).toBe(0);
  });
});
```

### 悪い例
```ts
// ❌ 実装の中身をなぞっているだけ（定数を変えるとテストも同じだけ変わり、何も検証していない）
expect(s.player.vy).toBe(-PHYSICS.jumpVelocity + PHYSICS.gravity * 0.016);
// ❌ 固定フレーム数を前提にした脆いアサーション
expect(s.player.y).toBe(287.36);
// ❌ skip で green にする
it.skip('AC-4 ...', () => {});
```

## E2E（tests/e2e/*.spec.ts）
状態は `window.__GAME__.getState()` を `expect.poll` で検証する。固定 sleep とピクセル比較は使わない。

```ts
import { expect, test } from '@playwright/test';

const status = (page) => page.evaluate(() => window.__GAME__?.getState().status);
const player = (page) => page.evaluate(() => window.__GAME__?.getState().player);

test('GAM-1 AC-5: SPACE でジャンプして着地する', async ({ page }) => {
  await page.goto('/?test=1');
  await page.locator('#game canvas').click();
  await page.keyboard.press('Space'); // 開始
  await expect.poll(() => status(page)).toBe('playing');

  await page.keyboard.press('Space'); // ジャンプ
  await expect.poll(async () => (await player(page))?.onGround).toBe(false);
  await expect.poll(async () => (await player(page))?.onGround, { timeout: 5_000 }).toBe(true);
});
```
