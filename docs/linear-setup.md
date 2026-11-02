# Linear セットアップ手順（人間が行う作業）

## 1. ワークスペースとチーム
1. https://linear.app でワークスペースを作成
2. Team を作成: 名前 `Game`、Identifier（キー）`GAM`

## 2. Workflow states（Settings → Teams → Game → Workflow）
| カテゴリ | 状態名（この綴りで作成。スクリプトが名前で参照します） | 誰が動かす |
|---|---|---|
| Triage | `Triage` | 起票・フィードバック取り込み |
| Backlog | `Backlog` | 人 |
| Unstarted | `Planning` | AI（設計中） |
| Unstarted | `Design Review` 👤 | AI → 人が確認 |
| Unstarted | `Approved` | **人（設計承認）** |
| Started | `In Progress` | AI |
| Started | `In Review` | GitHub 連携（PR open） |
| Started | `Merge Approved` 👤 | **人（マージ承認）** |
| Started | `Needs Human` 👤 | AI（エスカレーション） |
| Completed | `Done` | GitHub 連携（PR merge） |
| Canceled | `Canceled` | 人 |

Triage を有効化しておく（Settings → Teams → Game → Triage）。

## 3. Labels
`ai-ready`（AI が着手してよい）、`feature`、`bug`、`refactor`、`feedback`

## 4. GitHub 連携（Settings → Integrations → GitHub）
1. GitHub を接続し、`zawa929292/pixel-runner` へのアクセスを許可
2. Team Game の PR 自動化:
   - On PR open → `In Review`
   - On PR merge → `Done`
   - （draft / review request は変更なし）
3. **GitHub Issues Sync** を有効化し、`pixel-runner` の Issue を Team Game の `Triage` に取り込む（フィードバック用）

## 5. API キーと Secrets
1. Linear: Settings → Security & access → Personal API keys で作成
2. GitHub repo → Settings → Secrets and variables → Actions に登録:
   - `LINEAR_API_KEY` — 上記キー
   - `CLAUDE_CODE_OAUTH_TOKEN` — ローカルで `claude setup-token` を実行して得たトークン
3. Claude GitHub App をインストール（Claude Code で `/install-github-app`）。AI が作った PR で CI が起動するために必要

## 6. Claude Code に Linear MCP を追加
```bash
claude mcp add --transport http linear https://mcp.linear.app/mcp
```
Claude Code 内で `/mcp` → linear → Authenticate でブラウザ認証。

## 7. GitHub Pages
repo → Settings → Pages → Source を **GitHub Actions** に設定。

## 人間の操作まとめ
AI のコメントは `🤖` で始まります。**あなたのコメントは `🤖` で始めないでください**（AI が「人の指示」として扱うため）。

| やりたいこと | Linear での操作 | 次に AI がすること |
|---|---|---|
| 開発を依頼 | Issue を起票し `ai-ready` ラベル | `/plan-issue` で設計 |
| 設計を承認 | `Design Review` → `Approved` | `/implement` で実装（new） |
| 設計を差し戻し | コメントを書き `Planning` に移す | `/plan-issue` で再設計 |
| マージを承認 | `In Review` → `Merge Approved` | 10 分以内に自動マージ・デプロイ |
| 実装を差し戻し | コメントを書き `In Progress` に移す | `/implement` で差し戻し対応（rework）→ PR 更新 → `In Review` |
| 設計からやり直し | コメントを書き `Planning` に移す | `/plan-issue` で再設計 → `Design Review` |
| エスカレーション対応 | `Needs Human` のコメントを読み、指示をコメントして `In Progress`（実装から）か `Planning`（設計から）に移す | 指示に従い再開 |

どの場合も Claude Code で `/next-issue` を実行すれば、AI が状態とコメントを見て適切な作業を選びます。
