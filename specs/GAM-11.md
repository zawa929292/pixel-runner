# GAM-11: [Ops] Sentry でエラー検知 → Linear 自動起票

## 目的
本番（GitHub Pages）で起きた JavaScript の実行時エラーを Sentry（無料枠）に集め、Sentry の Linear 連携で Linear の `Triage` に `bug` + `feedback` ラベル付きで自動起票する。これで「本番監視 → 運用フィードバック → 起票」のループができる（CTC「AI 駆動開発 全体アーキテクチャ」との差分の解消）。

- 送信するのは**本番ビルドで、DSN が設定され、テストモードでも自動操作でもないとき**だけ。dev サーバー・`?test=1`・E2E（Playwright）では Sentry を初期化しない
- Sentry の初期化に失敗してもゲームは止めない（例外を外に出さない）
- ゲームの仕様（`docs/game-design.md`）と `src/core/` のゲームロジックは変更しない（定数の追加のみ）
- Sentry と Linear の連携設定は人が行う作業なので、手順を `docs/monitoring.md` に書くところまでを本 Issue の範囲にする
- パフォーマンス監視（FPS 低下）は本 Issue では入れない（下記「パフォーマンス監視の検討」。別 Issue 案あり）

### 前提（調査済みの事実）
- `npm run e2e` は `vite build && vite preview` の**本番ビルド**で動く（`playwright.config.ts`）。そのため `import.meta.env.PROD` だけでは E2E を除外できず、`?test` と `navigator.webdriver` での判定が必要
- `ci.yml` / `playwright.config.ts` は Sentry 関係の環境変数を渡していない。CI のビルドには DSN が入らない
- `deploy.yml` は `main` への push で `npm run build` → Pages。ビルド時の環境変数はまだ何も渡していない
- `.gitignore` に `.env` / `.env.*` がある（ローカルの DSN はコミットされない）
- GAM-7 で PR に `CI / npm-audit`（`npm audit --audit-level=high`）と `Security Review / security-gate` が追加済み。新しい npm 依存はこれを通る必要がある
- Sentry の DSN はブラウザのバンドルに埋め込まれる公開情報（秘密ではない）。DSN を知っていれば誰でもイベントを送れるため、悪用対策は Sentry 側の「Allowed Domains」とレート制限、およびクライアント側の件数上限で行う

## 受入条件

### タグ
- `[unit]`: `src/monitoring/` の純粋関数と、設定ファイルの静的な性質。`tests/unit/` の vitest で検証（implementer 担当）
- `[e2e]`: ブラウザで `?test=1` を開いたときの状態（e2e-tester 担当）
- `[ci]`: GAM-7 で承認されたタグ。PR 上の GitHub Actions の結果を `gh` で判定し、オーケストレーターが進捗ノートに記録する
- `[manual]`: **新設の提案**（確認事項 Q1）。Sentry / Linear のアカウント操作が必要で、人がマージ・デプロイ後に行う確認。手順と判定基準は `docs/monitoring.md` に書き、結果を進捗ノートに記録する

表記:
- `ENV(overrides)` = 次の正常な（送信が有効になる）入力に `overrides` を上書きしたもの:
  `{ dsn: 'https://0123456789abcdef0123456789abcdef@o123.ingest.us.sentry.io/4567', isProduction: true, search: '', webdriver: false, release: 'pixel-runner@abc1234', environment: undefined }`
- `M` = `src/core/config.ts` の `MONITORING`（後述）

