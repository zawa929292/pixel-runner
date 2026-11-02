# GAM-8: [Harness] AI 実行の監査ログ

## 目的
Claude Code（手元の WSL と GitHub Actions の claude-code-action の両方）が実行したツール呼び出し（実行コマンド・編集ファイル・結果）を、PreToolUse / PostToolUse hook で 1 呼び出し 1 行の JSONL に記録する。後から「AI がいつ何を実行し、何を編集し、どうなったか」を追えるようにする（CTC「AI 駆動開発 全体アーキテクチャ」のハーネス / 権限管理・セキュリティの差分を埋める）。

守ること:
- **秘密情報を記録しない**（伏せ字化 ＋ ファイル内容そのものは記録しない）
- **ログを肥大化させない**（フィールドの切り詰め、1 行の上限、日次ファイルと保持期間による削除）
- **hook が失敗しても AI の作業を止めない**（fail-open。確認事項 Q1）
- ログはリポジトリの中に置かない（誤ってコミットされないように）

ゲームの仕様（`docs/game-design.md`）や `src/` は変更しない。

### 前提（調査済みの事実）
- 既存の hook（`.claude/settings.json`）: PreToolUse `Bash` → `block-dangerous.sh`（exit 2 でブロック）、PostToolUse `Edit|Write` → `post-edit-lint.sh`（exit 2 で lint エラーを Claude に返す）、Notification → `notify-slack.sh`。いずれも stdin の JSON を `node -e` で読み、`tool_input.command` / `tool_input.file_path` / `message` を取り出している
- Claude Code の hook 入力（stdin JSON）の共通フィールド: `session_id`、`transcript_path`、`cwd`、`permission_mode`、`hook_event_name`。PreToolUse は `tool_name`・`tool_input`・`tool_use_id`、PostToolUse はこれに `tool_response` が加わる。exit 0 は成功、exit 2 はブロック、その他の非 0 はブロックしないエラー。PreToolUse の stdout に JSON を出すと判定として解釈されうるので、監査 hook は**何も出力しない**
- 同じイベントに一致する hook は**並列に**実行される。したがって監査 hook は `block-dangerous.sh` の判定結果を知らない。ブロックされた呼び出しは「Pre の行はあるが Post の行がない」で識別する
- `.claude/settings.json` の deny で `.env` / `.env.*` の Read は拒否済み。`block-dangerous.sh` も `cat .env` 等をブロックする
- GAM-7 の `scripts/security-review/findings.mjs` に秘密情報の正規表現 `SECRET_PATTERNS`（非公開）と `REDACTED = '[REDACTED]'`（公開）がある。`redactSecrets` は非公開
- Actions 上で claude-code-action を使うワークフロー: `ai-review.yml`（job `review`）、`security-review.yml`（job `audit`）、`linear-dispatch.yml`（job `implement`。`workflow_dispatch` のみ）。`ai-review.yml` と `security-review.yml` の audit ジョブには `actions/setup-node` がない（ランナー同梱の Node を使うことになる）
- `tests/unit/workflows.test.ts`（GAM-7 AC-14 (c)）は `security-review.yml` の本文に `Write`・`Edit` などの文字列が**含まれない**ことを検査している
- GAM-7 で暫定承認された `[ci]` タグ: GitHub Actions 上で動かして `gh` / `git` の出力で判定する AC。オーケストレーターが PR 作成後に実施し、結果を進捗ノートに記録する

## 受入条件

### タグ
- `[unit]`: `scripts/audit-log/audit.mjs` の純粋関数、`scripts/audit-log/hook.mjs`（CLI）と `.claude/hooks/audit-log.sh` を子プロセスで動かす検査、設定ファイル・ワークフローの静的な検査。`tests/unit/` の vitest で検証する
- `[ci]`: GitHub Actions 上で実際に記録されることの確認（オーケストレーターが PR 作成後に実施）
- `[e2e]`: なし（ブラウザの挙動は変わらない）

### 表記
- `CTX` = `{ now: '2026-11-02T01:02:03.000Z', source: 'local', secretValues: [] }`
- `IN(overrides)` = 次の PreToolUse の入力に `overrides` を上書きしたもの:
  `{ session_id: 's1', transcript_path: '/home/u/.claude/projects/x.jsonl', cwd: '/repo', permission_mode: 'default', hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'npm run verify', description: 'run verify' }, tool_use_id: 't1' }`
- `POST(overrides)` = `IN({ hook_event_name: 'PostToolUse', ...overrides })`
- `MAX` = `FIELD_MAX`（= 2000）、`JMAX` = `JSON_FIELD_MAX`（= 1000）、`MARK` = `TRUNCATION_MARK`（= `'…[truncated]'`）、`R` = `REDACTED`（= `'[REDACTED]'`）、`LIMIT` = `RECORD_MAX_BYTES`（= 16384）
- 「line」= `serializeRecord(buildAuditRecord(input, ctx))` の文字列

