#!/usr/bin/env bash
# Notification: Claude Code が許可確認や入力待ちで止まったら Slack に通知する。
# Webhook URL は環境変数 SLACK_WEBHOOK_URL か ~/.config/slack-webhook-url（リポジトリ外）から読む。未設定なら何もしない。
url=${SLACK_WEBHOOK_URL:-$(tr -d "[:space:]" 2>/dev/null < ~/.config/slack-webhook-url)}
[[ -n $url ]] || exit 0
branch=$(git -C "${CLAUDE_PROJECT_DIR:-.}" branch --show-current 2>/dev/null)
payload=$(BRANCH="$branch" node -e '
let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{
  let m="入力待ちです";try{m=JSON.parse(d).message||m}catch{}
  process.stdout.write(JSON.stringify({text:`⏳ *Claude Code が待っています* — ${m}\nブランチ: \`${process.env.BRANCH||"-"}\``}));
})')
curl -s -m 5 -X POST -H 'Content-Type: application/json' -d "$payload" "$url" >/dev/null &
exit 0
