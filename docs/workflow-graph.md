# Workflow Graph（グラフエンジニアリング）

AI と人のノード、その間のエッジ（受け渡し物）と遷移条件の定義。
`.claude/commands/` の各コマンドはこのグラフを実行するオーケストレーターである。

```mermaid
flowchart LR
  IN([👤 起票<br/>Backlog + ai-ready]) --> D[🤖 designer<br/>設計AI]
  D -- specs/GAM-n.md --> HG1{👤 Design Review}
  HG1 -- 差し戻しコメント --> D
  HG1 -- Approved --> FORK(( ))
  FORK -- spec AC[unit] --> I1[🤖 implementer<br/>実装AI①: コード+Unit]
  FORK -- spec AC[e2e] --> I2[🤖 e2e-tester<br/>実装AI②: E2E テスト]
  I1 -- コード --> JOIN(( 合流<br/>npm run verify ))
  I2 -- テスト --> JOIN
  JOIN -- 失敗 / 5回・同一失敗2連続まで --> I1
  JOIN -- 失敗: テスト自体の誤り --> I2
  JOIN -- 停止条件到達 --> NH{👤 Needs Human}
  JOIN -- green --> R[🤖 reviewer<br/>レビューAI]
  R -- NEEDS_FIX / 最大2周 --> I1
  R -- PASS --> PR[🤖 PR 作成]
  PR --> HG2{👤 PR レビュー<br/>In Review}
  HG2 -- 設計の問題: Planning へ --> D
  HG2 -- 実装の問題: In Progress へ --> I1
  HG2 -- Merge Approved --> M[⚙️ merge-gate<br/>マージ・デプロイ]
  NH -- 指示コメント + 状態変更 --> D
  NH -- 指示コメント + 状態変更 --> I1
```

## ノード
| ノード | 担当 | 入力 | 出力 |
|---|---|---|---|
| designer | `.claude/agents/designer.md` | Issue 本文・コメント・docs | `specs/GAM-n.md` |
| implementer | `.claude/agents/implementer.md` | spec の `[unit]` 受入条件 / 失敗ログ | `src/**`, `tests/unit/**`, 進捗ノート |
| e2e-tester | `.claude/agents/e2e-tester.md` | spec の `[e2e]` 受入条件 | `tests/e2e/**` |
| 合流（verify） | オーケストレーター（`/implement`） | 両者の成果物 | `npm run verify` の結果 |
| reviewer | `.claude/agents/reviewer.md` | `git diff main...HEAD`、spec、進捗ノート | PASS / NEEDS_FIX |
| merge-gate | `.github/workflows/linear-merge-gate.yml` | `Merge Approved` の Issue | マージ・デプロイ |

## エッジの遷移条件
| 遷移 | 条件 |
|---|---|
| Design Review → 実装 | 人が Linear で `Approved` に移動 |
| 実装の並列分岐 | spec の受入条件を `[unit]` と `[e2e]` タグで振り分け。両者は書き込み先ディレクトリが重ならない |
| 合流 → 修正 | verify 失敗。失敗がテストコード自体の誤り（仕様と矛盾するテスト）なら e2e-tester、それ以外は implementer |
| 合流 → Needs Human | 修正の通算 5 回到達、または同一失敗シグネチャが 2 連続（進捗ノートで判定） |
| reviewer → implementer | high の指摘あり（最大 2 周、超えたら Needs Human） |
| In Review → 再設計 | 人がコメントして `Planning` に移動 |
| In Review → 再実装 | 人がコメントして `In Progress` に移動 |
| Needs Human → 再開 | 人が指示をコメントし、`Planning`（設計から）または `In Progress`（実装から）に移動 |

## 人の指示の見分け方
Linear MCP は人のアカウントで動くため、投稿者では区別できない。
**AI のコメントは必ず `🤖` で始める**。最新の `🤖` コメントより新しい、`🤖` で始まらないコメントを「未対応の人の指示」とみなす。

## PR 上の自動チェック
PR ごとに次のチェックが並列に走る。merge-gate（`scripts/linear-merge-gate.mjs`）は失敗したチェックがあると自動マージせず `Needs Human` にする。

| チェック | ワークフロー | 失敗条件 | 失敗時 |
|---|---|---|---|
| `CI / verify` | ci.yml | `npm run verify` 失敗 | マージゲートが Needs Human |
| `CI / npm-audit` | ci.yml | high 以上の脆弱な依存 | 同上 |
| `AI Review / review` | ai-review.yml | （失敗させない。コメントのみ） | — |
| `Security Review / security-gate` | security-review.yml | HIGH の指摘、監査未完了、fork PR | 同上 |

取り込み元と更新手順: `.github/security-review/` の各ファイルのヘッダーにある anthropics/claude-code-security-review の SHA を見て、上流の差分を確認してから取り込み直す（`scripts/security-review/findings.mjs` の除外ルールの移植も同様）。