### 記録の組み立て（`buildAuditRecord`）
| ID | Given | When | Then |
|---|---|---|---|
| AC-1 [unit] Pre の基本形 | `IN({})`、`CTX` | `buildAuditRecord(input, CTX)` | 次と deep equal: `{ v: 1, ts: '2026-11-02T01:02:03.000Z', source: 'local', event: 'PreToolUse', session_id: 's1', tool_use_id: 't1', permission_mode: 'default', cwd: '/repo', tool: 'Bash', input: { command: 'npm run verify', description: 'run verify' }, truncated: false }`。`transcript_path`・`result`・`ci` のキーはない |
| AC-2 [unit] Post の Bash | `POST({ tool_response: { stdout: 'ok\n', stderr: 'warn', interrupted: false } })` | 同上 | `event: 'PostToolUse'`、`input` は AC-1 と同じ、`result` は `{ stdout: 'ok\n', stderr: 'warn', interrupted: false }`。`tool_response` が文字列 `'done'` のときは `result: { text: 'done' }` |
| AC-3 [unit] 編集系はファイル名と大きさだけ | `tool_name`/`tool_input` が次の各組。`Write` `{ file_path: '/repo/src/a.ts', content: 'SECRET-CONTENT-XYZ' }`／`Edit` `{ file_path: '/repo/src/a.ts', old_string: 'ab', new_string: 'abcd', replace_all: true }`／`MultiEdit` `{ file_path: '/repo/src/a.ts', edits: [{…}, {…}] }`／`NotebookEdit` `{ notebook_path: '/repo/n.ipynb', cell_id: 'c1', new_source: 'xyz', edit_mode: 'replace' }`。Post では `tool_response` に `{ filePath: '/repo/src/a.ts', content: 'SECRET-CONTENT-XYZ' }` | 同上 | `input` はそれぞれ `{ file_path: '/repo/src/a.ts', content_chars: 18 }`／`{ file_path: '/repo/src/a.ts', old_chars: 2, new_chars: 4, replace_all: true }`／`{ file_path: '/repo/src/a.ts', edits: 2 }`／`{ notebook_path: '/repo/n.ipynb', cell_id: 'c1', edit_mode: 'replace', new_chars: 3 }`。Post の `result` は `{ response_chars: JSON.stringify(tool_response).length }`。どの line にも `SECRET-CONTENT-XYZ` が現れない |
| AC-4 [unit] 読み取り系は内容を残さない | `Read` `{ file_path: '/repo/src/a.ts', offset: 10, limit: 5 }`（Post の `tool_response` にファイル内容 `'const k = "PLAINTEXT-BODY";'` を含む）／`Grep` `{ pattern: 'foo', path: 'src', glob: '*.ts', output_mode: 'content', '-n': true }`／`Glob` `{ pattern: '**/*.ts', path: '/repo' }` | 同上 | `input` は Read `{ file_path: '/repo/src/a.ts', offset: 10, limit: 5 }`、Grep `{ pattern: 'foo', path: 'src', glob: '*.ts', output_mode: 'content' }`（`pattern`・`path`・`glob`・`output_mode` 以外のキーは落とす）、Glob `{ pattern: '**/*.ts', path: '/repo' }`。Post の `result` は 3 つとも `{ response_chars: n }` だけ。line に `PLAINTEXT-BODY` が現れない |
| AC-5 [unit] その他のツールは JSON 文字列で | `tool_name: 'mcp__linear__save_comment'`、`tool_input: { issueId: 'GAM-8', body: 'x'.repeat(3000) }`、Post の `tool_response: { id: 'c1' }`／`tool_name: 'WebFetch'`、`tool_input: { url: 'https://example.com', prompt: 'p' }` | 同上 | `input` は `{ json: s }`（`s` は `JSON.stringify(tool_input)` を伏せ字化し `JMAX` で切り詰めたもの。1 つ目は `s` が `MARK` で終わり、`truncated: true`）。`result` は `{ json: '{"id":"c1"}' }`。2 つ目の `input.json` は `'{"url":"https://example.com","prompt":"p"}'` |
| AC-6 [unit] 記録しない入力 | `IN({ hook_event_name: 'Notification' })`／`IN({ hook_event_name: 'Stop' })`／`IN({ tool_name: undefined })`／`null`／`'text'`／`[]` | 同上 | すべて `null`（例外を投げない） |
| AC-7 [unit] 任意のフィールド | `IN({ agent_id: 'a1', agent_type: 'implementer' })`／`IN({ session_id: undefined, tool_use_id: 123 })`／`CTX` に `source: 'actions'`、`ci: { repository: 'o/r', workflow: 'AI Review', job: 'review', run_id: '42', run_attempt: '1' }` | 同上 | 1 つ目は `agent_id: 'a1'`、`agent_type: 'implementer'` を含む（入力にないときはキー自体がない）。2 つ目は `session_id: null`、`tool_use_id: null`（文字列以外は `null`）。3 つ目は `source: 'actions'` と `ci` が CTX の値と deep equal |

### 秘密情報の伏せ字化（`redactAuditText`、`isSensitivePath`）
| ID | Given | When | Then |
|---|---|---|---|
| AC-8 [unit] パターンによる伏せ字 | 次の各文字列: `'token sk-ant-oat01-AbC_123-xyz'`／`'ghp_abcdEFGH1234'`／`'ghs_abcdEFGH1234'`／`'github_pat_11ABC_def'`／`'lin_api_abcDEF123'`／`'xoxb-123-456-abc'`／`'https://hooks.slack.com/services/T0/B0/xyz'`／`'AKIAABCDEFGHIJKLMNOP'`／`'curl -H "Authorization: Bearer abcdefgh12345678"'`／`'MY_SECRET=hunter2hunter2'`／`'export SLACK_WEBHOOK_URL="https://x.example/y"'`／`'LINEAR_API_KEY: plainvalue99'`／PEM ブロック `'-----BEGIN RSA PRIVATE KEY-----\nMIIEow\nAAAA\n-----END RSA PRIVATE KEY-----'` | `redactAuditText(s, [])` | すべての出力が `R` を含み、元の秘密の部分（`AbC_123-xyz`、`abcdEFGH1234`、`11ABC_def`、`abcDEF123`、`123-456-abc`、`T0/B0/xyz`、`ABCDEFGHIJKLMNOP`、`abcdefgh12345678`、`hunter2hunter2`、`x.example/y`、`plainvalue99`、`MIIEow`、`AAAA`）を含まない。名前は残す（`'Bearer [REDACTED]'`、`'MY_SECRET=[REDACTED]'`、`'LINEAR_API_KEY: [REDACTED]'` を含む） |
| AC-9 [unit] 環境変数の値そのものの伏せ字 | `secretValues = ['s3cr3t-value-123', 'short']` | `redactAuditText('echo s3cr3t-value-123 short', secretValues)` | `'echo [REDACTED] short'`（`MIN_SECRET_VALUE_LENGTH` = 8 文字未満の値は無視する） |
| AC-10 [unit] 誤検知しない | `'npm run verify'`／`'max_tokens=100'`／`'git diff main...HEAD'`／`'const TOKEN_KIND = 1'`／`'gh pr view 8'` | `redactAuditText(s, [])` | すべて入力と同一（秘密らしい名前への代入は、名前が `TOKEN`・`SECRET` などで**終わる**ときだけ伏せる） |
| AC-11 [unit] 機微なパス | `isSensitivePath(p)` に `'.env'`／`'/repo/.env.local'`／`'config/.env.production'`／`'/repo/.env.example'`／`'/home/u/.config/slack-webhook-url'`／`'/home/u/.ssh/id_rsa'`／`'certs/key.pem'`／`'/home/u/.npmrc'`／`'src/env.ts'`／`'src/core/config.ts'`／`'docs/environment.md'` | 判定 | 前 8 つは `true`、後 3 つは `false`。`buildAuditRecord` で `Read`/`Write`/`Edit` の `file_path` が機微なパスなら、レコードに `sensitive: true` が付き（それ以外ではキー自体がない）、`input` は AC-3/AC-4 と同じ形（内容は元から記録しない） |
| AC-12 [unit] レコード全体に伏せ字が効く | `POST({ tool_input: { command: 'curl -H "Authorization: Bearer abcdefgh12345678" https://api.linear.app' }, tool_response: { stdout: 'ghp_abcdEFGH1234', stderr: 'env-secret-value-1', interrupted: false } })`、`CTX` の `secretValues: ['env-secret-value-1']`／AC-5 の mcp ツールで `body: 'lin_api_abcDEF123'` | line | line に `abcdefgh12345678`・`ghp_abcdEFGH1234`・`env-secret-value-1`・`lin_api_abcDEF123` のいずれも現れない |

