# GAM-9: [Harness] 繰り返し手順の Skills 化

## 目的
`/plan-issue`・`/implement`・`/next-issue` に重複して書かれている共通手順を `.claude/skills/<name>/SKILL.md` に切り出し、手順の定義を 1 か所にまとめる。対象は「Linear の状態確認」「未対応の人の指示の抽出」「進捗ノートの更新」と、あわせて「ブランチ・push・PR」。各コマンドには自分だけの手順（モード判定・サブエージェントの起動順・停止条件など）を残し、共通部分はスキルを参照する形にする。運用で分かったこと（hook の誤ブロック、Linear の自動リンク、非 ASCII のブランチ名など）もスキルに書いて、同じ失敗を繰り返さないようにする。

ゲームの仕様（`docs/game-design.md`）や `src/` は変更しない。

### 前提（調査済みの事実）
- 共通手順の重複箇所（main の現状）
  | 手順 | 書かれている場所 |
  |---|---|
  | Issue の取得（説明・全コメント・ラベル・状態・gitBranchName・添付 PR）と、状態による着手判定 | `plan-issue.md` 1 章、`implement.md` 1 章 |
  | 未対応の人の指示の定義「最新の `🤖` コメントより新しい、`🤖` で始まらないコメント」 | `plan-issue.md` 10 行目、`implement.md` 9 行目、`next-issue.md` 5 行目（ほかに `CLAUDE.md` 37 行目、`docs/workflow-graph.md`「人の指示の見分け方」） |
  | ブランチの準備「gitBranchName のブランチに切り替え（なければ main から作成）」 | `plan-issue.md` 11 行目、`implement.md` 18 行目 |
  | 進捗ノートの読み込み・追記（`### <日時> [orchestrator] …`） | `plan-issue.md` 11・19 行目、`implement.md` 6 行目と各章 |
  | コミット・push・Linear への `🤖` コメント | `plan-issue.md` 3 章、`implement.md` 5・6 章 |
- 進捗ノートの形式の定義は `specs/README.md`、Linear コメントの形式は `docs/examples/linear-comments.md` にある。これらは形式の定義元のまま残し、スキルからは参照するだけにする（形式を二重に持たない）
- 運用で分かったこと（記録のある場所）
  - `git push … && gh pr create --base main …` のように push と `--base main` を 1 つのコマンドに入れると、`.claude/hooks/block-dangerous.sh` 8 行目の正規表現（`git push.*[[:space:]](origin[[:space:]]+)?(HEAD:)?main([[:space:]]|$)`）に当たってブロックされる（main への push ではないのに）
  - Linear の GitHub 連携は、PR のタイトル（とブランチ名）に含まれる `GAM-n` で PR を Issue に自動でリンクする。検証用の PR も Issue にリンクされ、閉じた後にリンクを外す必要があった（`specs/GAM-7.progress.md` 18:15・18:30）
  - claude-code-action は base ブランチ名に非 ASCII 文字があると `Invalid branch name` で失敗する。Linear の gitBranchName は日本語を含むことがある（例 `zawa929292/gam-7-harness-ci-にセキュリティ検査を追加（…`）ため、スタック PR では AI レビューとセキュリティレビューが動かない。ASCII 名のコピーブランチを base にして回避した（`specs/GAM-7.progress.md` 18:10〜18:30）
  - 進捗ノートの日時が前後している（`GAM-2.progress.md` 15:20 → 15:30 → 15:20、`GAM-7.progress.md` 16:50 → 16:38、17:50 → 17:10）。日時を推測で書いているため。`date` コマンドで取得すれば防げる
  - Approved への移動に「承認します」のような承認だけのコメントが付くことがある（`GAM-7.progress.md` 16:30）。これは差し戻しの指示ではなく「確認事項を暫定案で承認」と記録した
- `implementer` の書き込み範囲（`src/**`、`tests/unit/**`、`docs/game-design.md`、進捗ノート）には `.claude/**` と `docs/workflow-graph.md` が含まれない（GAM-7 と同じ状況。確認事項 Q6）
- `tests/unit/workflows.test.ts`（GAM-7）は、YAML パーサーを使わずに `node:fs` でファイルをテキストとして読んで静的に検査している。本 Issue も同じやり方にする

## 受入条件

