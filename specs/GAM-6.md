# GAM-6: [Harness] Node バージョンと実行環境の固定

## 目的
ローカル・CI・デプロイで使う Node のバージョンを、リポジトリ内の 1 か所（`.nvmrc`）で決める。現在はワークフロー 6 ファイルの 7 か所に `node-version: 22` が直接書かれていて、ローカルの Node はどこにも決められていない。対応後は次の状態にする。
- `.nvmrc` だけを書き換えれば、全ワークフローの Node が変わる
- 対応範囲外の Node では `npm ci` / `npm install` が失敗し、早い段階で気付ける
- CI が実際に Node 22 で動いていることをテストで確かめる

ゲームの仕様（`docs/game-design.md`）、`src/`、既存のテストは変更しない。

### 前提（調査済みの事実。main `38cf10e` 時点）
- ローカルの Node は v22.23.1。`.nvmrc` / `.node-version` / `.npmrc` / `.tool-versions` はない。`package.json` に `engines` はない
- `package-lock.json` は `lockfileVersion: 3`。依存のうち Node の下限がいちばん高いのは ESLint 10 系（`^20.19.0 || ^22.13.0 || >=24`）。Vite 8 系（rolldown）は `^20.19.0 || >=22.12.0`、Playwright は `>=20`。つまり Node 22 系では **22.13.0 以上** が必要
- `actions/setup-node` を使っている箇所（全 7 か所。すべて `@v4`、`node-version: 22`）

| ファイル | ジョブ | 現在の `with` | 起動のきっかけ |
|---|---|---|---|
| `ci.yml` | `verify` | `{ node-version: 22, cache: npm }` | PR / main への push |
| `ci.yml` | `npm-audit` | `{ node-version: 22 }` | PR / main への push |
| `deploy.yml` | `deploy` | `{ node-version: 22, cache: npm }` | main への push / 手動 |
| `linear-dispatch.yml` | `implement` | `{ node-version: 22, cache: npm }` | 手動のみ（schedule はコメントアウト） |
| `linear-merge-gate.yml` | `gate` | `{ node-version: 22 }` | cron（10 分ごと） / 手動 |
| `linear-notify.yml` | `notify` | `{ node-version: 22 }` | cron（5 分ごと） / 手動 |
| `security-review.yml` | `report`（security-gate） | `{ node-version: 22 }`。直前の checkout が `sparse-checkout: scripts/security-review` | PR |

- `setup-node` を使っていないワークフロー: `ai-review.yml`、`security-review.yml` の `audit` ジョブ。どちらも `anthropics/claude-code-action@v1` だけを使い、action が自前の実行環境を持つ。本 Issue の対象外
- `actions/checkout@v4` の `sparse-checkout` は既定で cone モード（`sparse-checkout-cone-mode: true`）。cone モードではリポジトリ直下のファイルは常にチェックアウトされるので、`security-gate` ジョブでも `.nvmrc` は作業ツリーにある

## 受入条件

### タグ
- `[unit]`: 設定ファイルをテキスト / JSON として静的に検査するものと、テストを実行している Node 自体の検査。`tests/unit/node-version.test.ts` の vitest で検証する（implementer 担当）
- `[ci]`: GAM-7 で承認されたタグ。実際に動かして確かめるもの。`gh` / `git` / `npm` の出力で機械的に判定する。オーケストレーターが PR 作成後（AC-11 はマージ後）に実施し、結果（PR URL・run URL・判定）を `specs/GAM-6.progress.md` に記録する。AC-9 だけは GitHub Actions ではなくオーケストレーターの手元で実行する（確認事項 Q6）
- `[e2e]`: なし（ブラウザの挙動は変わらない）

表記: `NVMRC` = リポジトリ直下の `.nvmrc` の中身、`PKG` = `package.json` を `JSON.parse` したもの、`LOCK` = `package-lock.json` を `JSON.parse` したもの、`WF(name)` = `.github/workflows/<name>` のテキスト。ファイルはすべて `node:fs` で読む（YAML パーサーは追加しない）。

