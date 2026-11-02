# GAM-10: [Harness] DevContainer 化

## 目的
`.devcontainer/` を追加し、Node・Playwright（chromium と OS 依存ライブラリ）・Claude Code が揃った開発環境を、誰の PC でも同じ手順で作れるようにする（実行環境の再現性）。中身は Phase 2 の GitHub Actions の実行環境（`ci.yml` / `linear-dispatch.yml`）と揃え、「ローカルでは通るのに CI では落ちる」原因を減らす。

あわせて、コンテナを実際にビルドしてその中で `npm run verify` が通ることを **GitHub Actions 上で** 確かめる仕組み（`devcontainer.yml`）を作る。開発機（WSL2）に Docker があるかは分からないため、ローカルの Docker がなくても受入条件を判定できるようにする。

ゲームの仕様（`docs/game-design.md`）、`src/`、既存のワークフローは変更しない。

### 前提（調査済みの事実）
- Actions の実行環境（2026-11-02 時点の main）
  | 項目 | `ci.yml`（verify） | `linear-dispatch.yml`（Phase 2 の実装ジョブ） |
  |---|---|---|
  | OS | `ubuntu-latest`（現在は Ubuntu 24.04） | 同左 |
  | Node | `actions/setup-node@v4`、`node-version: 22` | 同左 |
  | 依存 | `npm ci` | `npm ci` |
  | Playwright | `npx playwright install --with-deps chromium` | 同左 |
  | Claude Code | なし | `anthropics/claude-code-action@v1`（action が CLI を同梱）。認証は `secrets.CLAUDE_CODE_OAUTH_TOKEN` |
  | `CI` 環境変数 | `true`（Actions が設定） | 同左 |
- `package-lock.json` の `@playwright/test` / `playwright` / `playwright-core` はいずれも `1.64.1`。`npx playwright install` は `node_modules` の playwright を使うので、ブラウザの版は自動的に lockfile と一致する
- `playwright.config.ts` は `process.env.CI` で `retries`・`reporter`・`reuseExistingServer` を切り替える。E2E は `vite build && vite preview --port 4173` で動く。開発サーバー（`npm run dev`）は Vite 既定の 5173
- Claude Code の hook（`.claude/settings.json`）は 3 つ。いずれも `bash`・`node`・`git`（`notify-slack.sh` は `curl` も）だけを使い、パスは `$CLAUDE_PROJECT_DIR` 基準
  - `block-dangerous.sh`（PreToolUse / Bash）: 危険なコマンドなら exit 2
  - `post-edit-lint.sh`（PostToolUse / Edit|Write）: `.ts` 以外は exit 0、`.ts` は `npx eslint`
  - `notify-slack.sh`（Notification）: `SLACK_WEBHOOK_URL` か `~/.config/slack-webhook-url` がなければ何もせず exit 0
- `[ci]` タグは GAM-7 で承認済み（GitHub Actions 上で動かして確かめる AC。オーケストレーターが PR 作成後に `gh` で判定し、進捗ノートに記録する）
- implementer の書き込み範囲（`src/**`・`tests/unit/**`・`docs/game-design.md`）には `.devcontainer/`・`scripts/`・`.github/` が含まれない。GAM-7 と同様、オーケストレーターが本 spec の変更ファイルに範囲を限定して委任する想定

## 受入条件

### タグ
本 Issue は実行環境が対象で、ブラウザ上の入力・状態遷移は関係しないので `[e2e]` はなし。
- `[unit]`: `scripts/devcontainer/env-check.mjs` の純粋関数と、`devcontainer.json`・`post-create.sh`・ワークフローの静的な性質。`tests/unit/devcontainer.test.ts` の vitest で検証する（implementer 担当）
- `[ci]`: GitHub Actions 上で実際にコンテナをビルドし、その中で動かして確かめるもの。オーケストレーターが PR 作成後に `gh` / `git` の出力で判定し、PR URL・run URL・判定を `specs/GAM-10.progress.md` に記録する
- ローカルの Docker での確認は、Docker の有無が分からないため **AC にしない**（「テスト計画」の人の動作確認手順を参照。確認事項 Q2）

表記: `DC` = `.devcontainer/devcontainer.json` を `JSON.parse` したもの。`EXPECTED_NODE` = `.nvmrc` があれば `parseNodeSpec(.nvmrc の中身)`、なければ `nodeSpecFromWorkflow(ci.yml の中身)` の値。`NODE_FEATURE` = `'ghcr.io/devcontainers/features/node:1'`。

