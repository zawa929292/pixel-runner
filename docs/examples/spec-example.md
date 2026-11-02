# 見本: 設計書（specs/GAM-n.md）

> ⚠️ これは書き方の見本であり、架空の Issue です。ここに書かれた機能を実装してはいけません。

---

# GAM-99: 一時停止（ポーズ）機能

## 目的
プレイ中に P キーで一時停止・再開できるようにし、離席時にゲームオーバーにならないようにする。

## 受入条件
- **AC-1 [unit]** Given status が `playing` / When `togglePause` を呼ぶ / Then status が `paused` になる
- **AC-2 [unit]** Given status が `paused` / When `togglePause` を呼ぶ / Then status が `playing` に戻る
- **AC-3 [unit]** Given status が `paused` / When `step(state, input, 1000)` を呼ぶ / Then プレイヤー位置・障害物・スコアが変化しない
- **AC-4 [unit]** Given status が `ready` または `gameover` / When `togglePause` を呼ぶ / Then 状態は変化しない
- **AC-5 [e2e]** Given ゲーム開始後 / When P キーを押す / Then `getState().status` が `paused` になり、もう一度 P で `playing` に戻る

## 設計
- `src/core/state.ts`: `GameStatus` に `'paused'` を追加。`togglePause(state): GameState` を追加（純関数）
- `src/core/step.ts`: 先頭で `if (state.status !== 'playing') return state;`
- `src/scenes/GameScene.ts`: `keydown-P` で `togglePause` を呼ぶ。`paused` 中は「PAUSED」テキストを表示
- 定数の追加なし

## テスト計画
- Unit: `tests/unit/pause.test.ts` — AC-1〜4。AC-4 は `ready` と `gameover` の 2 ケース
- E2E: `tests/e2e/pause.spec.ts` — AC-5

## 影響範囲・リスク
- `GameStatus` の網羅チェック（switch）がある箇所はすべて `paused` の分岐が必要
- 一時停止中も Phaser の update は呼ばれるため、core 側で止めることが重要

## 確認事項
- 一時停止中に SPACE を押した場合は無視でよいか（本設計では無視）
