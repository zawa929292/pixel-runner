# GAM-3: スコア（走行距離）と HUD 表示

## 目的
`playing` 中の走行距離をスコアにして、画面右上の HUD に「ハイスコアと今回のスコア」を表示する。ハイスコアは `gameover` になったときに更新し、localStorage に保存してリロード後も残す。localStorage が使えない環境（無い、アクセスで例外が出る、不正な値が入っている）でもエラーにならず、ハイスコア 0 として動く。

方針:
- **走行距離は `scrollSpeed × dt` の積算**で持つ（GAM-5 で速度が変わっても正しく積算される）。スコアは距離から計算する整数
- **core は純粋に保つ**。localStorage へのアクセスは core の外のアダプタ（`src/highScoreStore.ts`）に閉じ込め、`main.ts` から scene に注入する。ハイスコアは core の state（`highScore`）に持ち、更新ルール（gameover への遷移時に max を取る）は core に置く
- **HUD の文字列整形は core の純関数**（`formatHud`）。scene はその文字列を描画するだけ

### 前提（GAM-1 / GAM-2 と同じ）
- 速度は px/s、時間は ms（`step` の dt と同じ）。`step` は不正 dt → クランプ（`PHYSICS.maxDtMs`）→ status 分岐 の順
- `startGame` は `playing` 以外のとき、シードを引き継いで初期化した `playing` の state を返す（GAM-3 ではハイスコアも引き継ぐ）
- 何も入力しない場合の最初の衝突は、開始から `T0 = FIRST + (SX - PR) / S * 1000` = **3160ms** 後（GAM-2）

## 受入条件

表記: `S` = `SCROLL.initialSpeed`、`P` = `SCORE.pxPerPoint`、`EPS` = `SCORE.floorEpsilon`、`D` = `SCORE.hudDigits`、`MAXD` = `10**D - 1`（現行値 99999）、`MAXDT` = `PHYSICS.maxDtMs`、`FIRST` = `OBSTACLE.firstSpawnDelayMs`、`SX` = `OBSTACLE.spawnX`、`W` = `OBSTACLE.width`、`HMIN` = `OBSTACLE.minHeight`、`PR` = `PLAYER.x + PLAYER.width`、`T0` = 上記、`KEY` = `HIGH_SCORE_KEY`（`src/highScoreStore.ts`）。
テストは数値を直書きせず、これらの定数から期待値を計算する（例示の数値は現行値での参考）。
「自動生成を止めた state」は GAM-2 と同じく `spawnTimerMs: 1e9` にして `obstacles` を直接与えて作る。

### スコア計算（`src/core/score.ts`）
| ID | Given | When | Then |
|---|---|---|---|
| AC-1 [unit] 距離の積算 | — | `advanceDistance(distance, scrollSpeed, dtMs)` を `(0, S, 10)`、`(100, S, 16)`、`(100, 2*S, 16)`、`(0, S, MAXDT)` で呼ぶ | 戻り値が `distance + scrollSpeed * dtMs / 1000` と誤差 1e-9 で一致（例: `(0, 300, 10)` → 3） |
| AC-2 [unit] 距離 → スコア | — | `scoreFromDistance(d)` | `d = 0` → 0、`d = P - 0.5` → 0、`d = P` → 1、`d = 90*P - 1e-9`（浮動小数誤差で境界をわずかに下回った値）→ **90**、`d = 90*P - P*10*EPS`（明確に下回る）→ 89、`d = 948` → `Math.floor(948 / P)`（現行値 94）。戻り値は常に `Number.isInteger` が true の 0 以上の値 |
| AC-3 [unit] ハイスコア値の正規化 | — | `sanitizeHighScore(n)` | `0` → 0、`123` → 123、`Number.MAX_SAFE_INTEGER` → そのまま、`-1` → 0、`1.5` → 0、`NaN` → 0、`Infinity` → 0、`MAX_SAFE_INTEGER + 2` → 0 |
| AC-4 [unit] 保存文字列のパース | — | `parseHighScore(raw)` | `"123"` → 123、`"00123"` → 123、`"0"` → 0、`String(Number.MAX_SAFE_INTEGER)` → その値。次はすべて 0: `null`、`""`、`"abc"`、`"-5"`、`"1.5"`、`"1e3"`、`" 12"`、`"12 "`、`"0x10"`、`"9007199254740993"`（安全な整数を超える） |