### バージョン検査の純粋関数（`scripts/devcontainer/env-check.mjs`）
| ID | Given | When | Then |
|---|---|---|---|
| AC-1 [unit] Node の版指定の解析 | `'22\n'`／`'v22.11.0'`／`' 22.11 '`／`'lts/jod'`／`''`／`'node'`／`'22.x'` | `parseNodeSpec(text)` | 順に `{ ok: true, value: { major: 22, prefix: '22' } }`／`{ major: 22, prefix: '22.11.0' }`／`{ major: 22, prefix: '22.11' }`／残り 4 つはすべて `ok === false`、`error` は空でない文字列（エイリアスやワイルドカードは扱わない） |
| AC-2 [unit] ワークフローからの Node の版 | (a) リポジトリの `.github/workflows/ci.yml` の中身／(b) `'steps:\n  - uses: actions/setup-node@v4\n    with: { node-version-file: .nvmrc }\n'`／(c) `node-version` を含まない文字列 | `nodeSpecFromWorkflow(yaml)` | (a) `ok === true` で `major` が `ci.yml` に書かれた `node-version` の値と一致（現時点では 22）。(b)(c) `ok === false` |
| AC-3 [unit] lockfile の Playwright の版 | (a) `'{"packages":{"node_modules/@playwright/test":{"version":"1.64.1"}}}'`／(b) `'{"packages":{}}'`／(c) `'not json'`／(d) リポジトリの `package-lock.json` | `playwrightVersionFromLock(text)` | (a) `{ ok: true, value: '1.64.1' }`。(b)(c) `ok === false`。(d) `ok === true` で `value` が `/^\d+\.\d+\.\d+$/` に一致（具体的な版はテストに直書きしない） |
| AC-4 [unit] コマンド出力の解析 | `parsePlaywrightVersion('Version 1.64.1\n')`／`parsePlaywrightVersion('')`／`parseClaudeVersion('2.1.3 (Claude Code)\n')`／`parseClaudeVersion('bash: claude: command not found')` | 各関数 | `'1.64.1'`／`null`／`'2.1.3'`／`null` |
| AC-5 [unit] 版の突き合わせ | 基準: `nodeSpec = { major: 22, prefix: '22' }`、`lockPlaywright = '1.64.1'`、`actual = { node: 'v22.11.0', playwright: '1.64.1', claude: '2.1.3' }`。これから 1 か所ずつ変えたもの: (a) 変更なし／(b) `actual.node = 'v20.1.0'`／(c) `nodeSpec.prefix = '22.11.0'`、`actual.node = 'v22.11.1'`／(d) `nodeSpec.prefix = '22.11'`、`actual.node = 'v22.11.1'`／(e) `nodeSpec.prefix = '22.1'`、`actual.node = 'v22.11.0'`／(f) `actual.playwright = '1.63.0'`／(g) `actual.playwright = null`／(h) `actual.claude = null` | `checkVersions({ nodeSpec, lockPlaywright, actual })` | (a)(d) `ok === true`、`mismatches` は `[]`。(b)(c)(e) `ok === false`、`mismatches` の 1 件が `'node'` を含む（(e) は前方一致を `.` 区切りで判定するため不一致）。(f)(g) `mismatches` の 1 件が `'playwright'` を含む。(h) `mismatches` の 1 件が `'claude'` を含む。全ケースで `lines` は 3 行（node / playwright / claude）で、それぞれ `OK` か `NG` を含む。入力を書き換えない |