### バージョンの定義
| ID | Given | When | Then |
|---|---|---|---|
| AC-1 [unit] `.nvmrc` の書式 | リポジトリ直下の `.nvmrc` | テキストとして読む | 中身はちょうど `'22\n'`（`v` を付けない。末尾の改行 1 つ。ほかの行・空白・コメントなし） |
| AC-2 [unit] `engines` | `PKG` | `PKG.engines` を見る | `{ node: '^22.13.0' }` と deep equal（`npm` などほかのキーは置かない） |
| AC-3 [unit] `.nvmrc` と `engines` の整合 | `NVMRC` と `PKG.engines.node` | `NVMRC.trim()` を X、`PKG.engines.node` の正規表現 `/^\^(\d+)\./` の 1 番目のグループを Y とする | X === Y。どちらか片方だけ書き換えるとこのテストが失敗する |
| AC-4 [unit] `engine-strict` | リポジトリ直下の `.npmrc` | テキストとして読み、各行を `trim` する | `engine-strict=true` の行がちょうど 1 つある。`_auth`・`_authToken`・`//registry` を含む行がない（シークレットを置くファイルにしない） |
| AC-5 [unit] lockfile の整合 | `LOCK` と `PKG` | `LOCK.packages[''].engines` を見る | `PKG.engines` と deep equal。`LOCK.lockfileVersion === 3` のまま |
| AC-6 [unit] テストを動かしている Node | vitest の実行プロセス | `process.versions.node` を `.` で分けて数値にする（major, minor） | major === `Number(NVMRC.trim())`、かつ minor >= 13（AC-2 の下限）。CI の `verify` ジョブでもこのテストが走るので、CI が `.nvmrc` の Node で動いていることの確認になる |

### ワークフローの静的な性質
| ID | Given | When | Then |
|---|---|---|---|
| AC-7 [unit] 全 setup-node が `.nvmrc` を参照 | `.github/workflows/*.yml` すべて | 各ファイルを `- uses: actions/setup-node@` で分割し、2 つ目以降の各断片の「次の `\n\s*- ` まで」（= その step の範囲）を見る | (a) 各 step の範囲が正規表現 `/node-version-file:\s*['"]?\.nvmrc['"]?/` にマッチする。(b) どのファイルにも正規表現 `/node-version:/` にマッチする箇所がない（`node-version-file:` はマッチしない）。(c) setup-node を含むファイルの集合が `ci.yml`・`deploy.yml`・`linear-dispatch.yml`・`linear-merge-gate.yml`・`linear-notify.yml`・`security-review.yml` を含む（テストが何も読まずに通るのを防ぐ） |
| AC-8 [unit] 既存の設定を壊さない | AC-7 と同じ | 同上 | (a) `ci.yml` の `verify`、`deploy.yml`、`linear-dispatch.yml` の setup-node の step の範囲に `cache: npm` が残っている（`ci.yml` は 1 つ目の setup-node の step で判定）。(b) `security-review.yml` に `sparse-checkout-cone-mode` が現れない（cone モードを切ると `.nvmrc` がチェックアウトされず security-gate が失敗するため） |

