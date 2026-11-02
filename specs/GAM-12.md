# GAM-12: [Ops] リリースタグと CHANGELOG

## 目的
main のデプロイが成功するたびに、デプロイしたコミットへ semver のタグ（例 `v1.1.0`）を付け、GitHub Release を作る。Release の本文が CHANGELOG になる。本文は、前回のタグから今回までに main に入ったコミット（squash マージの PR タイトル `GAM-n: …`）から Issue を集め、Linear のタイトル・ラベルで分類して作る。

ゲームの仕様（`docs/game-design.md`）と `src/` は変更しない。

### 前提（調査済みの事実）
- `.github/workflows/deploy.yml`: `push`（main）と `workflow_dispatch` で起動する。ジョブは `deploy` の 1 つ（checkout → setup-node 22 → `npm ci` → `npm run build` → Pages へアップロード・デプロイ → Slack 通知）。ワークフロー全体の権限は `contents: read, pages: write, id-token: write`、`concurrency: { group: pages, cancel-in-progress: true }`
- `scripts/linear-merge-gate.mjs` は GITHUB_TOKEN で `gh pr merge --squash` するため push イベントが発火しない。代わりに最後に `gh workflow run deploy.yml --ref main` で明示的にデプロイを起動している（入力なし）。このとき `github.sha` は起動時点の main の先頭
- main は squash マージで、コミットの件名は PR タイトル + ` (#PR番号)`。現在の履歴: `GAM-1: プレイヤーのジャンプと重力 (#1)`、`Harness: Slack 通知（…） (#3)`、`GAM-2: 障害物の生成・スクロールと当たり判定 (#4)`、`Re-register scheduled workflows with offset cron times (#5)`、`GAM-7: CI にセキュリティ検査を追加（…） (#6)`。GAM-n で始まらないコミットもある
- ローカルの `.git` にタグはない（`refs/tags/` も `packed-refs` のタグもなし）。`package.json` の `version` は `1.0.0`
- `scripts/linear.mjs` は `gql(query, variables)` と `TEAM_KEY`（`LINEAR_TEAM_KEY`、既定 `GAM`）を export している。Secret `LINEAR_API_KEY` は登録済み
- `docs/linear-setup.md` のラベルは `ai-ready`、`feature`、`bug`、`refactor`、`feedback`。一方で本 Issue には `Improvement` ラベルが付いている（Linear の既定ラベル `Feature` / `Improvement` / `Bug` も使われている）→ 大文字小文字を区別せずに対応させる（確認事項 Q3）
- 先例: GAM-7 の `scripts/security-review/findings.mjs`（純粋関数）+ `findings.d.mts`（型宣言）+ `report.mjs`（I/O だけの CLI）と、`tests/unit/workflows.test.ts`（ワークフローをテキストで静的に検査）

## 受入条件

### タグ
ブラウザは関係しないので `[e2e]` はなし。GAM-7 と同じく次の 2 種類を使う。
- `[unit]`: `scripts/release/changelog.mjs` の純粋関数と、`deploy.yml` の静的な性質。`tests/unit/` の vitest で検証する（implementer 担当）
- `[ci]`: GitHub 上で実際に動かして確かめるもの。オーケストレーターが `gh` / `git` の出力で判定し、`specs/GAM-12.progress.md` に記録する。AC-15・16 は **マージ後** にしか確かめられない（確認事項 Q9）

表記: `C(sha, subject)` = `{ sha, subject }`。`M(title, labels)` = `{ identifier: <キー>, title, url: 'https://linear.app/pixel/issue/<キー>', labels }`。

### バージョン（`parseSemverTag`、`latestVersionTag`、`nextVersion`）
| ID | Given | When | Then |
|---|---|---|---|
| AC-1 [unit] タグの解析 | `'v1.0.0'`／`'v10.20.30'`／`'1.0.0'`／`'v1.0'`／`'v1.0.0-rc.1'`／`'v01.0.0'`／`'release-1'`／`''` | `parseSemverTag(tag)` | `{ major: 1, minor: 0, patch: 0 }`／`{ major: 10, minor: 20, patch: 30 }`／残りはすべて `null`（`v` + 先頭ゼロなしの数字 3 つだけを受け付ける） |
| AC-2 [unit] 最新タグ | `['v1.9.0', 'v1.10.0', 'v1.2.3', 'foo', 'v2.0.0-rc.1']`／`[]`／`['foo', 'v1.0']` | `latestVersionTag(tags)` | `'v1.10.0'`（数値で比較する。文字列比較なら `v1.9.0` になってしまう）／`null`／`null` |
| AC-3 [unit] 次のバージョン | `(null, 'minor', '1.0.0')`／`(null, 'patch', '1.0.0')`／`('v1.2.3', 'patch', '1.0.0')`／`('v1.2.3', 'minor', '1.0.0')`／`('v1.2.3', 'major', '1.0.0')`／`('v1.2.3', null, '1.0.0')`／`('bad', 'patch', '1.0.0')`／`(null, 'patch', '1.0')` | `nextVersion(prevTag, bump, baseVersion)` | `'v1.0.0'`／`'v1.0.0'`（前回タグがなければ `baseVersion` をそのまま使い、bump は無視）／`'v1.2.4'`／`'v1.3.0'`／`'v2.0.0'`／`null`／例外を投げる／例外を投げる |