### 切り詰めとシリアライズ（`truncateField`、`serializeRecord`）
| ID | Given | When | Then |
|---|---|---|---|
| AC-13 [unit] フィールドの切り詰め | `'a'.repeat(MAX)`／`'a'.repeat(MAX + 1)`／`'😀'.repeat(MAX + 5)` | `truncateField(s, MAX)` | 1 つ目 `{ text: s, truncated: false }`。2 つ目 `{ text: 'a'.repeat(MAX) + MARK, truncated: true }`。3 つ目は `text === '😀'.repeat(MAX) + MARK`（コードポイント単位で数え、サロゲートペアを割らない） |
| AC-14 [unit] 伏せ字の後に切り詰める | `POST({ tool_response: { stdout: 'x'.repeat(MAX - 5) + 'ghp_abcdEFGH1234', stderr: 'e'.repeat(MAX * 5), interrupted: false } })` | line | `result.stdout` は `ghp_` を含まず `MARK` で終わる（伏せ字を先に行うので、切り詰めでトークンの一部が残らない）。`result.stderr` の長さは `MAX + MARK.length`。`truncated: true`。`input.command` も `MAX` を超えれば同様に切り詰める |
| AC-15 [unit] 1 行の上限 | AC-1〜14 の各レコード／`command`・`description`・`stdout`・`stderr` すべてが `'😀'.repeat(3000)` の Post レコード | `serializeRecord(record)` | 戻り値は `'\n'` で終わり、それ以外に改行を含まず、`JSON.parse` できる。UTF-8 のバイト長は常に `LIMIT` 以下。2 つ目は上限を超えるので、`input` と `result` を `{ omitted: 'record too large' }` に置き換え、`truncated: true` にし、それ以外のキー（`ts`・`event`・`tool`・`tool_use_id` など）は元のまま |

### 保存先・コンテキスト・ローテーション（`resolveAuditDir`、`buildContext`、`logFileName`、`selectExpiredFiles`）
| ID | Given | When | Then |
|---|---|---|---|
| AC-16 [unit] 保存先 | `projectDir = '/repo'` と次の `env`: (a) `{ PIXEL_RUNNER_AUDIT_DIR: '/var/log/a', HOME: '/home/u' }`／(b) `{ GITHUB_ACTIONS: 'true', RUNNER_TEMP: '/rt', HOME: '/home/runner' }`／(c) `{ HOME: '/home/u' }`／(d) `{ PIXEL_RUNNER_AUDIT_DIR: '/repo/logs', HOME: '/home/u' }`／(e) `{ PIXEL_RUNNER_AUDIT_DIR: 'logs', HOME: '/home/u' }`／(f) `{}`／(g) `{ GITHUB_ACTIONS: 'true', HOME: '/home/runner' }`（`RUNNER_TEMP` なし） | `resolveAuditDir(env, projectDir)` | (a) `'/var/log/a'`。(b) `'/rt/claude-audit'`。(c) `'/home/u/.claude/audit/pixel-runner'`。(d)(e) 上書きを無視して (c) と同じ（リポジトリ内のパス・相対パスは使わない）。(f) `null`（記録しない）。(g) `'/home/runner/.claude/audit/pixel-runner'` |
| AC-17 [unit] コンテキスト | `buildContext(env, '2026-11-02T01:02:03.000Z')` に (a) `{ HOME: '/home/u', LINEAR_API_KEY: 'lin_api_long_value', GH_TOKEN: 'abc' }`／(b) `{ GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: 'o/r', GITHUB_WORKFLOW: 'AI Review', GITHUB_JOB: 'review', GITHUB_RUN_ID: '42', GITHUB_RUN_ATTEMPT: '1', GITHUB_TOKEN: 'ghs_xxxxxxxxxxxx' }` | 実行 | (a) `{ now, source: 'local', secretValues: ['lin_api_long_value'] }`（`ci` キーなし。8 文字未満の `GH_TOKEN` は含めない）。(b) `source: 'actions'`、`ci: { repository: 'o/r', workflow: 'AI Review', job: 'review', run_id: '42', run_attempt: '1' }`、`secretValues` は `['ghs_xxxxxxxxxxxx']`。対象の変数名は `SECRET_ENV_NAMES` = `['CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY', 'LINEAR_API_KEY', 'GH_TOKEN', 'GITHUB_TOKEN', 'SLACK_WEBHOOK_URL']` |
| AC-18 [unit] ファイル名 | `'2026-11-02T23:59:59.999Z'`／`'2026-11-03T00:00:00.000Z'` | `logFileName(now)` | `'2026-11-02.jsonl'`／`'2026-11-03.jsonl'`（UTC の日付） |
| AC-19 [unit] 期限切れの選択 | `names = ['2026-10-02.jsonl', '2026-10-03.jsonl', '2026-11-02.jsonl', 'notes.txt', '2026-13-01.jsonl', 'x-2026-01-01.jsonl']`、`today = '2026-11-02'`、`retentionDays = 30` | `selectExpiredFiles(names, today, retentionDays)` | `['2026-10-02.jsonl']`（`today − retentionDays` 日 = 2026-10-03 以降は残す。`YYYY-MM-DD.jsonl` の形で実在する日付以外は対象外） |

