# Pixel Runner — AI 駆動開発リポジトリ

ブラウザ 2D 横スクロールアクション。AI（Claude Code）が設計・実装・検証を行い、人間は **Linear** で起票・承認・差し戻しを行う。

## コマンド
- `npm run dev` — 開発サーバー
- `npm run verify` — lint → typecheck → unit → e2e。**完了条件の機械判定はこれが green であること**
- `npm test` / `npm run e2e` — 個別実行

## 参照すべきドキュメント（必要なときだけ読む）
- ゲーム仕様: `docs/game-design.md`（仕様の単一情報源。仕様変更はここも更新）
- 設計方針: `docs/architecture.md`
- Issue ごとの設計: `specs/GAM-<n>.md`
- Linear 運用: `docs/linear-setup.md`

## アーキテクチャ規約
- `src/core/` は Phaser 非依存の純ロジック。ルール・数値計算・当たり判定はすべてここに書き、`tests/unit/` でテストする
- `src/scenes/` は描画と入力を core に橋渡しするだけ。ロジックを書かない
- 定数は `src/core/config.ts` に集約。マジックナンバー禁止
- 状態更新はイミュータブル（新しいオブジェクトを返す）
- E2E は `?test=1` で公開される `window.__GAME__.getState()` を使って状態を検証する（ピクセル比較はしない）

## 開発フロー（ループエンジニアリング）
Linear の状態遷移に従う。👤 は人間のゲート。
`Triage` → `Planning` → `Design Review`👤 → `Approved` → `In Progress` → `In Review` → `Merge Approved`👤 → `Done`
- 設計: `/plan-issue GAM-n` → `specs/GAM-n.md` を作り Linear にコメント、`Design Review` へ
- 実装: `/implement GAM-n`（`Approved` の Issue のみ着手可）
- ブランチ名は Linear の gitBranchName（例 `gam-12-player-jump`）を使う。PR タイトル先頭に `GAM-n`
- 人間のコメントで差し戻された場合は、そのコメントを最優先の要求として扱う

## 停止条件とエスカレーション
- verify の修正反復は **最大 5 回**。**同じ失敗が 2 回連続** したら直ちに停止
- 停止時は Linear Issue を `Needs Human` にし、「試したこと / 失敗ログ要約 / 仮説 / 人に判断してほしい点」をコメントする
- 仕様が曖昧なまま推測で実装しない。`Design Review` に戻して質問する

## 禁止事項
- `main` への直接 push、force push、テストの削除・skip による green 化
- `.env` やシークレットの読み取り