### 設定ファイルの静的な性質（`tests/unit/devcontainer.test.ts`）
| ID | Given | When | Then |
|---|---|---|---|
| AC-6 [unit] devcontainer.json の基本構成 | `.devcontainer/devcontainer.json` を `readFileSync` | `JSON.parse`（コメントなしの厳密な JSON で書く） | 例外なく解析できる。`DC.image === 'mcr.microsoft.com/devcontainers/base:ubuntu-24.04'`、`DC.remoteUser === 'vscode'`、`DC.build` がない（Dockerfile を使わない）。`Object.keys(DC.features)` が `NODE_FEATURE`・`'ghcr.io/devcontainers/features/github-cli:1'`・`'ghcr.io/anthropics/devcontainer-features/claude-code:1'` をすべて含む。`DC.postCreateCommand === 'bash .devcontainer/post-create.sh'`。`DC.forwardPorts` が `5173` と `4173` を含む |
| AC-7 [unit] Node の版が Actions と揃っている | `DC`、`.nvmrc`（あれば）、`.github/workflows/*.yml` の全ファイル | `parseNodeSpec(DC.features[NODE_FEATURE].version)` と `EXPECTED_NODE` を比べ、各ワークフローの `node-version:` / `node-version-file:` の行を正規表現で抜き出す | `major` が `EXPECTED_NODE.major` と一致。すべてのワークフローで、`node-version:` の値の major は `EXPECTED_NODE.major` と一致し、`node-version-file:` の値は `.nvmrc`。（GAM-6 の `.nvmrc` がマージ済みなら `.nvmrc` を、未マージなら `ci.yml` を基準にする。どちらの順でマージしても成り立つ） |
| AC-8 [unit] Playwright は lockfile の版を使う | `.devcontainer/post-create.sh`、`ci.yml`、`linear-dispatch.yml`、`.devcontainer/` 配下の全ファイル、`devcontainer.yml` | 文字列検査 | `post-create.sh` に `npm ci` の行と `npx playwright install --with-deps chromium` の行がこの順にある。同じ文字列 `npx playwright install --with-deps chromium` が `ci.yml` と `linear-dispatch.yml` にもある。`.devcontainer/` 配下と `devcontainer.yml` に `playwright@` と `mcr.microsoft.com/playwright` が現れない（版を二重に書かない） |
| AC-9 [unit] シークレットをイメージ・設定に入れない | `devcontainer.json` と `post-create.sh` の文字列、`DC` | 文字列検査とキー検査 | (a) どちらにも `CLAUDE_CODE_OAUTH_TOKEN`・`ANTHROPIC_API_KEY`・`LINEAR_API_KEY`・`GH_TOKEN`・`GITHUB_TOKEN`・`sk-ant-`・`--env-file`・`.env` が現れない。(b) `DC.remoteEnv` の値はすべて `/^\$\{localEnv:[A-Z0-9_]+\}$/` に一致し、キーは `['SLACK_WEBHOOK_URL']` と等しい。(c) `DC.containerEnv` は `{ CLAUDE_CONFIG_DIR: '/home/vscode/.claude' }` と deep equal。(d) `DC.mounts` はちょうど 1 件で、`target=/home/vscode/.claude` と `type=volume` を含み、`type=bind` を含まない（ホームのディレクトリを共有しない）。(e) `DC.runArgs` がない |
| AC-10 [unit] 検証用ワークフローの性質 | `.github/workflows/devcontainer.yml` をテキストとして読む | 文字列・正規表現で検査 | (a) `devcontainers/ci@` を使い、`push: never` がある。(b) `secrets.` と `pull_request_target` が現れない。(c) `permissions` が `contents: read` のみ（`write` が現れない）。(d) `pull_request:` の `paths` に `.devcontainer/**`・`scripts/devcontainer/**`・`.github/workflows/devcontainer.yml`・`package.json`・`package-lock.json`・`.nvmrc`・`.claude/hooks/**`・`.claude/settings.json` がすべてあり、`workflow_dispatch:` がある。(e) `runCmd` の中で `node .devcontainer/check-env.mjs --expect-no-credentials` が `npm run verify` より前にある。(f) `env` に `CI=true` を渡している |

### GitHub Actions 上での確認
| ID | Given | When | Then |
|---|---|---|---|
| AC-11 [ci] コンテナ内で verify が通る | GAM-10 の PR（draft でない） | 全チェック完了まで待ち、`gh pr checks <PR> --json name,workflow,state` と `gh run view <run> --log` | `Dev Container / build-and-verify` が `SUCCESS`。ログに `check-env.mjs` の出力として `node OK`・`playwright OK <lockfile の版>`（`package-lock.json` の `packages['node_modules/@playwright/test'].version` と同じ文字列）・`claude OK`・`credentials none`・`hook block-dangerous OK`・`hook post-edit-lint OK`・`hook notify-slack OK` がある。続く `npm run verify` の vitest と Playwright の結果に失敗がない。既存の `CI / verify`・`CI / npm-audit`・`Security Review / security-gate` も `SUCCESS` |
| AC-12 [ci] 既存のハーネスを変えない | GAM-10 のブランチ | `git diff --exit-code origin/main...HEAD -- .github/workflows/ci.yml .github/workflows/linear-dispatch.yml .github/workflows/ai-review.yml .github/workflows/security-review.yml .github/workflows/linear-merge-gate.yml .claude/settings.json .claude/hooks package.json package-lock.json playwright.config.ts src` | exit 0（追加のみ。既存の設定・スクリプト・依存を変えない） |

## 設計

### 方式の比較と推奨: 汎用ベースイメージ + Features + postCreate（Dockerfile なし）
| 観点 | **A: `devcontainers/base:ubuntu-24.04` + Features（推奨）** | B: `mcr.microsoft.com/playwright:v1.64.1-noble` | C: 独自 Dockerfile にすべて焼く |
|---|---|---|---|
| Actions との一致 | OS は ubuntu-latest と同じ 24.04。Node は setup-node と同じく版を指定して入れる。Playwright は CI と**同じコマンド**で入れる | Node の版はイメージ任せ（`.nvmrc` に従えない） | 揃えられるが、CI と別の手順を保守することになる |
| Playwright の版 | `node_modules` の版を使うので lockfile と自動で一致 | イメージのタグと lockfile の 2 か所に版を書く。依存更新のたびにずれる | 同左（ビルド時に版を指定する必要がある） |
| 起動の速さ | 初回作成時に `npm ci` と chromium の取得で数分 | 速い（ブラウザ同梱） | 速い |
| 保守 | `devcontainer.json` と小さなシェル 1 本 | タグの更新が必要 | Dockerfile の保守が必要 |