### 送信するかどうかの判定（`decideMonitoring`）
| ID | Given | When | Then |
|---|---|---|---|
| AC-1 [unit] テストモードでは無効 | `ENV({ search: '?test=1' })`／`ENV({ search: '?seed=3&test' })`／`ENV({ search: '?test=0' })` | `decideMonitoring(env)` | すべて `{ enabled: false, reason: 'test-mode' }`（`main.ts` の既存判定と同じく、`test` パラメータが**ある**だけで値は問わない） |
| AC-2 [unit] 自動操作では無効 | `ENV({ webdriver: true })` | `decideMonitoring` | `{ enabled: false, reason: 'automation' }` |
| AC-3 [unit] 本番ビルド以外では無効 | `ENV({ isProduction: false })` | `decideMonitoring` | `{ enabled: false, reason: 'not-production' }` |
| AC-4 [unit] DSN 未設定では無効 | `ENV({ dsn: undefined })`／`ENV({ dsn: '' })`／`ENV({ dsn: '   ' })` | `decideMonitoring` | すべて `{ enabled: false, reason: 'no-dsn' }` |
| AC-5 [unit] 不正な DSN では無効 | `dsn` が `'abc'`／`'http://0123456789abcdef0123456789abcdef@o123.ingest.us.sentry.io/4567'`（http）／`'https://o123.ingest.us.sentry.io/4567'`（公開鍵なし）／`'https://0123456789abcdef0123456789abcdef@o123.ingest.us.sentry.io/'`（プロジェクト ID なし）／`'https://0123456789abcdef0123456789abcdef@o123.ingest.us.sentry.io/4567?x=1'` | `decideMonitoring` | すべて `{ enabled: false, reason: 'invalid-dsn' }` |
| AC-6 [unit] 有効になる条件 | `ENV({})`／`ENV({ dsn: '  ' + ENV({}).dsn + '\n' })`（前後に空白） | `decideMonitoring` | どちらも `enabled: true` で、`options` が `{ dsn: ENV({}).dsn（前後の空白を除いたもの）, release: 'pixel-runner@abc1234', environment: M.defaultEnvironment（= 'production'）, sampleRate: M.errorSampleRate（= 1）, maxEventsPerSession: M.maxEventsPerSession（= 10） }` と deep equal |
| AC-7 [unit] 判定の優先順 | (a) `ENV({ search: '?test=1', webdriver: true, isProduction: false, dsn: undefined })`／(b) `ENV({ webdriver: true, isProduction: false, dsn: 'abc' })`／(c) `ENV({ isProduction: false, dsn: undefined })`／(d) `ENV({ dsn: 'abc' })` | `decideMonitoring` | `reason` はそれぞれ `'test-mode'`／`'automation'`／`'not-production'`／`'invalid-dsn'`。優先順は test-mode → automation → not-production → no-dsn → invalid-dsn |
| AC-8 [unit] release の正規化 | `release` が `undefined`／`''`／`'  pixel-runner@abc1234  '`／`'a/b'`／`'a b'`／`'.'`／`'..'`／`'x'.repeat(200)`／`'x'.repeat(201)` | `normalizeRelease(release)` と、`decideMonitoring(ENV({ release }))` の `options.release` | `undefined`／`undefined`／`'pixel-runner@abc1234'`／`undefined`／`undefined`／`undefined`／`undefined`／`'x'.repeat(200)`／`undefined`。release が `undefined` になっても `enabled` は `true` のまま（release なしで送る） |
| AC-9 [unit] environment | `environment` が `undefined`／`''`／`'staging'`／`' staging '` | `decideMonitoring(ENV({ environment }))` | `options.environment` は `'production'`／`'production'`／`'staging'`／`'staging'` |

### 初期化（`initMonitoring`）
`deps = { loadSdk, warn }`。`loadSdk` はテストでは偽物（`vi.fn`）を渡す。
| ID | Given | When | Then |
|---|---|---|---|
| AC-10 [unit] 無効なら SDK を読み込まない | AC-1〜5 のいずれかの入力（`ENV({ search: '?test=1' })` と `ENV({ dsn: undefined })` の 2 ケース） | `await initMonitoring(env, deps)` | `loadSdk` は 0 回呼ばれる。戻り値は `{ enabled: false, reason: <decideMonitoring の reason> }` |
| AC-11 [unit] 有効なら 1 回だけ初期化 | `ENV({})`、`loadSdk` は `{ init: vi.fn() }` を resolve | `await initMonitoring(env, deps)` | `loadSdk` 1 回、`init` 1 回。`init` の引数は `dsn`・`release`・`environment`・`sampleRate` が AC-6 の `options` と一致し、`sendDefaultPii === false`、`beforeSend` が関数、`denyUrls` が `M.denyUrls` と等しい。引数に `tracesSampleRate`・`tracesSampler`・`replaysSessionSampleRate`・`replaysOnErrorSampleRate` のキーがない。戻り値は `{ enabled: true, reason: null }` |
| AC-12 [unit] 失敗してもゲームを止めない | (a) `loadSdk` が reject する／(b) `loadSdk` が同期的に throw する／(c) `init` が throw する | `initMonitoring(env, deps)` | 3 ケースとも返った Promise は reject せず `{ enabled: false, reason: 'init-failed' }` に resolve する。`warn` がちょうど 1 回呼ばれる |

### 送信前のフィルタ（`createBeforeSend`、`scrubEvent`）
| ID | Given | When | Then |
|---|---|---|---|
| AC-13 [unit] セッションあたりの件数上限 | `const beforeSend = createBeforeSend(3)`、イベント `{ message: 'e' }` | `beforeSend` を 4 回呼ぶ | 1〜3 回目は `null` でないイベントを返し、4 回目は `null`。別の `createBeforeSend(3)` で作った関数は件数を共有しない |
| AC-14 [unit] 個人情報になりうる値を落とす | `ev = { message: 'e', user: { id: '1', ip_address: '1.2.3.4' }, request: { url: 'https://x.github.io/pixel-runner/?seed=1&test#h', headers: { 'User-Agent': 'UA' }, cookies: { a: 'b' } }, tags: { k: 'v' } }`（`structuredClone` で控えを取る） | `scrubEvent(ev)` と、`createBeforeSend(10)(ev)` | どちらも `user` キーがなく、`request` は `{ url: 'https://x.github.io/pixel-runner/' }`（クエリとハッシュを除去、`headers`・`cookies` なし）、`message` と `tags` はそのまま。`ev` は控えと deep equal（書き換えない）。`request` がないイベントはそのまま（`request` を足さない） |