### CLI と hook（子プロセスで実行）
共通: `tmp` = `fs.mkdtempSync(os.tmpdir() + '/gam8-')`。子プロセスの env は `process.env` から `GITHUB_ACTIONS`・`RUNNER_TEMP`・`PIXEL_RUNNER_AUDIT_DIR` を除いたものに、各ケースの値を足す（CI 上の vitest でも同じ結果になるように）。stdin は `JSON.stringify(input)`。

| ID | Given | When | Then |
|---|---|---|---|
| AC-20 [unit] 記録できる | `PIXEL_RUNNER_AUDIT_DIR=tmp`、`LINEAR_API_KEY=zzz-custom-secret-123`、stdin = `POST({ tool_input: { command: 'echo zzz-custom-secret-123' }, tool_response: { stdout: 'zzz-custom-secret-123\n', stderr: '', interrupted: false } })` | `node scripts/audit-log/hook.mjs` を 2 回実行 | 2 回とも exit 0、stdout は空。`tmp/<今日の UTC 日付>.jsonl` がちょうど 2 行で、各行が `JSON.parse` でき `tool === 'Bash'`、`event === 'PostToolUse'`、`source === 'local'`。ファイルに `zzz-custom-secret-123` が現れない。POSIX ではファイルのパーミッションが `0o600` |
| AC-21 [unit] fail-open | (a) stdin = `'not json'`／(b) stdin = 空／(c) `PIXEL_RUNNER_AUDIT_DIR` が既存の**通常ファイル**を指す（ディレクトリを作れない）／(d) stdin = `IN({ hook_event_name: 'Notification' })` | `node scripts/audit-log/hook.mjs` | すべて exit 0、stdout は空、2 秒以内に終了。(a)(b)(d) は `tmp` にファイルを作らない |
| AC-22 [unit] シェルの入口 | (a) `CLAUDE_PROJECT_DIR` = リポジトリのルート、`PIXEL_RUNNER_AUDIT_DIR=tmp`、stdin = `IN({})`／(b) `CLAUDE_PROJECT_DIR=/nonexistent` | `.claude/hooks/audit-log.sh` を**直接**実行（`bash` 経由ではなく。実行ビットの確認を兼ねる） | (a) exit 0、stdout 空、`tmp` の当日ファイルに 1 行。(b) exit 0、stdout 空 |
| AC-23 [unit] ローテーション | `tmp` に `2000-01-01.jsonl` と `keep.txt` を置き、当日ファイルはない | `hook.mjs` を `IN({})` で実行 → 続けて `tmp` に `2000-01-02.jsonl` を置いてもう一度実行 | 1 回目の後: `2000-01-01.jsonl` が消え、`keep.txt` と当日ファイルが残る。2 回目の後: `2000-01-02.jsonl` は残る（削除は当日ファイルを新規作成したときだけ行う） |

### 設定ファイルとワークフローの静的な性質
| ID | Given | When | Then |
|---|---|---|---|
| AC-24 [unit] hook の登録 | `.claude/settings.json` を `JSON.parse` | 検査 | `hooks.PreToolUse` と `hooks.PostToolUse` のそれぞれに、`matcher === '*'` で、`hooks` に `command` が `.claude/hooks/audit-log.sh` を含み `timeout` が 1 以上 10 以下の要素がちょうど 1 つある。既存の 3 つ（PreToolUse `Bash` → `block-dangerous.sh`、PostToolUse `Edit\|Write` → `post-edit-lint.sh`、Notification → `notify-slack.sh`）が残っている。`permissions.allow` / `permissions.deny` は本 Issue 前の要素をすべて含む（他 Issue による追加は許す） |
| AC-25 [unit] ワークフローの artifact | `.github/workflows/ai-review.yml`、`security-review.yml`、`linear-dispatch.yml` をテキストとして読む | 文字列・正規表現で検査 | 3 ファイルそれぞれに `actions/upload-artifact@v4` を使い、`name: claude-audit-` で始まり、`path: ${{ runner.temp }}/claude-audit/`、`retention-days: 14`、`if-no-files-found: ignore` を含むステップがある（`if:` に `always()` を含む）。`security-review.yml` は既存の GAM-7 AC-14 (b)(c) を満たし続ける（`Write`・`Edit` を含まない。既存テストがそのまま通ること） |
| AC-26 [unit] 既存の秘密パターンの共有 | `scripts/lib/secrets.mjs` の `redactSecrets` | AC-8 の前 8 つ（トークン形式）の文字列を通す | すべて `R` を含む。`tests/unit/security-review.test.ts` は**変更せずに**通る（`findings.mjs` の挙動は変わらない） |

### GitHub Actions 上での確認
| ID | Given | When | Then |
|---|---|---|---|
| AC-27 [ci] Actions で記録される | GAM-8 の PR（draft でない） | `AI Review` と `Security Review` の完了を待ち、各 run で `gh run download <run-id> -n claude-audit-review -D a`、`gh run download <run-id> -n claude-audit-security-audit -D b` | 両方とも `.jsonl` が 1 つ以上あり、全行が `JSON.parse` でき、`source === 'actions'` で `ci.run_id` がその run の ID と一致する行がある。`a` には `tool === 'Bash'` かつ `input.command` が `gh pr` を含む行が 1 つ以上ある。`grep -rEn 'sk-ant-[A-Za-z0-9_-]{8,}\|gh[pousr]_[A-Za-z0-9]{8,}\|github_pat_[A-Za-z0-9_]{8,}\|lin_(api\|oauth)_[A-Za-z0-9]{8,}' a b` が何も出さない（差分に含まれるテスト用の偽トークンも伏せ字になっているはず）。既存のチェック（`CI / verify`、`Security Review / security-gate` など）が `SUCCESS` |

## 設計