### 実際に動かして確認
| ID | Given | When | Then |
|---|---|---|---|
| AC-9 [ci] 範囲外の Node で install が失敗する | GAM-6 のブランチをチェックアウトした手元（Node 22.13 以上） | (1) `npm install --dry-run --ignore-scripts --no-audit --no-fund --node-version=20.19.0`、(2) 同じコマンドで `--node-version=22.13.0`、(3) 同じコマンドで `--node-version=24.0.0` | (1) と (3) は exit code が 0 以外で、出力に `EBADENGINE` と `pixel-runner` を含む。(2) は exit 0。いずれも作業ツリーに差分を残さない（`git status --porcelain` が空） |
| AC-10 [ci] PR 上のチェック | GAM-6 の PR（draft でない） | 全チェックの完了を待ち、`gh pr checks <PR> --json name,workflow,state` と、各ジョブの `gh run view <run-id> --job <job-id> --log` | (a) `CI / verify`、`CI / npm-audit`、`Security Review / security-gate`（と `security-audit`）、`AI Review / review` がすべて `SUCCESS`。(b) `verify`・`npm-audit`・`security-gate` の各ログに、setup-node が解決した Node として正規表現 `/node\/22\.\d+\.\d+/` にマッチする行（ツールキャッシュのパス `/opt/hostedtoolcache/node/22.x.y/...` など）が 1 行以上ある。(c) `verify` のログで AC-6 のテストが passed になっている |
| AC-11 [ci] マージ後に main 上のワークフローが動く | GAM-6 のマージ後 | マージコミットを SHA とし、`gh run list --workflow <file> --branch main --json headSha,conclusion,event --limit 20` | (a) `deploy.yml` の、`headSha === SHA` の run の `conclusion` が `success`。(b) `linear-merge-gate.yml` と `linear-notify.yml` の、マージ後に始まった `schedule` の run（各 1 件以上。マージから最大 60 分待つ）の `conclusion` がすべて `success`。(c) `linear-dispatch.yml` は手動実行のみで、動かすと Linear の Issue を拾って実装を始めてしまうため実行しない（AC-7 の静的検査で代える） |
| AC-12 [ci] lockfile の変更は `engines` だけ | GAM-6 のブランチ | `git show origin/main:package-lock.json` と `git show HEAD:package-lock.json` をそれぞれ `JSON.parse` し、HEAD 側から `packages[''].engines` を削除して比べる（`node -e` で実行） | 2 つが deep equal（依存の解決結果は 1 件も変わらない）。`git diff --numstat origin/main...HEAD -- package-lock.json` の追加行は 5 以下、削除行は 1 以下 |

## 設計

### 決めたこと
| 項目 | 決定 | 理由 |
|---|---|---|
| `.nvmrc` の値 | `22`（メジャーのみ） | CI は setup-node がその時点のランナーにある 22 系の最新を使い、セキュリティ修正が自動で入る。パッチまで固定（`22.23.1`）すると、上げ忘れで古い Node に留まるうえ、`.nvmrc` の更新 PR が定期的に必要になる。再現性は「メジャー固定 ＋ `engines` の下限 ＋ `package-lock.json`」で十分と判断した（確認事項 Q1） |
| `engines.node` | `^22.13.0`（= `>=22.13.0 <23.0.0`） | Issue の「Node 22 を固定」に合わせて 23 以上を除外する。下限は依存（ESLint 10 系）が要求する 22.13.0。`>=22.13.0` のように上限を開けると、Node 24 でも install できてしまい「固定」にならない（確認事項 Q2） |
| `engine-strict` | `.npmrc` に `engine-strict=true` を入れる | `engines` だけでは npm は警告（`EBADENGINE`）を出すだけで install は成功する。範囲外の Node で `npm ci` を失敗させるために入れる。依存パッケージの `engines` も厳密に検査されるようになるが、現在の依存はすべて Node 22.13 以上で満たされる（確認事項 Q3） |
| 置き換え範囲 | `setup-node` の全 7 か所を `node-version-file: .nvmrc` にする | 1 か所でも直書きが残ると、`.nvmrc` を上げたときに取り残される。AC-7 で直書きの再混入も防ぐ |
| `package-lock.json` | `npm install --package-lock-only --ignore-scripts` で、ルートの `packages['']` に `engines` を反映させるだけ。依存は更新しない | lockfile の root エントリは `package.json` の `engines` を写すので、更新しないと両者が食い違う。`npm ci` 自体はこの食い違いでは失敗しないが、次に誰かが `npm install` したときに無関係な差分が出るのを防ぐ（AC-5、AC-12） |
| ランタイムの検査 | 追加のスクリプトや `preinstall` フックは作らない。代わりに AC-6 のテストを置く | `engine-strict` で install 時に弾ける。`npm run` 時の検査は npm にないが、`verify` の unit テスト（AC-6）で範囲外を検出できる |

