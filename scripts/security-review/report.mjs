#!/usr/bin/env node
// GAM-7: security-review.yml の security-gate ジョブから呼ばれる CLI。
// 入出力（ファイル読み込み・gh 呼び出し・終了コード）だけを行い、判断はすべて findings.mjs に委ねる。
// gh は execFileSync の配列引数で呼ぶ（シェルを通さない。外部の値をコマンド文字列に連結しない）。
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import {
  SUMMARY_MARKER,
  buildInlineComments,
  changedFilesError,
  decideGate,
  filterFindings,
  parseAuditOutput,
  parseDiffRightLines,
  renderSummary,
  touchesHarness,
} from './findings.mjs';

const BOT_LOGIN = 'github-actions[bot]';
const GH_MAX_BUFFER = 64 * 1024 * 1024;

const env = (name) => {
  const v = process.env[name];
  if (!v) throw new Error(`環境変数 ${name} がありません`);
  return v;
};

const REPO = env('REPO');
const PR_NUMBER = env('PR_NUMBER');
const HEAD_SHA = env('HEAD_SHA');
const AUDIT_RESULT = process.env.AUDIT_RESULT ?? '';
const IS_FORK = process.env.IS_FORK === 'true';
const FINDINGS_PATH = process.env.FINDINGS_PATH ?? 'security-findings.json';

function gh(args, input) {
  return execFileSync('gh', args, {
    encoding: 'utf8',
    input,
    maxBuffer: GH_MAX_BUFFER,
    stdio: ['pipe', 'pipe', 'inherit'],
  });
}

/** `--jq '... | @json'` の出力（1 行 1 JSON）を配列にする */
const parseJsonLines = (out) =>
  out
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l));

/** 総評は PR 上に常に 1 件: マーカーで始まる bot コメントがあれば PATCH、なければ POST */
function upsertSummary(body) {
  const comments = parseJsonLines(
    gh(['api', '--paginate', `repos/${REPO}/issues/${PR_NUMBER}/comments`, '--jq', '.[] | {id: .id, login: .user.login, body: .body} | @json']),
  );
  const existing = comments.find((c) => c.login === BOT_LOGIN && typeof c.body === 'string' && c.body.startsWith(SUMMARY_MARKER));
  const payload = JSON.stringify({ body });
  if (existing) gh(['api', '-X', 'PATCH', `repos/${REPO}/issues/comments/${existing.id}`, '--input', '-'], payload);
  else gh(['api', '-X', 'POST', `repos/${REPO}/issues/${PR_NUMBER}/comments`, '--input', '-'], payload);
}

/** 総評を投稿する。投稿に失敗したら false（呼び出し側で fail-closed にする） */
function postSummary(input) {
  const body = renderSummary({ headSha: HEAD_SHA, ...input });
  console.log(body);
  try {
    upsertSummary(body);
    return true;
  } catch (e) {
    console.error(`::error::総評コメントの投稿に失敗しました: ${e instanceof Error ? e.message : String(e)}`);
    return false;
  }
}

function postInline(kept, diff) {
  const rightLines = parseDiffRightLines(diff);
  const existingBodies = parseJsonLines(gh(['api', '--paginate', `repos/${REPO}/pulls/${PR_NUMBER}/comments`, '--jq', '.[].body | @json']));
  const comments = buildInlineComments(kept, rightLines, existingBodies);
  if (comments.length === 0) return;
  const review = { commit_id: HEAD_SHA, event: 'COMMENT', comments };
  gh(['api', '-X', 'POST', `repos/${REPO}/pulls/${PR_NUMBER}/reviews`, '--input', '-'], JSON.stringify(review));
  console.log(`inline コメントを ${comments.length} 件投稿しました`);
}

function readFindings() {
  try {
    return readFileSync(FINDINGS_PATH, 'utf8');
  } catch {
    return null;
  }
}

function main() {
  // 1. fork PR はシークレットが使えず監査していない → fail-closed
  if (IS_FORK) {
    postSummary({ status: 'fork' });
    return 1;
  }

  // 2. 監査ジョブが成功していない／結果ファイルがない → 未完了
  if (AUDIT_RESULT !== 'success') {
    postSummary({ status: 'incomplete', error: `security-audit job result: ${AUDIT_RESULT || 'unknown'}` });
    return 1;
  }
  const raw = readFindings();
  if (raw === null || raw.trim() === '') {
    postSummary({ status: 'incomplete', error: `findings file ${FINDINGS_PATH} is missing or empty` });
    return 1;
  }

  // 3. PR の変更ファイル（REST でページングして全件）と差分
  let changedFiles;
  try {
    changedFiles = gh(['api', '--paginate', `repos/${REPO}/pulls/${PR_NUMBER}/files`, '--jq', '.[].filename'])
      .split('\n')
      .filter((l) => l !== '');
  } catch (e) {
    postSummary({ status: 'incomplete', error: `failed to list PR files: ${e instanceof Error ? e.message : String(e)}` });
    return 1;
  }
  let diff = '';
  try {
    diff = gh(['pr', 'diff', PR_NUMBER, '--repo', REPO]);
  } catch (e) {
    // 差分が取れなくても判定はできる（inline コメントが付けられないだけ）
    console.error(`::warning::gh pr diff に失敗しました（inline コメントなし）: ${e instanceof Error ? e.message : String(e)}`);
  }

  // 4. 監査結果の検証（fail-closed）
  const parsed = parseAuditOutput(raw);
  if (!parsed.ok) {
    postSummary({ status: 'incomplete', error: parsed.error });
    return 1;
  }

  // 変更ファイルが空なのに指摘がある → 取得失敗とみなす（全件「Not in PR diff」で success になるのを防ぐ）
  const filesError = changedFilesError(changedFiles, parsed.value.findings.length);
  if (filesError) {
    postSummary({ status: 'incomplete', error: filesError });
    return 1;
  }

  // 5. フィルタ → 判定 → 総評
  const { kept, excluded } = filterFindings(parsed.value.findings, { changedFiles });
  const gate = decideGate(kept);
  const posted = postSummary({ status: 'completed', gate, kept, excluded, touchesHarness: touchesHarness(changedFiles) });

  // 7. inline（失敗しても総評が投稿できていれば判定はそのまま）
  if (diff !== '') {
    try {
      postInline(kept, diff);
    } catch (e) {
      console.error(`::warning::inline コメントの投稿に失敗しました: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // 8. 判定
  console.log(`gate: ${gate.conclusion} (HIGH ${gate.counts.HIGH} / MEDIUM ${gate.counts.MEDIUM} / LOW ${gate.counts.LOW})`);
  if (!posted) return 1;
  return gate.conclusion === 'failure' ? 1 : 0;
}

try {
  process.exitCode = main();
} catch (e) {
  console.error(`::error::${e instanceof Error ? e.stack : String(e)}`);
  process.exitCode = 1;
}