### タグ
ブラウザの動作は変わらないので `[e2e]` はなし。GitHub Actions 上での確認も不要なので `[ci]` もなし。すべて `[unit]`（`tests/unit/skills.test.ts` で Markdown をテキストとして読んで検査する）。

表記:
- `SKILLS` = `['linear-issue-status', 'human-instructions', 'progress-note', 'branch-and-pr']`
- `P(name)` = 文字列 `` `.claude/skills/${name}/SKILL.md` ``（コマンドからの参照に使うパス表記）
- `DEF` = 文字列 ``最新の `🤖` コメントより新しい、`🤖` で始まらないコメント``（`CLAUDE.md` 37 行目と同じ文）
- 「frontmatter」 = ファイル先頭の `---` の行から、次の `---` の行までの間。各行を最初の `: ` で分けて key / value とする（値の前後の空白と、値全体を囲む `"` / `'` は外す）
- 「`bash` ブロック」 = `` ```bash `` の行から次の `` ``` `` の行までの中身。「`text` ブロック」も同様

### スキルの構造
| ID | Given | When | Then |
|---|---|---|---|
| AC-1 [unit] スキルの一覧 | リポジトリの `.claude/skills/` | `readdirSync` でディレクトリを列挙 | ディレクトリ名の集合が `SKILLS` とちょうど一致（過不足なし）。各ディレクトリに `SKILL.md` がある |
| AC-2 [unit] frontmatter の必須キー | `SKILLS` の各 `SKILL.md` | frontmatter を解析 | 1 行目が `---`。閉じる `---` の行がある。`name` と `description` のキーがある。`name` はディレクトリ名と一致し、`/^[a-z0-9-]{1,64}$/` に一致。`description` は 1 文字以上 1024 文字以下で、`/plan-issue`・`/implement`・`/next-issue` のうち少なくとも 1 つを含む（どのコマンドから使うかを書く） |
| AC-3 [unit] 本文の共通構成 | `SKILLS` の各 `SKILL.md` | 本文（frontmatter の後）を行単位で読む | 行頭が `## 入力`・`## 手順`・`## 出力` の見出しがこの順に 1 つずつある。ファイル全体が 200 行以下 |

### 各スキルの中身
| ID | Given | When | Then |
|---|---|---|---|
| AC-4 [unit] linear-issue-status | `linear-issue-status/SKILL.md` | テキスト検査 | 次の文字列をすべて含む: `gitBranchName`、`ラベル`、`全コメント`、`添付`、`P('human-instructions')`、`🤖`、`docs/examples/linear-comments.md`、`docs/linear-setup.md`、`許可する状態`（呼び出し側が許可する状態の一覧を渡し、外れていたら Linear を変更せずに中止する手順があること） |
| AC-5 [unit] human-instructions の定義が CLAUDE.md と一致 | `CLAUDE.md` と `human-instructions/SKILL.md` | テキスト検査 | 両方が `DEF` を含む（どちらかを書き換えたらテストが落ち、片方だけ変わることを防ぐ） |
| AC-6 [unit] human-instructions の細則 | `human-instructions/SKILL.md` | テキスト検査 | 次の文字列をすべて含む: `createdAt`（作成日時で並べる）、`スレッド`（返信も対象に含める）、`編集`（編集は検知しない）、`🤖 コメントがない`（その場合は `🤖` で始まらない全コメントが対象）、`承認`（承認だけのコメントの扱い）、`原文`（指示は要約せず原文で引き継ぐ） |
| AC-7 [unit] progress-note | `progress-note/SKILL.md` | テキスト検査 | 次の文字列をすべて含む: `specs/README.md`（形式の定義元として参照）、`追記のみ`、`## 現在の状態`、`## ログ`、`[orchestrator]`。さらに `bash` ブロックの中に `date '+%Y-%m-%d %H:%M'` を含む行がある（日時はコマンドで取得する） |
| AC-8 [unit] branch-and-pr の知見 | `branch-and-pr/SKILL.md` | テキスト検査 | 次の文字列をすべて含む: `gitBranchName`、`GAM-n`、`Fixes`、`自動でリンク`（Linear の GitHub 連携）、`非 ASCII`、`claude-code-action`、`In Review`。`bash` ブロックの中に `git push` を含む行と `gh pr create` を含む行がそれぞれ 1 行以上ある。`bash` ブロックの中に、`git push` と `--base` を同じ行に含む行はない |
| AC-9 [unit] branch-and-pr のコマンド例が hook を通る | `branch-and-pr/SKILL.md` の `bash` ブロックで `git push` を含む各行と、`text` ブロックで `git push` と `--base main` を同じ行に含む行（NG 例。1 行以上あること） | 各行を `{"tool_input":{"command":<行>}}` として `.claude/hooks/block-dangerous.sh` の標準入力に渡し、`spawnSync('bash', [hook])` で実行する。環境変数 `CLAUDE_PROJECT_DIR` は `mkdtempSync` で作った git 管理外の一時ディレクトリにする（現在のブランチ判定を空にするため） | `bash` ブロックの行はすべて終了コード 0。`text` ブロックの NG 例はすべて終了コード 2（スキルに書いた「同じコマンドに入れるとブロックされる」が hook の実際の挙動と一致していること。hook が直されたらこのテストが落ちるので、スキルの記述も直す） |