### 変更ファイル一覧
| ファイル | 種別 | 内容 |
|---|---|---|
| `.nvmrc` | 新規 | `22` と改行のみ |
| `.npmrc` | 新規 | `engine-strict=true` の 1 行のみ（コメントも書かない。理由は本 spec と README に書く） |
| `package.json` | 変更 | `"engines": { "node": "^22.13.0" }` を追加（`private` の前あたり。ほかのキーは変えない） |
| `package-lock.json` | 変更 | 上記コマンドで再生成。`packages['']` に `engines` が増えるだけ（AC-12） |
| `.github/workflows/ci.yml` | 変更 | 2 か所。`verify`: `with: { node-version-file: .nvmrc, cache: npm }`、`npm-audit`: `with: { node-version-file: .nvmrc }` |
| `.github/workflows/deploy.yml` | 変更 | `with: { node-version-file: .nvmrc, cache: npm }` |
| `.github/workflows/linear-dispatch.yml` | 変更 | `with: { node-version-file: .nvmrc, cache: npm }` |
| `.github/workflows/linear-merge-gate.yml` | 変更 | `with: { node-version-file: .nvmrc }` |
| `.github/workflows/linear-notify.yml` | 変更 | `with: { node-version-file: .nvmrc }` |
| `.github/workflows/security-review.yml` | 変更 | `report` ジョブの setup-node を `with: { node-version-file: .nvmrc }` に。checkout の `sparse-checkout: scripts/security-review` は変えず、その上に `# cone モードではリポジトリ直下のファイル（.nvmrc）も取得される` とコメントを 1 行足す |
| `tests/unit/node-version.test.ts` | 新規 | AC-1〜8 |
| `README.md` | 変更 | 「はじめに」のコードブロックの前に「Node 22（バージョンは `.nvmrc`。nvm なら `nvm use`）。範囲外の Node では `.npmrc` の `engine-strict` により `npm ci` が失敗する」を 1〜2 行で追記 |
| `docs/workflow-graph.md` | 変更 | 「PR 上の自動チェック」節の近くに「全ワークフローの Node は `.nvmrc` で決める（`node-version-file`）。直書きは `tests/unit/node-version.test.ts` が検出する」を 1 行追記 |

- 変更は setup-node の `with` の 1 行だけ。各ワークフローのトリガー・権限・ほかの step は変えない
- `tests/unit/workflows.test.ts`（GAM-7）は変更しない。別ファイルにするのは、Issue ごとにテストの責務を分け、GAM-12 など他 Issue の変更と衝突しにくくするため
- `.github/workflows/*` と `security-review.yml` を変更するので、GAM-6 の PR では Security Review の総評に「ハーネスを変更しています」の警告が出る（想定どおり）

### `tests/unit/node-version.test.ts` の書き方
- `workflows.test.ts` と同じく `fileURLToPath(new URL('../../…', import.meta.url))` でパスを作り、`readFileSync` / `readdirSync` で読む
- AC-7 の step の切り出しは、`text.split(/- uses: actions\/setup-node@/).slice(1)` の各要素について、`/\n\s*- /` が最初に現れる位置までを step の範囲とする。現在のワークフローはすべて `with: { … }` のフロー形式で 1 行に書いているが、ブロック形式（`with:` の次の行に `node-version-file: .nvmrc`）でも通る正規表現にする
- AC-6 は `describe` 名に「テスト実行環境の Node」と書き、失敗メッセージに `process.versions.node` と `.nvmrc` の値を含める（範囲外の Node でテストを走らせた人が原因に気付けるように）
- semver ライブラリは追加しない（比較はメジャー・マイナーの数値比較で足りる）