### コミットの集計（`parseGitLog`、`groupCommits`）
| ID | Given | When | Then |
|---|---|---|---|
| AC-4 [unit] git log の解析 | `'aaa\tGAM-2: 障害物\tの生成 (#4)\r\n\nbbb\tfoo\n'`／`''` | `parseGitLog(text)` | `[C('aaa', 'GAM-2: 障害物\tの生成 (#4)'), C('bbb', 'foo')]`（最初のタブだけで分ける。空行と末尾の `\r` は無視）／`[]` |
| AC-5 [unit] Issue ごとにまとめる | 古い順の `commits` = `C('c1', 'GAM-1: プレイヤーのジャンプと重力 (#1)')`、`C('c2', 'Harness: Slack 通知 (#3)')`、`C('c3', 'GAM-2: 障害物の生成 (#4)')`、`C('c4', 'Re-register scheduled workflows with offset cron times (#5)')`、`C('c5', 'GAM-7: CI にセキュリティ検査を追加 (#6)')`、`C('c6', 'GAM-2: 着地判定の修正 (#8)')`、`C('c7', 'Revert "GAM-7: CI にセキュリティ検査を追加 (#6)" (#9)')`、`C('c8', 'gam-3: lowercase')`、`C('c9', 'GAM-10x: not an id')`、`C('c10', 'GAM-11 Sentry 連携')`（入力は `structuredClone` で控えを取る） | `groupCommits(commits, 'GAM')` | `issues` は登場順に 4 件: `{ identifier: 'GAM-1', number: 1, prNumbers: [1], shas: ['c1'], subject: 'GAM-1: プレイヤーのジャンプと重力 (#1)' }`、`GAM-2`（`prNumbers: [4, 8]`、`shas: ['c3', 'c6']`、`subject` は最初のコミット `c3` の件名）、`GAM-7`（`[6]`）、`GAM-11`（`prNumbers: []`）。`others` は入力順に 5 件: `{ sha: 'c2', subject: 'Harness: Slack 通知 (#3)', prNumber: 3 }`、`c4`（`5`）、`c7`（`9`。`Revert "` で始まる件名は Issue に数えない）、`c8`（`null`。キーは大文字小文字を区別する）、`c9`（`null`）。入力は控えと deep equal |

### 分類と CHANGELOG の項目（`labelCategory`、`buildEntries`、`decideBump`、`sanitizeTitle`）
| ID | Given | When | Then |
|---|---|---|---|
| AC-6 [unit] ラベルの分類 | `['Feature']`／`['bug', 'Feature']`／`['Bug']`／`['Improvement']`／`['refactor']`／`['bug', 'improvement']`／`['ai-ready', 'feedback']`／`[]` | `labelCategory(labels)` | `'feature'`／`'feature'`／`'bug'`／`'improvement'`／`'improvement'`／`'bug'`／`'other'`／`'other'`（大文字小文字を区別しない。優先順は feature > bug > improvement > other） |
| AC-7 [unit] 項目の組み立て | AC-5 の結果と、`meta = { 'GAM-1': M('プレイヤーのジャンプと重力', ['Feature', 'ai-ready']), 'GAM-2': M('障害物の生成・スクロールと当たり判定', ['Feature']), 'GAM-7': M('[Harness] CI にセキュリティ検査を追加', ['Improvement']), 'GAM-11': null }` | `buildEntries(groups, meta)` | 9 件の `ChangelogEntry`。`GAM-1` → `{ category: 'feature', identifier: 'GAM-1', number: 1, title: 'プレイヤーのジャンプと重力', url: 'https://linear.app/pixel/issue/GAM-1', prNumbers: [1] }`。`GAM-7` → `category: 'improvement'`。`GAM-11`（Linear に見つからない）→ `{ category: 'other', identifier: 'GAM-11', number: 11, title: 'Sentry 連携', url: null, prNumbers: [] }`（件名から先頭の `GAM-11` と区切りの `:`・空白、末尾の ` (#n)` を除いたもの）。`others` の `c2` → `{ category: 'other', identifier: null, number: null, title: 'Harness: Slack 通知', url: null, prNumbers: [3] }`。`meta` にキーがない Issue は `null` と同じ扱い |
| AC-8 [unit] バージョンの上げ方 | `entries` が (a) AC-7 の結果（feature あり）／(b) `improvement` と `bug` と `other` のみ／(c) `[]`、`override` が `'auto'`／`'major'`／`'patch'`／`'none'`／`'foo'` | `decideBump(entries, override)` | (a)+auto → `'minor'`、(b)+auto → `'patch'`、(c)+auto → `null`。(a)+major → `'major'`、(a)+patch → `'patch'`（指定が優先）、(a)+none → `null`、(c)+major → `null`（変更がなければ指定があっても上げない）。`'foo'` は例外を投げる |
| AC-9 [unit] タイトルの無害化 | `'a\nb\r\nc'`／`'@octocat に連絡'`／`'x <!-- y --> z'`／`'  前後  '`／`'あ'.repeat(250)` | `sanitizeTitle(s)` | `'a b c'`／`'@​octocat に連絡'`（`@` の直後にゼロ幅スペース `​`）／`'x &lt;!-- y --&gt; z'`／`'前後'`／先頭 `TITLE_MAX`（= 200）文字 + `'…'` |

