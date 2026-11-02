// Slack Incoming Webhook への通知。SLACK_WEBHOOK_URL が未設定なら送らずにログだけ出す（通知の失敗で本処理を止めない）。
import { pathToFileURL } from 'node:url';

export async function notifySlack(text) {
  const url = process.env.SLACK_WEBHOOK_URL;
  if (!url) {
    console.log(`[slack:dry-run] ${text}`);
    return;
  }
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
    if (!res.ok) console.warn(`[slack] ${res.status} ${await res.text()}`);
  } catch (e) {
    console.warn(`[slack] ${e.message}`);
  }
}

// CLI: node scripts/slack.mjs "message"
if (import.meta.url === pathToFileURL(process.argv[1]).href) await notifySlack(process.argv.slice(2).join(' '));