起動の遅さより「CI と同じコマンドで同じ版になる」ことを優先して A にする（確認事項 Q4）。

### Actions との対応（`docs/devcontainer.md` にも同じ表を載せる）
| 項目 | Actions | DevContainer |
|---|---|---|
| OS | `ubuntu-latest`（24.04） | `mcr.microsoft.com/devcontainers/base:ubuntu-24.04` |
| Node | `setup-node` の `node-version: 22`（GAM-6 後は `.nvmrc`） | Feature `node:1` の `version`。`.nvmrc` と major が一致することを AC-7 で強制し、コンテナ内でも `check-env.mjs` で確かめる |
| 依存 | `npm ci` | `post-create.sh` で `npm ci` |
| Playwright | `npx playwright install --with-deps chromium` | `post-create.sh` で同じコマンド（AC-8） |
| Claude Code | `claude-code-action@v1` が同梱する CLI | Feature `ghcr.io/anthropics/devcontainer-features/claude-code:1`（ビルド時点の最新）。CLI の版は完全には一致しない（確認事項 Q6） |
| gh | ランナーにプリインストール | Feature `github-cli:1` |
| 認証 | `secrets.CLAUDE_CODE_OAUTH_TOKEN` | イメージにも設定ファイルにも入れない。コンテナ内で 1 回 `claude` でログインし、名前付きボリュームに保存（後述） |
| `CI` | `true` | 普段の開発では未設定（Playwright は既存サーバーを再利用）。`devcontainer.yml` では `CI=true` を渡す |

### 変更ファイル一覧
| ファイル | 種別 | 内容 |
|---|---|---|
| `.devcontainer/devcontainer.json` | 新規 | 後述。コメントを書かない厳密な JSON（AC-6 のテストで `JSON.parse` するため）。説明は `docs/devcontainer.md` に書く |
| `.devcontainer/post-create.sh` | 新規 | 後述 |
| `.devcontainer/check-env.mjs` | 新規 | CLI。版と hook の確認（後述）。判断は `env-check.mjs` に委ねる |
| `scripts/devcontainer/env-check.mjs` | 新規 | 純粋関数（AC-1〜5）。I/O・`process`・子プロセスを使わない |
| `scripts/devcontainer/env-check.d.mts` | 新規 | 型宣言（テストから import したときの型検査用。GAM-7 と同じ方式） |
| `.github/workflows/devcontainer.yml` | 新規 | コンテナをビルドして中で検証する（後述） |
| `tests/unit/devcontainer.test.ts` | 新規 | AC-1〜10 |
| `docs/devcontainer.md` | 新規 | 前提（Docker の用意）、起動手順、認証、Actions との対応表、版の更新手順 |
| `docs/workflow-graph.md` | 変更 | 「PR 上の自動チェック」の表に `Dev Container / build-and-verify` の行を追加（失敗条件: コンテナのビルド失敗・版の不一致・hook の失敗・verify 失敗。対象ファイルを変更した PR でのみ動く） |

### `.devcontainer/devcontainer.json`
```json
{
  "name": "pixel-runner",
  "image": "mcr.microsoft.com/devcontainers/base:ubuntu-24.04",
  "features": {
    "ghcr.io/devcontainers/features/node:1": { "version": "22" },
    "ghcr.io/devcontainers/features/github-cli:1": {},
    "ghcr.io/anthropics/devcontainer-features/claude-code:1": {}
  },
  "remoteUser": "vscode",
  "containerEnv": { "CLAUDE_CONFIG_DIR": "/home/vscode/.claude" },
  "remoteEnv": { "SLACK_WEBHOOK_URL": "${localEnv:SLACK_WEBHOOK_URL}" },
  "mounts": [
    "source=pixel-runner-claude-config-${devcontainerId},target=/home/vscode/.claude,type=volume"
  ],
  "postCreateCommand": "bash .devcontainer/post-create.sh",
  "forwardPorts": [5173, 4173],
  "customizations": {
    "vscode": {
      "extensions": ["dbaeumer.vscode-eslint", "ms-playwright.playwright", "anthropic.claude-code"]
    }
  }
}
```
要点:
- Node の `version` は `.nvmrc` の major と同じ値を書く。devcontainer.json はファイルの中身を参照できないので、ずれは AC-7（unit）とコンテナ内の `check-env.mjs`（AC-11）で検出する。GAM-6 で `.nvmrc` がパッチ版まで固定された場合も、Feature 側は major だけ書けばよい（`check-env.mjs` は `.nvmrc` の prefix で前方一致を見るので、パッチ版まで固定なら Feature 側も同じ値にする。AC-5 (c)(d)）
- **認証**: Claude Code の設定と認証情報は `CLAUDE_CONFIG_DIR`（= 名前付きボリューム）に置く。初回だけコンテナ内で `claude` を起動してログインすれば、コンテナを作り直しても残る。イメージ・`devcontainer.json`・リポジトリには何も入らない。ホストの `~/.claude` の bind mount は、ホストの認証情報と設定をコンテナに丸ごと渡すことになるので採らない（AC-9 (d)。確認事項 Q5）
- `SLACK_WEBHOOK_URL` はホストの環境変数をそのまま渡すだけ（ホストで未設定なら空になり、`notify-slack.sh` は何もしない）。他のシークレットは渡さない
- `${devcontainerId}` でワークスペースごとにボリュームを分ける
- `forwardPorts` は VS Code 用。devcontainer CLI だけで使う場合の注意は `docs/devcontainer.md` に書く（後述）

