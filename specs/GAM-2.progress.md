# GAM-2 進捗ノート

## 現在の状態
- フェーズ: review
- 修正反復: 0 / 5
- 直近の失敗シグネチャ: なし

## ログ
### 2026-11-02 14:30 [orchestrator] 設計 (新規): 障害物（seed 付き PRNG で決定的に生成、時間ベースの間隔 1.4〜2.4s、高さ 24〜56px、速度 300px/s）と AABB 当たり判定（接触は非衝突）の spec を作成。AC-1〜25（unit 23 / e2e 2）。既存 AC-14 のアサーションは削除せず置き換える方針に修正（Q11）。
### 2026-11-02 14:40 [orchestrator] 実装開始 (new): 人が Approved（確認事項 Q1〜Q11 は暫定案で承認）。implementer（[unit] AC-1〜23）と e2e-tester（[e2e] AC-24, 25）を並列起動。
### 2026-11-02 14:45 [implementer] build 開始: spec 読了。[unit] AC-1〜23 の Unit テストを先に書き、core（config/random/collision/obstacles/state）→ main.ts/GameScene の順に実装する。
### 2026-11-02 15:00 [e2e-tester] tests/e2e/obstacles.spec.ts を新規作成（GAM-2 AC-24: 障害物出現と同一 id の 30px 左移動 / AC-25: 無入力で gameover・AABB 重なり・onGround を検証）。`/?test=1&seed=12345`、poll 間隔 100ms・timeout 5000/5000/15000ms は spec どおり。state は GameState 型に依存しないローカル部分型で読む。tsc / eslint tests/e2e は green。実行時点の implementer の作業中コードでビルドしたところ 2 件 pass。
### 2026-11-02 15:00 [implementer] build 完了: core に random.ts / collision.ts / obstacles.ts を追加、config.ts（SCROLL/OBSTACLE/RANDOM）・state.ts（新フィールド、createInitialState(seed)、startGame のシード保持、step の障害物更新と衝突判定）を変更。main.ts で ?seed= を読み GameScene(seed) に渡し、GameScene は障害物を id で同期描画。Unit: random/collision/obstacles.test.ts 新規、state.test.ts に AC-9,12〜15,17〜22 を追加、AC-23 として既存 AC-14 の 2 つ目のアサーションを「変化したフィールドが 1 つ以上ある」検証に置き換え（削除なし）。docs/game-design.md に障害物の節を追記。verify:unit 1 回目で green（48 tests）。ミューテーション確認: 生成位置のはみ出し補正を外すと AC-11/12 が、intersects を閉区間にすると AC-3 が落ちることを確認済み。e2e は未実行（合流後）。
### 2026-11-02 14:50 [orchestrator] 合流: npm run verify green（lint / typecheck / unit 48 / e2e 4）。修正反復 0 回。reviewer へ。