### Release 本文（`renderReleaseNotes`）
| ID | Given | When | Then |
|---|---|---|---|
| AC-10 [unit] 本文の書式 | 「設計 > Release 本文の例」の入力 | `renderReleaseNotes(input)` | 同節の期待文字列と完全一致（`toBe`）。見出しは 新機能 → 改善 → 不具合修正 → その他 の順で、項目のない見出しは出さない。各見出しの中で Issue は番号の昇順（`GAM-2` が `GAM-10` より先）、Issue のあとに `identifier: null` の項目を入力順で並べる |
| AC-11 [unit] 初回・URL なし | AC-10 の入力の `prevTag` を `null`、`pageUrl` を `''` にしたもの | `renderReleaseNotes(input)` | `- 差分:` の行の代わりに `- 初回リリース` の行がある。`compare/` を含まない。`- デプロイ:` の行がない。それ以外は AC-10 と同じ |

### リリースするかの判定（`decideRelease`）
共通の入力: `base = { headTags: [], mergedTags: ['v1.0.0'], existingTags: ['v1.0.0'], entries: <AC-7 の結果>, baseVersion: '1.0.0', override: 'auto' }`
| ID | Given | When | Then |
|---|---|---|---|
| AC-12 [unit] 冪等性と判定 | (a) `base`／(b) `base` の `headTags` を `['v1.1.0', 'foo']`／(c) `entries: []`／(d) `override: 'none'`／(e) `existingTags: ['v1.0.0', 'v1.1.0']`（`mergedTags` は `['v1.0.0']` のまま）／(f) `mergedTags: [], existingTags: []`／(g) `override: 'major'` | `decideRelease(input)` | (a) `{ action: 'create', tag: 'v1.1.0', prevTag: 'v1.0.0', bump: 'minor' }`／(b) `{ action: 'skip', reason: 'already-tagged', tag: 'v1.1.0' }`（同じコミットに二重にタグを付けない。`entries` があってもこれを最優先）／(c) `{ action: 'skip', reason: 'no-changes' }`／(d) `{ action: 'skip', reason: 'bump-none' }`／(e) `{ action: 'error', reason: 'tag-exists', tag: 'v1.1.0' }`（別のコミットに同名タグがある。上書きしない）／(f) `{ action: 'create', tag: 'v1.0.0', prevTag: null, bump: 'minor' }`／(g) `{ action: 'create', tag: 'v2.0.0', prevTag: 'v1.0.0', bump: 'major' }` |

### ワークフローの静的な性質
| ID | Given | When | Then |
|---|---|---|---|
| AC-13 [unit] deploy.yml の release ジョブ | `.github/workflows/deploy.yml` と `scripts/release/*.mjs` をテキストとして読む（`node:fs`） | 文字列・正規表現で検査 | (a) `jobs:` より前（ワークフロー全体）の `permissions:` に `contents: read` があり `contents: write` がない。(b) `contents: write` はファイル全体でちょうど 1 回（release ジョブの権限）。(c) `needs: deploy`、`fetch-depth: 0`、`RELEASE_SHA: ${{ github.sha }}`、`node scripts/release/release.mjs` を含む。(d) `run:` で始まる行（`- run:` を含む）に `${{` が含まれない（値は `env:` 経由）。(e) deploy.yml と `scripts/release/` 配下の全 `.mjs` に `git push` が含まれない（タグは GitHub Release の API で作り、bot は main に push しない） |

### GitHub 上での確認
| ID | Given | When | Then |
|---|---|---|---|
| AC-14 [ci] dry-run に副作用がない（マージ前） | GAM-12 のブランチ。事前に `git ls-remote --tags origin 'v*'` の出力を控える | `LINEAR_API_KEY` なしで `node scripts/release/release.mjs --dry-run` を実行 | exit 0。標準出力に `release: offline (LINEAR_API_KEY is not set)` と `release: plan create v` で始まる行がある（リモートにタグがなければ `release: plan create v1.0.0 (bump=…, prev=none)`）。本文に `GAM-7` と `(#6)` と `GAM-2` を含む。実行後の `git ls-remote --tags origin 'v*'` が事前と同じで、`gh release list --json tagName` の件数も変わらない |
| AC-15 [ci] デプロイ後にリリースが作られる（マージ後） | GAM-12 の PR が merge-gate でマージされ、`deploy.yml` が workflow_dispatch で起動された | その実行の完了を待つ（`gh run watch`） | `deploy` と `release` の両ジョブが `success`。release のログに `release: created v<x.y.z>` がある。`gh release view v<x.y.z> --json tagName,isDraft,isPrerelease,body` で `isDraft === false`、`isPrerelease === false`、`body` に `GAM-12` と `GAM-7` を含む（初回なら `- 初回リリース` も）。`git rev-list -n 1 v<x.y.z>` がその実行の `headSha`（`gh run view <id> --json headSha`）と一致 |
| AC-16 [ci] 同じコミットで再実行しても二重に作らない（マージ後） | AC-15 の直後で、main に新しいコミットがない | `gh workflow run deploy.yml --ref main` で再度デプロイし、完了を待つ | `release` ジョブが `success` で、ログに `release: skip already-tagged v<x.y.z>` がある。`gh release list --json tagName` の件数と `git ls-remote --tags origin 'v*'` の行数が AC-15 の直後と同じ |
| AC-17 [ci] 既存のチェックが通る | GAM-12 の PR（draft でない） | 全チェックの完了を待ち、`gh pr checks <PR>` | `CI / verify`、`CI / npm-audit`、`AI Review / review`、`Security Review / security-gate` がすべて `SUCCESS`（`deploy.yml` を変えるので security-gate の総評にハーネス変更の警告が出るのは想定どおり） |