### コマンドからの参照と重複の除去
| ID | Given | When | Then |
|---|---|---|---|
| AC-10 [unit] コマンドがスキルを参照する | `.claude/commands/plan-issue.md`・`implement.md`・`next-issue.md` | テキスト検査 | `plan-issue.md` と `implement.md` は `SKILLS` の 4 つすべての `P(name)` を含む。`next-issue.md` は `P('linear-issue-status')` と `P('human-instructions')` を含む |
| AC-11 [unit] 参照切れ・孤立がない | `.claude/commands/*.md`、`SKILLS` の各 `SKILL.md`、`docs/workflow-graph.md` | 正規表現 `/\.claude\/skills\/([a-z0-9-]+)\/SKILL\.md/g` で参照を集める | 参照されたパスはすべて実在する。`SKILLS` の各スキルは `.claude/commands/*.md` のどれかから 1 回以上参照されている |
| AC-12 [unit] 重複した手順がコマンドから除かれている | `plan-issue.md`・`implement.md`・`next-issue.md` | テキスト検査 | どのファイルも次を含まない: `` `🤖` コメントより新しい ``（未対応の人の指示の定義）、`### <日時>`（進捗ノートの行の書式）、`なければ main から作成`（ブランチの準備）、`specs/README.md` の進捗ノートの見本にある見出し `## 現在の状態` |
| AC-13 [unit] コマンド固有の手順は残っている（取り除きすぎの防止） | 同上 | テキスト検査 | 各ファイルの frontmatter に `description` がある（`plan-issue.md` と `implement.md` は `argument-hint: GAM-n` も）。`plan-issue.md` は `Planning`・`Design Review`・`designer`・`最大 2 回`・`ここで停止` を含む。`implement.md` は `**new**`・`**rework**`・`**resume**`・`通算 5 回`・`2 連続`・`implementer`・`e2e-tester`・`reviewer`・`Needs Human`・`TEST_BUG` を含む。`next-issue.md` は `1 件だけ` と、行頭が `1.`〜`5.` の行をそれぞれ 1 行以上含む |
| AC-14 [unit] workflow-graph にスキルの一覧がある | `docs/workflow-graph.md` | 行頭が `## Skills` の見出しから次の `## ` 見出し（なければ末尾）までを取り出す | その範囲に `SKILLS` の 4 つの名前すべてと、各 `P(name)` が含まれる |

## 設計

### 方針
- **スキルの粒度**: Issue の 3 手順に「ブランチ・push・PR」を加えた 4 つ（確認事項 Q2）。どれも `/plan-issue` と `/implement` の両方で使い、ツール（Linear MCP・git・gh）の使い方と運用の知見を含む部分。設計固有（designer の起動、spec の確認）と実装固有（モード判定、並列実装、修正ループ、停止条件、レビュー）はコマンドに残す
- **形式の定義元は動かさない**: 進捗ノートの形式は `specs/README.md`、Linear コメントの形式は `docs/examples/linear-comments.md`、状態名は `docs/linear-setup.md` のまま。スキルは「いつ・どう使うか」の手順を書き、形式はそれらを参照する
- **コマンドからの参照方法**: コマンドの該当箇所に「`.claude/skills/<name>/SKILL.md` の手順に従う」とパスで書く。Skill ツールで呼ばれても、ファイルとして読まれても同じ手順になる（確認事項 Q3）
- **「未対応の人の指示」の定義**: 一文の定義は `CLAUDE.md`（プロジェクトの規則）と `human-instructions` スキル（手順と細則）の 2 か所に置き、AC-5 で文言の一致をテストで保証する。`CLAUDE.md` は変更しない（確認事項 Q7）。`docs/workflow-graph.md` の「人の指示の見分け方」は理由の説明として残し、末尾にスキルへのリンクを足す