### step でのスコア（`src/core/state.ts`）
| ID | Given | When | Then |
|---|---|---|---|
| AC-5 [unit] playing 中に増える | 自動生成を止めた `playing`・地上の state（障害物なし）、`distance = 0`、`score = 0` | `step(s, 入力なし, dt)`（dt = 10, 16, 1000/60, MAXDT） | `distance` が `S * dt / 1000` と誤差 1e-9 で一致、`score === scoreFromDistance(distance)`、`status === 'playing'` |
| AC-6 [unit] 速度は state から読む | AC-5 と同じだが `scrollSpeed = 2*S` | `step(s, 入力なし, 16)` | `distance` が `2*S*16/1000` と誤差 1e-9 で一致（GAM-5 で速度が変わっても距離が正しく積算されることの確認） |
| AC-7 [unit] ジャンプ中も増える・入力に依存しない | 自動生成を止めた `playing`・地上の state | `step(s, ジャンプ入力, 16)` と `step(s, 入力なし, 16)` | 両方の `distance` と `score` が `===` で一致 |
| AC-8 [unit] dt クランプ | AC-5 と同じ | `step(s, 入力なし, 1000)` と `step(s, 入力なし, MAXDT)` | 両者の `distance` が `===` で一致し、`S * MAXDT / 1000` と誤差 1e-9 で一致（クランプ後の dt で積算する） |
| AC-9 [unit] dt 非依存 | `startGame(createInitialState(12345))`（入力なし） | 合計 3000ms（T0 より前）を `[10]×300`、`[20]×150`、`[50]×60`、`[5,45,30,20,50,50]×15`、`[1000/60]×180` で step | 5 通りすべて `status === 'playing'`、`distance` が `S * 3000 / 1000`（現行値 900）と誤差 1e-6 以内、`score === Math.round(S * 3000 / 1000 / P)`（現行値 90。浮動小数で 899.9999… になっても EPS で 90 になる） |
| AC-10 [unit] ready / gameover では増えない | `createInitialState(1, 50)`（ready）／`{ ...createInitialState(1, 50), status: 'gameover', distance: 945, score: 94 }` | 入力なし・ありを交互に dt=16 で 100 回 step（ready は入力なしのみ。入力ありだと開始してしまうため） | 毎回、入力 state と deep equal（`distance`・`score`・`highScore` が変わらない） |
| AC-11 [unit] ready → playing の遷移フレーム | `createInitialState(1, 50)` | `step(s, ジャンプ入力, 16)` | `status === 'playing'`、`distance === 0`、`score === 0`、`highScore === 50`（開始フレームでは距離を進めない。GAM-1 の「開始に使った押下ではジャンプしない」と同じ扱い） |
| AC-12 [unit] プレイ中はハイスコアを更新しない | 自動生成を止めた `playing`・地上の state、`highScore = 3`、`distance = 10*P` | 入力なしで dt=16 を 10 回 step | 毎フレーム `status === 'playing'`、`score > highScore`、`highScore === 3` のまま |
| AC-13 [unit] 衝突フレームの扱いとハイスコア更新 | GAM-2 AC-13 と同じ「接触直前」の state（自動生成停止、障害物 `{id:1, x: PR + S*10/1000, width: W, height: HMIN}`）に `distance = 500` を加えたもの。`highScore` は (a) `0`、(b) `MAXD` | `step(s, 入力なし, 10)` → その結果を `step(…, 入力なし, 10)` | 1 回目: `status === 'playing'`、`distance` が `500 + S*10/1000`、`highScore` は不変。2 回目（衝突フレーム）: `status === 'gameover'`、**衝突フレームの移動ぶんも距離に含める**（`distance` が `500 + 2*S*10/1000` と誤差 1e-9）、`score === scoreFromDistance(distance)`、`highScore` は (a) `=== score`、(b) `=== MAXD`（下回るときは更新しない。`Math.max`） |
| AC-14 [unit] 通しでの更新タイミングと値 | `startGame(createInitialState(12345, 0))` | 入力なしで dt ∈ {1000/60, 50} の固定 dt で gameover まで step（上限 10 秒） | gameover になるフレームより前は全フレームで `highScore === 0`。gameover のフレームで `highScore === score` となり、以降の step では変わらない。gameover 時の `distance` は経過時間 `elapsed`（= フレーム数 × dt）に対して `S * elapsed / 1000` と誤差 1e-6、`elapsed` は `T0 < elapsed ≤ T0 + dt + 1e-6`、`score` は `Math.floor(S*T0/1000/P)` 以上 `Math.floor(S*(T0+MAXDT)/1000/P)` 以下（現行値 94〜96） |