### 実装時の注意
- `package-lock.json` を作り直すときは、`npm install --package-lock-only --ignore-scripts` を使い、`npm install <pkg>` や `npm update` はしない。作り直した後に AC-12 のコマンドを手元で実行してから commit する
- `.npmrc` を入れた後、手元で `npm ci` が通ることを確認する（Node 22.23.1 は `^22.13.0` を満たす）
- AC-9 の `--node-version` は npm の設定項目 `node-version`（engines の検査に使う Node のバージョン。既定は実行中の Node）を使う。もし手元の npm でこの方法では root パッケージの `EBADENGINE` を再現できなかった場合は、推測で別の検証方法に変えず、停止して確認事項として戻す（確認事項 Q6）

## テスト計画
- Unit: `tests/unit/node-version.test.ts` — AC-1〜8
  - AC-7 (b) の正規表現が `node-version-file:` にマッチしないことを、テスト内で `expect('node-version-file: .nvmrc').not.toMatch(/node-version:/)` として先に確かめる（正規表現の書き間違いで常に通るのを防ぐ）
- CI: AC-9〜12 はオーケストレーターが実施し、進捗ノートに `### <日時> [orchestrator] AC-10 PASS — <PR URL> <run URL>` の形で記録する。AC-11 はマージ後に実施する（`Done` への遷移後でもよい。失敗したら新しい Issue を起票する）
- E2E: なし（既存の `tests/e2e/` は変更しない）
- `npm run verify` が green であること

## 影響範囲・リスク
- **GAM-12（`deploy.yml` を変更予定）との衝突**: 両方が `deploy.yml` を変える。推奨のマージ順は **GAM-6 → GAM-12**（GAM-6 は 1 行の変更で小さく、先に入れると GAM-12 は rebase で `node-version-file: .nvmrc` を引き継ぐだけで済む）。GAM-6 のマージ後に GAM-12 が `node-version: 22` を書いた setup-node を追加・残した場合は、AC-7 のテストが失敗して気付ける。逆に GAM-12 が先にマージされた場合は、GAM-6 の rebase 時に `deploy.yml` の setup-node が何か所あっても全部 `.nvmrc` 参照にする（AC-7 は箇所数を固定していないので、そのまま判定できる）
- **GAM-10（DevContainer）との整合**: DevContainer の Node は `.nvmrc` と同じメジャーにすべき。devcontainer の features（`ghcr.io/devcontainers/features/node`）やイメージタグは `.nvmrc` を直接読めないので、GAM-10 側で次のどちらかにすることを推奨する: (a) `postCreateCommand` などで `.nvmrc` を読んで `nvm install` する、(b) `devcontainer.json` に `22` を書き、`tests/unit/` に「`devcontainer.json` の Node のメジャー === `.nvmrc`」の検査を GAM-10 で追加する。GAM-6 のテストは `.devcontainer/` を見ない（Issue をまたいだ依存を作らないため）。GAM-10 が GAM-6 より先にマージされる場合は `.nvmrc` がまだないので、GAM-10 は GAM-6 の後にマージするのが望ましい
- **`engine-strict` の副作用**: 将来、依存の更新で Node 22 系を対象外にしたパッケージ（例: `engines: >=24`）を入れると、`npm ci` が CI でもローカルでも失敗する。これは意図した挙動（Node を上げる判断を人に促す）だが、Dependabot などの依存更新 PR が `npm ci` で落ちる形で現れる
- **Node 22 の保守期限**: Node 22 の保守（Maintenance LTS）は 2027-04 末で終了予定。それまでに `.nvmrc` と `engines` を次の LTS（24）に上げる Issue が必要になる。上げるときは `.nvmrc`・`engines`（と lockfile の root）を同時に変えれば、AC-3 / AC-5 / AC-7 がそのまま整合を確かめる
- **ランナーのツールキャッシュ**: `.nvmrc` が `22` の場合、setup-node は既定（`check-latest: false`）でランナーにキャッシュ済みの 22 系を使う。最新パッチより少し古いことがあるが、22.13 を下回ることはない（AC-6 / AC-10 で検出できる）
- **`security-gate` の sparse checkout**: cone モードに依存して `.nvmrc` を取得している。将来 `sparse-checkout-cone-mode: false` にすると setup-node が `.nvmrc` を見つけられず security-gate が失敗し、fail-closed なのでマージが止まる。AC-8 (b) で防ぐ
- **マージゲートと通知**: `linear-merge-gate.yml` / `linear-notify.yml` は main の定義で cron 実行される。設定を誤るとマージと Slack 通知が止まるが、PR 上ではこの 2 つは動かないため、AC-11 でマージ後に確認する
- **ローカル環境**: nvm を使っていない開発者・エージェント環境でも、Node 22.13 以上の 22 系なら影響なし。それ以外の Node では `npm ci` が失敗するようになる