### 変更ファイル一覧
| ファイル | 種別 | 内容 |
|---|---|---|
| `.claude/skills/linear-issue-status/SKILL.md` | 新規 | Issue の取得・状態確認・状態の移動・`🤖` コメントの投稿 |
| `.claude/skills/human-instructions/SKILL.md` | 新規 | 未対応の人の指示の抽出（定義と細則） |
| `.claude/skills/progress-note/SKILL.md` | 新規 | 進捗ノートの読み込み・作成・追記・「現在の状態」の更新 |
| `.claude/skills/branch-and-pr/SKILL.md` | 新規 | ブランチの準備、コミット・push、PR の作成・更新、検証用 PR の扱い |
| `.claude/commands/plan-issue.md` | 変更 | 共通手順をスキル参照に置き換える |
| `.claude/commands/implement.md` | 変更 | 同上 |
| `.claude/commands/next-issue.md` | 変更 | 定義の重複をスキル参照に置き換える |
| `docs/workflow-graph.md` | 変更 | `## Skills（共通手順）` 節を追加。「人の指示の見分け方」の末尾に `human-instructions` スキルへのリンクを 1 行追加 |
| `specs/README.md` | 変更 | 「進捗ノートの形式」の直後に「書き込みの手順は `.claude/skills/progress-note/SKILL.md`」の 1 行を追加（形式の見本は変えない） |
| `tests/unit/skills.test.ts` | 新規 | AC-1〜14 |

変更しないもの: `CLAUDE.md`、`.claude/agents/*`、`.claude/hooks/*`、`.claude/settings.json`、`.claude/commands/review.md`、`docs/examples/*`、`src/**`、`tests/e2e/**`。

### 各スキルの中身
各 `SKILL.md` は次の構成にする（AC-3）。日本語で書く。
```markdown
---
name: <ディレクトリ名>
description: <何をするか。どのコマンドのどの場面で使うか（/plan-issue 等を明記）>
---
# <タイトル>
## 入力
## 手順
## 出力
（必要なら）## 注意（運用で分かったこと）
```

#### 1. `linear-issue-status`
- description 例: 「Linear Issue を取得し、状態が着手可能か確認する。状態の移動と 🤖 コメントの投稿の決まりも含む。/plan-issue・/implement・/next-issue の最初と、状態を動かす・コメントする場面で使う」
- 入力: Issue ID（`GAM-n`）、呼び出し側が**許可する状態**の一覧（例: `/plan-issue` は `Triage`・`Backlog`・`Todo`・`Planning`）
- 手順:
  1. Linear MCP で Issue を取得する: 説明、状態、ラベル、gitBranchName、添付（リンクされた PR の URL）
  2. 全コメントを取得し（スレッドの返信も含む）、`.claude/skills/human-instructions/SKILL.md` で未対応の人の指示を抽出する
  3. 状態が許可する状態の一覧になければ、Linear は何も変更せずに中止し、現在の状態と理由を利用者に伝える（どのコマンドの担当かも示す）
  4. 状態を動かすときは `docs/linear-setup.md` の状態名を綴りどおり使う
  5. コメントは先頭を必ず `🤖` にし、形式は `docs/examples/linear-comments.md` に従う（MCP は人のアカウントで投稿するため、これが人の指示と区別する唯一の手がかり）
- 出力: 状態、ラベル、gitBranchName、リンクされた PR の URL、未対応の人の指示（human-instructions の出力そのまま）
- 注意: Linear の GitHub 連携が状態を動かすのは PR を開いたとき（`In Review`）とマージしたとき（`Done`）だけ。既存の PR に push しても状態は戻らない