### 全体構成
```
Claude Code（手元 WSL / Actions の claude-code-action）
 └─ ツール呼び出しごとに PreToolUse・PostToolUse（matcher "*"）
     └─ .claude/hooks/audit-log.sh          … 入口。node を呼び、常に exit 0・出力なし
         └─ scripts/audit-log/hook.mjs       … I/O だけ（stdin 読み・env 読み・追記・期限切れ削除）
             └─ scripts/audit-log/audit.mjs  … 純粋関数（組み立て・伏せ字・切り詰め・保存先・ローテーション判定）
                 └─ scripts/lib/secrets.mjs  … 秘密パターン（GAM-7 の findings.mjs と共有）
保存先
 ├─ 手元: ~/.claude/audit/pixel-runner/YYYY-MM-DD.jsonl（UTC 日付、30 日保持、0600）
 └─ Actions: $RUNNER_TEMP/claude-audit/YYYY-MM-DD.jsonl → upload-artifact（14 日保持）
```

### 変更ファイル一覧
| ファイル | 種別 | 内容 |
|---|---|---|
| `scripts/lib/secrets.mjs` | 新規 | `findings.mjs` から `SECRET_PATTERNS`・`REDACTED`・`redactSecrets` を移して export する（正規表現は 1 文字も変えない） |
| `scripts/lib/secrets.d.mts` | 新規 | 型宣言 |
| `scripts/security-review/findings.mjs` | 変更 | 上記を `../lib/secrets.mjs` から import する。`REDACTED` は re-export して公開 API を維持。挙動は変えない |
| `scripts/audit-log/audit.mjs` | 新規 | 純粋関数（I/O・`process`・`fs` を使わない） |
| `scripts/audit-log/audit.d.mts` | 新規 | 型宣言 |
| `scripts/audit-log/hook.mjs` | 新規 | CLI。判断はすべて `audit.mjs` に委ねる |
| `.claude/hooks/audit-log.sh` | 新規 | 入口（実行ビット付き、git のモード `100755`） |
| `.claude/settings.json` | 変更 | `hooks.PreToolUse` と `hooks.PostToolUse` に要素を 1 つずつ**追加**（既存の要素・`permissions` は変えない） |
| `.github/workflows/ai-review.yml` | 変更 | `review` ジョブ末尾に artifact のアップロードステップを追加 |
| `.github/workflows/security-review.yml` | 変更 | `audit` ジョブ末尾に同上 |
| `.github/workflows/linear-dispatch.yml` | 変更 | `implement` ジョブ末尾に同上 |
| `tests/unit/audit-log.test.ts` | 新規 | AC-1〜23 |
| `tests/unit/harness-config.test.ts` | 新規 | AC-24〜26 |
| `docs/audit-log.md` | 新規 | 保存先・保持期間・レコードの形・読み方（`jq` の例）・秘密情報の扱い・Actions での取り出し方（`gh run download`） |

### `.claude/settings.json` の追加分
既存の配列の末尾に要素を足すだけにする（既存の `Bash` / `Edit|Write` の要素に混ぜない。並列実行なので順序は挙動に影響しない）。次を `PreToolUse` と `PostToolUse` の両方に追加する。
```json
{ "matcher": "*", "hooks": [{ "type": "command", "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/audit-log.sh", "timeout": 5 }] }
```

### `.claude/hooks/audit-log.sh`
```bash
#!/usr/bin/env bash
# PreToolUse/PostToolUse(*): AI のツール実行を監査ログ（JSONL）に記録する（GAM-8）。
# 失敗しても AI の作業は止めない（fail-open）: 常に exit 0、stdout/stderr には何も出さない。
node "${CLAUDE_PROJECT_DIR:-.}/scripts/audit-log/hook.mjs" >/dev/null 2>&1
exit 0
```
- stdin はそのまま node に渡る。stdout を捨てるのは、PreToolUse の stdout の JSON が判定として解釈されるのを防ぐため

### `scripts/audit-log/hook.mjs`（I/O のみ）
1. stdin をすべて読む。`JSON.parse` に失敗したら終了（exit 0）
2. `now = new Date().toISOString()`、`ctx = buildContext(process.env, now)`、`record = buildAuditRecord(input, ctx)`。`null` なら終了
3. `dir = resolveAuditDir(process.env, process.env.CLAUDE_PROJECT_DIR ?? process.cwd())`。`null` なら終了
4. `mkdirSync(dir, { recursive: true, mode: 0o700 })`。`file = join(dir, logFileName(now))`。当日ファイルが存在しなかったかを記録
5. `appendFileSync(file, serializeRecord(record), { mode: 0o600 })`（1 回の書き込みで 1 行。複数のサブエージェントが同時に追記しても、`LIMIT` 以下の 1 回の追記なので行は混ざらない想定）
6. 当日ファイルを新規作成した場合だけ、`readdirSync(dir)` → `selectExpiredFiles(names, now.slice(0, 10), RETENTION_DAYS)` → 各ファイルを `unlinkSync`（個別に try/catch）
7. 全体を try/catch で囲み、どの例外でも何も出力せず exit 0。stdin が閉じない場合に備え、`HOOK_INTERNAL_TIMEOUT_MS`（= 2000、`hook.mjs` 内の名前付き定数）で `process.exit(0)` するタイマーを置く（`unref()`）
- ランナー同梱の Node（`setup-node` のないジョブ）でも動くよう、Node 20 で使える API だけを使う。依存パッケージは使わない