### 状態の初期化・リトライ（`src/core/state.ts`）
| ID | Given | When | Then |
|---|---|---|---|
| AC-15 [unit] 初期状態 | — | `createInitialState()`、`createInitialState(7)`、`createInitialState(7, 123)`、`createInitialState(7, -1)`、`createInitialState(7, NaN)`、`createInitialState(7, 1.5)` | `distance === 0`、`score === 0`。`highScore` はそれぞれ 0, 0, 123, 0, 0, 0（`sanitizeHighScore` を通す）。既存フィールド（`rngSeed` など）は GAM-2 AC-19 どおり |
| AC-16 [unit] startGame はハイスコアを引き継ぐ | `{ ...createInitialState(777, 10), status: 'gameover', distance: 950, score: 95, highScore: 95 }` | `startGame(s)` | `status === 'playing'`、`rngSeed === 777`、`highScore === 95`、`distance === 0`、`score === 0`（GAM-4 のリトライでそのまま使える） |
| AC-17 [unit] イミュータブル | 自動生成を止めた `playing` の state（`distance = 100`）、AC-13 の衝突直前フレームの state（`structuredClone` で控えを取る） | `step`（入力あり・なし、dt=16 / 衝突ケースは dt=10 で 2 回） | 入力 state が控えと deep equal。戻り値は入力と別参照（`!==`）で、`distance` が入力と異なる |

### HUD 文字列（`src/core/hud.ts`）
| ID | Given | When | Then |
|---|---|---|---|
| AC-18 [unit] 書式 | — | `formatHud({ score, highScore })` | `(45, 123)` → `"HI 00123  00045"`、`(0, 0)` → `"HI 00000  00000"`、`(MAXD, MAXD)` → `"HI 99999  99999"`、`(MAXD + 1, 10**7)` → `"HI 99999  99999"`（表示上限で頭打ち。内部値は頭打ちしない）。`"HI "` ＋ D 桁ゼロ埋めの highScore ＋ 半角スペース 2 つ ＋ D 桁ゼロ埋めの score。テストは D から期待値を組み立てる |
| AC-19 [unit] 引数 | `createInitialState(1, 7)` をもとにした任意の `GameState` | `formatHud(state)` | `GameState` をそのまま渡せる（引数型は `Pick<GameState, 'score' \| 'highScore'>`）。結果が `formatHud({ score: state.score, highScore: state.highScore })` と一致 |

### ハイスコアの保存（`src/highScoreStore.ts`、core の外。unit テストではフェイクを注入する）
| ID | Given | When | Then |
|---|---|---|---|
| AC-20 [unit] 読み込み | `createHighScoreStore(getStorage)`。`getStorage` が返すフェイクの `getItem(KEY)` が次を返す: `"123"` / `null` / `"abc"` / `"-5"` | `load()` | 123 / 0 / 0 / 0。`getItem` が `KEY` で呼ばれている |
| AC-21 [unit] 使えない環境での読み込み | `getStorage` が (a) 例外を投げる（`window.localStorage` へのアクセス自体が SecurityError になる環境）、(b) `null` を返す、(c) `undefined` を返す、(d) `getItem` が例外を投げるフェイクを返す | `load()` | どれも例外を投げずに 0 を返す |
| AC-22 [unit] 保存 | `setItem` を記録するフェイク | `save(123)`、`save(0)` | `setItem(KEY, "123")`、`setItem(KEY, "0")` が呼ばれる。保存した値を同じフェイクで `load()` すると 123 / 0 に戻る（往復） |
| AC-23 [unit] 使えない環境・不正値での保存 | (a) `getStorage` が例外を投げる、(b) `null` を返す、(c) `setItem` が例外を投げる（QuotaExceededError 相当）フェイク／正常なフェイクに `save(-1)`、`save(1.5)`、`save(NaN)` | `save(…)` | どれも例外を投げない。不正値のケースでは `setItem` が呼ばれない |
| AC-24 [unit] 既存テストの扱い | GAM-1 / GAM-2 の既存 unit テスト（`state.test.ts`、`obstacles.test.ts` ほか） | `npm test` | **変更せずに** green（下記「既存テストへの影響」で確認済み。修正が必要になった場合は削除・skip ではなく置き換え、理由を進捗ノートに書く） |