#### 2. `human-instructions`
- description 例: 「Linear のコメントから未対応の人の指示を抽出する。/plan-issue・/implement・/next-issue で差し戻しや再開を判定するときに使う」
- 入力: Issue の全コメント（本文と `createdAt`。スレッドの返信を含む）
- 手順:
  1. 定義: `DEF`（`CLAUDE.md` と同じ文をそのまま書く）
  2. 全コメントを `createdAt` の昇順に並べる（スレッドの返信もトップレベルと同じ列に入れる）
  3. 本文の先頭の空白を除いた最初の文字が `🤖` のものを AI のコメントとする。最新の AI コメントより後に作られた、AI のコメントでないものが未対応の人の指示
  4. 🤖 コメントがない場合は、`🤖` で始まらない全コメントが対象
  5. 承認だけのコメント（例「承認します」「暫定案で OK」）は差し戻しの指示ではない。`Approved` への移動とあわせて「確認事項を暫定案で承認」として進捗ノートに記録する。判断に迷う内容（承認に条件や要望が付いている）は指示として扱う
  6. 編集は検知しない（`createdAt` だけで判定する）。人が古いコメントを編集して指示を足しても拾えないことを、必要なら `🤖` コメントで人に伝える
- 出力: 未対応の人の指示の一覧（`createdAt` と本文の原文。要約しない）。なければ「なし」
- 注意: 指示を引き継ぐときは原文で渡す（designer への受け渡し、進捗ノートの rework 記録）

#### 3. `progress-note`
- description 例: 「specs/GAM-n.progress.md を読む・作る・追記する。/plan-issue・/implement の各ステップの開始と結果を記録するときに使う」
- 入力: Issue ID、役割（`[orchestrator]` など）、記録する内容、（必要なら）「現在の状態」の新しい値
- 手順:
  1. 作業の最初に `specs/GAM-n.progress.md` があれば全部読み、「現在の状態」から再開位置を決める
  2. なければ `specs/README.md` の「進捗ノートの形式」どおりに作る（`# GAM-n 進捗ノート`、`## 現在の状態`、`## ログ`）
  3. 日時はコマンドで取得する（推測で書かない）:
     ```bash
     date '+%Y-%m-%d %H:%M'
     ```
  4. `## ログ` の末尾に `specs/README.md` の書式で 1 行（または 1 段落）を足す。過去の行は消さない・書き換えない（追記のみ）
  5. `## 現在の状態`（フェーズ・修正反復・直近の失敗シグネチャ）だけは上書きしてよい。失敗シグネチャの書式は `specs/README.md` に従う
  6. 記録すべきこと: 各ステップの開始と結果、人の指示の引用（rework）、spec からの逸脱とその理由、停止の判断
  7. 進捗ノートは spec や実装と同じコミットに含める
- 出力: 更新後の「現在の状態」
- 注意: 既存のノートには日時が前後している箇所がある（推測で書いたため）。並べ替えはしない

#### 4. `branch-and-pr`
- description 例: 「gitBranchName のブランチの準備、コミット・push、PR の作成・更新を行う。/plan-issue・/implement で作業を始めるときと成果を push するときに使う」
- 入力: Issue ID、gitBranchName、（PR を作るとき）タイトルの要約と本文
- 手順:
  1. ブランチの準備: gitBranchName をそのまま使う（`/` や日本語を含むことがある）。リモートにあれば切り替えて pull、なければ最新の main から作る:
     ```bash
     git fetch origin
     git switch "<gitBranchName>"
     git pull
     ```
     ```bash
     git switch -c "<gitBranchName>" origin/main
     ```
  2. main の上でコミット・push しない（hook がブロックする）
  3. push と PR の作成は**別々のコマンド**で実行する:
     ```bash
     git push -u origin HEAD
     ```
     ```bash
     gh pr create --base main --title "GAM-n: <要約>" --body-file <本文ファイル>
     ```
     NG 例（`text` ブロックで書く。hook の main への push の正規表現に当たってブロックされる）:
     ```text
     git push -u origin HEAD && gh pr create --base main --title "GAM-n: <要約>"
     ```
  4. PR のタイトルは `GAM-n: <要約>`、本文に `Fixes GAM-n`。Linear の GitHub 連携がタイトルの `GAM-n` で PR を Issue に自動でリンクし、PR を開くと `In Review` に移す
  5. 既存の PR があれば push で更新される。Linear の状態は戻らないので、必要なら呼び出し側が自分で動かす
