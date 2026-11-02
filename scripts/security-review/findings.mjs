// GAM-7: セキュリティレビューの純粋関数（解析・除外・判定・コメント生成）。
// I/O・process・gh は使わない（それらは report.mjs が行う）。型は findings.d.mts。

/** 確信度のしきい値（0〜1）。取り込み元スラッシュコマンドの「8 未満を除外」に合わせる */
export const MIN_CONFIDENCE = 0.8;
/** コメントに載せる各フィールドの最大文字数 */
export const COMMENT_FIELD_MAX = 1000;
/** PR 上の総評コメントを識別するマーカー */
export const SUMMARY_MARKER = '<!-- pixel-runner:security-review -->';
/** このパス配下を変更する PR はハーネス（監査の設定そのもの）を変更している */
export const HARNESS_PATHS = Object.freeze(['.github/workflows/', '.github/security-review/', 'scripts/security-review/']);

const SEVERITIES = ['HIGH', 'MEDIUM', 'LOW'];
/** confidence の尺度: 取り込み元は 0〜1 と 1〜10 の 2 種類を使う */
const CONFIDENCE_UNIT_MAX = 1;
const CONFIDENCE_SCORE_MAX = 10;
/** テストのみのファイル（上流 HARD EXCLUSIONS 11 を決定的に適用する。本リポジトリの追加） */
const TEST_PATH_PREFIX = 'tests/';
const ZERO_WIDTH_SPACE = '​';
const ELLIPSIS = '…';

// ---------------------------------------------------------------------------
// parseAuditOutput
// ---------------------------------------------------------------------------

const FENCE_RE = /^```(?:json)?[ \t]*\r?\n?([\s\S]*?)\r?\n?```$/;

const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNonNegInt = (v) => Number.isInteger(v) && v >= 0;

function normalizeFinding(raw, index) {
  const where = `findings[${index}]`;
  if (!isObject(raw)) return { error: `${where} is not an object` };
  if (typeof raw.file !== 'string' || raw.file.length === 0) return { error: `${where}.file must be a non-empty string` };

  let line = null;
  if (raw.line !== undefined && raw.line !== null) {
    if (!Number.isInteger(raw.line) || raw.line < 1) return { error: `${where}.line must be a positive integer or null` };
    line = raw.line;
  }

  const severity = typeof raw.severity === 'string' ? raw.severity.toUpperCase() : '';
  if (!SEVERITIES.includes(severity)) return { error: `${where}.severity must be one of ${SEVERITIES.join('/')}` };

  if (typeof raw.category !== 'string' || raw.category.length === 0) return { error: `${where}.category must be a non-empty string` };
  for (const key of ['description', 'exploit_scenario', 'recommendation']) {
    if (typeof raw[key] !== 'string') return { error: `${where}.${key} must be a string` };
  }

  const c = raw.confidence;
  if (typeof c !== 'number' || !Number.isFinite(c) || c < 0 || c > CONFIDENCE_SCORE_MAX) {
    return { error: `${where}.confidence must be a number between 0 and ${CONFIDENCE_SCORE_MAX}` };
  }
  const confidence = c > CONFIDENCE_UNIT_MAX ? c / CONFIDENCE_SCORE_MAX : c;

  return {
    finding: {
      file: raw.file,
      line,
      severity,
      category: raw.category,
      description: raw.description,
      exploit_scenario: raw.exploit_scenario,
      recommendation: raw.recommendation,
      confidence,
    },
  };
}

