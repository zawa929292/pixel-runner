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

  it('AC-14 (回帰 InvalidJsonSchema): findings.schema.json は --json-schema に渡せる形（$schema の 2020-12 指定なし・シングルクォートなし）', () => {
    const text = readFileSync(fileURLToPath(new URL('../../.github/security-review/findings.schema.json', import.meta.url)), 'utf8');
    // Claude Code のスキーマ検証器は draft 2020-12 のメタスキーマを解決できず、監査が失敗した（PR #6）
    expect(text).not.toContain('2020-12');
    expect(JSON.parse(text)).not.toHaveProperty('$schema');
    // claude_args は shell-quote で解析され、スキーマは '…' で囲んで渡すため
    expect(text).not.toContain("'");
    // 2020-12 固有のキーワードを使わない（draft-07 でも有効な範囲に留める）
    for (const k of ['$defs', 'prefixItems', 'unevaluatedProperties', 'unevaluatedItems', 'dependentRequired', 'dependentSchemas', '$dynamicRef']) {
      expect(text, k).not.toContain(`"${k}"`);
    }
  });

  it('AC-14 (d): ci.yml に npm audit があり、security-review.yml に PR タイトル・本文の式がない', () => {
    expect(read('ci.yml')).toContain('npm audit --audit-level=high');
    const text = read('security-review.yml');
    expect(text).not.toContain('github.event.pull_request.title');
    expect(text).not.toContain('github.event.pull_request.body');
  });
});