- 出力: ブランチ名、コミット SHA、PR の URL
- 注意（運用で分かったこと）:
  - 検証用の PR（canary など、マージしない PR）のタイトルやブランチ名に `GAM-n` を入れると、その Issue に自動でリンクされる。避けられない場合は、閉じた後に Linear でリンクを外す。検証用 PR を `Merge Approved` にしない
  - claude-code-action は base ブランチ名に非 ASCII 文字があると失敗する（AI Review・Security Review が動かない）。日本語を含む gitBranchName のブランチを base にするスタック PR では、同じコミットを指す ASCII 名のブランチを作って base にする
  - コマンド例のプレースホルダー（`<gitBranchName>` など）は実際の値に置き換える

### コマンドの変更後の姿
共通手順をスキル参照に置き換えるだけで、手順の順序と判断の内容は変えない。

**`plan-issue.md`**
1. 状況把握: `linear-issue-status`（許可する状態: `Triage`/`Backlog`/`Todo`、`Planning`）→ 未対応の人の指示は同スキル経由で `human-instructions` から得る。`branch-and-pr` の「ブランチの準備」。`progress-note` で既存ノートを読む
2. 設計（残す）: `Planning` に移動、`designer` に Issue 内容と未対応の人の指示（原文）を渡す、spec の確認（全 AC に ID とタグ、人の指示の反映）と再依頼（最大 2 回）。記録は `progress-note` で `[orchestrator]` として「設計 (新規|改訂): <要約>」
3. 人へ回す: `branch-and-pr` でコミット・push。`linear-issue-status` の決まりで「設計完了」コメント。`Design Review` に移動
4. 「ここで停止し、実装には進まないこと」（残す）

**`implement.md`**
- 冒頭の「各ステップの開始・結果を進捗ノートに `[orchestrator]` として追記」は `progress-note` の参照に置き換える
- 1 章: Issue の取得と未対応の人の指示の抽出は `linear-issue-status`（許可する状態: `Approved`、`In Progress`、`Needs Human`）。モード判定の表と rework の扱い（カウンタのリセット、設計変更なら `Planning` へ）は残す。ブランチは `branch-and-pr`
- 2〜4 章: 変更なし（失敗シグネチャの記録先を `progress-note` と書き換える程度）
- 5 章: `gh pr create` の手順は `branch-and-pr` を参照。タイトル・本文の中身（変更点・AC チェックリスト・レビュー結果）と、rework / resume で自分で `In Review` に移す判断は残す
- 6 章: コミット・push は `branch-and-pr`、コメントは `linear-issue-status` の決まりで「エスカレーション」形式

**`next-issue.md`**
- 5 行目の定義を「未対応の人の指示は `.claude/skills/human-instructions/SKILL.md` で判定する」に置き換え、Issue の取得は `linear-issue-status` を参照。優先順の 1〜5 は変えない

### `docs/workflow-graph.md` への追記
```markdown
## Skills（共通手順）
`.claude/commands/` の各コマンドが共通で使う手順。手順の定義はここにだけ書き、コマンドからはパスで参照する。
| スキル | 内容 | 使うコマンド |
|---|---|---|
| `linear-issue-status`（`.claude/skills/linear-issue-status/SKILL.md`） | Issue の取得・状態確認・状態の移動・🤖 コメント | /plan-issue, /implement, /next-issue |
| `human-instructions`（…） | 未対応の人の指示の抽出 | 同上 |
| `progress-note`（…） | 進捗ノートの読み込み・追記 | /plan-issue, /implement |
| `branch-and-pr`（…） | ブランチの準備・push・PR | /plan-issue, /implement |
```
（`…` の部分も実際のパスを書く。AC-14）

### `tests/unit/skills.test.ts` の実装メモ
- `workflows.test.ts` と同じく `node:fs` でテキストとして読む。YAML パーサー・Markdown パーサーは追加しない
- frontmatter の解析は小さな関数をテストファイル内に書く（「表記」の定義どおり）
- AC-9 は `node:child_process` の `spawnSync('bash', [hookPath], { input, env: { ...process.env, CLAUDE_PROJECT_DIR: tmpDir } })`。`tmpDir` は `mkdtempSync(join(tmpdir(), 'gam9-'))`、テスト後に `rmSync`。hook は内部で `node` を使うので `PATH` は引き継ぐ
- テスト名に AC ID を含める

## テスト計画
- Unit: `tests/unit/skills.test.ts` — AC-1〜14
  - AC-1〜3 は `SKILLS` の各スキルを `it.each` で回す
  - AC-9 の NG 例の期待値（終了コード 2）は、hook の現在の挙動を固定するもの。hook を直す Issue ではこのテストとスキルの記述を一緒に直す
  - 取り除きすぎの検出（AC-13）と重複の検出（AC-12）を両方置き、片方だけで判定しない