### 依存とファイル構成の静的な性質
| ID | Given | When | Then |
|---|---|---|---|
| AC-15 [unit] Sentry への依存を 1 か所に閉じ込める | `src/` 配下の全 `.ts` を `node:fs` で読む | 文字列で検査 | `@sentry/` を含むファイルは `src/monitoring/sentry.ts` だけ。`src/core/` 配下のどのファイルも `monitoring` を import しない。`src/monitoring/decide.ts`・`src/monitoring/init.ts` は `phaser` も `@sentry/` も含まない。`package.json` の `dependencies` に `@sentry/browser` があり、`devDependencies` にはない |
| AC-16 [unit] DSN は本番デプロイだけに渡る | `.github/workflows/deploy.yml`・`ci.yml`・`playwright.config.ts`・`vite.config.ts` をテキストとして読む | 文字列・正規表現で検査 | `deploy.yml` に `VITE_SENTRY_DSN: ${{ vars.SENTRY_DSN }}` と `VITE_APP_RELEASE: pixel-runner@${{ github.sha }}` がある。`deploy.yml` に `secrets.SENTRY` を含まない（DSN は Variables。確認事項 Q4）。`ci.yml`・`playwright.config.ts` は `SENTRY` を含まない。`vite.config.ts` に `sourcemap: true` がある（確認事項 Q6） |

### ブラウザでの確認
| ID | Given | When | Then |
|---|---|---|---|
| AC-17 [e2e] テストモードでは Sentry を初期化せず、ゲームは通常どおり動く | `page.on('request')` で全リクエストの URL を記録しておき、`/?test=1` を開く | `getState().status` が `ready` になるまで待ち、canvas をクリックして SPACE を押す | `window.__GAME__.getMonitoring()` が `{ enabled: false, reason: 'test-mode' }` になる（`expect.poll`）。`getState().status` が `playing` になる。記録した URL に `sentry` を含むものが 1 件もない |

### GitHub Actions 上での確認
| ID | Given | When | Then |
|---|---|---|---|
| AC-18 [ci] 新しい依存が検査を通る | GAM-11 の PR（draft でない） | 全チェック完了まで待ち、`gh pr checks <PR> --json name,workflow,state` | `CI / verify`、`CI / npm-audit`、`Security Review / security-gate` が `SUCCESS`。`npm audit --audit-level=high` が high 以上 0 件。security-gate が HIGH で失敗した場合は偽陽性かどうかを人に判断してもらう（進捗ノートに記録して `Needs Human`） |

### 本番での確認（人が行う。マージ後）
前提: 人が確認事項「人が用意するもの」の 1〜5 を済ませ、`vars.SENTRY_DSN` を設定した状態で `main` のデプロイが成功していること（未設定のままマージしても DSN なしで無効になるだけで、ゲームは壊れない）。
| ID | Given | When | Then |
|---|---|---|---|
| AC-19 [manual] 本番のエラーが Sentry に届く | 本番 URL（`?test` なし）を Chrome で開き、DevTools の Console で `setTimeout(() => { throw new Error('GAM-11 verification ' + Date.now()) }, 0)` を実行 | 5 分以内に Sentry の Issues を見る | そのメッセージの Issue が 1 件でき、`environment` が `production`、`release` が `pixel-runner@<デプロイしたコミットの SHA>`。イベントに `user.ip_address` がない（Sentry の「Prevent Storing of IP Addresses」が有効）。同じ手順を `?test=1` 付きの URL で行うと、5 分待っても Issue ができない |
| AC-20 [manual] Linear の Triage に自動起票される | AC-19 で Sentry の Issue ができた | 10 分以内に Linear の Team Game を見る | Issue が 1 件起票され、状態が `Triage`、ラベルに `bug` と `feedback` があり、本文または添付に Sentry の Issue へのリンクがある。AC-19 と同じメッセージで再度エラーを起こしても、Linear の Issue は増えない（Sentry の同じ Issue にまとまる） |
| AC-21 [manual] ソースマップで元のコードが分かる | アプリのコード内で起きたエラーのイベント（手順は `docs/monitoring.md`。確認事項 Q6 で非公開方式を選んだ場合はその手順） | Sentry のイベント詳細のスタックトレースを見る | フレームに `src/` 配下の元のファイル名と行番号が表示される（minify された `assets/index-*.js` だけではない） |

## 設計

### 全体構成
```
src/main.ts
  ├─ startMonitoring()  ← 最初に呼ぶ（await しない）。Phaser.Game の生成をブロックしない
  │    src/monitoring/sentry.ts   import.meta.env を読み、initMonitoring に本物の loadSdk を渡す（@sentry/browser を使う唯一のファイル）
  │      └─ src/monitoring/init.ts    initMonitoring / createBeforeSend / scrubEvent（DI で純粋にテストできる。SDK を import しない）
  │           └─ src/monitoring/decide.ts  decideMonitoring / normalizeRelease（純関数）
  │                └─ src/core/config.ts   MONITORING 定数
  ├─ new Phaser.Game(...)       既存のまま
  └─ ?test=1 のとき window.__GAME__ = { getState, getMonitoring }
```
- `@sentry/browser` は**動的 import**（`import('@sentry/browser')`）で読み込む。Vite が別チャンクに分けるので、無効なとき（dev・E2E・DSN なし）は SDK のコードを読み込まず、ゲーム本体の読み込みサイズも増えない。代わりに、SDK が読み込まれる前（ページ読み込み直後の数百 ms）に起きたエラーは拾えない（許容する）
- `src/monitoring/` は core の外。core（ゲームのルール）からは参照しない。scenes も参照しない（AC-15）
- ESLint: `src/core/**` と `src/scenes/**` で `@sentry/*` の import を禁止する（`no-restricted-imports` の `patterns`）。既存の `phaser` 禁止ルールは残す