## 設計

### 方式の決定
| 論点 | 決定（推奨） | 理由・比較 |
|---|---|---|
| バージョニング | **semver `vMAJOR.MINOR.PATCH`**。初回は `package.json` の `1.0.0` をそのまま使い `v1.0.0` | `package.json` が既に semver。日付ベース（`v2026.11.02` など）は 1 日に複数回デプロイすると連番が必要になり、変更の大きさも表せない |
| 何で上げるか | 前回タグ以降の Issue に **`Feature` ラベルが 1 件でもあれば minor**、それ以外（`Improvement` / `bug` / `refactor` / ラベルなし / GAM-n 以外のコミット）は **patch**。**major は自動では上げない**（`workflow_dispatch` の入力 `release: major` で人が指定） | ゲームの遊びが増えたら minor、それ以外は patch。後方互換を壊す API があるわけではないので major の基準は機械的に決められない（確認事項 Q2） |
| タイミング | **デプロイ成功後のみ**。`deploy.yml` に `needs: deploy` の `release` ジョブを追加 | `workflow_run` で別ワークフローにする案は、merge-gate が GITHUB_TOKEN で起動したデプロイの完了で発火するかが不確かなため採らない。`needs` なら deploy 失敗時は自動でスキップされる |
| CHANGELOG の出典 | **前回タグ..今回のコミット（`git log --first-parent`）の件名にある `GAM-n`** を集め、Linear からタイトル・URL・ラベルを引く | 「前回タグ以降に Done になった Issue」を Linear で探す案は、(1) GitHub 連携の Done 遷移がデプロイと競合して漏れる・二重に載る、(2) コードを伴わずに Done にした Issue も載る、ため採らない。コミット範囲なら「実際にデプロイした内容」と一致し、範囲が重ならない。Linear の状態（Done かどうか）では絞らない（確認事項 Q4） |
| CHANGELOG の置き場所 | **GitHub Release の本文のみ**。`CHANGELOG.md` はリポジトリにコミットしない | bot が main に push するのは CLAUDE.md の「main への直接 push 禁止」に触れ、ブランチ保護とも衝突する。PR で更新する案は毎回人のマージが要り、マージするとそのコミットが次の CHANGELOG に載るので循環する（確認事項 Q1） |
| タグの作り方 | `gh release create <tag> --target <sha>` の 1 回の API 呼び出しで **タグと Release を同時に** 作る | `git tag` + `git push --tags` + Release 作成の 3 段にすると、途中で取り消されたときに「タグだけある」状態が残る |
| 冪等性 | (1) 対象コミットに既に `v*` タグがあれば何もしない（`already-tagged`）。(2) 計算したタグ名が別のコミットに既にあれば失敗（`tag-exists`、上書きしない）。(3) Linear の取得に失敗したらタグを作らずに失敗する | 失敗・取り消しで作られなかった分は、次のデプロイで「前回タグ..今回」の範囲に自然に含まれる（自己修復） |
| 権限 | ワークフロー全体は `contents: read` のまま。**release ジョブだけ** `permissions: { contents: write }` | deploy ジョブに書き込み権限を渡さない |

### 変更ファイル一覧
| ファイル | 種別 | 内容 |
|---|---|---|
| `scripts/release/changelog.mjs` | 新規 | 純粋関数（I/O・`process`・`git`・`gh`・`fetch` を使わない）。定数もここに置く |
| `scripts/release/changelog.d.mts` | 新規 | 上記の型宣言 |
| `scripts/release/release.mjs` | 新規 | CLI。`git` / `gh` / Linear / Slack の入出力と終了コードだけ。判断はすべて `changelog.mjs` に委ねる |
| `.github/workflows/deploy.yml` | 変更 | `workflow_dispatch` に入力 `release` を追加、deploy ジョブに `outputs.page_url` を追加、`release` ジョブを末尾に追加。deploy ジョブの既存ステップは変えない |
| `tests/unit/release.test.ts` | 新規 | AC-1〜12 |
| `tests/unit/release-workflow.test.ts` | 新規 | AC-13（GAM-7 の `workflows.test.ts` には追記しない。並行 Issue との衝突を避けるため） |
| `docs/release.md` | 新規 | バージョニング規則、手動で major / none を指定する方法、dry-run の使い方、失敗時の対処 |
| `docs/notifications.md` | 変更 | 表に「リリース作成 🏷️ / リリース失敗 ⚠️ — `deploy.yml`」の 2 行を追加 |