### E2E
| ID | Given | When | Then |
|---|---|---|---|
| AC-25 [e2e] スコアが増え、gameover で止まり、ハイスコアと HUD に反映される | 新しいブラウザコンテキスト（localStorage 空）で `/?test=1&seed=12345` を開き、canvas クリック → SPACE で `status === 'playing'` | 何も入力しない | (1) `{status, score}` を poll して `score >= 10` になるのを待つ（timeout 5000ms）。そのサンプルで `status === 'playing'`。(2) `status === 'gameover'` を poll（timeout 15000ms）。(3) 取得した state `s1` で `highScore === score`、`score` が `Math.floor(S*T0/1000/P)` 以上 `Math.floor(S*(T0+MAXDT)/1000/P)` 以下（現行値 94〜96）。(4) ブラウザで 10 アニメーションフレーム待ってから取得した `s2` で `s2.score === s1.score`、`s2.distance === s1.distance`、`s2.highScore === s1.highScore`（gameover で止まる）。(5) `window.__GAME__.getHudText() === formatHud(s2)`（例 `"HI 00095  00095"`） |
| AC-26 [e2e] ハイスコアがリロード後も残る | AC-25 と同じ手順で gameover まで進め、`H = getState().highScore` を記録 | `page.reload()`（同じコンテキストなので localStorage は残る） | `status === 'ready'` を poll。その state で `highScore === H`、`score === 0`、`distance === 0`。`localStorage.getItem(KEY) === String(H)`。10 アニメーションフレーム待っても `score === 0`（ready では増えない）。`getHudText() === formatHud(state)`（例 `"HI 00095  00000"`）。なお同じテストの最初の `ready`（リロード前）では `highScore === 0`、`getHudText() === formatHud(state)`（`"HI 00000  00000"`） |

## 設計

### 変更ファイル一覧
| ファイル | 種別 | 内容 |
|---|---|---|
| `src/core/config.ts` | 変更 | `SCORE`、`HUD` を追加 |
| `src/core/score.ts` | 新規 | `advanceDistance`、`scoreFromDistance`、`sanitizeHighScore`、`parseHighScore` |
| `src/core/hud.ts` | 新規 | `formatHud` |
| `src/core/state.ts` | 変更 | `GameState` に `distance`・`highScore` を追加、`createInitialState(seed?, highScore?)`、`startGame` のハイスコア引き継ぎ、`step` の playing 分岐で距離・スコア・ハイスコアを更新 |
| `src/highScoreStore.ts` | 新規 | localStorage アダプタ（`createHighScoreStore`、`HIGH_SCORE_KEY`、型） |
| `src/scenes/GameScene.ts` | 変更 | ストアを受け取る。HUD テキストを右上に描画。ハイスコアが変わったフレームで保存。`hudText` を公開 |
| `src/main.ts` | 変更 | ストアを生成して scene に注入。`window.__GAME__` に `getHudText` を追加 |
| `tests/unit/score.test.ts` | 新規 | AC-1〜4 |
| `tests/unit/hud.test.ts` | 新規 | AC-18, 19 |
| `tests/unit/highScoreStore.test.ts` | 新規 | AC-20〜23 |
| `tests/unit/state.test.ts` | 変更（追記のみ） | AC-5〜17 を新しい `describe('GAM-3 …')` に追加。既存テストは変更しない（AC-24） |
| `tests/e2e/score.spec.ts` | 新規 | AC-25, 26 |
| `docs/game-design.md` | 変更 | スコア・HUD・ハイスコアの仕様を追記、ロードマップの GAM-3 を更新（差分案は後述） |

### 追加する定数（`src/core/config.ts`）
```ts
export const SCORE = {
  /** 走行距離 [px] をスコア 1 点に換算する量。300 px/s で 30 点/秒 */
  pxPerPoint: 10,
  /** scoreFromDistance の floor で、浮動小数誤差により境界をわずかに下回るのを吸収する量 [点] */
  floorEpsilon: 1e-6,
  /** HUD に表示する桁数（ゼロ埋め）。超えたら 10^digits - 1 で頭打ち */
  hudDigits: 5,
} as const;

export const HUD = {
  /** 画面右上からの余白 [px] */
  marginPx: 16,
  fontSizePx: 20,
} as const;
```
根拠:
- **10px = 1 点**: 初速 300 px/s で 30 点/秒。何もしなければ 約 94 点、1 分走って 約 1800 点。5 桁（99999）に達するのは約 55 分（GAM-5 の速度上昇でもっと早まるが、頭打ちは表示だけ）
- **EPS = 1e-6 点**（= 1e-5 px）: 浮動小数の積算誤差（3000ms 走って 1e-12 px 程度）より十分大きく、1 フレームの移動量（最小でも 数 px）より十分小さい。これがないと 3000ms ちょうどで 899.99999… px → 89 点のように分割によって 1 点ずれ、AC-9 が不安定になる

### 追加する型・関数（src/core、Phaser import 禁止）

#### `src/core/score.ts`（新規）
```ts
/** 1 フレームぶん距離を進める。dtMs はクランプ済み。 */
export function advanceDistance(distance: number, scrollSpeed: number, dtMs: number): number
// distance + scrollSpeed * dtMs / MS_PER_SECOND（MS_PER_SECOND = 1000 はファイル内の名前付き定数）

/** 走行距離 [px] → スコア（0 以上の整数） */
export function scoreFromDistance(distance: number): number
// Math.max(0, Math.floor(distance / SCORE.pxPerPoint + SCORE.floorEpsilon))

/** 0 以上の安全な整数ならそのまま、それ以外は 0 */
export function sanitizeHighScore(n: number): number
// Number.isSafeInteger(n) && n >= 0 ? n : 0

/** 保存された文字列 → ハイスコア。/^\d+$/ に一致し安全な整数のときだけその値、それ以外は 0 */
export function parseHighScore(raw: string | null): number
// raw !== null && /^\d+$/.test(raw) ? sanitizeHighScore(Number(raw)) : 0
```