### 変更ファイル一覧
| ファイル | 種別 | 内容 |
|---|---|---|
| `package.json` / `package-lock.json` | 変更 | `dependencies` に `@sentry/browser` を追加（実装時点の latest。`npm view @sentry/browser version` で確認し、`^` 付きで記録） |
| `src/core/config.ts` | 変更 | `MONITORING` 定数を追加（後述） |
| `src/monitoring/decide.ts` | 新規 | `decideMonitoring`、`normalizeRelease`、型 |
| `src/monitoring/init.ts` | 新規 | `initMonitoring`、`createBeforeSend`、`scrubEvent`、`buildSentryOptions` |
| `src/monitoring/sentry.ts` | 新規 | `startMonitoring()`。`import.meta.env` の読み取り、本物の `loadSdk`、状態の保持 |
| `src/vite-env.d.ts` | 新規 | `ImportMetaEnv` に `VITE_SENTRY_DSN?`・`VITE_APP_RELEASE?`・`VITE_SENTRY_ENVIRONMENT?`（すべて `string`）を宣言 |
| `src/main.ts` | 変更 | 先頭で `startMonitoring()`。`window.__GAME__` に `getMonitoring` を追加 |
| `eslint.config.js` | 変更 | `@sentry/*` の import 禁止（core / scenes） |
| `vite.config.ts` | 変更 | `build.sourcemap: true`、Phaser を別チャンクに分ける `manualChunks`（確認事項 Q6） |
| `.github/workflows/deploy.yml` | 変更 | `npm run build` のステップに `env:` を追加するだけ（後述） |
| `docs/monitoring.md` | 新規 | 人が行う Sentry / Linear の設定手順、確認手順（AC-19〜21）、無料枠と運用 |
| `docs/linear-setup.md` | 変更 | 「8. Sentry 連携（任意）」節を追加し、`docs/monitoring.md` へリンク |
| `docs/architecture.md` | 変更 | レイヤー図に `src/monitoring/*`（本番のエラー監視。core / scenes から参照しない）を 1 行追加 |
| `tests/unit/monitoring.test.ts` | 新規 | AC-1〜14 |
| `tests/unit/monitoring-static.test.ts` | 新規 | AC-15〜16 |
| `tests/e2e/monitoring.spec.ts` | 新規 | AC-17 |

### 定数（`src/core/config.ts` に追加）
```ts
/** 本番のエラー監視（GAM-11）。ゲームのルールには使わない */
export const MONITORING = {
  /** エラーイベントのサンプリング率（0〜1）。無料枠の範囲で全件送る */
  errorSampleRate: 1,
  /** 1 ページ読み込みあたりの送信上限。update ループ内の例外が毎フレーム送られて無料枠を使い切るのを防ぐ */
  maxEventsPerSession: 10,
  /** VITE_SENTRY_ENVIRONMENT が未設定のときの environment */
  defaultEnvironment: 'production',
  /** release 名の最大長（Sentry の制約） */
  maxReleaseLength: 200,
  /** 送信しないエラーの発生元（ブラウザ拡張） */
  denyUrls: [/^chrome-extension:\/\//, /^moz-extension:\/\//, /^safari-web-extension:\/\//],
  /** DSN の形式: https://<32 桁 16 進の公開鍵>@<ホスト>/<数字のプロジェクト ID> */
  dsnPattern: /^https:\/\/[0-9a-f]{32}@[A-Za-z0-9.-]+(:\d+)?\/\d+$/,
} as const;
```
- ゲームの定数ではないが、CLAUDE.md の「定数は `src/core/config.ts` に集約」に従う（確認事項 Q8）

