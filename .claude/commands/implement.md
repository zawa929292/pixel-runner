---
description: 実装・検証ループ + 品質改善ループ — 承認済み/差し戻し Issue を実装し PR を作成・更新する
argument-hint: GAM-n
---
Linear Issue $ARGUMENTS を実装してください。あなたは `docs/workflow-graph.md` のオーケストレーターです。
各ステップの開始・結果を `specs/$ARGUMENTS.progress.md` に `[orchestrator]` として追記すること。

## 1. 事前チェックとモード判定
Linear MCP で Issue（状態・全コメント・gitBranchName・添付 PR）を取得し、**未対応の人の指示**（最新の `🤖` コメントより新しい、`🤖` で始まらないコメント）を抽出する。

| 状態 | 条件 | モード |
|---|---|---|
| `Approved` | — | **new**（新規実装） |
| `In Progress` / `Needs Human` | 未対応の人の指示がある | **rework**（差し戻し対応） |
| `In Progress` | 指示なし・進捗ノートあり | **resume**（中断からの再開） |
| 上記以外 | — | 中止して理由を伝える（`Planning`/`Design Review` は `/plan-issue` の担当） |

- Issue を `In Progress` に移動。gitBranchName のブランチに切り替え（なければ main から作成）、`git pull` する
- rework の場合: 人の指示を進捗ノートに `rework` として引用記録し、修正反復カウンタを 0 に戻す
- rework で指示が設計変更を要する（受入条件の追加・変更が必要）と判断したら、実装せず `Planning` に移して `🤖` コメントで理由を伝え停止

## 2. 並列実装（new / rework で E2E に関わる指示がある場合）
**1 つのメッセージで 2 つのサブエージェントを同時に起動する**:
- `implementer`（build モード）: spec の `[unit]` AC、rework なら人の指示
- `e2e-tester`: spec の `[e2e]` AC（rework で E2E 変更が不要なら起動しない）

いずれかが ESCALATE / NEEDS_SPEC_CLARIFICATION → 「6. エスカレーション」へ
resume の場合は進捗ノートの「現在の状態」から該当ステップに戻る。

## 3. 合流と修正ループ
1. `npm run verify` を実行。green なら 4 へ
2. 失敗したら失敗シグネチャ `<種類>:<ファイル>:<テスト名またはAC>:<エラー種別>` を作り、進捗ノートの「現在の状態」を更新
3. 停止条件を判定（**修正反復が通算 5 回** または **同一シグネチャが 2 連続**）→ 該当すれば 6 へ
4. 振り分け: 原則 `implementer`（fix モード）に失敗ログを渡す。implementer が `TEST_BUG` を返したら、その理由を添えて `e2e-tester` に渡す
5. 1 に戻る

## 4. 品質改善ループ（最大 2 周）
- `reviewer` でレビュー。NEEDS_FIX なら指摘を `implementer`（fix モード）に渡し、3 の合流から再実行
- 2 周しても high が残れば 6 へ

## 5. PR 作成・更新
- `docs/game-design.md` のロードマップ状態を更新し、コミットして push
- **new**: `gh pr create`（タイトル `$ARGUMENTS: <要約>`、本文に変更点・AC チェックリスト・レビュー結果・`Fixes $ARGUMENTS`）。PR open で Linear 連携が `In Review` に移す
- **rework / resume で PR が既にある場合**: push で PR が更新される。Linear 連携は再遷移しないため、**自分で Issue を `In Review` に移動**する
- Linear に `🤖` コメント（形式は `docs/examples/linear-comments.md`「PR 作成」または「差し戻しへの対応」）

## 6. エスカレーション
作業中の変更をコミットして push（WIP として残す）→ Issue を `Needs Human` に移動 → `🤖` コメント（形式は `docs/examples/linear-comments.md`「エスカレーション」）→ 停止。