`package.json` の `version` は変更しない（以後のバージョンの正はタグ。確認事項 Q6）。`scripts/linear.mjs` も変更しない（`gql` と `TEAM_KEY` を import して使う）。

### `scripts/release/changelog.d.mts`
```ts
export type Category = 'feature' | 'improvement' | 'bug' | 'other';
export type Bump = 'major' | 'minor' | 'patch';
export type BumpOverride = 'auto' | Bump | 'none';
export interface Semver { major: number; minor: number; patch: number }
export interface Commit { sha: string; subject: string }
export interface IssueGroup { identifier: string; number: number; prNumbers: number[]; shas: string[]; subject: string }
export interface OtherCommit { sha: string; subject: string; prNumber: number | null }
export interface CommitGroups { issues: IssueGroup[]; others: OtherCommit[] }
export interface IssueMeta { identifier: string; title: string; url: string; labels: string[] }
export interface ChangelogEntry {
  category: Category; identifier: string | null; number: number | null;
  title: string; url: string | null; prNumbers: number[];
}
export type ReleaseDecision =
  | { action: 'create'; tag: string; prevTag: string | null; bump: Bump }
  | { action: 'skip'; reason: 'already-tagged'; tag: string }
  | { action: 'skip'; reason: 'no-changes' | 'bump-none' }
  | { action: 'error'; reason: 'tag-exists'; tag: string };

/** 'v' */
export const TAG_PREFIX: string;
/** 200 */
export const TITLE_MAX: number;
/** ['feature', 'improvement', 'bug', 'other'] */
export const CATEGORY_ORDER: readonly Category[];
/** { feature: '新機能', improvement: '改善', bug: '不具合修正', other: 'その他' } */
export const CATEGORY_HEADINGS: Readonly<Record<Category, string>>;

export function parseSemverTag(tag: string): Semver | null;
export function latestVersionTag(tags: string[]): string | null;
export function nextVersion(prevTag: string | null, bump: Bump | null, baseVersion: string): string | null;
export function parseGitLog(text: string): Commit[];
export function groupCommits(commits: Commit[], teamKey: string): CommitGroups;
export function labelCategory(labels: string[]): Category;
export function buildEntries(groups: CommitGroups, meta: Record<string, IssueMeta | null>): ChangelogEntry[];
export function decideBump(entries: ChangelogEntry[], override: BumpOverride): Bump | null;
export function sanitizeTitle(s: string): string;
export function renderReleaseNotes(input: {
  tag: string; prevTag: string | null; date: string; sha: string;
  repo: string; pageUrl: string; entries: ChangelogEntry[];
}): string;
export function decideRelease(input: {
  headTags: string[]; mergedTags: string[]; existingTags: string[];
  entries: ChangelogEntry[]; baseVersion: string; override: BumpOverride;
}): ReleaseDecision;
```
仕様の補足:
- `parseSemverTag`: 正規表現 `^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$`。プレリリース・ビルドメタデータは扱わない
- `nextVersion`: `baseVersion` は `v` なしの `x.y.z`（`parseSemverTag('v' + baseVersion)` で検証）。minor は patch を 0 に、major は minor と patch を 0 にする
- `groupCommits`: Issue の判定は `new RegExp('^' + teamKey + '-([1-9]\\d*)(?=[:\\s]|$)')`（`teamKey` は英大文字のみを想定。それ以外が来たら例外）。`^Revert "` で始まる件名は先に `others` へ。PR 番号は件名末尾の `\(#(\d+)\)\s*$`。同じ Issue の 2 件目以降は `prNumbers`（重複なし・登場順）と `shas` に追記する
- `buildEntries`: Issue → `others` の順に並べる。`meta` がある Issue は `title: sanitizeTitle(meta.title)`、`url: meta.url`、`category: labelCategory(meta.labels)`。ない Issue と `others` は件名から ID 接頭辞（`GAM-n` と直後の `:`・空白）と末尾の ` (#n)` を取り除いて `sanitizeTitle` したものを `title` にし、`category: 'other'`、`url: null`
- `decideBump`: `override` が `BumpOverride` 以外なら例外。`entries` が空なら常に `null`
- `decideRelease`: 判定順は (1) `headTags` に `parseSemverTag` が通るタグ → `already-tagged`（複数あれば `latestVersionTag`）、(2) `entries` が空 → `no-changes`、(3) `decideBump` が `null` → `bump-none`、(4) `prevTag = latestVersionTag(mergedTags)`、`tag = nextVersion(prevTag, bump, baseVersion)`、(5) `existingTags` に `tag` → `tag-exists`、(6) `create`
- 定数は `src/core/config.ts` ではなくこのモジュールに置く（ゲームの定数ではないため。GAM-7 と同じ方針）

