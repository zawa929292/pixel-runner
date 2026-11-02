# Pixel Runner — AI 駆動開発リポジトリ

ブラウザ 2D 横スクロールアクション。AI（Claude Code）が設計・実装・検証を行い、人間は **Linear** で起票・承認・差し戻しを行う。

## コマンド
- `npm run dev` — 開発サーバー
- `npm run verify` — lint → typecheck → unit → e2e。**完了条件の機械判定はこれが green であること**
- `npm run verify:unit` — lint → typecheck → unit（並列実装フェーズの中間確認専用。**完了判定には使わない**）
- `npm test` / `npm run e2e` — 個別実行

## 参照すべきドキュメント（必要なときだけ読む）
- ゲーム仕様: `docs/game-design.md`（仕様の単一情報源。仕様変更はここも更新）
- 設計方針: `docs/architecture.md`
- Issue ごとの設計と進捗ノート: `specs/GAM-<n>.md`, `specs/GAM-<n>.progress.md`（形式は `specs/README.md`）
- AI と人の流れ（ノード・エッジ・遷移条件）: `docs/workflow-graph.md`
- 見本（設計書・テスト・Linear コメント）: `docs/examples/`
- Linear 運用: `docs/linear-setup.md`

## アーキテクチャ規約
- `src/core/` は Phaser 非依存の純ロジック。ルール・数値計算・当たり判定はすべてここに書き、`tests/unit/` でテストする
- `src/scenes/` は描画と入力を core に橋渡しするだけ。ロジックを書かない
- 定数は `src/core/config.ts` に集約。マジックナンバー禁止
- 状態更新はイミュータブル（新しいオブジェクトを返す）
- E2E は `?test=1` で公開される `window.__GAME__.getState()` を使って状態を検証する（ピクセル比較はしない）

## 開発フロー（ループエンジニアリング）
Linear の状態遷移に従う。👤 は人間のゲート。詳細は `docs/workflow-graph.md`。
`Triage`/`Backlog` → `Planning` → `Design Review`👤 → `Approved` → `In Progress` → `In Review`👤 → `Merge Approved` → `Done`
- 設計: `/plan-issue GAM-n`（新規 / `Planning` に差し戻された再設計）
- 実装: `/implement GAM-n`（`Approved` の新規、または `In Progress`/`Needs Human` の差し戻し対応・再開）
  - implementer（コード + Unit）と e2e-tester（E2E）を **並列** に動かし、`npm run verify` で合流する
- 迷ったら `/next-issue`
- ブランチ名は Linear の gitBranchName（例 `gam-12-player-jump`）。PR タイトル先頭に `GAM-n`

## Linear コメントのルール
- **AI のコメントは必ず `🤖` で始める**（MCP は人のアカウントで投稿するため、これで人の指示と区別する）
- 最新の `🤖` コメントより新しい、`🤖` で始まらないコメント = **未対応の人の指示**。最優先の要求として扱う
- 形式は `docs/examples/linear-comments.md`

## 進捗ノート
- 作業のたびに `specs/GAM-n.progress.md` に追記する。セッション・差し戻し・サブエージェント間の状態引き継ぎはこれで行う
- 新しいセッションで作業を再開するときは、最初に進捗ノートを読む

## 停止条件とエスカレーション
- 合流後の修正反復は **通算 5 回** まで。**同じ失敗シグネチャが 2 連続** したら直ちに停止（差し戻し対応の開始時にカウンタをリセット）
- 停止時は WIP をコミット・push し、Linear Issue を `Needs Human` にして「停止理由 / 試したこと / 仮説 / 判断してほしいこと」を `🤖` コメントする
- 仕様が曖昧なまま推測で実装しない。`Planning` に戻して質問する

## 禁止事項
- `main` への直接 push、force push、テストの削除・skip による green 化
- `.env` やシークレットの読み取り