#### `src/core/hud.ts`（新規）
```ts
/** HUD の文字列。例: "HI 00123  00045"（ハイスコア → 今回のスコアの順） */
export function formatHud(s: Pick<GameState, 'score' | 'highScore'>): string
```
- 各値を `Math.min(value, 10 ** SCORE.hudDigits - 1)` で頭打ちし、`String(v).padStart(SCORE.hudDigits, '0')`
- `"HI " + hi + "  " + score`（区切りの `"HI "` と半角スペース 2 つは hud.ts 内の名前付き定数）

#### `src/core/state.ts`（変更）
```ts
export interface GameState {
  status: GameStatus;
  player: PlayerState;
  /** 今回のスコア = scoreFromDistance(distance)。0 以上の整数 */
  score: number;
  /** 今回の走行距離 [px]。playing 中に scrollSpeed × dt を積算する */
  distance: number;
  /** ハイスコア。gameover への遷移時に max(highScore, score) で更新する */
  highScore: number;
  obstacles: Obstacle[];
  spawnTimerMs: number;
  rngSeed: number;
  nextObstacleId: number;
  scrollSpeed: number;
}

export function createInitialState(seed: number = RANDOM.defaultSeed, highScore: number = 0): GameState
// 既存の初期値に加えて distance: 0、score: 0、highScore: sanitizeHighScore(highScore)

export function startGame(state: GameState): GameState
// playing なら state をそのまま返す（従来どおり）。それ以外は
// { ...createInitialState(state.rngSeed, state.highScore), status: 'playing' }
```
`step` の変更は `playing` 分岐のみ（不正 dt → クランプ → ready / gameover の判定順は変えない。ready → playing の遷移フレームでは距離を進めない＝AC-11）:
1. `player`、`world`、`hit` の計算は GAM-2 のまま
2. `distance = advanceDistance(state.distance, state.scrollSpeed, dt)`（**クランプ後の `dt`**、**`advanceObstacles` と同じフレーム開始時の `state.scrollSpeed`**）
3. `score = scoreFromDistance(distance)`
4. `highScore = hit ? Math.max(state.highScore, score) : state.highScore`
5. `{ ...state, ...world, player, distance, score, highScore, status: hit ? 'gameover' : 'playing' }` を返す
- 衝突フレームも、そのフレームで世界が動いたぶんを距離に含める（障害物の位置がそのフレームぶん進んでいるのと一貫させる）
- `gameover` 分岐は従来どおり state をそのまま返すので、gameover 後は距離・スコア・ハイスコアが変わらない
- ハイスコアが変わるのは playing → gameover の遷移フレームの 1 回だけ（scene はこれを「`highScore` が前フレームと変わった」で検知して保存する）

### core の外（`src/highScoreStore.ts`、新規）
```ts
/** localStorage のうち使う部分だけ（テストでフェイクを渡せるように） */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
export interface HighScoreStore {
  load(): number;
  save(highScore: number): void;
}
export const HIGH_SCORE_KEY = 'pixel-runner.highScore';

/** getStorage は呼ぶたびに評価する（window.localStorage へのアクセス自体が例外を投げうるため、関数で受け取る） */
export function createHighScoreStore(getStorage: () => KeyValueStorage | null | undefined): HighScoreStore
```
- `load()`: `try { const st = getStorage(); return st ? parseHighScore(st.getItem(HIGH_SCORE_KEY)) : 0; } catch { return 0; }`
- `save(n)`: `sanitizeHighScore(n) !== n` なら何もしない（不正値は書かない）。それ以外は `try { getStorage()?.setItem(HIGH_SCORE_KEY, String(n)); } catch { /* 保存できなくてもゲームは続ける */ }`
- 不正な値が入っていた場合も削除はせず、次にハイスコアが更新されたときに上書きされる
- core から import してよいのは `parseHighScore` / `sanitizeHighScore` のみ（逆方向の依存＝core からこのファイルを import することは禁止）
- unit テストは Vitest の node 環境で動くので `window` は無い。テストは必ずフェイクを注入する（`vi.fn()` で `getItem`/`setItem` を作る、例外を投げるフェイクを作る）

