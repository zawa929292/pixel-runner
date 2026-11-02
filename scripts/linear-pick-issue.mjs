// Phase 2 自動起動: `Approved` + `ai-ready` の Issue を 1 件選び、In Progress にして identifier を出力する
import { appendFileSync } from 'node:fs';
import { issuesInState, moveIssue } from './linear.mjs';

const [issue] = (await issuesInState('Approved', 'ai-ready')).sort((a, b) => (a.priority || 5) - (b.priority || 5));
if (issue) {
  await moveIssue(issue.id, 'In Progress'); // 次の cron で二重起動しないよう先に移動
  console.log(`picked ${issue.identifier}: ${issue.title}`);
}
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `issue=${issue?.identifier ?? ''}\n`);
