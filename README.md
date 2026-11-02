# Pixel Runner

ブラウザ 2D アクションゲームを題材にした **AI 駆動開発** の実践リポジトリ。
CTC「AI 駆動開発 全体アーキテクチャ」の 5 つのエンジニアリングを、Claude Code + GitHub Actions + Linear で実装している。

## 全体像
```
Linear(人)          Claude Code(AI)                     GitHub Actions(自動)
 起票 ai-ready ──▶ /plan-issue  設計改善ループ
 Design Review ◀── specs/GAM-n.md + コメント
 Approved ───────▶ /implement   実装・検証ループ ─▶ PR ─▶ CI / AI Review（品質改善ループ）
 In Review ◀───────────────────────────────────── (PR open で自動遷移)
 Merge Approved ─────────────────────────────────▶ merge-gate cron ─▶ merge ─▶ Pages デプロイ
 Triage ◀──────────────────────────────────────── フィードバック Issue（運用フィードバックループ）
```

| エンジニアリング | このリポジトリでの実体 |
|---|---|
| プロンプト | `.claude/commands/*`, `.claude/agents/*`（役割・目的・制約・出力形式） |
| コンテキスト | `CLAUDE.md`, `docs/`, `specs/`, Linear MCP |
| グラフ | designer → implementer → reviewer → Human Gate（Linear 状態） |
| ループ | 停止条件付き verify 反復、レビュー反復、Linear による差し戻し |
| ハーネス | `.claude/settings.json`（permissions/hooks）、Vitest/Playwright/ESLint、CI |

## はじめに
```bash
npm ci
npx playwright install chromium
npm run dev       # http://localhost:5173
npm run verify
```
Linear 側の準備は [docs/linear-setup.md](docs/linear-setup.md)、Slack 通知は [docs/notifications.md](docs/notifications.md)。