### `scripts/audit-log/audit.mjs`（純粋関数）
`audit.d.mts`:
```ts
export type AuditEvent = 'PreToolUse' | 'PostToolUse' | 'PostToolUseFailure';
export interface CiInfo { repository: string; workflow: string; job: string; run_id: string; run_attempt: string }
export interface AuditContext { now: string; source: 'local' | 'actions'; ci?: CiInfo; secretValues: string[] }
export interface AuditRecord {
  v: 1;
  ts: string;
  source: 'local' | 'actions';
  ci?: CiInfo;
  event: AuditEvent;
  session_id: string | null;
  tool_use_id: string | null;
  agent_id?: string;
  agent_type?: string;
  permission_mode: string | null;
  cwd: string | null;
  tool: string;
  input: Record<string, unknown>;
  sensitive?: true;
  result?: Record<string, unknown>;   // PostToolUse / PostToolUseFailure のみ
  error?: string;                      // PostToolUseFailure のみ（入力の error を伏せ字化・切り詰め）
  truncated: boolean;
}

export const AUDIT_SCHEMA_VERSION: 1;
export const FIELD_MAX: number;               // 2000（command / description / stdout / stderr / text / error / パス）
export const JSON_FIELD_MAX: number;          // 1000（その他のツールの input.json / result.json）
export const RECORD_MAX_BYTES: number;        // 16384
export const RETENTION_DAYS: number;          // 30（手元）
export const MIN_SECRET_VALUE_LENGTH: number; // 8
export const TRUNCATION_MARK: string;         // '…[truncated]'
export const LOCAL_AUDIT_SUBDIR: string;      // '.claude/audit/pixel-runner'
export const ACTIONS_AUDIT_SUBDIR: string;    // 'claude-audit'
export const SECRET_ENV_NAMES: readonly string[];
export const REDACTED: string;                // secrets.mjs の re-export

export function buildAuditRecord(input: unknown, ctx: AuditContext): AuditRecord | null;
export function redactAuditText(text: string, secretValues: string[]): string;
export function isSensitivePath(path: string): boolean;
export function truncateField(text: string, max: number): { text: string; truncated: boolean };
export function serializeRecord(record: AuditRecord): string;
export function resolveAuditDir(env: Record<string, string | undefined>, projectDir: string): string | null;
export function buildContext(env: Record<string, string | undefined>, now: string): AuditContext;
export function logFileName(now: string): string;
export function selectExpiredFiles(names: string[], today: string, retentionDays: number): string[];
```

ツールごとの要約（`input` / `result`）:
| tool_name | `input` | `result`（Post） |
|---|---|---|
| `Bash` | `command`、`description`（あれば）、`run_in_background`（あれば）。文字列は伏せ字 → `FIELD_MAX` で切り詰め | `stdout`・`stderr`（同上）、`interrupted`（boolean ならそのまま）。`tool_response` が文字列なら `{ text }` |
| `Write` | `file_path`、`content_chars` | `{ response_chars }` |
| `Edit` | `file_path`、`old_chars`、`new_chars`、`replace_all`（あれば） | 同上 |
| `MultiEdit` | `file_path`、`edits`（件数） | 同上 |
| `NotebookEdit` | `notebook_path`、`cell_id`・`edit_mode`（あれば）、`new_chars` | 同上 |
| `Read` | `file_path`、`offset`・`limit`（あれば） | 同上 |
| `Grep` | `pattern`、`path`・`glob`・`output_mode`（あれば） | 同上 |
| `Glob` | `pattern`、`path`（あれば） | 同上 |
| その他（`mcp__*`、`WebFetch`、`WebSearch`、`Agent`/`Task`、`TodoWrite` など） | `{ json }`（`JSON.stringify(tool_input)` を伏せ字 → `JSON_FIELD_MAX`） | `{ json }`（`tool_response` を同様に） |
- パス（`file_path` など）・`pattern` も伏せ字を通し、`FIELD_MAX` で切り詰める
- `response_chars` は `JSON.stringify(tool_response ?? null).length`
- `PostToolUseFailure` は Claude Code の版が対応していれば登録する（確認事項 Q4）。`buildAuditRecord` は受け付け、`error` に入力の `error`（文字列）を伏せ字・切り詰めて入れる
- どこかのフィールドを切り詰めたら `truncated: true`
- `buildAuditRecord` は入力を書き換えない

`redactAuditText(text, secretValues)` の処理順:
1. `secretValues` のうち長さ `MIN_SECRET_VALUE_LENGTH` 以上の値を、長い順にリテラル置換（正規表現として解釈しない）で `R` にする
2. PEM ブロック全体 `/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g` → `R`（共有パターンはヘッダー行だけを伏せるため、本文ごと伏せる処理を先に行う）
3. `redactSecrets`（共有パターン）
4. `Bearer` トークン: `/\b(Bearer)\s+[A-Za-z0-9._~+\/=-]{8,}/gi` → `'$1 ' + R`
5. 秘密らしい名前への代入（名前がキーワードで**終わる**もの）: `/\b([A-Za-z0-9_]*(?:TOKEN|SECRET|PASSWORD|PASSWD|API_KEY|APIKEY|WEBHOOK_URL|PRIVATE_KEY|CREDENTIALS?))(\s*[=:]\s*)("[^"]*"|'[^']*'|[^\s"',;]+)/gi` → `'$1$2' + R`（`max_tokens=100`・`TOKEN_KIND = 1` は名前がキーワードで終わらないので対象外。AC-10）
- 2・4・5 は監査ログ専用の追加パターンで、`secrets.mjs` には入れない（GAM-7 の PR コメントの挙動を変えないため。確認事項 Q6）

`isSensitivePath(path)`: `\` を `/` に揃え、最後の要素（basename）で判定する。`true` になるのは: basename が `.env` または `.env.` で始まる、`slack-webhook-url`、`.npmrc`、`.netrc`、`id_rsa`・`id_ed25519`・`id_ecdsa`（`.pub` 以外）、拡張子が `.pem`・`.key`・`.p12`、またはパスに `/.ssh/` を含む

`resolveAuditDir(env, projectDir)`:
1. `PIXEL_RUNNER_AUDIT_DIR` が絶対パスで、`projectDir` 自身でも配下でもなければそれ（`path.posix` で正規化して比較）
2. `GITHUB_ACTIONS === 'true'` かつ `RUNNER_TEMP` があれば `${RUNNER_TEMP}/claude-audit`
3. `HOME` があれば `${HOME}/.claude/audit/pixel-runner`
4. それ以外は `null`
- `node:path` の `posix` だけを使う（`fs` は使わない）

`buildContext(env, now)`: `GITHUB_ACTIONS === 'true'` なら `source: 'actions'` と `ci`（`GITHUB_REPOSITORY`・`GITHUB_WORKFLOW`・`GITHUB_JOB`・`GITHUB_RUN_ID`・`GITHUB_RUN_ATTEMPT`。ないものは `''`）。`secretValues` は `SECRET_ENV_NAMES` の順に、値の長さが `MIN_SECRET_VALUE_LENGTH` 以上のもの

`serializeRecord(record)`: `JSON.stringify(record) + '\n'`。UTF-8 のバイト長（`TextEncoder`）が `RECORD_MAX_BYTES` を超えたら、`input`・`result` を `{ omitted: 'record too large' }` に置き換え、`error` があれば削り、`truncated: true` にして再シリアライズ（残るメタデータは短いので必ず収まる）

定数は `src/core/config.ts` ではなくこのモジュール内に名前付きで置く（ゲームの定数ではないため。GAM-7 と同じ方針）。

### ワークフローへの追加
3 ファイルの各ジョブ末尾に次の形のステップを追加する（artifact 名は固定文字列）。
```yaml
      - name: upload claude audit log
        if: ${{ always() }}
        uses: actions/upload-artifact@v4
        with:
          name: claude-audit-review
          path: ${{ runner.temp }}/claude-audit/
          retention-days: 14
          if-no-files-found: ignore