### `src/monitoring/decide.ts`（純関数。`location`・`navigator`・`import.meta.env` を直接読まない）
```ts
export type MonitoringDisabledReason = 'test-mode' | 'automation' | 'not-production' | 'no-dsn' | 'invalid-dsn';
export interface MonitoringEnv {
  dsn: string | undefined;
  isProduction: boolean;      // import.meta.env.PROD
  search: string;             // location.search
  webdriver: boolean;         // navigator.webdriver === true
  release: string | undefined;     // import.meta.env.VITE_APP_RELEASE
  environment: string | undefined; // import.meta.env.VITE_SENTRY_ENVIRONMENT
}
export interface MonitoringOptions {
  dsn: string; release: string | undefined; environment: string;
  sampleRate: number; maxEventsPerSession: number;
}
export type MonitoringDecision =
  | { enabled: true; options: MonitoringOptions }
  | { enabled: false; reason: MonitoringDisabledReason };

export function decideMonitoring(env: MonitoringEnv): MonitoringDecision;
export function normalizeRelease(release: string | undefined): string | undefined;
```
- 判定順は AC-7。`test` の判定は `new URLSearchParams(search).has('test')`（`main.ts` と同じ規則）
- `dsn` は `trim()` してから空判定（AC-4）と `M.dsnPattern` の照合（AC-5）
- `normalizeRelease`: `trim()` 後、空なら `undefined`。`M.maxReleaseLength` 超、空白・`/`・`\` を含む、`'.'`・`'..'` なら `undefined`（Sentry の release 名の制約）
- `environment`: `trim()` 後、空なら `M.defaultEnvironment`

### `src/monitoring/init.ts`（SDK を import しない。DI でテストする）
```ts
/** @sentry/browser の init に渡す値のうち、本設計で使うものだけを構造的に表す */
export interface SentryInitOptions {
  dsn: string; release: string | undefined; environment: string; sampleRate: number;
  sendDefaultPii: false;
  denyUrls: readonly RegExp[];
  beforeSend: (event: MonitoringEvent) => MonitoringEvent | null;
}
export interface MonitoringEvent { user?: unknown; request?: { url?: string; headers?: unknown; cookies?: unknown; [k: string]: unknown }; [k: string]: unknown }
export interface SdkLike { init(options: SentryInitOptions): unknown }
export interface MonitoringStatus { enabled: boolean; reason: MonitoringDisabledReason | 'init-failed' | 'pending' | null }

export function buildSentryOptions(options: MonitoringOptions): SentryInitOptions;
export function createBeforeSend(maxEvents: number): (event: MonitoringEvent) => MonitoringEvent | null;
export function scrubEvent(event: MonitoringEvent): MonitoringEvent;
export function initMonitoring(env: MonitoringEnv, deps: { loadSdk: () => Promise<SdkLike>; warn: (msg: string, err: unknown) => void }): Promise<MonitoringStatus>;
```
- `initMonitoring`: `decideMonitoring` が無効なら `loadSdk` を呼ばずに `{ enabled: false, reason }`。有効なら `loadSdk()` → `sdk.init(buildSentryOptions(options))` → `{ enabled: true, reason: null }`。**全体を try/catch で囲み**（`loadSdk` の同期 throw も含む）、失敗時は `warn('[monitoring] Sentry の初期化に失敗しました', err)` を 1 回呼んで `{ enabled: false, reason: 'init-failed' }`。絶対に reject しない（AC-12）
- `buildSentryOptions`: `sendDefaultPii: false`（明示）、`denyUrls: M.denyUrls`、`beforeSend: createBeforeSend(options.maxEventsPerSession)`。**トレーシング・リプレイのオプションは渡さない**（パフォーマンス監視とセッションリプレイは使わない。AC-11）。`maxEventsPerSession` は SDK には渡さない（beforeSend で使う）
- `createBeforeSend`: クロージャ内のカウンタが `maxEvents` に達したら `null`（送らない）。それ以外は `scrubEvent(event)` を返してカウンタを 1 増やす。カウンタは関数ごとに独立（AC-13）。この関数だけはカウンタという内部状態を持つ（SDK のフックの形に合わせるため。イベントオブジェクト自体はイミュータブルに扱う）
- `scrubEvent`: 新しいオブジェクトを返す。`user` を除く。`request` があれば `headers`・`cookies` を除き、`url` からクエリとハッシュを除く（`new URL` で解析できなければ `?` と `#` 以降を文字列で切る）。入力は書き換えない（AC-14）

### `src/monitoring/sentry.ts`（I/O だけ。判断は書かない）
```ts
export function startMonitoring(): () => MonitoringStatus;  // 現在の状態を返す getter を返す
```
- `env` を組み立てる: `{ dsn: import.meta.env.VITE_SENTRY_DSN, isProduction: import.meta.env.PROD, search: location.search, webdriver: navigator.webdriver === true, release: import.meta.env.VITE_APP_RELEASE, environment: import.meta.env.VITE_SENTRY_ENVIRONMENT }`
- `loadSdk = async () => { const Sentry = await import('@sentry/browser'); return { init: (o) => Sentry.init(o) }; }`。`SentryInitOptions` と Sentry の型の差（`beforeSend` のイベント型など）はこのファイル内の型変換で吸収し、`init.ts` に Sentry の型を持ち込まない
- 状態は `{ enabled: false, reason: 'pending' }` で始め、`initMonitoring(env, { loadSdk, warn: console.warn }).then((s) => { status = s; })` で更新する（`initMonitoring` は reject しないので `.catch` は不要だが、念のため付けても可）
- Sentry の既定のインテグレーション（グローバルなエラーハンドラ、未処理の Promise reject、Dedupe、ブレッドクラム）はそのまま使う。`browserTracingIntegration`・`replayIntegration` は追加しない

### `src/main.ts` の変更
```ts
import { startMonitoring } from './monitoring/sentry';
const getMonitoring = startMonitoring();   // 既存の readSeed / new GameScene より前
// ...（既存のまま）
declare global { interface Window { __GAME__?: { getState: () => GameState; getMonitoring: () => MonitoringStatus } } }
if (new URLSearchParams(location.search).has('test')) {
  window.__GAME__ = { getState: () => scene.state, getMonitoring };
}
```
- `getMonitoring` は E2E での観測用（AC-17）。ゲームの状態（`GameState`）には監視の情報を混ぜない