### scene 側の変更（描画・入力のみ）
`src/main.ts`:
- `const store = createHighScoreStore(() => window.localStorage)`（`window.localStorage` の参照は関数の中で行い、例外はアダプタが握りつぶす）
- `new GameScene(readSeed(), store)`
- `window.__GAME__` の型を `{ getState: () => GameState; getHudText: () => string }` にし、`?test=1` のとき `getHudText: () => scene.hudText` を追加。`getState` は変更しない

`src/scenes/GameScene.ts`:
- `constructor(seed: number, private readonly highScoreStore: HighScoreStore)` で `this.state = createInitialState(seed, highScoreStore.load())`
- `create()` で HUD テキストを追加: `this.add.text(WORLD.width - HUD.marginPx, HUD.marginPx, formatHud(this.state), { fontSize: \`${HUD.fontSizePx}px\`, fontFamily: 'monospace', color: … }).setOrigin(1, 0)`（右上基準。等幅フォントで桁が揃う）。色は既存の他テキストと同じ扱いでよい（マジックナンバー規約に従い、新しい色を使うならファイル内の名前付き定数）
- `update()`:
  1. `const prev = this.state; this.state = step(prev, …, delta);`（既存）
  2. `if (this.state.highScore !== prev.highScore) this.highScoreStore.save(this.state.highScore);`（core が更新したときだけ保存＝ gameover 遷移時の 1 回）
  3. `this.hud.setText(formatHud(this.state))`
- `get hudText(): string` で HUD テキストの現在の文字列（`this.hud?.text ?? ''`）を返す（E2E 用）
- HUD は ready / playing / gameover のすべてで表示する。スコアの計算・整形は書かない（`formatHud` を呼ぶだけ）

### docs/game-design.md 差分案
```diff
 - 定数は `src/core/config.ts` の `SCROLL`、`OBSTACLE`、`RANDOM`
+
+## スコアと HUD（GAM-3）
+- スコア = 走行距離。playing 中だけ、フレームごとに スクロール速度 × 経過時間 を積算する（速度が変わっても正しく積算される）
+- 10px = 1 点（初速で 30 点/秒）。ready・gameover 中は増えない。衝突したフレームの移動ぶんは含める
+- 画面右上に `HI 00123  00045`（ハイスコア、今回のスコア。5 桁ゼロ埋め、99999 で表示を頭打ち）を常に表示する
+- ハイスコアはゲームオーバーになった瞬間に更新し（プレイ中は更新しない）、localStorage（キー `pixel-runner.highScore`）に保存する
+- localStorage が使えない・不正な値が入っている場合はハイスコア 0 として動く（エラーにしない）
+- 定数は `src/core/config.ts` の `SCORE`、`HUD`
@@
-| GAM-3 | スコア（走行距離）と HUD 表示、ハイスコア保存 | 未着手 |
+| GAM-3 | スコア（走行距離）と HUD 表示、ハイスコア保存 | 完了 |
```
（ロードマップの「完了」への更新はマージ時の慣例に合わせる）

## テスト計画

### Unit（Vitest）
`tests/unit/score.test.ts`: AC-1〜4（境界値を表で回す）
`tests/unit/hud.test.ts`: AC-18, 19（期待値は `SCORE.hudDigits` から組み立てる）
`tests/unit/highScoreStore.test.ts`: AC-20〜23
- フェイクは `const fake = { getItem: vi.fn(() => '123'), setItem: vi.fn() }`。例外系は `vi.fn(() => { throw new Error('SecurityError') })`。往復（AC-22）は `Map` を裏に持つフェイクで確認
- `window` / 実際の `localStorage` には触らない

`tests/unit/state.test.ts`（追記のみ、新しい `describe('GAM-3 step（スコア・ハイスコア）')`）:
- GAM-2 ブロックの `noSpawn` / `runFixedDt` / `repeat` / `runDts` はそのブロック内のローカル関数なので、新しい describe でも同等のヘルパーを定義する（既存ブロックを書き換えて共通化するのは可だが、既存テストの中身は変えない）
- AC-5〜8（1 フレームの増分）、AC-9（5 通りの分割。`[1000/60]×180` は合計が厳密に 3000 にならないので、合計 `sum` を計算して期待距離を `S*sum/1000` とし、スコアは `scoreFromDistance(S*sum/1000)` と比較する。他の 4 つは合計 3000 を `toBe` で確認）
- AC-10〜13、AC-14（GAM-2 の `runUntilGameover` と同様だが `startGame(createInitialState(12345, 0))` から開始し自動生成あり。T0 は定数から計算）
- AC-15〜17