```
| ファイル | ジョブ | `name` | `if` |
|---|---|---|---|
| `ai-review.yml` | `review` | `claude-audit-review` | `${{ always() }}` |
| `security-review.yml` | `audit` | `claude-audit-security-audit` | `${{ always() }}` |
| `linear-dispatch.yml` | `implement` | `claude-audit-implement` | `${{ always() && steps.pick.outputs.issue != '' }}` |
- `security-review.yml` に `Write` / `Edit` を含む文字列を入れない（ステップ名・コメントも。GAM-7 AC-14 (c)）
- artifact のアップロードに追加の `permissions` は不要
- ログの書き込み先は `hook.mjs` が `GITHUB_ACTIONS` / `RUNNER_TEMP` から自動で決めるので、ワークフローへの env の追加は不要

### 保持期間とローテーション
| 環境 | 保存先 | ファイル | 保持 | 削除のタイミング |
|---|---|---|---|---|
| 手元（WSL） | `~/.claude/audit/pixel-runner/` | UTC 日付ごと `YYYY-MM-DD.jsonl`、`0600`（ディレクトリ `0700`） | 30 日（`RETENTION_DAYS`） | その日最初の記録時に期限切れを削除 |
| Actions | `$RUNNER_TEMP/claude-audit/` → artifact | 同上 | 14 日（`retention-days`） | GitHub が自動削除 |
- 1 行は最大 16 KiB。1 日のツール呼び出しが 2,000 回（Pre・Post で 4,000 行）でも最悪 64 MiB、通常は 1 行 1 KiB 未満で数 MiB に収まる見込み

### `docs/audit-log.md`
- 目的、保存先と保持期間（上の表）、レコードの形（`AuditRecord` のキーの説明）、「Pre があり Post がない = ブロック・拒否・失敗」の読み方
- 例: `jq -c 'select(.tool=="Bash" and .event=="PostToolUse") | {ts, cmd: .input.command}' ~/.claude/audit/pixel-runner/2026-11-02.jsonl`、`gh run download <run-id> -n claude-audit-review`
- 記録しないもの: ファイルの内容（Write の content、Read の結果、Edit の差分）、秘密情報（伏せ字のルールの要約）。伏せ字は完全ではないので、ログファイル・artifact を共有しないこと
- 保存先の変更: `PIXEL_RUNNER_AUDIT_DIR`（絶対パス、リポジトリ外のみ）

## テスト計画
- Unit: `tests/unit/audit-log.test.ts` — AC-1〜23
  - `import { … } from '../../scripts/audit-log/audit.mjs'`（型は `audit.d.mts`。`tsconfig.json` の `include` は変更しない。GAM-7 と同じ）
  - AC-20〜23 は `node:child_process` の `spawnSync`（`input` に stdin、`timeout: 5000`）で実行する。env から `GITHUB_ACTIONS`・`RUNNER_TEMP`・`PIXEL_RUNNER_AUDIT_DIR` を必ず除く（CI では `GITHUB_ACTIONS=true` のため）。`tmp` は `afterEach` で削除
  - AC-20 のパーミッション確認は `process.platform !== 'win32'` のときだけ行う（`it.skip` は使わず、条件分岐で `expect` を省く）
  - AC-21 の「2 秒以内」は `spawnSync` の前後の経過時間で判定する
- Unit: `tests/unit/harness-config.test.ts` — AC-24〜26。`.claude/settings.json` は `JSON.parse`、ワークフローは `readFileSync` でテキストとして読む（YAML パーサーは追加しない）
- 既存の `tests/unit/security-review.test.ts`・`tests/unit/workflows.test.ts` は変更しない（AC-25・AC-26）
- CI: AC-27 はオーケストレーターが PR 作成後に実施し、進捗ノートに `### <日時> [orchestrator] AC-27 PASS — <PR URL> <run URL>` の形で記録する
- E2E: なし
- 手元での動作確認（AC にはしない。推奨）: マージ後、新しい Claude Code セッションで `/hooks` に audit-log が表示され、`~/.claude/audit/pixel-runner/` の当日ファイルに行が増えることを人が確認する（Claude Code は起動時に hook 設定を読み込むため、設定変更は実行中のセッションには反映されないことがある）
- `npm run verify` が green であること