### `deploy.yml` の変更（`npm run build` のステップに `env:` を足すだけ）
```yaml
      - run: npm run build
        env:
          VITE_SENTRY_DSN: ${{ vars.SENTRY_DSN }}
          VITE_SENTRY_ENVIRONMENT: production
          VITE_APP_RELEASE: pixel-runner@${{ github.sha }}
```
- DSN は GitHub の **Variables**（`vars.SENTRY_DSN`）に置く。バンドルに埋め込まれて公開される値なので Secrets にする意味が薄く、Variables なら設定値を後から確認できる（確認事項 Q4）。未設定なら空文字になり、`no-dsn` で無効になる（壊れない）
- release 名は `pixel-runner@<コミット SHA 40 桁>`。変数名は Sentry 専用にせず `VITE_APP_RELEASE` にして、GAM-12（リリースタグ）が画面表示などに再利用できるようにする。GAM-12 でバージョンタグ（例 `v1.2.0`）を導入する場合は `pixel-runner@v1.2.0` に揃える（確認事項 Q5）
- `ci.yml` と `playwright.config.ts` には何も渡さない（テストのビルドに DSN を入れない。AC-16）
- 他のステップ・トリガー・権限は変えない（GAM-6・GAM-12 も `deploy.yml` を触るため、差分を最小にしてコンフリクトを減らす）

### `vite.config.ts` の変更
```ts
build: {
  chunkSizeWarningLimit: 1600,
  sourcemap: true,
  rollupOptions: { output: { manualChunks: { phaser: ['phaser'] } } },
},
```
- ソースマップは**公開**する方式を推奨（`.map` を Pages に一緒に置き、Sentry がスタックトレースの解決時に URL から取得する）。リポジトリのソースが公開されている前提なら漏れる情報はなく、Sentry の認証トークン（Secrets）も追加の npm 依存（`@sentry/vite-plugin`）も不要（確認事項 Q6）
- Phaser を別チャンクに分けるのは、アプリ本体のチャンクとそのソースマップを小さく保ち、Sentry がソースマップを取得・解決しやすくするため

### `docs/monitoring.md` の内容
1. **概要**: 何を送るか（本番の未処理例外・未処理の Promise reject のみ）、送らない条件（dev、`?test`、自動操作、DSN なし）、送らない情報（ユーザー情報・IP・Cookie・ヘッダー・URL のクエリ）、上限（1 ページ読み込みあたり 10 件）
2. **Sentry の準備（人）**: アカウント作成（Developer = 無料プラン）→ プロジェクト作成（Platform: Browser JavaScript、名前 `pixel-runner`）→ Client Keys から DSN をコピー → GitHub repo → Settings → Secrets and variables → Actions → **Variables** に `SENTRY_DSN` を登録 → `main` を再デプロイ（Actions の Deploy を `workflow_dispatch` で実行）
3. **Sentry プロジェクトの設定（人）**:
   - Security & Privacy: 「Prevent Storing of IP Addresses」ON、「Data Scrubber」「Use Default Scrubbers」ON
   - Project Settings → General の **Allowed Domains** を `zawa929292.github.io` にする（他のオリジンからの送信を拒否し、公開 DSN の悪用を減らす）
   - Inbound Filters: ブラウザ拡張・localhost・古いブラウザのエラーを除外
   - Client Keys → 該当キーのレート制限（例: 1 時間 100 件。プランで使えない場合は Spike Protection の既定のまま）
4. **Linear 連携（人）**:
   - Sentry → Settings → Integrations → **Linear** をインストールし、Linear のワークスペースを認可
   - Linear 側で Team Game の Triage が有効なことを確認（`docs/linear-setup.md` の 2）
   - Sentry → Alerts → Create Alert → Issue Alert: 条件「A new issue is created」、フィルタ「environment = production」、アクション「Create a Linear issue」（Team: Game、Labels: `bug`・`feedback`、状態: `Triage`）。アクションで状態・ラベルを指定できない場合の代替は確認事項 Q3
   - 起票された Issue には `ai-ready` を付けない。人が Triage で内容を見て、直す場合に `ai-ready` を付けて通常のフローに乗せる
5. **確認手順**: AC-19・AC-20・AC-21 の手順と判定基準（AC 表と同じ文面）。結果は `specs/GAM-11.progress.md` に `### <日時> [human] AC-19 PASS — <Sentry Issue URL>` の形で記録
6. **無料枠と運用**: Developer プランのエラー件数の上限（2026-11 時点で月 5,000 件の想定。設定時に料金ページで確認して書き換える）、上限に達すると月末まで受信されないこと、Spike Protection、件数が多いときは `MONITORING.errorSampleRate` を下げる
7. **無効化の方法**: Variables の `SENTRY_DSN` を削除して再デプロイ（コード変更なしで止められる）