## 確認事項（人間に判断してほしいこと。暫定案で設計済み）
1. **Q1 `.nvmrc` の粒度**: メジャーのみ `22`（CI は 22 系の最新に自動で追従）にした。完全な再現性を優先してパッチまで固定（`22.23.1`）するか（暫定: `22`）
2. **Q2 `engines` の範囲**: `^22.13.0`（Node 23 以上は install 不可）にした。Node 24 の利用者も受け入れたいなら `>=22.13.0` にするが、その場合 Issue の「Node 22 を固定」とは言えなくなる（暫定: `^22.13.0`）
3. **Q3 `engine-strict` を入れるか**: 入れる案にした（範囲外の Node で `npm ci` が失敗する）。警告だけで十分なら `.npmrc` を作らず、AC-4・AC-9 を削る（暫定: 入れる）
4. **Q4 マージ順**: GAM-6 → GAM-10 / GAM-12 の順を推奨した。並行開発の都合で逆になる場合は、後からマージする側が rebase で `.nvmrc` 参照に揃える、でよいか
5. **Q5 DevContainer との整合の検査をどちらの Issue に置くか**: GAM-10 側に置く案にした（GAM-6 は `.devcontainer/` を見ない）。GAM-6 側で「`.devcontainer/devcontainer.json` があればメジャーが一致すること」を検査する方がよいか
6. **Q6 AC-9 の実施場所とタグ**: `engine-strict` の効果は GitHub Actions 上で別の Node を用意しないと確かめられないため、オーケストレーターが手元で `npm --node-version=…` を使って確かめ、`[ci]` として進捗ノートに記録する案にした。`[ci]` の定義（GitHub Actions 上で判定）から外れるので、(a) このまま `[ci]` 扱い、(b) CI に Node 20 / 24 で `npm ci` が失敗することを確かめるジョブを追加する、(c) AC から外して実装時の手動確認に留める、のどれにするか（暫定: (a)）。また、npm の `node-version` 設定で root パッケージの `EBADENGINE` が再現できない場合の扱い（暫定: 実装者は停止して `Design Review` に戻す）
7. **Q7 Claude Code Action の実行環境**: `ai-review.yml` と `security-review.yml` の `audit` ジョブは setup-node を使わず、action が持つ実行環境で動く。これらは「実行環境の固定」の対象外とした。action のバージョン固定（`@v1` → コミット SHA 固定など）も必要なら別 Issue にする（暫定: 対象外）
8. **Q8 他のアクションのバージョン**: `actions/checkout@v4` などのメジャー固定は今のままにし、SHA 固定は本 Issue の範囲外とした（暫定: 範囲外。必要なら別 Issue）

分割は不要と判断した（設定ファイル 2 つの追加、`package.json` と lockfile の root の更新、ワークフローの `with` の置き換え 7 か所、静的テスト 1 ファイルで 1 Issue に収まる）。

## 改訂履歴
- 初版: 新規作成（人間のコメントなし）
