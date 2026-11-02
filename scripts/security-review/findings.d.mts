// GAM-7: findings.mjs の型宣言（tests/unit/*.test.ts から import したときの型検査用）

export type Severity = 'HIGH' | 'MEDIUM' | 'LOW';
export interface Finding {
  file: string;
  line: number | null;
  severity: Severity;
  category: string;
  description: string;
  exploit_scenario: string;
  recommendation: string;
  /** 0〜1 */
  confidence: number;
}
export interface AuditOutput {
  findings: Finding[];
  analysis_summary: {
    files_reviewed: number;
    high_severity: number;
    medium_severity: number;
    low_severity: number;
    review_completed: boolean;
  };
}
export interface Excluded {
  finding: Finding;
  reason: string;
}
export interface Gate {
  conclusion: 'success' | 'failure';
  counts: Record<Severity, number>;
}
export interface InlineComment {
  path: string;
  line: number;
  side: 'RIGHT';
  body: string;
}

/** 0.8（取り込み元のスラッシュコマンドの「8 未満を除外」に合わせる） */
export const MIN_CONFIDENCE: number;
/** 1000 */
export const COMMENT_FIELD_MAX: number;
/** '<!-- pixel-runner:security-review -->' */
export const SUMMARY_MARKER: string;
/** ['.github/workflows/', '.github/security-review/', 'scripts/security-review/'] */
export const HARNESS_PATHS: readonly string[];
/** '[REDACTED]'（トークン形式の文字列の置換先） */
export const REDACTED: string;

export function parseAuditOutput(raw: string): { ok: true; value: AuditOutput } | { ok: false; error: string };
export function getExclusionReason(finding: Finding): string | null;
/** file を PR の変更ファイルの表記に寄せる（`\\`→`/`、先頭 `./` 除去、絶対パスは末尾一致する changedFile） */
export function normalizeFindingPath(file: string, changedFiles: string[]): string;
/** changedFiles が空なのに指摘があれば理由文字列（fail-closed）、それ以外は null */
export function changedFilesError(changedFiles: string[], findingsCount: number): string | null;
export function filterFindings(
  findings: Finding[],
  opts: { changedFiles: string[]; minConfidence?: number },
): { kept: Finding[]; excluded: Excluded[] };
export function decideGate(kept: Finding[]): Gate;
export function parseDiffRightLines(diff: string): Map<string, Set<number>>;
export function fingerprint(finding: Finding): string;
export function buildInlineComments(
  kept: Finding[],
  rightLines: Map<string, Set<number>>,
  existingBodies: string[],
): InlineComment[];
export function sanitizeForComment(text: string, maxLen?: number): string;
export function touchesHarness(changedFiles: string[]): boolean;
export function renderSummary(input: {
  status: 'completed' | 'incomplete' | 'fork';
  headSha: string;
  gate?: Gate;
  kept?: Finding[];
  excluded?: Excluded[];
  touchesHarness?: boolean;
  error?: string;
}): string;
