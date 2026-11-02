import { describe, expect, it } from 'vitest';
import {
  COMMENT_FIELD_MAX,
  MIN_CONFIDENCE,
  SUMMARY_MARKER,
  REDACTED,
  buildInlineComments,
  changedFilesError,
  decideGate,
  filterFindings,
  fingerprint,
  getExclusionReason,
  normalizeFindingPath,
  parseAuditOutput,
  parseDiffRightLines,
  renderSummary,
  sanitizeForComment,
  touchesHarness,
  type Excluded,
  type Finding,
} from '../../scripts/security-review/findings.mjs';

const MIN = MIN_CONFIDENCE;
const MARK = SUMMARY_MARKER;
const ZWSP = '\u200B';

const BASE: Finding = {
  file: 'src/main.ts',
  line: 10,
  severity: 'HIGH',
  category: 'code_injection',
  description: 'URL parameter passed to eval',
  exploit_scenario: 'Attacker sends crafted URL',
  recommendation: 'Remove eval',
  confidence: 0.9,
};

/** spec の F(overrides)。不正値も作れるように overrides は緩い型にする */
const F = (overrides: Record<string, unknown> = {}): Finding => ({ ...BASE, ...overrides }) as Finding;

/** spec の OUT(findings, summaryOverrides) */
const OUT = (findings: unknown[], summaryOverrides: Record<string, unknown> = {}): string => {
  const n = findings.length;
  return JSON.stringify({
    findings,
    analysis_summary: {
      files_reviewed: 1,
      high_severity: n,
      medium_severity: n,
      low_severity: n,
      review_completed: true,
      ...summaryOverrides,
    },
  });
};

const parseOk = (raw: string) => {
  const r = parseAuditOutput(raw);
  if (!r.ok) throw new Error(`expected ok, got error: ${r.error}`);
  return r.value;
};

describe('GAM-7 parseAuditOutput', () => {
  it('AC-1: 正常な出力を解析できる', () => {
    const r = parseAuditOutput(OUT([F({})]));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.findings).toHaveLength(1);
    expect(r.value.findings[0]).toEqual(F({}));
    expect(r.value.analysis_summary.review_completed).toBe(true);
  });

  it('AC-2: ```json の囲みと前後の空白・改行を許す', () => {
    const raw = OUT([F({})]);
    const wrapped = `  \n\n\`\`\`json\n${raw}\n\`\`\`\n  \n`;
    expect(parseAuditOutput(wrapped)).toEqual(parseAuditOutput(raw));
    const v = parseOk(wrapped);
    expect(v.findings).toEqual([F({})]);
    expect(v.analysis_summary.review_completed).toBe(true);
  });

  it('AC-3: 不正な出力は失敗（1 件でも不正なら全体を失敗）', () => {
    const { file: _omit, ...withoutFile } = F({});
    void _omit;
    const noSummary = JSON.stringify({ findings: [F({})] });
    const inputs: [string, string][] = [
      ['空文字', ''],
      ['JSON でない', 'not json'],
      ['findings がオブジェクト', '{"findings": {}}'],
      ['severity CRITICAL', OUT([F({ severity: 'CRITICAL' })])],
      ['file が空', OUT([F({ file: '' })])],
      ['file キーなし', OUT([withoutFile])],
      ['confidence 負', OUT([F({ confidence: -0.1 })])],
      ['confidence 11', OUT([F({ confidence: 11 })])],
      ['line 0', OUT([F({ line: 0 })])],
      ['line 1.5', OUT([F({ line: 1.5 })])],
      ['review_completed false', OUT([], { review_completed: false })],
      ['analysis_summary なし', noSummary],
      ['正常 1 件 + 不正 1 件', OUT([F({}), F({ severity: 'CRITICAL' })])],
    ];
    for (const [label, raw] of inputs) {
      const r = parseAuditOutput(raw);
      expect(r.ok, label).toBe(false);
      if (r.ok) continue;
      expect(typeof r.error, label).toBe('string');
      expect(r.error.length, label).toBeGreaterThan(0);
    }
  });

  it('AC-4: severity を大文字に、confidence を 0〜1 に、line の欠落を null に正規化する', () => {
    const sev = parseOk(OUT([F({ severity: 'high' }), F({ severity: 'Medium' })]));
    expect(sev.findings.map((f) => f.severity)).toEqual(['HIGH', 'MEDIUM']);

    const conf = parseOk(OUT([F({ confidence: 9 }), F({ confidence: 10 }), F({ confidence: 1 }), F({ confidence: 0.85 })]));
    expect(conf.findings.map((f) => f.confidence)).toEqual([0.9, 1, 1, 0.85]);

    const { line: _omit, ...withoutLine } = F({});
    void _omit;
    const lines = parseOk(OUT([withoutLine, F({ line: null })]));
    expect(lines.findings.map((f) => f.line)).toEqual([null, null]);
  });
});

