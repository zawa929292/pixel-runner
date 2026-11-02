# Architecture

## レイヤー
```
src/main.ts          エントリ。Phaser.Game 生成、テスト用フック公開
src/scenes/*         Phaser シーン：入力 → core 関数呼び出し → 結果を描画
src/core/*           純ロジック：状態型・更新関数・当たり判定・定数（Phaser import 禁止 / ESLint で強制）
```

## なぜ分けるか（AI 駆動開発の観点）
- core が純関数なので Vitest で高速・決定的に検証でき、実装・検証ループが速く回る
- scenes を薄くすることで E2E は「起動・入力・状態遷移」の確認に絞れる
- AI が変更すべき場所が明確になり、差分が小さくレビューしやすい

## 状態更新パターン
`step(state, input, dtMs) => newState` の形で 1 フレーム分を計算する。
scene は `update(time, delta)` で `step` を呼び、返った state を描画する。

## テスト方針
- Unit: core の全公開関数。境界値（着地・衝突の瞬間）を必ず含める
- E2E: `?test=1` → `window.__GAME__.getState()` で状態を検証。1 機能 1 シナリオ程度に留める