### `.devcontainer/post-create.sh`
```bash
#!/usr/bin/env bash
# DevContainer の作成直後に 1 回だけ実行する。手順は .github/workflows/ci.yml と揃える。
set -euo pipefail
# 名前付きボリュームは root 所有で作られるため、remoteUser が書けるようにする
sudo chown -R "$(id -u):$(id -g)" "$CLAUDE_CONFIG_DIR"
npm ci
npx playwright install --with-deps chromium
```
- `--with-deps` は apt でブラウザの依存ライブラリを入れる（`vscode` ユーザーはパスワードなしの sudo が使える）
- ワークスペースの `node_modules` はホストと共有される（bind mount）。ホストも WSL2 の Linux x64 なのでネイティブバイナリは互換だが、ホストとコンテナで Node の major が違うと問題になりうる（「影響範囲・リスク」）

### `.devcontainer/check-env.mjs`（CLI。判断は書かない）
1. 期待値: `.nvmrc` があれば `parseNodeSpec`、なければ `.github/workflows/ci.yml` を `nodeSpecFromWorkflow`。`package-lock.json` を `playwrightVersionFromLock`。どれかが `ok: false` なら理由を出して exit 1
2. 実測: `process.version`、`execFileSync('npx', ['--no-install', 'playwright', '--version'])` を `parsePlaywrightVersion`、`execFileSync('claude', ['--version'])` を `parseClaudeVersion`（コマンドが無い・失敗したら `null`）
3. `checkVersions` の `lines` を 1 行ずつ出力（例 `node OK v22.11.0 (expected 22)`、`playwright OK 1.64.1`、`claude OK 2.1.3`）
4. `--expect-no-credentials` のとき: `$CLAUDE_CONFIG_DIR/.credentials.json` が存在せず、環境変数 `CLAUDE_CODE_OAUTH_TOKEN` と `ANTHROPIC_API_KEY` が未設定または空なら `credentials none`、そうでなければ `credentials FOUND`（NG）。CI の新しいコンテナに認証情報が焼き込まれていないことの確認に使う。普段の開発では付けない
5. hook のスモークテスト（`CLAUDE_PROJECT_DIR` をリポジトリのルートにして、各 hook に stdin で JSON を渡す）:
   | 出力行 | hook | stdin | 期待 |
   |---|---|---|---|
   | `hook block-dangerous` | `.claude/hooks/block-dangerous.sh` | `{"tool_input":{"command":"git push --force origin x"}}` と `{"tool_input":{"command":"ls"}}` | 前者 exit 2、後者 exit 0 |
   | `hook post-edit-lint` | `.claude/hooks/post-edit-lint.sh` | `{"tool_input":{"file_path":"<root>/src/core/config.ts"}}` と `{"tool_input":{"file_path":"<root>/README.md"}}` | どちらも exit 0（前者は eslint が実際に走る） |
   | `hook notify-slack` | `.claude/hooks/notify-slack.sh` | `{"message":"check"}`（環境変数 `SLACK_WEBHOOK_URL` を空にし、`HOME` を一時ディレクトリにして送信させない） | exit 0 |
   - GAM-8 の監査ログ hook がマージ済みなら、GAM-8 の spec が定める入力と期待値で 1 行追加する（確認事項 Q7）
6. 1 つでも NG があれば exit 1
- 子プロセスは `execFileSync` / `spawnSync` の配列引数で呼ぶ（シェルを通さない）