describe('GAM-7 除外と判定', () => {
  it('AC-5: 取り込み元 HardExclusionRules の除外理由をそのまま返す', () => {
    const cases: [Finding, string | null][] = [
      [F({ file: 'docs/a.md' }), 'Finding in Markdown documentation file'],
      [F({ description: 'Possible denial of service' }), 'Generic DOS/resource exhaustion finding (low signal)'],
      [F({ description: 'Missing rate limit on endpoint' }), 'Generic rate limiting recommendation'],
      [F({ description: 'potential memory leak here' }), 'Resource management finding (not a security vulnerability)'],
      [F({ description: 'open redirect via next param' }), 'Open redirect vulnerability (not high impact)'],
      [F({ description: 'regex injection in search' }), 'Regex injection finding (not applicable)'],
      [F({ file: 'src/a.ts', description: 'buffer overflow' }), 'Memory safety finding in non-C/C++ code (not applicable)'],
      [F({ file: 'native/a.c', description: 'buffer overflow' }), null],
      [F({ file: 'index.html', description: 'SSRF via fetch' }), 'SSRF finding in HTML file (not applicable to client-side code)'],
      [F({ file: 'src/a.ts', description: 'SSRF via fetch' }), null],
      [F({}), null],
    ];
    for (const [finding, expected] of cases) {
      expect(getExclusionReason(finding), `${finding.file}: ${finding.description}`).toBe(expected);
    }
    expect(() => getExclusionReason(F({ description: null }))).not.toThrow();
    expect(getExclusionReason(F({ description: null }))).toBeNull();
  });

  it('AC-6: 変更ファイル → tests/ → 除外ルール → 確信度 の順でフィルタし、入力を書き換えない', () => {
    const findings = [
      F({ file: 'src/a.ts' }),
      F({ file: 'src/other.ts' }),
      F({ file: 'tests/unit/x.test.ts' }),
      F({ file: 'src/a.ts', confidence: MIN }),
      F({ file: 'src/a.ts', confidence: MIN - 0.01 }),
      F({ file: 'docs/a.md' }),
    ];
    const changedFiles = ['src/a.ts', 'tests/unit/x.test.ts', 'docs/a.md'];
    const snapshot = structuredClone(findings);

    const { kept, excluded } = filterFindings(findings, { changedFiles });

    expect(kept).toEqual([findings[0], findings[3]]);
    expect(excluded).toEqual([
      { finding: findings[1], reason: 'Not in PR diff' },
      { finding: findings[2], reason: 'Test-only file' },
      { finding: findings[4], reason: 'Low confidence' },
      { finding: findings[5], reason: 'Finding in Markdown documentation file' },
    ]);
    expect(findings).toEqual(snapshot);
  });

  it('AC-7: HIGH が 1 件以上のときだけ failure', () => {
    expect(decideGate([])).toEqual({ conclusion: 'success', counts: { HIGH: 0, MEDIUM: 0, LOW: 0 } });
    expect(decideGate([F({ severity: 'MEDIUM' }), F({ severity: 'LOW' })])).toEqual({
      conclusion: 'success',
      counts: { HIGH: 0, MEDIUM: 1, LOW: 1 },
    });
    expect(decideGate([F({ severity: 'LOW' }), F({ severity: 'HIGH' })])).toEqual({
      conclusion: 'failure',
      counts: { HIGH: 1, MEDIUM: 0, LOW: 1 },
    });
  });
});