### Release 本文の例（AC-10 の入力と期待値）
入力:
```js
{
  tag: 'v1.1.0', prevTag: 'v1.0.0', date: '2026-11-03',
  sha: '0123456789abcdef0123456789abcdef01234567',
  repo: 'zawa929292/pixel-runner', pageUrl: 'https://zawa929292.github.io/pixel-runner/',
  entries: [
    { category: 'other', identifier: null, number: null, title: 'Re-register scheduled workflows', url: null, prNumbers: [5] },
    { category: 'feature', identifier: 'GAM-10', number: 10, title: 'ハイスコア保存', url: 'https://linear.app/pixel/issue/GAM-10', prNumbers: [12] },
    { category: 'feature', identifier: 'GAM-2', number: 2, title: '障害物の生成', url: 'https://linear.app/pixel/issue/GAM-2', prNumbers: [4, 8] },
    { category: 'bug', identifier: 'GAM-9', number: 9, title: '着地判定のずれ', url: 'https://linear.app/pixel/issue/GAM-9', prNumbers: [11] },
    { category: 'other', identifier: 'GAM-11', number: 11, title: 'Sentry 連携', url: null, prNumbers: [] },
  ],
}
```
期待値（各行末に空白なし。末尾は改行 1 つ）:
```markdown
## v1.1.0 — 2026-11-03

### 新機能
- [GAM-2](https://linear.app/pixel/issue/GAM-2) 障害物の生成 (#4, #8)
- [GAM-10](https://linear.app/pixel/issue/GAM-10) ハイスコア保存 (#12)

### 不具合修正
- [GAM-9](https://linear.app/pixel/issue/GAM-9) 着地判定のずれ (#11)

### その他
- GAM-11 Sentry 連携
- Re-register scheduled workflows (#5)

---
- コミット: `0123456789abcdef0123456789abcdef01234567`
- 差分: https://github.com/zawa929292/pixel-runner/compare/v1.0.0...v1.1.0
- デプロイ: https://zawa929292.github.io/pixel-runner/
```
（`改善` の項目がないので見出しも出ない。見出しと見出しの間は空行 1 つ。PR 番号は GitHub が Release 本文で自動リンクする）

### `scripts/release/release.mjs`（CLI。判断は書かない）
引数: `--dry-run`。環境変数: `RELEASE_SHA`（dry-run では省略可、既定 `git rev-parse HEAD`）、`RELEASE_BUMP`（既定 `auto`）、`REPO`（dry-run では省略可、既定 `local/pixel-runner`）、`PAGE_URL`（任意）、`LINEAR_API_KEY`、`GH_TOKEN`、`SLACK_WEBHOOK_URL`。
1. `git rev-parse HEAD` が `RELEASE_SHA` と違えば exit 1（ビルドしたコミット以外にタグを付けない）
2. `git fetch --tags --force origin`
3. `headTags = git tag --points-at RELEASE_SHA`、`mergedTags = git tag --merged RELEASE_SHA`、`existingTags = git tag --list`
4. `prevTag = latestVersionTag(mergedTags)`。範囲は `prevTag ? prevTag..RELEASE_SHA : RELEASE_SHA`。`git log --reverse --first-parent --format=%H%x09%s <範囲>` → `parseGitLog` → `groupCommits(commits, TEAM_KEY)`
5. `headTags` にバージョンタグがあれば Linear を呼ばずに 6 へ（`entries: []` で `decideRelease` を呼べば `already-tagged` になる）。それ以外は Linear から Issue の情報を 1 回のクエリで取る（下記）。`LINEAR_API_KEY` がない場合、dry-run なら `release: offline (LINEAR_API_KEY is not set)` を出して全 Issue を `null` として続行、dry-run でなければ exit 1。API エラーは exit 1（タグを作らない）
6. `buildEntries` → `decideRelease`
   - `skip` → `release: skip <reason>[ <tag>]` を出して exit 0
   - `error` → `release: error tag-exists <tag>` を出して exit 1
   - `create` → `renderReleaseNotes`（`date` は `Asia/Tokyo` の `YYYY-MM-DD`）。dry-run なら `release: plan create <tag> (bump=<bump>, prev=<prevTag ?? 'none'>)` と本文を出して exit 0。そうでなければ本文を `os.tmpdir()` の一時ファイルに書き、`gh release create <tag> --target <RELEASE_SHA> --title <tag> --notes-file <file> --latest` を実行し、`release: created <tag>` を出す。`notifySlack('🏷️ *リリース <tag>* — <Release の URL>')`。`GITHUB_STEP_SUMMARY` があれば本文を追記
- `git` / `gh` は `execFileSync(cmd, [...args])`（配列引数。シェルを通さない）。Linear のタイトルはコマンド引数に入れず、ファイル経由で渡す
- Linear のクエリ（`scripts/linear.mjs` の `gql` を使う。100 件ずつに分ける）:
  ```graphql
  query($team: String!, $numbers: [Float!]) {
    issues(first: 100, filter: { team: { key: { eq: $team } }, number: { in: $numbers } }) {
      nodes { identifier title url labels { nodes { name } } }
    }
  }
  ```
  返ってこなかった番号は `meta` に `null` を入れる（削除・別チームの Issue）。`number` の型は実装時に Linear のスキーマで確認する