### `scripts/devcontainer/env-check.mjs`（純粋関数）
`env-check.d.mts`:
```ts
export interface NodeSpec { major: number; prefix: string }
export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export function parseNodeSpec(text: string): Result<NodeSpec>;
export function nodeSpecFromWorkflow(yaml: string): Result<NodeSpec>;
export function playwrightVersionFromLock(lockJson: string): Result<string>;
export function parsePlaywrightVersion(stdout: string): string | null;
export function parseClaudeVersion(stdout: string): string | null;
export function checkVersions(input: {
  nodeSpec: NodeSpec;
  lockPlaywright: string;
  actual: { node: string; playwright: string | null; claude: string | null };
}): { ok: boolean; lines: string[]; mismatches: string[] };
```
仕様の補足:
- `parseNodeSpec`: 前後の空白を除き、`/^v?(\d+)(\.\d+){0,2}$/` に一致すれば `prefix` は先頭の `v` を除いた文字列、`major` はその先頭の数。一致しなければ失敗
- `nodeSpecFromWorkflow`: 最初の `node-version:\s*['"]?([0-9][0-9.]*)` を `parseNodeSpec` に渡す。`node-version-file` しかない／見つからない場合は失敗
- `playwrightVersionFromLock`: `JSON.parse` して `packages['node_modules/@playwright/test'].version`
- `parsePlaywrightVersion`: `/Version (\d+\.\d+\.\d+)/`。`parseClaudeVersion`: 先頭の `/(\d+\.\d+\.\d+)/`
- `checkVersions` の Node の判定: `actual.node` の先頭の `v` を除いた文字列が `prefix` と等しいか、`prefix + '.'` で始まれば一致。Playwright は文字列の完全一致。Claude は `null` でなければ一致（版は固定しない。確認事項 Q6）
- 定数はこのモジュール内に置く（ゲームの定数ではないため `src/core/config.ts` には入れない。GAM-7 と同じ扱い）

### `.github/workflows/devcontainer.yml`
```yaml
name: Dev Container
# 検証ハーネス: DevContainer をビルドし、その中で版の確認と npm run verify を行う（GAM-10）
on:
  pull_request:
    paths: &paths
      - '.devcontainer/**'
      - 'scripts/devcontainer/**'
      - '.github/workflows/devcontainer.yml'
      - 'package.json'
      - 'package-lock.json'
      - '.nvmrc'
      - '.claude/hooks/**'
      - '.claude/settings.json'
  push:
    branches: [main]
    paths: *paths
  workflow_dispatch:
permissions:
  contents: read
concurrency:
  group: devcontainer-${{ github.ref }}
  cancel-in-progress: true
jobs:
  build-and-verify:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@v4
        with: { persist-credentials: false }
      - uses: devcontainers/ci@v0.3
        with:
          push: never
          env: |
            CI=true
          runCmd: |
            node .devcontainer/check-env.mjs --expect-no-credentials
            npm run verify
```
要点:
- シークレットを一切使わない（AC-10 (b)）。コンテナ内で Claude Code は起動するだけでログインしない（`claude --version` のみ）
- `push: never` でイメージをレジストリに送らない。`devcontainers/ci` は `postCreateCommand` を実行するので、`npm ci` と chromium の取得は `post-create.sh` が行う（CI と同じ手順がコンテナ内で検証される）
- YAML のアンカー（`&paths` / `*paths`）を GitHub Actions が受け付けない場合は、同じリストを 2 回書く（AC-10 (d) は `pull_request` の paths だけを見る）
- `imageName` の指定が `devcontainers/ci` で必須だった場合は `imageName: pixel-runner-devcontainer` を加える（レジストリには送らない）
- `paths` に当たらない PR ではこのワークフローは動かない（チェック自体が出ない）。マージゲートは「無いチェック」を失敗に数えないので、通常の PR の所要時間は増えない
- 所要時間の目安はビルド 3〜6 分 + verify 2〜3 分

### `docs/devcontainer.md` に書くこと
- **前提（人が用意するもの）**: 次のどちらか
  1. Docker Desktop for Windows（Settings → Resources → WSL integration で使っている WSL2 ディストリビューションを有効化）
  2. WSL2 内に Docker Engine（docker-ce）を入れる（systemd を有効化し、ユーザーを `docker` グループに追加）
  - どちらでも、リポジトリは WSL2 のファイルシステム（`/home/...`）に置いたまま開く（`/mnt/c` は遅い）
  - VS Code + Dev Containers 拡張、または `npx @devcontainers/cli`
- **起動**: VS Code の「Reopen in Container」。CLI の場合 `npx @devcontainers/cli up --workspace-folder .` → `npx @devcontainers/cli exec --workspace-folder . bash`
- **初回の認証**: コンテナ内で `claude` を起動してログイン（ボリュームに保存され、作り直しても残る）。`gh auth login`。Linear MCP は `claude mcp add` で登録し直す（ホストの設定は持ち込まない）。シークレットを `devcontainer.json` や `.env` 経由でコンテナに渡さない
- **確認**: `node .devcontainer/check-env.mjs` → `npm run verify`
- **開発サーバー**: VS Code は `forwardPorts` で 5173 / 4173 を転送する。CLI だけで使う場合はポート転送されないので `npm run dev -- --host` と `docker` のポート公開が必要
- **版の更新手順**: Playwright は `package.json` / lockfile を更新してコンテナを作り直すだけ（DevContainer 側の変更不要）。Node は `.nvmrc` と `devcontainer.json` の `version` を同時に変える（片方だけだと AC-7 のテストが落ちる）。ベースイメージの Ubuntu は `ubuntu-latest` が次の LTS に変わったら追随する
- Actions との対応表（上記）