// AC-8 の diff（gh pr diff の形式）。新しい側の行番号は各ハンクヘッダーの +start から数える
const DIFF = [
  // (a) src/a.ts: 2 ハンク
  'diff --git a/src/a.ts b/src/a.ts',
  'index 1111111..2222222 100644',
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -1,3 +1,4 @@',
  ' line1', // new 1 (context)
  '+added', // new 2 (追加)
  ' line2', // new 3 (context)
  ' line3', // new 4 (context)
  '@@ -10,2 +11,2 @@',
  '-old10', // 削除（新しい側の行番号を進めない）
  '+new11', // new 11 (追加)
  ' ctx12', // new 12 (context)
  // (b) 新規ファイル src/new.ts
  'diff --git a/src/new.ts b/src/new.ts',
  'new file mode 100644',
  'index 0000000..3333333',
  '--- /dev/null',
  '+++ b/src/new.ts',
  '@@ -0,0 +1,2 @@',
  '+first', // new 1
  '+second', // new 2
  // (c) 削除ファイル src/old.ts
  'diff --git a/src/old.ts b/src/old.ts',
  'deleted file mode 100644',
  'index 4444444..0000000',
  '--- a/src/old.ts',
  '+++ /dev/null',
  '@@ -1,2 +0,0 @@',
  '-x',
  '-y',
  // (d) "\ No newline at end of file" を含むハンク
  'diff --git a/src/c.ts b/src/c.ts',
  'index 5555555..6666666 100644',
  '--- a/src/c.ts',
  '+++ b/src/c.ts',
  '@@ -5,2 +5,2 @@',
  ' keep', // new 5 (context)
  '-oldLast',
  '\\ No newline at end of file',
  '+newLast', // new 6 (追加)
  '\\ No newline at end of file',
  '',
].join('\n');

describe('GAM-7 PR への出力', () => {
  it('AC-8: 差分から新しい側の追加行・context 行の行番号を集める', () => {
    const r = parseDiffRightLines(DIFF);
    expect(r.get('src/a.ts')).toEqual(new Set([1, 2, 3, 4, 11, 12]));
    expect(r.get('src/new.ts')).toEqual(new Set([1, 2]));
    expect(r.has('src/old.ts')).toBe(false);
    expect(r.get('src/c.ts')).toEqual(new Set([5, 6]));
  });

  it('AC-9: 差分にある行だけ、未投稿の fingerprint だけ inline コメントにする', () => {
    const kept = [
      F({ file: 'src/a.ts', line: 2 }),
      F({ file: 'src/a.ts', line: 99 }),
      F({ file: 'src/a.ts', line: null }),
      F({ file: 'src/new.ts', line: 1, category: 'xss' }),
    ];
    const rightLines = parseDiffRightLines(DIFF);
    const existingBodies = ['previous comment\n' + fingerprint(kept[3])];

    const comments = buildInlineComments(kept, rightLines, existingBodies);

    expect(comments).toHaveLength(1);
    const [c] = comments;
    expect({ path: c.path, line: c.line, side: c.side }).toEqual({ path: 'src/a.ts', line: 2, side: 'RIGHT' });
    expect(c.body).toContain(fingerprint(kept[0]));
    for (const s of [kept[0].severity, kept[0].category, kept[0].description, kept[0].recommendation]) {
      expect(c.body).toContain(s);
    }
  });

  it('AC-10: fingerprint は file・line・category だけで決まる HTML コメント', () => {
    const a = fingerprint(F({}));
    expect(fingerprint(F({ description: '別の文' }))).toBe(a);
    expect(fingerprint(F({ line: 11 }))).not.toBe(a);
    expect(a.startsWith('<!-- ')).toBe(true);
    expect(a.endsWith(' -->')).toBe(true);
  });

  it('AC-11: 総評（完了・検出なし・未完了・fork・ハーネス変更）', () => {
    const headSha = 'abc1234';
    const keptA = [F({}), F({ severity: 'MEDIUM', file: 'src/b.ts', line: 5 })];
    const excludedA: Excluded[] = [
      { finding: F({ file: 'src/other.ts' }), reason: 'Not in PR diff' },
      { finding: F({ file: 'src/a.ts', confidence: 0.5 }), reason: 'Low confidence' },
    ];
    const a = renderSummary({ status: 'completed', headSha, gate: decideGate(keptA), kept: keptA, excluded: excludedA, touchesHarness: false });
    const b = renderSummary({ status: 'completed', headSha, gate: decideGate([]), kept: [], excluded: [], touchesHarness: false });
    const c = renderSummary({ status: 'incomplete', headSha, error: 'parse error' });
    const d = renderSummary({ status: 'fork', headSha });
    const e = renderSummary({ status: 'completed', headSha, gate: decideGate([]), kept: [], excluded: [], touchesHarness: true });

    for (const s of [a, b, c, d, e]) {
      expect(s.split('\n')[0]).toBe(MARK);
      expect(s).toContain(headSha);
    }

    // (a)
    for (const s of ['FAIL', 'HIGH: 1', 'MEDIUM: 1', 'src/main.ts:10', 'src/b.ts:5']) expect(a).toContain(s);
    const details = a.slice(a.indexOf('<details>'), a.indexOf('</details>'));
    expect(a.indexOf('<details>')).toBeGreaterThan(-1);
    expect(details).toContain('src/other.ts');
    expect(details).toContain('Not in PR diff');
    expect(details).toContain('Low confidence');
    expect(a).not.toContain('ハーネス');
    // (b)
    expect(b).toContain('PASS');
    expect(b).toContain('検出なし');
    // (c)
    expect(c).toContain('未完了');
    expect(c).toContain('parse error');
    expect(c).not.toContain('PASS');
    // (d)
    expect(d).toContain('fork');
    expect(d).toContain('未実施');
    expect(d).not.toContain('PASS');
    // (e)
    expect(e.split('\n').some((l) => l.includes('ハーネス') && l.includes('⚠️'))).toBe(true);
  });

  it('AC-12: メンションとマーカーを無害化し、各フィールドを切り詰める', () => {
    const evil = F({ description: '@octocat see <!-- pixel-runner:security-review --> ' + 'x'.repeat(5000) });
    const summary = renderSummary({
      status: 'completed',
      headSha: 'abc1234',
      gate: decideGate([evil]),
      kept: [evil],
      excluded: [],
      touchesHarness: false,
    });
    const inline = buildInlineComments([evil], new Map([['src/main.ts', new Set([10])]]), []);
    expect(inline).toHaveLength(1);

    for (const out of [summary, inline[0].body]) {
      expect(out).not.toMatch(/@octocat/);
      expect(out).toContain(`@${ZWSP}octocat`);
      expect(out).not.toContain('x'.repeat(COMMENT_FIELD_MAX + 1));
    }
    expect(summary.split(MARK).length - 1).toBe(1);
    expect(summary.startsWith(`${MARK}\n`)).toBe(true);
    expect(inline[0].body).not.toContain(MARK);

    const s = sanitizeForComment(evil.description);
    expect(s.length).toBeLessThanOrEqual(COMMENT_FIELD_MAX + 1);
    expect(s.endsWith('…')).toBe(true);
    expect(s).not.toContain('<!--');
    expect(s).not.toContain('-->');
    expect(sanitizeForComment('short @a')).toBe(`short @${ZWSP}a`);
  });

  it('AC-13: ハーネスのパスを変更しているか検知する', () => {
    const cases: [string[], boolean][] = [
      [['src/main.ts'], false],
      [['.github/workflows/ci.yml'], true],
      [['.github/security-review/audit-prompt.md'], true],
      [['scripts/security-review/findings.mjs', 'src/a.ts'], true],
      [['scripts/linear.mjs'], false],
    ];
    for (const [changedFiles, expected] of cases) {
      expect(touchesHarness(changedFiles), changedFiles.join(',')).toBe(expected);
    }
  });
});

