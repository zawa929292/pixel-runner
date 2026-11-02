# 見本: Linear コメント

AI のコメントは **必ず `🤖` で始める**（人の指示と区別するため。docs/workflow-graph.md 参照）。

## 設計完了（/plan-issue）
```markdown
🤖 **設計完了 — Design Review をお願いします**

**要約**: core に `step()` と重力・ジャンプ定数を追加し、SPACE 入力でジャンプ。dt ベースで計算しフレームレート非依存にする。
**spec**: specs/GAM-1.md（ブランチ `gam-1-...`）

**受入条件**
- AC-1 [unit] 地上で jump → 上向き速度
- AC-2 [unit] 重力で落下
- AC-3 [unit] 空中ジャンプ不可
- AC-4 [unit] 着地時に地面へ吸着
- AC-5 [e2e] SPACE でジャンプ → 着地

**確認事項**
1. ジャンプ高さは約 120px（プレイヤー 3.75 個分）でよいか

✅ 承認 → `Approved` へ ／ ↩️ 差し戻し → コメントを書いて `Planning` のまま
```

## PR 作成（/implement）
```markdown
🤖 **実装完了 — PR を確認してください**

PR: https://github.com/zawa929292/pixel-runner/pull/12
- verify: ✅ lint / typecheck / unit 14 / e2e 3
- 反復: 2 回（進捗ノート: specs/GAM-1.progress.md）
- reviewer: PASS（low 1 件: 定数名の提案）

✅ マージ可 → `Merge Approved` ／ ↩️ 実装の差し戻し → コメント + `In Progress` ／ ↩️ 設計からやり直し → コメント + `Planning`
```

## エスカレーション（停止条件到達）
```markdown
🤖 **停止しました — 判断が必要です（Needs Human）**

**停止理由**: 同一失敗が 2 連続（`tests/e2e/jump.spec.ts` AC-5 timeout）
**試したこと**
1. 着地判定を `>=` に変更 → unit は green、e2e は依然 timeout
2. E2E のタイムアウトを延長 → 変化なし
**仮説**: headless 環境で Phaser の update が低頻度になり、dt が大きすぎて着地を跨いでいる可能性
**判断してほしいこと**: dt の上限クランプ（例: 50ms）を仕様として入れてよいか

再開方法: 指示をコメントして `In Progress`（実装から）または `Planning`（設計から）へ
```

## 差し戻しへの対応
```markdown
🤖 **差し戻し対応完了**

ご指摘: 「ジャンプが低すぎる」
対応: `PHYSICS.jumpVelocity` を 520 → 600 に変更し、AC-1 の境界値テストを更新（commit abc1234）
PR を更新しました。再確認をお願いします。
```