## テスト計画
- Unit: `tests/unit/devcontainer.test.ts` — AC-1〜10
  - `import { … } from '../../scripts/devcontainer/env-check.mjs'`（型は `env-check.d.mts` で解決。`tsconfig.json` の `include` は変更しない）
  - AC-6〜10 は `readFileSync` でファイルを読み、文字列・正規表現・`JSON.parse` で検査する（YAML パーサーは追加しない。GAM-7 の `workflows.test.ts` と同じ方式）
  - AC-7 は `.nvmrc` の有無で基準を切り替える。どちらの分岐を通ったかをテスト名かメッセージに出す
  - 既存の `tests/unit/workflows.test.ts` の AC-14 (a)（全ワークフローに `pull_request_target` がない）は `devcontainer.yml` にも適用される
- CI: AC-11・12 はオーケストレーターが PR 作成後に実施し、進捗ノートに `### <日時> [orchestrator] AC-11 PASS — <PR URL> <run URL>` の形で記録する。AC-11 が失敗した場合は通常の修正反復（最大 5 回、同じ失敗シグネチャ 2 連続で停止）に数える。シグネチャ例 `ci:devcontainer.yml:AC-11:PlaywrightDepsInstall`
- E2E: なし（既存の `tests/e2e/` は変更しない）
- `npm run verify` が green であること（ホスト上でも従来どおり通る）
- **人の動作確認（任意。AC ではない）**: Docker を用意したあと、`docs/devcontainer.md` の手順でコンテナを作り、`node .devcontainer/check-env.mjs` と `npm run verify` が通ること、コンテナ内の `claude` でログインして hook（例: `git push --force` がブロックされる）が動くこと、`npm run dev` の画面がホストのブラウザで開けることを確かめる。結果は Linear にコメントしてもらう

## 影響範囲・リスク
- **GAM-6 とのマージ順**: GAM-6 が `.nvmrc` で Node 22 を固定する。**GAM-6 → GAM-10 の順が自然**（GAM-10 の AC-7 と `check-env.mjs` が最初から `.nvmrc` を基準にできる）。GAM-10 が先にマージされても `ci.yml` を基準に成り立ち、GAM-6 のマージ後は自動的に `.nvmrc` 基準に切り替わる。ただし GAM-6 が `.nvmrc` をパッチ版まで固定する（例 `22.11.0`）なら、`devcontainer.json` の `version` も同じ値にしないと `check-env.mjs` が NG になる。後からマージする側の PR で揃える。また GAM-6 が `ci.yml` を `node-version-file` に変えても、AC-12 は `origin/main` との差分なので衝突しない（GAM-10 は既存ワークフローを変えない）
- **GAM-8 とのマージ順**: GAM-8 の監査ログ hook がコンテナ内で動くには、(1) hook が使うコマンド（`jq` など）がベースイメージにあること、(2) ログの書き込み先がコンテナを作り直しても消えない場所（`$CLAUDE_PROJECT_DIR` 配下＝ホストと共有、または `CLAUDE_CONFIG_DIR` のボリューム）であること、が必要。`~/` 直下など他の場所に書くと、コンテナの作り直しでログが消える。`devcontainer.yml` の `paths` に `.claude/hooks/**` を入れているので、GAM-8 の PR でもこのチェックが動き、コンテナ内で hook が動かなければ検出できる（スモークテストの行を足した場合）
- **Claude Code の版**: Feature はビルド時点の最新を入れ、`claude-code-action@v1` の同梱版とは一致しない。CLI の挙動差でローカルと Actions の結果が変わる可能性は残る
- **ubuntu-latest の追随**: `ubuntu-latest` が次の LTS に切り替わると、イメージの `ubuntu-24.04` とずれる。AC-6 はイメージ名を固定しているので、追随はテストの期待値ごと変える
- **初回作成の遅さ**: 作成のたびに `npm ci` と chromium（と apt の依存）を取得するので数分かかる
- **`node_modules` の共有**: ワークスペースは bind mount なので、コンテナの `npm ci` はホストの `node_modules` を作り直す。ホストとコンテナで Node の major が違うと、ネイティブ依存が片方で動かない可能性がある（`.nvmrc` に揃えていれば問題ない）
- **`.env` はコンテナからも見える**: ワークスペースをそのまま共有するため。`block-dangerous.sh` と `settings.json` の deny はコンテナ内の Claude Code にも同じく効く（リポジトリの `.claude/settings.json` を使うため）。ただし `.claude/settings.local.json`（gitignore 済み）はホストと共有される
- **書き込み範囲**: 変更ファイルの大半が implementer の書き込み範囲の外（`.devcontainer/`・`scripts/`・`.github/`・`docs/devcontainer.md`）。GAM-7 と同じく、オーケストレーターが本 spec の変更ファイル一覧に範囲を限定して委任する
- **Actions の利用時間**: `paths` で絞るので、通常の PR では増えない。対象ファイルを変える PR では 1 回 5〜10 分増える