### パフォーマンス監視（FPS 低下）の検討
**結論: 本 Issue では入れない。必要なら別 Issue にする（推奨は「当面不要、プレイヤー数が増えてから」）**
- Sentry のパフォーマンス監視（`browserTracingIntegration`）が測るのはページ読み込みや画面遷移・HTTP 通信で、canvas のフレームレートは測らない。FPS を送るには自前の計測が必要。Sentry のカスタムメトリクス機能は 2024 年に提供終了しているため、イベントかスパンの属性として送ることになる
- トレーシングを入れると SDK のサイズが増え、無料枠のスパン件数も消費する。本ゲームは通信がなく、ページ読み込み後は 1 画面で完結するので得られる情報が少ない
- 別 Issue 案「[Ops] FPS 低下の検知」:
  - `src/core/fps.ts`: `updateFpsStats(stats, deltaMs) => stats`（直近 N 秒の平均 FPS と、しきい値を下回った時間を数える純関数。Phaser 非依存で unit テスト可能）
  - `GameScene.update` で `delta` を渡し、`playing` 中に平均 FPS が 40 未満の状態が 5 秒続いたら、1 ページ読み込みあたり 1 回だけ `Sentry.captureMessage('low-fps', { level: 'warning', extra: { avgFps, userAgent の大分類 } })` を送る（送信は `src/monitoring/` 経由）
  - Linear への起票対象にするかは、エラーとは別のアラートルールで決める（大量起票を避けるため、週次の集計で十分か要検討）

## テスト計画
- Unit: `tests/unit/monitoring.test.ts` — AC-1〜14
  - `ENV(overrides)` をテスト内のヘルパー関数として定義する
  - AC-11 は `init` の引数を `expect.objectContaining` と、`not.toHaveProperty('tracesSampleRate')` 等で検査する
  - AC-12 は 3 ケースそれぞれで `await expect(initMonitoring(...)).resolves.toEqual({ enabled: false, reason: 'init-failed' })`
  - AC-13・14 は入力を `structuredClone` で控えて deep equal
- Unit: `tests/unit/monitoring-static.test.ts` — AC-15〜16。`readdirSync(…, { recursive: true })` と `readFileSync` でテキストとして読む（`tests/unit/workflows.test.ts` と同じやり方。YAML パーサーは追加しない）
- E2E: `tests/e2e/monitoring.spec.ts` — AC-17
- CI: AC-18 はオーケストレーターが PR 作成後に確認し、進捗ノートに `### <日時> [orchestrator] AC-18 PASS — <PR URL>` と記録
- Manual: AC-19〜21 は人がマージ・デプロイ後に `docs/monitoring.md` の手順で行う（確認事項 Q1）
- `npm run verify` が green であること（既存のテストはそのまま通る）

## 影響範囲・リスク
- **E2E は本番ビルドで動く**: `import.meta.env.PROD` は E2E でも `true`。`?test` と `navigator.webdriver` の 2 段で除外する（AC-1・2・7・17）。ローカルの `.env.production.local` に DSN を置いた開発者が E2E を回しても送信されない
- **新しい依存**: `@sentry/browser`（と配下の `@sentry/core` 等）が `npm audit --audit-level=high` に引っかかれば `CI / npm-audit` が失敗する。その場合は推測でバージョンを下げず、停止して人に確認する
- **バンドルサイズ**: 動的 import なので初回の読み込みは増えない。本番で有効なときだけ Sentry のチャンク（gzip 後で数十 KB の見込み）を追加で読み込む
- **SDK 読み込み前のエラー**: 動的 import のため、ページ読み込み直後のエラーは拾えない。起動時のクラッシュを確実に拾いたい場合は静的 import に変える（全員の読み込みサイズが増える）
- **update ループ内の例外**: 毎フレーム同じ例外が出ると大量に送られる。Sentry の Dedupe（連続する同じイベントを捨てる）と `maxEventsPerSession`（10 件）で抑える
- **公開 DSN の悪用**: 誰でも DSN でイベントを送れる。Allowed Domains・レート制限・Spike Protection で抑えるが、完全には防げない。無料枠を使い切っても課金はされず受信が止まるだけ
- **ソースマップの公開**: リポジトリが非公開の場合はソースが読めるようになる（確認事項 Q6）。ソースマップ込みで `dist` が大きくなり、E2E のビルドも数秒遅くなる可能性がある
- **他 Issue とのコンフリクト**: `deploy.yml`（GAM-6・GAM-12）、`src/core/config.ts`・`src/main.ts` の `window.__GAME__` の型（他の Issue も触る可能性）、`vite.config.ts`。いずれも追加のみの小さな差分にする。後からマージする側がリベースで解消する
- **Sentry / Linear の仕様変更**: Linear 連携のアラートアクションで指定できる項目（状態・ラベル）は、設定時の画面で確認する必要がある（確認事項 Q3）
- **reviewer の判定**: `[manual]` の AC にはテストがないため、reviewer が「未対応の AC」として high にするおそれがある。`[manual]` は対象外と spec に明記してある（確認事項 Q1）

## 確認事項（人間に判断してほしいこと。暫定案で設計済み）