- E2E: なし（`tests/e2e/` は変更しない）
- 手動確認（AC にはしない）: マージ後に最初に実行する `/plan-issue` または `/implement` の進捗ノートに、スキルを読み込んだことを `[orchestrator]` として 1 行残す（確認事項 Q12）
- `npm run verify` が green であること（既存のテストはそのまま通る）

## 影響範囲・リスク
- **GAM-14（設計ループを spec-kit に置き換え、Triage）との重なり**: GAM-14 は `/plan-issue` の設計部分を置き換える可能性がある。重複作業を避けるため、本 Issue は次のように線引きする（確認事項 Q1）
  - 本 Issue で作るのは、設計の方式に依存しない部品（Linear の状態確認、人の指示の抽出、進捗ノート、ブランチ・PR）だけ。spec-kit に置き換えた後の設計ループもこれらを使える
  - `designer` エージェント、`docs/examples/spec-example.md`、spec の書式、`plan-issue.md` の「2. 設計」章の中身（designer の起動と spec の確認）には手を入れない。GAM-14 はこの章だけを置き換えればよい
  - 順序は GAM-9 を先にマージする案を推奨。GAM-14 を先にやる場合は、本 Issue から `plan-issue.md` の変更を外し、`implement.md`・`next-issue.md` とスキルだけにする（AC-10・12・13 の `plan-issue.md` の部分も外す）
- **GAM-8・GAM-13 も `.claude/` を触る**: 本 Issue が変更する `.claude/` のファイルは `commands/plan-issue.md`・`implement.md`・`next-issue.md` と新規の `skills/` だけ。`agents/`・`hooks/`・`settings.json` は触らない。同じコマンドファイルを変える Issue と同時に進むと競合するので、後からマージする側が rebase して、AC-12・13 のテストで取り除きすぎ・重複の戻りがないことを確かめる（確認事項 Q5）
- **実行中のコマンドを書き換える**: `/implement GAM-9` の実行中に `implement.md` 自身を変更することになる。実行中のセッションは読み込み済みの手順で動くので影響はないが、変更後の手順の確認はマージ後の実運用になる
- **スキルの自動呼び出し**: スキルは description に合えばモデルが自動で呼ぶことがある。コマンド外の会話で `branch-and-pr` などが呼ばれ、意図せず push や Linear の更新が起きる可能性がある。description に「どのコマンドで使うか」を明記して範囲を絞る（確認事項 Q3）
- **hook の誤ブロックを「仕様」として固定する**: AC-9 は hook の現在の挙動（push と `--base main` の同居でブロック）をテストで固定する。hook を直すときはこのテストとスキルの記述も直す必要がある（確認事項 Q9）
- **静的検査の限界**: AC は文字列の有無で判定するため、手順の意味が正しいかまでは保証しない。最終的な確認は Design Review と PR レビューでの人の目による
- **Claude Code の Skills の仕様の変化**: frontmatter の制約（`name` の文字種・長さ、`description` の長さ）やコマンドとスキルの関係は Claude Code の版で変わりうる（確認事項 Q4）