### 既存テストへの影響（確認済み、変更不要）
- GAM-1 `AC-14`（state.test.ts L172〜）: playing で変化したとき「`player`/`status`/`obstacles`/`spawnTimerMs` のどれかが変わる」「`spawnTimerMs === s.spawnTimerMs - 16`」を検証。GAM-3 後も `spawnTimerMs` は従来どおり変わるので成立。`distance`/`score` の追加はこの式に影響しない
- GAM-1 `AC-2`（空中のジャンプ入力は無視）: 距離はジャンプ入力に依存しないので `toEqual` が成立
- GAM-1 `AC-12`（dt クランプ）: 距離をクランプ後の dt で積算する限り `toEqual` が成立（AC-8 で明示）。**`dtMs` で積算すると壊れる**ので注意
- GAM-1 `AC-10`、GAM-2 `AC-17`（gameover で不変）、GAM-2 `AC-18`・GAM-1 `AC-11 補足`（ready で不変）: 分岐は変えないので成立
- GAM-2 `AC-20`（startGame）: `score === 0` は成立。`highScore` は `createInitialState(777)` 由来の 0 を引き継ぐだけで、既存アサーションに影響しない
- GAM-2 `AC-21`（同シードで deep equal）、`AC-22`（イミュータブル）: 成立
- 冒頭の `startGame で playing になりスコアがリセットされる`: 成立
- `obstacles.test.ts` / `collision.test.ts` / `random.test.ts` / `player.test.ts`: `ObstacleWorld` の `Pick` は変えないので影響なし
- 型: 既存テストは `GameState` をスプレッドで作っているので、フィールド追加で型エラーにならない
- E2E `boot.spec.ts` / `jump.spec.ts` / `obstacles.spec.ts`: `getState` の形は互換（フィールド追加のみ）。HUD テキストの追加は state に影響しない

### E2E（Playwright）
`tests/e2e/score.spec.ts`（2 シナリオ）:
- 共通: `/?test=1&seed=12345` を開き、canvas visible → `status === 'ready'` を poll → canvas クリック → SPACE → `status === 'playing'` を poll（`obstacles.spec.ts` の `startPlaying` と同じ手順。ファイル内に同等の関数を書く）
- 定数・`formatHud` は `src/core/config.ts`・`src/core/hud.ts` から import してよい。`HIGH_SCORE_KEY` は `src/highScoreStore.ts` から import してよい（Phaser に依存しないファイル）
- フレーム待ちヘルパー: `page.evaluate(() => new Promise<void>((resolve) => { let n = 0; const tick = () => (++n >= 10 ? resolve() : requestAnimationFrame(tick)); requestAnimationFrame(tick); }))`。固定 sleep（`waitForTimeout`）は使わない
- AC-25: `expect.poll(() => getState().score, { intervals: [100], timeout: 5000 }).toBeGreaterThanOrEqual(10)` の後、1 回の `evaluate` で `{status, score}` を取得して `status === 'playing'` を確認（同一サンプルで見るため、poll の戻り値を `{status, score}` にしてもよい）→ `gameover` を `{ intervals: [100], timeout: 15000 }` で poll → `s1` 取得・範囲確認 → 10 フレーム待ち → `s2` 取得・不変確認 → `getHudText()` と `formatHud(s2)` を比較
- AC-26: AC-25 と同じく gameover まで進め `H` を記録 → `page.reload()` → `ready` を poll → state・`localStorage.getItem(KEY)`・`getHudText()` を確認 → 10 フレーム待って `score === 0`。リロード前の最初の `ready` 時点で `highScore === 0` と HUD 文字列も確認する
- 待ち時間の根拠:
  - スコア 10 点はゲーム内 `10*P/S` = 0.33 秒。最初の衝突は 3.16 秒。dt は 50ms クランプなので headless で 10fps に落ちてもゲーム内時間は実時間の半分で進み、10 点まで 約 0.7 秒・衝突まで 約 6.3 秒で、timeout 5 秒／15 秒に 2 倍以上の余裕がある（GAM-2 と同じ根拠）
  - 10 点到達から衝突まで ゲーム内 2.8 秒あるので、poll 間隔 100ms で「playing 中に score ≥ 10」を必ず観測できる
  - gameover の score 範囲（94〜96）は、衝突フレームがゲーム内 `(T0, T0 + dt]`（dt ≤ MAXDT）に入ることから決まり、フレームレートの揺れに依存しない。シード 12345 の最初の障害物の高さにも依存しない（地上のプレイヤーはどの高さの障害物とも衝突する）
  - gameover 後の state は step が同じ state を返すので、10 フレーム待ってからの比較は決定的
  - HUD 文字列は ready / gameover の静止した state でだけ比較する（playing 中は毎フレーム変わり、`getState` と `getHudText` の取得タイミングがずれて flaky になるため比較しない）
  - Playwright はテストごとに新しいブラウザコンテキストを作るので、テスト開始時の localStorage は空（テスト間で干渉しない）。`page.reload()` は同じコンテキストなので保存値が残る

