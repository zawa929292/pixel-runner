// 承認差し戻しループの Human Gate:
// Linear で人間が `Merge Approved` にした Issue の PR を、CI が green ならマージする。
import { execFileSync } from 'node:child_process';
import { comment, issuesInState, moveIssue, prNumbersOf } from './linear.mjs';

const gh = (...args) => execFileSync('gh', args, { encoding: 'utf8' });

let merged = 0;
for (const issue of await issuesInState('Merge Approved')) {
  const prs = prNumbersOf(issue);
  if (prs.length === 0) {
    await moveIssue(issue.id, 'Needs Human');
    await comment(issue.id, '🤖 ⚠️ Merge gate: 紐づく GitHub PR が見つかりません。PR をリンクしてから再度 `Merge Approved` にしてください。');
    continue;
  }
  for (const pr of prs) {
    const info = JSON.parse(gh('pr', 'view', String(pr), '--json', 'state,mergeable,statusCheckRollup'));
    if (info.state !== 'OPEN') continue;
    const checks = info.statusCheckRollup ?? [];
    if (checks.length === 0) {
      console.log(`${issue.identifier}: PR #${pr} has no checks yet, retry next run`);
      continue;
    }
    const pending = checks.some((c) => (c.status ?? c.state) && !['COMPLETED', 'SUCCESS'].includes(c.status ?? c.state));
    const failed = checks.some((c) => ['FAILURE', 'ERROR', 'CANCELLED', 'TIMED_OUT'].includes(c.conclusion ?? c.state));
    if (failed || info.mergeable === 'CONFLICTING') {
      await moveIssue(issue.id, 'Needs Human');
      await comment(issue.id, `🤖 ❌ Merge gate: PR #${pr} は CI 失敗またはコンフリクトのためマージできません。修正後に再度 \`Merge Approved\` にしてください。`);
      continue;
    }
    if (pending) {
      console.log(`${issue.identifier}: PR #${pr} checks pending, retry next run`);
      continue;
    }
    gh('pr', 'merge', String(pr), '--squash', '--delete-branch');
    console.log(`${issue.identifier}: merged PR #${pr}`);
    merged++;
    // マージ後は Linear の GitHub 連携が Issue を Done に遷移させる
  }
}
// GITHUB_TOKEN によるマージは push イベントを発火しないため、デプロイを明示的に起動する
if (merged > 0) gh('workflow', 'run', 'deploy.yml', '--ref', 'main');
