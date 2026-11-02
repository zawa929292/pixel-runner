# Slack 通知

## 何が通知されるか
| 場面 | メッセージ | 送り元 |
|---|---|---|
| 新しい起票・フィードバック（`Triage`） | 📥 | `linear-notify.yml`（5 分ごと） |
| 設計レビュー待ち（`Design Review`） | 📝 | `linear-notify.yml` |
| PR レビュー待ち（`In Review`） | 🔍 | `linear-notify.yml` |
| AI が停止（`Needs Human`。マージ失敗を含む） | 🚨 | `linear-notify.yml` |
| マージ完了 | ✅ | `linear-merge-gate.yml` |
| デプロイ完了 / 失敗 | 🚀 / 🔥 | `deploy.yml` |
| 手元の Claude Code が許可確認・入力待ち | ⏳ | `.claude/hooks/notify-slack.sh`（Notification hook） |

`linear-notify` は前回実行時刻以降の状態遷移だけを通知する（カーソルは Actions cache に保存）。
GitHub の cron は数分遅れることがあるため、通知は状態変化から最大 5〜15 分程度遅れる。

## セットアップ（人間の作業）
### 1. Slack ワークスペースとチャンネル
1. https://slack.com/get-started でワークスペースを作成
2. 通知用チャンネル（例 `#pixel-runner`）を作成

### 2. Incoming Webhook
1. https://api.slack.com/apps → **Create New App** → **From scratch**
   - App Name: `Pixel Runner Notifier`、Workspace: 上で作ったもの
2. 左メニュー **Incoming Webhooks** → **Activate Incoming Webhooks** を On
3. **Add New Webhook to Workspace** → 通知先チャンネルを選んで **Allow**
4. 表示された Webhook URL（`https://hooks.slack.com/services/...`）をコピー

### 3. URL の登録
Webhook URL は秘密情報。チャットやリポジトリに貼らない。
```bash
nano ~/.config/slack-webhook-url   # URL を貼って保存（手元の Claude Code の入力待ち通知用）
chmod 600 ~/.config/slack-webhook-url
tr -d '[:space:]' < ~/.config/slack-webhook-url | gh secret set SLACK_WEBHOOK_URL -R zawa929292/pixel-runner   # Actions 用
```

### 4. 動作確認
```bash
gh workflow run linear-notify.yml -R zawa929292/pixel-runner   # 直近 10 分の遷移を通知（なければ何も来ない）
SLACK_WEBHOOK_URL=$(cat ~/.config/slack-webhook-url) node scripts/slack.mjs "テスト通知"
```