## 影響範囲・リスク
- **`.claude/settings.json` の衝突（並行 Issue）**: GAM-9（Skills 化）・GAM-13（Context7 / `.mcp.json`）も `.claude/` を触り、`settings.json` の `permissions.allow` や `hooks` を変更する可能性がある。本 Issue は `hooks.PreToolUse` / `hooks.PostToolUse` の**配列末尾に要素を足すだけ**にし、`permissions` と既存要素は変えない。後からマージする側がリベースして JSON の構文と AC-24 を通すこと。AC-24 の `permissions` の検査は「本 Issue 前の要素を含む」なので、他 Issue の追加では壊れない。逆に、他 Issue が既存の `permissions` や hook を削ると AC-24 が失敗する（意図した検知）。`.mcp.json`（GAM-13）は本 Issue では触らないが、MCP ツール（`mcp__context7__*` など）の呼び出しは matcher `*` により自動的に記録対象になる
- **ハーネス自身の変更**: `.github/workflows/*` と `scripts/security-review/findings.mjs` を変更するので、GAM-7 の `touchesHarness` により Security Review の総評に警告が出る（想定どおり）。`findings.mjs` の変更は import の付け替えだけで、`security-review.test.ts` を変えずに通すことで挙動が同じことを示す
- **担当エージェントの書き込み範囲**: implementer の範囲（`src/**`、`tests/unit/**`）に `scripts/`・`.claude/`・`.github/`・`docs/audit-log.md` が含まれない。GAM-7 と同様に、オーケストレーターが本 spec の変更ファイル一覧に範囲を限定して委任する必要がある
- **実装中に hook 自身が動く**: 実装中のセッションで `settings.json` の変更が反映されると、実装 AI 自身のツール呼び出しも記録される。`hook.mjs` が未完成の間は失敗するが、入口の `.sh` が常に exit 0 なので作業は止まらない。`.sh` と `settings.json` の変更は最後に行うことを推奨
- **性能**: すべてのツール呼び出しで node を 2 回起動する（1 回あたり数十 ms の見込み）。`timeout: 5` 秒と内部の 2 秒のタイマーで上限を設ける
- **伏せ字の限界**: パターンにない形式の秘密（独自形式のパスワードなど）は残りうる。ファイル内容は記録しない、出力は切り詰める、ログはリポジトリ外で `0600`、artifact は 14 日、で被害を抑える。artifact は**リポジトリの読み取り権限があれば誰でもダウンロードできる**（公開リポジトリなら GitHub にログインした誰でも）点に注意（確認事項 Q3）
- **claude-code-action が project の hook を読むか**: Actions で `.claude/settings.json` の hook が実行される前提。実行されない場合、artifact は `if-no-files-found: ignore` で空のまま成功するため、AC-27 で初めて分かる。その場合は推測で代替せず停止して確認事項 Q5 を人に戻す
- **`pull_request` のワークフローは PR 側の定義で動く**: PR で `settings.json` や `hook.mjs` を書き換えれば Actions 上の記録を弱められる（GAM-7 と同じ構造の限界）。`touchesHarness` の警告対象に `.claude/` は入っていない（確認事項 Q8）
- **並列追記**: サブエージェントの並列実行で同じファイルに同時追記しうる。1 行 16 KiB 以下の 1 回の `appendFile` なので通常のローカルファイルシステムでは行は混ざらない想定だが、保証ではない

## 確認事項（人間に判断してほしいこと。暫定案で設計済み）
1. **Q1 fail-open でよいか**: 記録に失敗しても AI の作業は止めない（常に exit 0）。監査の欠落より作業の継続を優先する。暫定: fail-open。逆に「記録できないならツール実行をブロックする（fail-closed）」にすると、ディスク満杯や Node の不具合で全作業が止まる
2. **Q2 保存先**: 手元は `~/.claude/audit/pixel-runner/`（Claude Code の設定ディレクトリの下。リポジトリ外）、Actions は artifact。`~/.local/state/pixel-runner/claude-audit/`（XDG）など別の場所がよければ指定してほしい。`PIXEL_RUNNER_AUDIT_DIR` で上書きはできる
3. **Q3 保持期間と artifact の公開範囲**: 手元 30 日、Actions artifact 14 日を暫定とした。リポジトリが公開の場合、artifact は第三者も取得できる。それを避けたい場合は (a) Actions では記録しない、(b) artifact をやめて job のログに件数などの要約だけ出す、のどちらかにする。暫定: 伏せ字・内容非記録・切り詰めを前提に 14 日残す
4. **Q4 失敗したツール呼び出しの記録**: 新しい Claude Code には失敗時の `PostToolUseFailure` イベントがあるとされるが、手元の版で使えるかは未確認。暫定: `buildAuditRecord` は対応しておき、実装時に `claude --version` とドキュメントで確認できた場合だけ `settings.json` に登録する。使えなければ「Pre だけで Post がない」で失敗・ブロックを識別する（`docs/audit-log.md` に書く）
5. **Q5 claude-code-action で hook が動かない場合**: 暫定: 停止して人に戻す。代替案は (a) action の出力 `execution_file`（実行のトランスクリプト）を同じ `audit.mjs` で JSONL に変換するステップを追加する、(b) `claude_args` の `--settings` で hook を明示的に渡す。どちらを採るか
6. **Q6 伏せ字パターンの共有範囲**: GAM-7 の `SECRET_PATTERNS` を `scripts/lib/secrets.mjs` に切り出して両方から使う（`findings.mjs` の挙動は変えない）。監査ログ専用の追加パターン（Bearer、`*_TOKEN=` などの代入、PEM 本文、既知の環境変数の値）を `secrets.mjs` に入れて GAM-7 の PR コメントの無害化にも適用するか。暫定: 本 Issue では監査ログ専用に留める。別案として、`findings.mjs` を一切触らずパターンを複製する方法もある（重複するが GAM-7 のファイルを変えずに済む）
7. **Q7 記録する範囲**: Edit/Write は「ファイル名と文字数」だけで、差分は記録しない（差分は git にあるため）。Read・Grep・Glob の結果も文字数だけ。MCP（Linear など）は入力・結果を 1000 文字までの JSON で記録する（Issue のコメント本文などが残る）。これでよいか。差分（伏せ字・切り詰めあり）も残したい場合は指示してほしい
8. **Q8 `.claude/` のハーネス警告**: GAM-7 の `HARNESS_PATHS` に `.claude/hooks/`・`.claude/settings.json`・`scripts/audit-log/` を加えると、hook を変更する PR で Security Review が警告を出すようになる。暫定: 本 Issue には含めない（GAM-7 の AC と挙動を変えるため、必要なら別 Issue）
9. **Q9 linear-dispatch.yml の確認**: `workflow_dispatch` のみで、`Approved` の Issue がないと Claude が動かないため、AC-27 では確認しない。静的な検査（AC-25）だけでよいか
10. **Q10 セッション単位のイベント**: `SessionStart` / `SessionEnd` / `UserPromptSubmit`（人の指示の本文）は記録しない。ツール実行の監査に絞る。人の指示も残したい場合は別 Issue にする
11. **Q11 CLAUDE.md への参照追加**: 「参照すべきドキュメント」に `docs/audit-log.md` を加えるかは人が判断する（本 spec の変更ファイルには含めない）

分割は不要と判断した（純粋関数のモジュール 1 本と CLI・入口スクリプト、設定 1 か所、ワークフロー 3 か所への同じステップの追加で 1 Issue に収まる）。分けるなら「(A) 手元の記録（AC-1〜24, 26）」と「(B) Actions の artifact 化（AC-25, 27）」に分割できる。

## 改訂履歴
- 初版: 新規作成（人間のコメントなし）
