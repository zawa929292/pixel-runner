# specs

| ファイル | 書く人 | 内容 |
|---|---|---|
| `GAM-<n>.md` | designer（`/plan-issue`） | 設計書。書き方は `docs/examples/spec-example.md` |
| `GAM-<n>.progress.md` | オーケストレーター / implementer / e2e-tester | 進捗ノート（下記）。セッションや差し戻しをまたいで状態を引き継ぐ |

## 進捗ノートの形式
追記のみ（過去の記録を消さない）。新しいセッションや差し戻し後は、まずこれを読んで続きから再開する。

```markdown
# GAM-n 進捗ノート

## 現在の状態
- フェーズ: implement / fix / review / pr / rework
- 修正反復: 2 / 5
- 直近の失敗シグネチャ: e2e:jump.spec.ts:AC-5:Timeout

## ログ
### 2026-11-02 10:12 [orchestrator] 並列実装開始
### 2026-11-02 10:20 [implementer] AC-1〜4 実装、verify:unit green
### 2026-11-02 10:21 [e2e-tester] AC-5 を tests/e2e/jump.spec.ts に作成
### 2026-11-02 10:23 [orchestrator] 合流 verify #1 失敗 — e2e:jump.spec.ts:AC-5:Timeout
### 2026-11-02 10:30 [implementer] fix #1: 着地判定を修正 → verify #2 green
### 2026-11-02 10:35 [reviewer] PASS
### 2026-11-02 11:40 [orchestrator] rework: 人の指示「ジャンプが低い」→ fix
```

**失敗シグネチャ** = `<種類>:<ファイル>:<テスト名またはAC>:<エラー種別>`。同じシグネチャが 2 連続したら停止する。