export function parseAuditOutput(raw) {
  if (typeof raw !== 'string') return { ok: false, error: 'audit output is not a string' };
  let text = raw.trim();
  const fenced = FENCE_RE.exec(text);
  if (fenced) text = fenced[1].trim();
  if (text.length === 0) return { ok: false, error: 'audit output is empty' };

  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    return { ok: false, error: `audit output is not valid JSON: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (!isObject(data)) return { ok: false, error: 'audit output is not a JSON object' };
  if (!Array.isArray(data.findings)) return { ok: false, error: 'findings must be an array' };

  const summary = data.analysis_summary;
  if (!isObject(summary)) return { ok: false, error: 'analysis_summary is missing' };
  if (summary.review_completed !== true) return { ok: false, error: 'analysis_summary.review_completed is not true' };
  if (!isNonNegInt(summary.files_reviewed)) return { ok: false, error: 'analysis_summary.files_reviewed must be a non-negative integer' };

  const findings = [];
  for (let i = 0; i < data.findings.length; i++) {
    const r = normalizeFinding(data.findings[i], i);
    // 1 件でも不正なら全体を失敗にする（一部だけ採用しない）
    if (r.error) return { ok: false, error: r.error };
    findings.push(r.finding);
  }

  const counts = countBySeverity(findings);
  return {
    ok: true,
    value: {
      findings,
      analysis_summary: {
        files_reviewed: summary.files_reviewed,
        high_severity: counts.HIGH,
        medium_severity: counts.MEDIUM,
        low_severity: counts.LOW,
        review_completed: true,
      },
    },
  };
}

// ---------------------------------------------------------------------------
// getExclusionReason
// ---------------------------------------------------------------------------
/*
Derived from: anthropics/claude-code-security-review
  Repository: https://github.com/anthropics/claude-code-security-review
  Commit:     0c6a49f1fa56a1d472575da86a94dbc1edb78eda
  File:       claudecode/findings_filter.py (HardExclusionRules)
License: MIT License, Copyright (c) 2025 Anthropic
  Full text: .github/security-review/LICENSE.claude-code-security-review
Modifications for Pixel Runner (GAM-7):
  - Ported from Python to JavaScript (re.IGNORECASE -> the `i` flag); same patterns, same order, same reason strings
  - get_exclusion_reason (classmethod) became the plain function getExclusionReason
  - Python's Unicode-aware \b is JavaScript's ASCII \b (patterns are ASCII-only, so matches are the same for English text)
*/

const DOS_PATTERNS = [
  /\b(denial of service|dos attack|resource exhaustion)\b/i,
  /\b(exhaust|overwhelm|overload).*?(resource|memory|cpu)\b/i,
  /\b(infinite|unbounded).*?(loop|recursion)\b/i,
];

const RATE_LIMITING_PATTERNS = [
  /\b(missing|lack of|no)\s+rate\s+limit/i,
  /\brate\s+limiting\s+(missing|required|not implemented)/i,
  /\b(implement|add)\s+rate\s+limit/i,
  /\bunlimited\s+(requests|calls|api)/i,
];

const RESOURCE_PATTERNS = [
  /\b(resource|memory|file)\s+leak\s+potential/i,
  /\bunclosed\s+(resource|file|connection)/i,
  /\b(close|cleanup|release)\s+(resource|file|connection)/i,
  /\bpotential\s+memory\s+leak/i,
  /\b(database|thread|socket|connection)\s+leak/i,
];

const OPEN_REDIRECT_PATTERNS = [
  /\b(open redirect|unvalidated redirect)\b/i,
  /\b(redirect.(attack|exploit|vulnerability))\b/i,
  /\b(malicious.redirect)\b/i,
];

const MEMORY_SAFETY_PATTERNS = [
  /\b(buffer overflow|stack overflow|heap overflow)\b/i,
  /\b(oob)\s+(read|write|access)\b/i,
  /\b(out.?of.?bounds?)\b/i,
  /\b(memory safety|memory corruption)\b/i,
  /\b(use.?after.?free|double.?free|null.?pointer.?dereference)\b/i,
  /\b(segmentation fault|segfault|memory violation)\b/i,
  /\b(bounds check|boundary check|array bounds)\b/i,
  /\b(integer overflow|integer underflow|integer conversion)\b/i,
  /\barbitrary.?(memory read|pointer dereference|memory address|memory pointer)\b/i,
];

const REGEX_INJECTION = [
  /\b(regex|regular expression)\s+injection\b/i,
  /\b(regex|regular expression)\s+denial of service\b/i,
  /\b(regex|regular expression)\s+flooding\b/i,
];

const SSRF_PATTERNS = [/\b(ssrf|server\s+.?side\s+.?request\s+.?forgery)\b/i];

const C_CPP_EXTENSIONS = new Set(['.c', '.cc', '.cpp', '.h']);
const HTML_EXTENSIONS = new Set(['.html']);

const matchesAny = (patterns, text) => patterns.some((p) => p.test(text));

export function getExclusionReason(finding) {
  const filePath = typeof finding.file === 'string' ? finding.file : '';
  if (filePath.toLowerCase().endsWith('.md')) return 'Finding in Markdown documentation file';

  const description = finding.description ?? '';
  const title = finding.title ?? '';
  const combinedText = `${title} ${description}`.toLowerCase();

  if (matchesAny(DOS_PATTERNS, combinedText)) return 'Generic DOS/resource exhaustion finding (low signal)';
  if (matchesAny(RATE_LIMITING_PATTERNS, combinedText)) return 'Generic rate limiting recommendation';
  if (matchesAny(RESOURCE_PATTERNS, combinedText)) return 'Resource management finding (not a security vulnerability)';
  if (matchesAny(OPEN_REDIRECT_PATTERNS, combinedText)) return 'Open redirect vulnerability (not high impact)';
  if (matchesAny(REGEX_INJECTION, combinedText)) return 'Regex injection finding (not applicable)';

  const fileExt = filePath.includes('.') ? `.${filePath.toLowerCase().split('.').pop()}` : '';
  if (!C_CPP_EXTENSIONS.has(fileExt) && matchesAny(MEMORY_SAFETY_PATTERNS, combinedText)) {
    return 'Memory safety finding in non-C/C++ code (not applicable)';
  }
  if (HTML_EXTENSIONS.has(fileExt) && matchesAny(SSRF_PATTERNS, combinedText)) {
    return 'SSRF finding in HTML file (not applicable to client-side code)';
  }
  return null;
}

// ---------------------------------------------------------------------------
// filterFindings / decideGate
// ---------------------------------------------------------------------------

export function filterFindings(findings, { changedFiles, minConfidence = MIN_CONFIDENCE }) {
  const changed = new Set(changedFiles);
  const kept = [];
  const excluded = [];
  for (const finding of findings) {
    let reason;
    if (!changed.has(finding.file)) reason = 'Not in PR diff';
    else if (finding.file.startsWith(TEST_PATH_PREFIX)) reason = 'Test-only file';
    else reason = getExclusionReason(finding) ?? (finding.confidence < minConfidence ? 'Low confidence' : null);
    if (reason === null) kept.push(finding);
    else excluded.push({ finding, reason });
  }
  return { kept, excluded };
}

function countBySeverity(findings) {
  const counts = { HIGH: 0, MEDIUM: 0, LOW: 0 };
  for (const f of findings) counts[f.severity] += 1;
  return counts;
}

export function decideGate(kept) {
  const counts = countBySeverity(kept);
  return { conclusion: counts.HIGH > 0 ? 'failure' : 'success', counts };
}

// ---------------------------------------------------------------------------
// parseDiffRightLines
// ---------------------------------------------------------------------------

const HUNK_RE = /^@@ -\d+(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
const NEW_FILE_PREFIX = '+++ ';
const DEV_NULL = '/dev/null';
const NEW_SIDE_PATH_PREFIX = 'b/';

/** unified diff から、ファイルごとに新しい側で inline コメントを付けられる行（追加行と context 行）を集める */
export function parseDiffRightLines(diff) {
  const result = new Map();
  let file = null;
  let newLine = 0;
  let oldRemaining = 0;
  let newRemaining = 0;

  const add = (n) => {
    if (file === null) return;
    let set = result.get(file);
    if (!set) {
      set = new Set();
      result.set(file, set);
    }
    set.add(n);
  };

  for (const line of diff.split('\n')) {
    const inHunk = oldRemaining > 0 || newRemaining > 0;
    if (!inHunk) {
      if (line.startsWith('diff --git ')) {
        file = null;
        continue;
      }
      if (line.startsWith(NEW_FILE_PREFIX)) {
        const path = line.slice(NEW_FILE_PREFIX.length).replace(/\t.*$/, '');
        if (path === DEV_NULL) file = null;
        else file = path.startsWith(NEW_SIDE_PATH_PREFIX) ? path.slice(NEW_SIDE_PATH_PREFIX.length) : path;
        continue;
      }
      const hunk = HUNK_RE.exec(line);
      if (hunk) {
        oldRemaining = hunk[1] === undefined ? 1 : Number(hunk[1]);
        newLine = Number(hunk[2]);
        newRemaining = hunk[3] === undefined ? 1 : Number(hunk[3]);
      }
      continue;
    }
    // ハンクの中
    if (line.startsWith('\\')) continue; // "\ No newline at end of file" は行番号を進めない
    if (line.startsWith('+')) {
      add(newLine);
      newLine += 1;
      newRemaining -= 1;
    } else if (line.startsWith('-')) {
      oldRemaining -= 1;
    } else {
      // context 行（空行は末尾空白が削られた context とみなす）
      add(newLine);
      newLine += 1;
      oldRemaining -= 1;
      newRemaining -= 1;
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// コメント生成
// ---------------------------------------------------------------------------

/** HTML コメントの開始・終了を無害化する（fingerprint や総評のマーカーを偽装させない） */
const escapeHtmlComment = (text) => text.replaceAll('<!--', '&lt;!--').replaceAll('-->', '--&gt;');

export function sanitizeForComment(text, maxLen = COMMENT_FIELD_MAX) {
  const escaped = escapeHtmlComment(String(text ?? '').replaceAll('@', `@${ZERO_WIDTH_SPACE}`));
  return escaped.length > maxLen ? `${escaped.slice(0, maxLen)}${ELLIPSIS}` : escaped;
}

export function fingerprint(finding) {
  const file = escapeHtmlComment(String(finding.file));
  const category = escapeHtmlComment(String(finding.category));
  return `<!-- pixel-runner:sr:${file}:${finding.line ?? 0}:${category} -->`;
}

export function buildInlineComments(kept, rightLines, existingBodies) {
  const seen = new Set();
  const comments = [];
  for (const f of kept) {
    if (f.line === null || f.line === undefined) continue;
    if (!rightLines.get(f.file)?.has(f.line)) continue;
    const fp = fingerprint(f);
    if (seen.has(fp) || existingBodies.some((b) => b.includes(fp))) continue;
    seen.add(fp);
    const body = [
      `**[Security] ${f.severity}: ${sanitizeForComment(f.category)}**`,
      '',
      sanitizeForComment(f.description),
      '',
      `**Exploit scenario:** ${sanitizeForComment(f.exploit_scenario)}`,
      '',
      `**Recommendation:** ${sanitizeForComment(f.recommendation)}`,
      '',
      fp,
    ].join('\n');
    comments.push({ path: f.file, line: f.line, side: 'RIGHT', body });
  }
  return comments;
}

export function touchesHarness(changedFiles) {
  return changedFiles.some((f) => HARNESS_PATHS.some((p) => f.startsWith(p)));
}

/** Markdown の表のセル用: 無害化に加えて | と改行を潰す */
const cell = (text) => sanitizeForComment(text).replaceAll('|', '\\|').replace(/\r?\n/g, ' ');
const location = (f) => (f.line === null || f.line === undefined ? f.file : `${f.file}:${f.line}`);

const HARNESS_WARNING =
  '⚠️ この PR はハーネス（ワークフロー／セキュリティレビュー設定）を変更しています。監査の設定自体が変わっていないか人が確認してください';
const GATE_NOTE = 'HIGH があるとこのチェックは失敗し、マージゲートは自動マージせず Needs Human にします';
const FORK_NOTE = 'fork からの PR ではシークレットを使えないためセキュリティレビューは未実施。人が確認してください';
const FAIL_CLOSED_NOTE = 'このチェックは失敗扱い（fail-closed）になります。';

export function renderSummary(input) {
  const { status, headSha } = input;
  const kept = input.kept ?? [];
  const excluded = input.excluded ?? [];
  const gate = input.gate ?? decideGate(kept);

  let verdict;
  if (status === 'completed') verdict = gate.conclusion === 'failure' ? 'FAIL' : 'PASS';
  else if (status === 'fork') verdict = '未実施（fork）';
  else verdict = '未完了';

  const lines = [SUMMARY_MARKER, `## Security Review — ${verdict}`, '', `HEAD: ${sanitizeForComment(headSha)}`, ''];
  if (input.touchesHarness) lines.push(HARNESS_WARNING, '');

  if (status === 'completed') {
    lines.push(`HIGH: ${gate.counts.HIGH} / MEDIUM: ${gate.counts.MEDIUM} / LOW: ${gate.counts.LOW}`, '');
    if (kept.length === 0) {
      lines.push('検出なし（フィルタ後に残った指摘はありません）', '');
    } else {
      lines.push('| Severity | 場所 | Category | Description |', '|---|---|---|---|');
      for (const f of kept) lines.push(`| ${f.severity} | ${cell(location(f))} | ${cell(f.category)} | ${cell(f.description)} |`);
      lines.push('');
    }
    if (excluded.length > 0) {
      lines.push(`<details><summary>除外 ${excluded.length} 件</summary>`, '');
      for (const { finding, reason } of excluded) {
        lines.push(
          `- ${cell(location(finding))} (${finding.severity}, ${cell(finding.category)}) — 理由: ${cell(reason)} — ${cell(finding.description)}`,
        );
      }
      lines.push('', '</details>', '');
    }
  } else if (status === 'fork') {
    lines.push(FORK_NOTE, '', FAIL_CLOSED_NOTE, '');
  } else {
    lines.push('セキュリティレビューが未完了です。人が確認してください。', '', `理由: ${sanitizeForComment(input.error ?? '不明')}`, '', FAIL_CLOSED_NOTE, '');
  }

  lines.push(GATE_NOTE);
  return lines.join('\n');
}