### 人が用意するもの（実装 AI はできない）
1. Sentry アカウント（Developer = 無料プラン）とプロジェクト `pixel-runner`（Browser JavaScript）の作成
2. DSN を GitHub repo の Actions **Variables** に `SENTRY_DSN` として登録（Q4 で Secrets を選ぶ場合は Secrets）
3. Sentry プロジェクトの設定: IP を保存しない、Data Scrubber、Allowed Domains（`zawa929292.github.io`）、Inbound Filters、レート制限（`docs/monitoring.md` の 3）
4. Sentry の Linear 連携のインストールと、Issue Alert（新しい Issue → Linear の Team Game に `bug` + `feedback` で起票）の作成
5. マージ後のデプロイと AC-19〜21 の確認、結果の記録

### 判断してほしいこと
1. **Q1 `[manual]` タグの新設**: Sentry / Linear のアカウント操作が必要な確認を `[manual]` として、人がマージ・デプロイ後に行い進捗ノートに記録する、でよいか。Linear の Issue は PR のマージで自動的に `Done` になるため、`[manual]` の確認は Done の後になる（暫定: 確認で失敗したら新しい `bug` Issue を起票する。reviewer は `[manual]` を AC 充足の判定から除外する）。エージェント定義（designer / reviewer）への `[manual]` の追記は別 Issue にする（暫定）
2. **Q2 本 Issue の範囲**: コード（SDK の導入・初期化・フィルタ）と `docs/monitoring.md` の手順書までを本 Issue にし、Sentry / Linear の実際の設定は人の作業とした。これでよいか。分割は不要と判断した（純関数 2 ファイル＋ I/O 1 ファイル、設定ファイル数行、ドキュメント 1 本で収まる）
3. **Q3 Linear 連携で状態とラベルを指定できない場合**: Sentry の Linear 連携のアラートアクションで、状態（`Triage`）やラベル（`bug`・`feedback`）を指定できない場合の代替。(a) Triage を有効にしたチームへの連携による起票は既定で Triage に入るので、状態はそれに任せ、ラベルは Linear の Triage で人が付ける、(b) Linear 側の自動化（テンプレートやワークフローの自動ラベル付け）で付ける、(c) Sentry の Webhook を受けて Linear API で起票するワークフロー／スクリプトを自作する（別 Issue）。暫定: (a)、ラベルが自動で付かないことを許容する
4. **Q4 DSN の置き場所**: DSN は公開される値なので GitHub **Variables**（`vars.SENTRY_DSN`）を暫定とした。Secrets にしたい場合は `deploy.yml` の 1 行と AC-16 を `secrets.SENTRY_DSN` に変える
5. **Q5 release 名と GAM-12 の揃え方**: 暫定は `pixel-runner@<コミット SHA>`、変数名は `VITE_APP_RELEASE`。GAM-12 でバージョンタグを作るなら、そちらの設計に合わせて `pixel-runner@<タグ>` に揃えたい。どちらの Issue で `VITE_APP_RELEASE` の値を決めるか（暫定: 先にマージした方の形式に後の方が合わせる）
6. **Q6 ソースマップ**: (a) **公開**（`sourcemap: true` で Pages に置き、Sentry が URL から取得。追加の依存・Secrets なし。暫定）、(b) 非公開（`sourcemap: 'hidden'` で生成し、`deploy.yml` で `@sentry/cli` を使って Sentry にアップロードしてから `.map` を `dist` から消す。`SENTRY_AUTH_TOKEN` の Secrets と新しい依存が必要）、(c) アップロードしない（スタックトレースは minify されたまま）。リポジトリが公開されているなら (a)、非公開なら (b) を別 Issue で、を推奨
7. **Q7 送信を有効にする範囲**: `?test` と自動操作では送らない。加えて、本番以外のホスト（`npm run preview` で DSN 入りのビルドを手元で開いた場合など）を除外するために、`location.hostname` が `zawa929292.github.io` のときだけ有効にする条件も入れるか（暫定: 入れない。Sentry 側の Allowed Domains で他のオリジンからのイベントは拒否されるため）
8. **Q8 定数の置き場所**: `MONITORING` を CLAUDE.md の規約どおり `src/core/config.ts` に置いた。ゲームの定数と分けたい場合は `src/monitoring/config.ts` に置く（GAM-7 はゲーム以外の定数をモジュール内に置いた前例がある）。どちらにするか
9. **Q9 件数の上限**: 1 ページ読み込みあたり 10 件（`maxEventsPerSession`）、エラーのサンプリング率 100% でよいか。無料枠（月 5,000 件の想定）に対して、エラーが出たセッションが月 500 回までなら収まる
10. **Q10 アラートの条件**: Linear への起票は「新しい Issue ができたとき」だけにし、解決済みの Issue の再発（regression）では起票しない（暫定）。再発でも起票したいか
11. **Q11 `window.__GAME__.getMonitoring` の追加**: E2E の観測用に `getState` の隣に `getMonitoring` を足した。テスト用フックの形を他の Issue と揃える必要があれば指示がほしい（暫定: この形）
12. **Q12 パフォーマンス監視**: 本 Issue では入れず、「パフォーマンス監視の検討」の別 Issue 案を Backlog に起票するかどうかを判断してほしい（暫定: 起票は人の判断に任せ、本 Issue では起票しない）

## 改訂履歴
- 初版: 新規作成（人間のコメントなし）