## 確認事項（人間に判断してほしいこと。暫定案で設計済み）
1. **Q1 Docker の用意（前提条件）**: Issue に「Docker 導入後」とあるが、開発機（WSL2）に Docker があるかは不明。どちらを用意するか決めてほしい: (a) Docker Desktop for Windows + WSL integration、(b) WSL2 内に Docker Engine（docker-ce）。（暫定: どちらでも動く手順を `docs/devcontainer.md` に書く。個人利用なら (a) が手軽、Docker Desktop のライセンス条件を避けたいなら (b)）。**本 Issue の AC はローカルの Docker がなくても判定できる**（コンテナのビルドと verify は Actions で確認する）ので、Docker の用意を待たずに実装に進めてよいか
2. **Q2 ローカルでの確認を AC にするか**: ローカルでコンテナを作って verify が通ることは、Docker の有無が分からないので AC にせず「人の動作確認（任意）」にした。Docker を用意した後に人が確認してコメントする、でよいか（暫定: はい。AI が Docker を使えるようになったら、別 Issue で `[local]` のような手段を検討する）
3. **Q3 「Phase 2 の Actions 実行環境と揃える」の範囲**: 本設計は「DevContainer の中身を Actions の手順（OS・Node・`npm ci`・Playwright のコマンド）に揃え、ずれをテストで検出する」解釈にした。逆に「Actions（`ci.yml` / `linear-dispatch.yml`）の実行自体を DevContainer の中で行う」まで含めるか（暫定: 含めない。CI が毎回コンテナをビルドして遅くなるため。必要なら別 Issue）
4. **Q4 ベースイメージ**: Playwright 公式イメージ（速いが、版を lockfile と二重管理し、Node の版を選べない）ではなく、汎用の `devcontainers/base:ubuntu-24.04` + Features にした。これでよいか
5. **Q5 Claude Code の認証**: コンテナ内で 1 回ログインし、名前付きボリューム（`CLAUDE_CONFIG_DIR`）に保存する案にした。代わりに (a) ホストの `~/.claude` を bind mount して共有する、(b) ホストの環境変数 `CLAUDE_CODE_OAUTH_TOKEN` を `remoteEnv` で渡す、のどちらかを望むか（暫定: どちらも採らない。(a) はホストの認証情報と設定がコンテナに丸ごと入る。(b) はホストで未設定のとき空文字の環境変数が入り、ログイン済みの認証を妨げる可能性がある）。`gh` の認証・Linear MCP の登録もコンテナ内でやり直す前提でよいか
6. **Q6 Claude Code の版**: Feature はビルド時点の最新を入れる（`claude-code-action@v1` の同梱版とは一致しない）。版を固定するか（暫定: 固定しない。`check-env.mjs` は「入っていること」だけ確かめる）
7. **Q7 GAM-8 の監査ログ hook**: GAM-8 の hook が使うコマンドとログの書き込み先を、コンテナ内でも動くように決めてほしい（暫定の要望: 依存は `bash`・`node`・`git` の範囲、書き込み先は `$CLAUDE_PROJECT_DIR` 配下）。GAM-8 が先にマージされた場合、`check-env.mjs` のスモークテストにその hook の行を追加するのは GAM-10 の実装に含める（暫定: 含める。GAM-10 が先なら GAM-8 側で追加する）
8. **Q8 `devcontainer.yml` の実行タイミング**: 対象ファイルを変えた PR・main への push・手動実行だけで動かす案にした。ベースイメージや Feature の更新で壊れていないかを定期的に確かめる `schedule`（例 週 1 回）を加えるか（暫定: 加えない）
9. **Q9 Action の固定**: `devcontainers/ci@v0.3` はタグ指定。既存のワークフローに合わせてタグにしたが、コミット SHA で固定するか（暫定: タグ）
10. **Q10 CLAUDE.md への追記**: 「参照すべきドキュメント」に `docs/devcontainer.md` を 1 行足すか（暫定: 足さない。CLAUDE.md の変更は人が判断する。`docs/workflow-graph.md` の表への追記のみ行う）

分割は不要と判断した（設定ファイル 2 本、確認用スクリプト 2 本とテスト、ワークフロー 1 本、ドキュメントで 1 Issue に収まる）。Q3 で「Actions を DevContainer の中で動かす」まで含める場合は別 Issue に分けることを推奨する。

## 改訂履歴
- 初版: 新規作成（人間のコメントなし）
