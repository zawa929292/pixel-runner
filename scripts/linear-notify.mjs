// 人の対応が必要になった Linear Issue を Slack に通知する（GitHub Actions の cron から実行）。
// 前回実行時刻（カーソル）以降の状態遷移だけを通知するので、cron が遅延しても重複・取りこぼしがない。
// usage: node scripts/linear-notify.mjs <cursor-file>
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { gql, TEAM_KEY } from './linear.mjs';
import { notifySlack } from './slack.mjs';

const WATCH = {
  Triage: '📥 *新しい起票・フィードバック* — 内容を確認し、AI に任せるなら `ai-ready` を付けてください',
  'Design Review': '📝 *設計レビュー待ち* — spec を確認し、OK なら `Approved`、直すならコメントして `Planning` へ',
  'In Review': '🔍 *PR レビュー待ち* — PR を確認し、OK なら `Merge Approved`、直すならコメントして `In Progress` へ',
  'Needs Human': '🚨 *AI が停止しました* — コメントを読んで指示を書き、`In Progress` か `Planning` へ',
};

const cursorFile = process.argv[2] ?? '.linear-notify-cursor';
const now = new Date();
const since = existsSync(cursorFile)
  ? new Date(readFileSync(cursorFile, 'utf8').trim())
  : new Date(now.getTime() - 10 * 60 * 1000); // 初回は直近 10 分

const data = await gql(
  `query($team: String!, $since: DateTimeOrDuration!) {
    issues(filter: { team: { key: { eq: $team } }, updatedAt: { gt: $since } }, first: 100) {
      nodes {
        identifier title url createdAt
        state { name }
        history(first: 30) { nodes { createdAt toState { name } } }
      }
    }
  }`,
  { team: TEAM_KEY, since: since.toISOString() },
);

const events = [];
for (const issue of data.issues.nodes) {
  const inWindow = (t) => new Date(t) > since && new Date(t) <= now;
  const transitions = issue.history.nodes.filter((h) => h.toState && WATCH[h.toState.name] && inWindow(h.createdAt));
  // 最初から Triage に作られた Issue（フィードバックの取り込みなど）は遷移履歴が残らない
  if (transitions.length === 0 && inWindow(issue.createdAt) && WATCH[issue.state.name]) {
    transitions.push({ createdAt: issue.createdAt, toState: issue.state });
  }
  for (const t of transitions) events.push({ at: t.createdAt, state: t.toState.name, issue });
}

events.sort((a, b) => a.at.localeCompare(b.at));
for (const { state, issue } of events) {
  await notifySlack(`${WATCH[state]}\n<${issue.url}|${issue.identifier}: ${issue.title}>`);
}
console.log(`notified ${events.length} event(s) between ${since.toISOString()} and ${now.toISOString()}`);
writeFileSync(cursorFile, now.toISOString());