// レビュー指摘（H1 / M1 / M3 / L4）への追加テスト。既存 AC の期待値は変えない
describe('GAM-7 レビュー指摘への追加', () => {
  it('AC-6 (H1): ./ 付き・絶対パス・バックスラッシュの file を変更ファイルに寄せてから判定する', () => {
    const changedFiles = ['src/a.ts', 'tests/unit/x.test.ts', 'docs/a.md'];
    const findings = [
      F({ file: './src/a.ts' }),
      F({ file: '/home/runner/work/x/x/src/a.ts' }),
      F({ file: '././src/a.ts' }),
      F({ file: '.\\src\\a.ts' }),
      F({ file: './tests/unit/x.test.ts' }),
      F({ file: '/home/runner/work/x/x/docs/a.md' }),
      F({ file: '/home/runner/work/x/x/src/zzz.ts' }),
    ];
    const snapshot = structuredClone(findings);

    const { kept, excluded } = filterFindings(findings, { changedFiles });

    expect(kept).toEqual([0, 1, 2, 3].map(() => F({ file: 'src/a.ts' })));
    expect(excluded.map((e) => [e.finding.file, e.reason])).toEqual([
      ['tests/unit/x.test.ts', 'Test-only file'],
      ['docs/a.md', 'Finding in Markdown documentation file'],
      ['/home/runner/work/x/x/src/zzz.ts', 'Not in PR diff'],
    ]);
    expect(findings).toEqual(snapshot);

    // 正規化後の file が inline の path に使われる（src/a.ts の 2 行目は差分の追加行）
    const comments = buildInlineComments(
      filterFindings([F({ file: '/home/runner/work/x/x/src/a.ts', line: 2 })], { changedFiles }).kept,
      parseDiffRightLines(DIFF),
      [],
    );
    expect(comments.map((c) => [c.path, c.line])).toEqual([['src/a.ts', 2]]);
  });

  it('AC-6 (H1): normalizeFindingPath は絶対パスを末尾一致する最長の changedFile に寄せる', () => {
    const changed = ['a.ts', 'src/a.ts'];
    expect(normalizeFindingPath('/w/repo/src/a.ts', changed)).toBe('src/a.ts');
    expect(normalizeFindingPath('/w/repo/a.ts', changed)).toBe('a.ts');
    expect(normalizeFindingPath('C:\\w\\repo\\src\\a.ts', changed)).toBe('src/a.ts');
    expect(normalizeFindingPath('src/a.ts', changed)).toBe('src/a.ts');
    expect(normalizeFindingPath('/w/repo/other.ts', changed)).toBe('/w/repo/other.ts');
  });

  it('AC-6 (L4): 変更ファイルが空で指摘があるときだけ未完了の理由を返す', () => {
    const err = changedFilesError([], 1);
    expect(typeof err).toBe('string');
    expect((err ?? '').length).toBeGreaterThan(0);
    expect(changedFilesError([], 0)).toBeNull();
    expect(changedFilesError(['src/a.ts'], 1)).toBeNull();
  });

  it('AC-10 (M1): fingerprint の file・category は安全な文字だけにし、コメントを閉じさせない', () => {
    const fp = fingerprint(F({ file: 'src/a.ts --> x', category: 'x --!> @octocat <img src=x onerror=alert(1)> ---' }));
    expect(fp.startsWith('<!-- ')).toBe(true);
    expect(fp.endsWith(' -->')).toBe(true);
    const inner = fp.slice('<!-- '.length, -' -->'.length);
    expect(inner).not.toMatch(/--|[<>@!\s]/);
    // 既存の形式（AC-10）は変わらない
    expect(fingerprint(F({}))).toBe('<!-- pixel-runner:sr:src/main.ts:10:code_injection -->');
  });

  it('AC-12 (M1): --!> も無害化し、inline コメントの中で HTML コメントが閉じるのは fingerprint の末尾だけ', () => {
    expect(sanitizeForComment('a --!> b')).not.toContain('--!>');
    const evil = F({ category: 'xss --!> @octocat', description: 'd --!> <b>x</b>', recommendation: 'r -->' });
    const [c] = buildInlineComments([evil], new Map([['src/main.ts', new Set([10])]]), []);
    expect(c.body).not.toContain('--!>');
    expect(c.body.split('-->').length - 1).toBe(1);
    expect(c.body.endsWith(' -->')).toBe(true);
    expect(c.body).not.toMatch(/@octocat/);
  });

  it('AC-12 (M3): トークン形式の文字列を [REDACTED] に置き換える', () => {
    // 実在のトークンに見えないよう連結で組み立てる（push protection の誤検知を避ける）
    const tokens = [
      'sk-' + 'ant-oat01-' + 'FAKEfake_0123-xyz',
      'gh' + 'p_' + 'FAKE0123456789abcdef',
      'gh' + 's_' + 'FAKE0123456789abcdef',
      'github' + '_pat_' + '11FAKE_0123456789',
      'lin' + '_api_' + 'FAKE0123456789',
      'xox' + 'b-' + '1234-5678-FAKE',
    ];
    for (const t of tokens) {
      const s = sanitizeForComment(`leaked ${t} here`);
      expect(s, t).toBe(`leaked ${REDACTED} here`);
    }
    const evil = F({ description: `token ${tokens[0]}`, exploit_scenario: tokens[1], recommendation: tokens[3] });
    const summary = renderSummary({ status: 'completed', headSha: 'abc1234', gate: decideGate([evil]), kept: [evil], excluded: [] });
    const [c] = buildInlineComments([evil], new Map([['src/main.ts', new Set([10])]]), []);
    for (const out of [summary, c.body]) {
      for (const t of tokens.slice(0, 4)) expect(out).not.toContain(t);
    }
    expect(summary).toContain(REDACTED);
    expect(c.body).toContain(REDACTED);
  });
});
