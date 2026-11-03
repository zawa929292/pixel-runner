import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// GAM-6: Node のバージョンを .nvmrc の 1 か所で決め、engines / lockfile / ワークフローがそれに従うことを確かめる
const repoPath = (rel: string): string => fileURLToPath(new URL(`../../${rel}`, import.meta.url));
const readText = (rel: string): string => readFileSync(repoPath(rel), 'utf8');

const NVMRC = readText('.nvmrc');
const PKG = JSON.parse(readText('package.json')) as { engines?: Record<string, string> };
const LOCK = JSON.parse(readText('package-lock.json')) as {
  lockfileVersion: number;
  packages: Record<string, { engines?: Record<string, string> }>;
};

const WORKFLOWS_DIR = repoPath('.github/workflows/');
const workflowFiles = readdirSync(WORKFLOWS_DIR).filter((f) => f.endsWith('.yml'));
const readWorkflow = (name: string): string => readFileSync(`${WORKFLOWS_DIR}${name}`, 'utf8');

const NODE_VERSION_FILE = /node-version-file:\s*['"]?\.nvmrc['"]?/;
const NODE_VERSION_INLINE = /node-version:/;
const ENGINES_MAJOR = /^\^(\d+)\./;
const ENGINES_MIN_MINOR = 13;

/** setup-node の各 step の範囲（`- uses: actions/setup-node@` の後ろから、次の `\n\s*- ` まで） */
const setupNodeSteps = (text: string): string[] =>
  text
    .split(/- uses: actions\/setup-node@/)
    .slice(1)
    .map((chunk) => {
      const end = chunk.search(/\n\s*- /);
      return end === -1 ? chunk : chunk.slice(0, end);
    });

describe('GAM-6 バージョンの定義', () => {
  it('AC-1: .nvmrc の中身はちょうど "22\\n"', () => {
    expect(NVMRC).toBe('22\n');
  });

  it('AC-2: package.json の engines は { node: "^22.13.0" } のみ', () => {
    expect(PKG.engines).toEqual({ node: '^22.13.0' });
  });

  it('AC-3: .nvmrc のメジャーと engines.node のメジャーが一致する', () => {
    const match = ENGINES_MAJOR.exec(PKG.engines?.node ?? '');
    expect(match, `engines.node=${PKG.engines?.node}`).not.toBeNull();
    expect(NVMRC.trim()).toBe(match?.[1]);
  });

  it('AC-4: .npmrc に engine-strict=true がちょうど 1 行あり、認証情報の行がない', () => {
    const lines = readText('.npmrc')
      .split('\n')
      .map((l) => l.trim());
    expect(lines.filter((l) => l === 'engine-strict=true')).toHaveLength(1);
    for (const secret of ['_auth', '_authToken', '//registry']) {
      expect(lines.some((l) => l.includes(secret)), secret).toBe(false);
    }
  });

  it('AC-5: package-lock.json の root の engines が package.json と一致し、lockfileVersion は 3', () => {
    expect(LOCK.packages['']?.engines).toEqual(PKG.engines);
    expect(LOCK.lockfileVersion).toBe(3);
  });
});

describe('GAM-6 テスト実行環境の Node', () => {
  it('AC-6: テストを動かしている Node のメジャーが .nvmrc と一致し、マイナーが下限以上', () => {
    const [major, minor] = process.versions.node.split('.').map(Number);
    const expectedMajor = Number(NVMRC.trim());
    const msg = `process.versions.node=${process.versions.node}, .nvmrc=${NVMRC.trim()}, engines.node=${PKG.engines?.node}`;
    expect(major, msg).toBe(expectedMajor);
    expect(minor, msg).toBeGreaterThanOrEqual(ENGINES_MIN_MINOR);
  });
});

describe('GAM-6 ワークフローの静的な性質', () => {
  it('AC-7 前提: node-version: の正規表現は node-version-file: にマッチしない', () => {
    expect('node-version-file: .nvmrc').not.toMatch(NODE_VERSION_INLINE);
    expect('with: { node-version-file: .nvmrc, cache: npm }').toMatch(NODE_VERSION_FILE);
    expect('with:\n          node-version-file: .nvmrc').toMatch(NODE_VERSION_FILE);
  });

  it('AC-7 (a): すべての setup-node の step が node-version-file: .nvmrc を使う', () => {
    for (const f of workflowFiles) {
      for (const [i, step] of setupNodeSteps(readWorkflow(f)).entries()) {
        expect(step, `${f} の ${i + 1} つ目の setup-node`).toMatch(NODE_VERSION_FILE);
      }
    }
  });

  it('AC-7 (b): どのワークフローにも node-version: の直書きがない', () => {
    for (const f of workflowFiles) {
      expect(readWorkflow(f), f).not.toMatch(NODE_VERSION_INLINE);
    }
  });

  it('AC-7 (c): setup-node を含むファイルに既知の 6 ファイルが含まれる', () => {
    const withSetupNode = workflowFiles.filter((f) => setupNodeSteps(readWorkflow(f)).length > 0);
    for (const f of [
      'ci.yml',
      'deploy.yml',
      'linear-dispatch.yml',
      'linear-merge-gate.yml',
      'linear-notify.yml',
      'security-review.yml',
    ]) {
      expect(withSetupNode).toContain(f);
    }
  });

  it('AC-8 (a): ci.yml の verify・deploy.yml・linear-dispatch.yml の setup-node に cache: npm が残る', () => {
    for (const f of ['ci.yml', 'deploy.yml', 'linear-dispatch.yml']) {
      const [first] = setupNodeSteps(readWorkflow(f));
      expect(first, f).toBeDefined();
      expect(first, f).toMatch(/cache:\s*['"]?npm['"]?/);
    }
  });

  it('AC-8 (b): security-review.yml で sparse-checkout の cone モードを切っていない', () => {
    expect(readWorkflow('security-review.yml')).not.toContain('sparse-checkout-cone-mode');
  });
});