## 確認事項（人間に判断してほしいこと。暫定案で設計済み）
1. **Q1 GAM-14 との順序と範囲**: GAM-9 を先にマージし、GAM-14 は `plan-issue.md` の「2. 設計」章だけを置き換える、という線引きでよいか（暫定: はい）。GAM-14 を先にやる、または近いうちに着手する予定なら、本 Issue から `plan-issue.md` の変更を外して `implement.md`・`next-issue.md` とスキルだけにする
2. **Q2 スキルの分け方**: Issue に書かれた 3 手順に `branch-and-pr` を加えた 4 つにした（運用の知見の多くが push・PR に関するため）。`branch-and-pr` を入れない（知見は別 Issue）、または `linear-issue-status` と `human-instructions` を 1 つにまとめる、のほうがよいか（暫定: 4 つ）
3. **Q3 呼び出し方**: コマンドからはパス（`.claude/skills/<name>/SKILL.md`）で参照し、モデルによる自動呼び出しは止めない（frontmatter は `name` と `description` だけ）案にした。push や Linear の更新を伴う `branch-and-pr`・`linear-issue-status` は、コマンド外で自動に呼ばれないよう `disable-model-invocation: true` を付けたほうがよいか（暫定: 付けない。このキーの対応状況が不確かなため。付ける場合は AC-2 に追加する）
4. **Q4 Skills の仕様の前提**: `.claude/skills/<name>/SKILL.md`、frontmatter の `name`（小文字・数字・ハイフン、64 文字以下）と `description`（1024 文字以下）を必須とする前提で書いた。また、最近の Claude Code ではコマンドとスキルが統合されつつある（`.claude/commands/` も引き続き使える）と理解している。実装時に使っている Claude Code の版のドキュメントで確認し、違っていたら推測で合わせずに停止して戻す、でよいか
5. **Q5 GAM-8・GAM-13 との競合**: どちらが先にマージしてもよいように、本 Issue は `.claude/agents/`・`hooks/`・`settings.json` を触らない範囲にした。両 Issue がコマンドファイル（`plan-issue.md`・`implement.md`・`next-issue.md`）も変える場合、マージの順序を人が決めてほしい（暫定: 先に Approved になったものから）
6. **Q6 実装の担当**: `implementer` の書き込み範囲に `.claude/**`・`docs/workflow-graph.md`・`specs/README.md` が含まれない。GAM-7 と同じく、エージェント定義は変えずに、本 spec の変更ファイル一覧に範囲を限った general-purpose エージェントに委任する、でよいか（暫定: はい）
7. **Q7 CLAUDE.md の定義**: 「未対応の人の指示」の一文は `CLAUDE.md` にも残し（毎回読み込まれる規則のため）、`human-instructions` と文言が一致することを AC-5 で保証する案にした。`CLAUDE.md` からも削ってスキルへの参照だけにするか（暫定: 残す。`CLAUDE.md` は本 Issue では変更しない）
8. **Q8 人の指示の細則**: (a) 承認だけのコメントは指示として扱わない、(b) 編集は検知しない、の 2 点を細則にした。(b) について、人に「指示は編集でなく新しいコメントで書く」と `docs/linear-setup.md` にも書くか（暫定: 書かない。本 Issue はスキルの範囲に留める）
9. **Q9 hook の誤ブロック**: `block-dangerous.sh` の main への push の正規表現が、同じコマンド内の `gh pr create --base main` に当たる。本 Issue では hook を直さず、スキルに回避方法（別々のコマンドで実行）を書き、AC-9 で挙動を固定する。hook の修正（`git push` の引数だけを見る）は別 Issue にしてよいか（暫定: 別 Issue）
10. **Q10 検証用 PR の自動リンク**: Linear が PR を Issue にリンクする条件（タイトル・ブランチ名・本文のどれに `GAM-n` があるとリンクされるか）は GAM-7 の 1 例から推測している。スキルには「タイトルとブランチ名に入れない。避けられなければ閉じた後にリンクを外す」と書く案でよいか
11. **Q11 `[ci]` タグとコマンドの AC 確認**: `plan-issue.md` の spec の確認項目は「全 AC に ID と `[unit]`/`[e2e]` タグ」のままで、GAM-7 で使った `[ci]` は追記しない（本 Issue は手順の移動だけで、内容は変えないため）。`[ci]` の正式な採用は別 Issue に任せてよいか（暫定: はい）
12. **Q12 実際に使われるかの確認**: スキルが実運用で読み込まれるかは自動テストで確かめられない。マージ後に最初に実行する `/plan-issue` か `/implement` で、オーケストレーターが「スキルを読み込んだ」と進捗ノートに記録し、問題があれば新しい Issue を起票する、でよいか
13. **Q13 サブエージェントの進捗ノート**: `implementer`・`e2e-tester`・`reviewer` も進捗ノートに書くが、エージェント定義は本 Issue では変えない（GAM-8・GAM-13 との競合を避けるため。サブエージェントがスキルを使えるかの仕様も不確か）。エージェントからも `progress-note` を参照させるのは別 Issue でよいか（暫定: はい）

分割は不要と判断した（Markdown 4 ファイルの新規作成、コマンド 3 ファイルの書き換え、ドキュメント 2 ファイルへの追記、静的検査のテスト 1 本で 1 Issue に収まる）。ただし Q1 で GAM-14 を先にする場合は、`plan-issue.md` の分を GAM-14 に回す。

## 改訂履歴
- 初版: 新規作成（人間のコメントなし）