- ログの文言（`release: …`）は AC-14〜16 の判定に使うので変えない

### `deploy.yml` の変更
```yaml
on:
  push:
    branches: [main]
  workflow_dispatch:
    inputs:
      release:
        description: 'リリースの上げ方（auto = ラベルから決定 / none = リリースしない）'
        type: choice
        options: [auto, patch, minor, major, none]
        default: auto
# permissions と concurrency は変更しない（contents: read のまま）
jobs:
  deploy:
    # 既存のまま。次の 1 行だけ追加
    outputs: { page_url: '${{ steps.deployment.outputs.page_url }}' }
    ...
  release:
    needs: deploy
    runs-on: ubuntu-latest
    timeout-minutes: 10
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0, fetch-tags: true }
      - uses: actions/setup-node@v4
        with: { node-version: 22 }   # GAM-6 が先にマージされていれば deploy ジョブと同じ node-version-file: .nvmrc にする
      - run: node scripts/release/release.mjs
        env:
          RELEASE_SHA: ${{ github.sha }}
          RELEASE_BUMP: ${{ inputs.release || 'auto' }}
          REPO: ${{ github.repository }}
          PAGE_URL: ${{ needs.deploy.outputs.page_url }}
          GH_TOKEN: ${{ github.token }}
          LINEAR_API_KEY: ${{ secrets.LINEAR_API_KEY }}
          SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK_URL }}
      - if: failure()
        run: node scripts/slack.mjs "⚠️ *リリース作成に失敗*（デプロイは完了済み）— $GITHUB_SERVER_URL/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID"
        env:
          SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK_URL }}
```
- `npm ci` は不要（`scripts/release/*.mjs` と `scripts/linear.mjs`・`scripts/slack.mjs` は Node 標準の機能だけを使う）
- push イベントでは `inputs.release` が空なので `auto`。merge-gate の `gh workflow run deploy.yml --ref main`（入力なし）も既定の `auto` になる。`scripts/linear-merge-gate.mjs` は変更しない
- release ジョブが失敗しても Pages のデプロイは完了している。ワークフローの実行は失敗表示になるが、merge-gate はデプロイ結果を見ないので開発フローは止まらない

### `docs/release.md` の内容
- タグ形式・バージョンの上げ方（上記「方式の決定」の表の要約）
- 手動で上げ方を指定する: `gh workflow run deploy.yml --ref main -f release=major`（`none` でリリースなし）。デプロイもやり直されることを明記
- 手元で確かめる: `node scripts/release/release.mjs --dry-run`（`LINEAR_API_KEY` なしでも可。その場合ラベルは使われず全件 patch 扱い）
- 失敗時: `tag-exists` は人がタグを確認する。Linear の障害などで作れなかった分は次のデプロイの Release にまとめて載る

## テスト計画
- Unit: `tests/unit/release.test.ts` — AC-1〜12。`import { … } from '../../scripts/release/changelog.mjs'`（型は `changelog.d.mts` で解決。`tsconfig.json` は変更しない）
  - AC-5 は入力を `structuredClone` で控え、関数呼び出し後に deep equal を確かめる
  - AC-9 のゼロ幅スペースは `'​'` で書く
  - AC-10 は期待値をテンプレート文字列で全文書き、`toBe` で比較する
- Unit: `tests/unit/release-workflow.test.ts` — AC-13。`readFileSync` / `readdirSync` を使う（YAML パーサーは追加しない）
- CI: AC-14・17 はオーケストレーターが PR 作成前後に実施、AC-15・16 は GAM-12 のマージ後に実施し、進捗ノートに `### <日時> [orchestrator] AC-15 PASS — <run URL> <release URL>` の形で記録する
- E2E: なし（`tests/e2e/` は変更しない）
- `npm run verify` が green であること

## 影響範囲・リスク
- **並行 Issue との衝突（`deploy.yml`）**: GAM-6 が deploy ジョブの `setup-node` を `.nvmrc` 参照に変える。本 Issue は deploy ジョブに `outputs` 1 行を足し、末尾に release ジョブを足すだけなので、ハンクは別になり自動マージできる見込み。ただし後からマージする側が、release ジョブの `setup-node` も `.nvmrc` 参照にそろえる（GAM-6 に「全 setup-node が `.nvmrc` を参照する」静的テストがあれば、後勝ちの側で必ず直す）。AC-13 は `setup-node` の書き方を検査しないので GAM-6 とは衝突しない
- **GAM-11（Sentry）の release 名**: Sentry の release はビルド時（deploy ジョブ）に決める必要があるが、本設計のバージョンはデプロイ後に決まる。暫定案として GAM-11 は release 名にコミット SHA（例 `pixel-runner@<github.sha>`）を使い、Release 本文の `コミット:` 行で対応を取れるようにする（確認事項 Q7）
- **`docs/notifications.md`**: 他の並行 Issue も通知の行を追加する可能性がある。表への行追加だけなので衝突しても解決は容易
- **初回リリースの範囲**: タグがないので、初回の `v1.0.0` には main の全履歴（GAM-1 以降と GAM-12 自身）が載る
- **concurrency による取り消し**: `deploy.yml` はワークフロー全体で `cancel-in-progress: true`。連続でデプロイが起動すると、前の実行の release ジョブが取り消されることがある。タグと Release は 1 回の API 呼び出しで作るので中途半端な状態は残らず、取り消された分は次の Release にまとめて載る
- **Linear の可用性**: Linear の障害・キー失効ではタグが作られない（fail-closed）。デプロイ自体は成功する。Slack に失敗通知が出る
- **タグの保護ルール**: リポジトリにタグの保護（rulesets）を設定すると、GITHUB_TOKEN でタグが作れなくなる。現状は未設定の前提（確認事項 Q8）
- **revert**: `Revert "GAM-n: …"` は「その他」に載るだけで、元の Issue の項目は消えない（同じ範囲に両方ある場合も両方載る）
- **package.json の version**: `1.0.0` のまま残り、タグとずれていく。ゲーム内でバージョンを表示する機能はないので実害はない
- **ハーネス変更の警告**: `deploy.yml` を変更するので、GAM-7 の security-gate の総評にハーネス変更の警告が出る（想定どおり）

