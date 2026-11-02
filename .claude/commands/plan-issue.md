---
description: 設計改善ループ — Linear Issue を分析し specs を作成/改訂して Design Review に回す
argument-hint: GAM-n
---
Linear Issue $ARGUMENTS の設計ループを実行してください。グラフ定義は `docs/workflow-graph.md`。

## 1. 状況把握
- Linear MCP で $ARGUMENTS を取得（説明・全コメント・ラベル・状態・gitBranchName）
- 着手できる状態: `Triage` / `Backlog` / `Todo`（新規）、`Planning`（差し戻し・再設計）。それ以外なら中止して理由を伝える
- **未対応の人の指示** を抽出する: 最新の `🤖` コメントより新しい、`🤖` で始まらないコメント
- gitBranchName のブランチに切り替える（なければ main から作成）。`specs/$ARGUMENTS.progress.md` があれば読む

## 2. 設計
- Issue を `Planning` に移動
- `designer` サブエージェントに Issue 内容と未対応の人の指示を渡し、`specs/$ARGUMENTS.md` を作成/改訂させる
- spec を自分で読み、次を確認。不十分なら designer に再依頼（最大 2 回）
  - 全 AC に ID と `[unit]`/`[e2e]` タグがある
  - 人の指示がすべて反映されている
- 進捗ノートに `### <日時> [orchestrator] 設計 (新規|改訂): <要約>` を追記（なければ作成）

## 3. 人へ回す
- spec と進捗ノートをコミットして push（PR が既にあれば更新される）
- Linear にコメント（形式は `docs/examples/linear-comments.md`「設計完了」。**先頭は必ず `🤖`**）
- Issue を `Design Review` に移動

ここで停止し、実装には進まないこと。
