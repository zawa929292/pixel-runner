# GAM-2 進捗ノート

## 現在の状態
- フェーズ: pr
- 修正反復: 0 / 5
- 直近の失敗シグネチャ: なし

## ログ
### 2026-11-02 14:30 [orchestrator] 設計 (新規): 障害物（seed 付き PRNG で決定的に生成、時間ベースの間隔 1.4〜2.4s、高さ 24〜56px、速度 300px/s）と AABB 当たり判定（接触は非衝突）の spec を作成。AC-1〜25（unit 23 / e2e 2）。既存 AC-14 のアサーションは削除せず置き換える方針に修正（Q11）。
### 2026-11-02 14:40 [orchestrator] 実装開始 (new): 人が Approved（確認事項 Q1〜Q11 は暫定案で承認）。implementer（[unit] AC-1〜23）と e2e-tester（[e2e] AC-24, 25）を並列起動。
### 2026-11-02 14:45 [implementer] build 開始: spec 読了。[unit] AC-1〜23 の Unit テストを先に書き、core（config/random/collision/obstacles/state）→ main.ts/GameScene の順に実装する。
### 2026-11-02 15:00 [e2e-tester] tests/e2e/obstacles.spec.ts を新規作成（GAM-2 AC-24: 障害物出現と同一 id の 30px 左移動 / AC-25: 無入力で gameover・AABB 重なり・onGround を検証）。`/?test=1&seed=12345`、poll 間隔 100ms・timeout 5000/5000/15000ms は spec どおり。state は GameState 型に依存しないローカル部分型で読む。tsc / eslint tests/e2e は green。実行時点の implementer の作業中コードでビルドしたところ 2 件 pass。
### 2026-11-02 15:00 [implementer] build 完了: core に random.ts / collision.ts / obstacles.ts を追加、config.ts（SCROLL/OBSTACLE/RANDOM）・state.ts（新フィールド、createInitialState(seed)、startGame のシード保持、step の障害物更新と衝突判定）を変更。main.ts で ?seed= を読み GameScene(seed) に渡し、GameScene は障害物を id で同期描画。Unit: random/collision/obstacles.test.ts 新規、state.test.ts に AC-9,12〜15,17〜22 を追加、AC-23 として既存 AC-14 の 2 つ目のアサーションを「変化したフィールドが 1 つ以上ある」検証に置き換え（削除なし）。docs/game-design.md に障害物の節を追記。verify:unit 1 回目で green（48 tests）。ミューテーション確認: 生成位置のはみ出し補正を外すと AC-11/12 が、intersects を閉区間にすると AC-3 が落ちることを確認済み。e2e は未実行（合流後）。
### 2026-11-02 14:50 [orchestrator] 合流: npm run verify green（lint / typecheck / unit 48 / e2e 4）。修正反復 0 回。reviewer へ。
### 2026-11-02 15:10 [reviewer] PASS（APPROVE）: AC-1〜25 すべてにテストがあり、spec の処理順（移動→削除→タイマー→生成、乱数は高さ→間隔）・はみ出し補正・開区間 AABB・step の playing 分岐・startGame のシード保持はいずれも spec どおり。core に Phaser / Math.random なし、unit 48 green を再確認。high なし。medium 1: AC-23 の置き換えアサーションが直前の if 条件（全体 JSON 比較）と同じ内容でほぼ常に真になる（参照比較か playing・地上での spawnTimerMs の変化を直接確認する形を推奨）。low 1: E2E が独自の StateSnapshot 型と `as unknown as` を使っている（window.__GAME__ は GameState 型なので不要）。
### 2026-11-02 15:20 [implementer] fix（レビュー指摘）: 仮説 — AC-23 の置き換え後アサーション `changed.length > 0` は直前の JSON 比較 if とほぼ同値で不具合を検出できない。対応: 参照/値比較（player・status・obstacles・spawnTimerMs のいずれかが入力と異なる）に置き換え、playing では `r.spawnTimerMs === s.spawnTimerMs - 16` を直接検証（削除なし）。指摘 2（tests/e2e/obstacles.spec.ts の型キャスト削除）は tests/e2e/** が e2e-tester の担当で implementer は編集不可のため未対応、オーケストレーターに差し戻す。
### 2026-11-02 15:30 [e2e-tester] レビュー指摘（low）に対応: tests/e2e/obstacles.spec.ts から独自型 ObstacleSnapshot / StateSnapshot と `as unknown as` キャストを削除し、`window.__GAME__?.getState()` を GameState 型のまま使うよう変更（`import type` で GameState / Obstacle を参照）。AC-24, 25 の検証内容・timeout・poll 間隔は変更なし。npm run verify green（lint / typecheck / unit 48 件 / e2e 4 件）。
### 2026-11-02 15:20 [orchestrator] 品質改善 1 周目: reviewer APPROVE（medium 1 / low 2）。medium（AC-23 の緩いアサーション）を implementer、low（E2E の独自型キャスト）を e2e-tester で修正。verify green（unit 48 / e2e 4）。low（GameScene の setSize）は PR に記載のみ。PR 作成へ。