## 影響範囲・リスク
- **`GameState` の拡張**: `distance`、`highScore` の追加。`createInitialState` の第 2 引数は省略可能なので既存の呼び出しは変更不要。`GameScene` のコンストラクタ引数が増えるため `main.ts` を同時に変更する
- **浮動小数**: スコアは距離の floor なので、境界付近で分割によって 1 点ずれうる。`EPS` で吸収する（AC-2, 9）。距離自体は誤差 1e-6 以内の一致で判定する
- **ハイスコアの更新タイミング**: プレイ中に今回のスコアがハイスコアを上回っても、HUD の HI はゲームオーバーまで変わらない（確認事項 Q3）
- **保存の失敗**: localStorage が使えない環境ではリロードでハイスコアが消えるが、ゲームは動く（仕様どおり）。保存失敗をユーザーに通知はしない
- **gameover から抜けられない**: GAM-2 と同様、リトライは GAM-4。`startGame` がハイスコアを引き継ぐので GAM-4 はそれを呼ぶだけでよい（AC-16）。リトライ後に再び gameover で `highScore` が変われば scene が保存する
- **GAM-5 への接続**: 距離は `state.scrollSpeed` を使って積算するので、GAM-5 で速度を上げても正しく積算される（AC-6）。GAM-5 で `step` の中で速度を更新する場合、**障害物の移動と距離の積算に同じフレーム開始時の速度を使う**順序を保つこと（ずれると障害物と距離が食い違う）
- **`window.__GAME__` の拡張**: `getHudText` を追加する（テストモード限定）。`getState` の互換性は保つ

## 確認事項（人間に判断してほしいこと。暫定案で設計済み）
1. **Q1 スコアの単位**: 10px = 1 点（初速で 30 点/秒、何もしなければ約 94 点）でよいか。メートル表記（例: 30px = 1m、`123m`）にしたい場合は `SCORE.pxPerPoint` と `formatHud` の単位表記を変える
2. **Q2 表示形式・位置**: 右上（余白 16px、20px 等幅フォント）に `HI 00123  00045`（ハイスコアが左、今回が右。5 桁ゼロ埋め、99999 で表示を頭打ち）でよいか。ラベル付き（`SCORE 45  HI 123`）やゼロ埋めなしが良ければ指示がほしい
3. **Q3 HI の更新タイミング**: ゲームオーバーの瞬間にだけ更新・保存する（プレイ中に今回スコアが上回っても HI 表示は変わらない）でよいか。プレイ中もリアルタイムに HI を追従させる案もある（その場合も保存は gameover 時の 1 回にする）
4. **Q4 衝突フレームの距離**: 衝突したフレームで進んだぶん（最大 15px ＝ 1.5 点）もスコアに含める（障害物の位置と一貫させる）でよいか
5. **Q5 開始フレーム**: ready → playing になったフレームでは距離を進めない（開始の押下はジャンプにも使わない、と同じ扱い）でよいか
6. **Q6 localStorage のキーと形式**: キー `pixel-runner.highScore`、値は 10 進整数の文字列でよいか。不正な値は 0 扱いにし、削除はせず次の更新時に上書きする
7. **Q7 テストモードでの分離**: `?test=1` でも本番と同じキーを使う（Playwright はテストごとにコンテキストが分かれ localStorage が空で始まるため干渉しない）。手元の開発ブラウザで E2E 相当の操作をすると実際のハイスコアが上書きされうるが許容する、でよいか。分離したい場合は `?test=1` でキーに接尾辞を付ける案がある
8. **Q8 `window.__GAME__.getHudText()` の追加**: HUD の表示文字列を E2E で検証するため、テストモード限定で HUD テキストの現在の文字列を返す関数を追加する（ピクセル比較はしない）。`getState()` 以外のフックを増やしてよいか。不可なら AC-25/26 の HUD 文字列確認を外し、`formatHud` の unit テスト（AC-18, 19）だけで担保する
9. **Q9 ready 中の HUD**: タイトル表示中（ready）も HUD を表示する（`HI 00095  00000`。前回までのハイスコアが開始前に見える）でよいか
10. **Q10 ハイスコアのリセット手段**: GAM-3 では用意しない（ブラウザのストレージ削除でのみリセット）でよいか

分割は不要と判断した（core に 2 ファイル追加と step の拡張、core 外のアダプタ 1 ファイル、scene は HUD 描画と保存呼び出しのみで 1 Issue に収まる）。

## 改訂履歴
- 初版: 新規作成（人間のコメントなし）