## 確認事項（人間に判断してほしいこと。暫定案で設計済み）
1. **Q1 CHANGELOG.md をリポジトリに置くか**: 暫定は「置かない。GitHub Release の本文を CHANGELOG とする」。bot が main に直接 push するのは CLAUDE.md の禁止事項（main への直接 push）とブランチ保護に触れるため。ファイルが必要なら、(a) リリースのたびに bot が `CHANGELOG.md` 更新の PR を作り人がマージする、(b) GitHub Releases から `CHANGELOG.md` を手元で生成するスクリプトを用意する、のどちらかを別 Issue にする（推奨は (b)）
2. **Q2 バージョンの上げ方**: `Feature` が 1 件でもあれば minor、それ以外は patch、major は手動指定のみ、でよいか。`[Ops]` / `[Harness]` など開発基盤だけのデプロイでも patch を上げてよいか（暫定: 上げる。デプロイ = リリースとして 1 対 1 にする）
3. **Q3 ラベル名**: `docs/linear-setup.md` は `feature` / `bug` / `refactor`、Linear の実際の Issue には `Feature` / `Improvement` / `Bug` が使われている。本設計は大文字小文字を無視して `feature` → 新機能、`bug` → 不具合修正、`improvement`・`refactor` → 改善、とした。実際に使っているラベルの一覧を教えてほしい。あわせて `docs/linear-setup.md` のラベル表を本 Issue で更新するか（暫定: しない。別 Issue）
4. **Q4 「Done Issue から」の解釈**: Issue 本文は「Linear の Done Issue から CHANGELOG を生成」だが、本設計は「デプロイしたコミット範囲にある `GAM-n`」を出典にし、Linear はタイトル・ラベルの取得にだけ使う（Done かどうかでは絞らない）。マージ直後は Linear の Done 遷移が間に合わないことがあり、状態で絞ると漏れるため。これでよいか
5. **Q5 初回リリース**: タグがないので初回は `v1.0.0`（全履歴を掲載）とする。過去のマージ（GAM-1, 2, 7）に遡ってタグを付けることはしない、でよいか
6. **Q6 package.json の version**: タグを正とし、`package.json` は `1.0.0` のまま更新しない（bot が main に push しないため）、でよいか。`version` を `0.0.0-dev` などに変えて「タグが正」と明示する案もある（暫定: 変えない）
7. **Q7 GAM-11（Sentry）との揃え方**: 暫定は「Sentry の release はコミット SHA、GitHub Release 本文に SHA を記載」。Sentry の release もタグ名（`v1.1.0`）にそろえたい場合は、バージョン計算を deploy ジョブの前の `plan` ジョブに移し、その出力をビルドと release の両方に渡す必要がある（Linear の障害時にデプロイを止めない工夫が要るので、本 Issue の範囲を超える。GAM-11 のマージ後に別 Issue を推奨）
8. **Q8 タグの保護**: GitHub の rulesets で `v*` タグを保護していないことを確認してほしい。保護する場合は GitHub App のトークンなど別の認証が必要になる
9. **Q9 マージ後に確かめる AC**: AC-15・16 は main へのマージとデプロイの後でしか確かめられない。マージ時点で Issue は Done になるので、オーケストレーターがマージ後に確認して進捗ノートと Linear にコメントし、失敗したら新しい Issue を起票する運用でよいか（暫定: そうする。マージ前は AC-14 の dry-run で代替する）
10. **Q10 Release 本文の言語と内容**: 見出しを日本語（新機能 / 改善 / 不具合修正 / その他）にし、GAM-n 以外のコミット（`Harness: …` など）も「その他」に載せる、でよいか（暫定: 載せる。デプロイ内容を漏れなく残すため）

分割は不要と判断した（純粋関数のスクリプト 1 本とテスト、CLI 1 本、`deploy.yml` へのジョブ追加、ドキュメントで 1 Issue に収まる）。Q1 の CHANGELOG.md、Q7 の Sentry との統合は必要なら別 Issue にする。

## 改訂履歴
- 初版: 新規作成（人間のコメントなし）
