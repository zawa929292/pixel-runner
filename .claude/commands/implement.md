---
description: 実装・検証ループ + 品質改善ループ — 承認済み Issue を実装し PR を作成する
argument-hint: GAM-n
---
Linear Issue $ARGUMENTS を実装してください。

## 事前チェック
- Linear で状態が `Approved` でなければ中止し、理由を伝える（人間の設計承認がないため）
- Issue を `In Progress` に移動。Linear の gitBranchName のブランチに切り替える（なければ main から作成）

## 実装・検証ループ
1. `implementer` サブエージェントに `specs/$ARGUMENTS.md` と Linear の最新コメントを渡す
2. 結果が ESCALATE の場合 → 下記「エスカレーション」へ

## 品質改善ループ（最大 2 周）
3. `reviewer` サブエージェントでレビュー
4. NEEDS_FIX なら指摘を `implementer` に渡して修正 → 再度 `npm run verify` → 再レビュー
5. 2 周しても high が残る場合 → エスカレーション

## PR 作成
6. `docs/game-design.md` のロードマップ状態を更新
7. コミットして作業ブランチを push し、`gh pr create` で PR を作成
   - タイトル: `$ARGUMENTS: <要約>`、本文: 変更点・受入条件のチェックリスト・レビュー結果・`Fixes $ARGUMENTS`
8. Linear に PR リンクとレビュー結果をコメント。「マージしてよければ `Merge Approved` に移動してください」と記載
   （PR 作成で Linear の GitHub 連携が `In Review` に自動遷移させる）

## エスカレーション
Issue を `Needs Human` に移動し、試したこと / 失敗ログ要約 / 原因仮説 / 人に判断してほしい点 をコメントして停止する。
