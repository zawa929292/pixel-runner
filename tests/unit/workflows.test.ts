import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// GAM-7 AC-14: ワークフローをテキストとして読み、危険な設定がないことを確かめる（YAML パーサーは使わない）
const WORKFLOWS_DIR = fileURLToPath(new URL('../../.github/workflows/', import.meta.url));
const read = (name: string): string => readFileSync(`${WORKFLOWS_DIR}${name}`, 'utf8');
const workflowFiles = readdirSync(WORKFLOWS_DIR).filter((f) => f.endsWith('.yml'));

const EXPECTED_ALLOWED_TOOLS = 'Read,Grep,Glob,Bash(gh pr diff:*),Bash(gh pr view:*)';

describe('GAM-7 ワークフローの静的な性質', () => {
  it('AC-14 (a): どのワークフローにも pull_request_target がない', () => {
    expect(workflowFiles).toContain('security-review.yml');
    for (const f of workflowFiles) {
      expect(read(f), f).not.toContain('pull_request_target');
    }
  });

  it('AC-14 (b): security-review.yml の --allowedTools がちょうど読み取り系のみ', () => {
    const matches = [...read('security-review.yml').matchAll(/--allowedTools\s+"([^"]*)"/g)].map((m) => m[1]);
    expect(matches).toEqual([EXPECTED_ALLOWED_TOOLS]);
  });

  it('AC-14 (c): security-review.yml に書き込み・投稿系のツールがない', () => {
    const text = read('security-review.yml');
    for (const s of ['Write', 'Edit', 'Bash(gh api', 'Bash(git push', 'Bash(gh pr comment']) {
      expect(text, s).not.toContain(s);
    }
  });

  it('AC-14 (d): ci.yml に npm audit があり、security-review.yml に PR タイトル・本文の式がない', () => {
    expect(read('ci.yml')).toContain('npm audit --audit-level=high');
    const text = read('security-review.yml');
    expect(text).not.toContain('github.event.pull_request.title');
    expect(text).not.toContain('github.event.pull_request.body');
  });
});
