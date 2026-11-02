# GAM-2: 障害物の生成・スクロールと当たり判定

## 目的
`playing` 中、画面右端から障害物が一定間隔（ランダム幅あり）で生成されて左へ流れ、画面左外に出たら消える。プレイヤーと障害物が AABB で重なったら `status = 'gameover'` になる。障害物の高さと間隔は、GAM-1 のジャンプ（滞空 1.1 秒・最高 約 151px）で必ず越えられる値にする。

あわせて、GAM-3（スコア）・GAM-4（リトライ）・GAM-5（速度上昇）が乗れるように、次の 2 つの土台を入れる。
- スクロール速度を `GameState.scrollSpeed` に持たせる（初期値は定数）
- 乱数をシード付き PRNG の状態として `GameState.rngSeed` に持たせる（core から `Math.random` を呼ばない）

### 座標系・前提（GAM-1 と同じ）
- y は下向きが正。`player.y` は足元の y（地上では `WORLD.groundY` = 340）。プレイヤーの矩形は左端 `player.x`（=120）、幅 `PLAYER.width`=32、高さ `PLAYER.height`=32（scene の `setOrigin(0, 1)` と同じ）
- 障害物は地面に置かれた矩形。`obstacle.x` は**左端**の x、下端は常に `WORLD.groundY`、上端は `WORLD.groundY - height`
- 速度は px/s、時間は ms（`step` の dt と同じ）

## 受入条件

表記: `S` = `SCROLL.initialSpeed`、`W` = `OBSTACLE.width`、`HMIN`/`HMAX` = `OBSTACLE.minHeight`/`maxHeight`、`IMIN`/`IMAX` = `OBSTACLE.minIntervalMs`/`maxIntervalMs`、`FIRST` = `OBSTACLE.firstSpawnDelayMs`、`SX` = `OBSTACLE.spawnX`、`G`/`V`/`MAXDT` = GAM-1 の `PHYSICS`、`GY` = `WORLD.groundY`、`PR` = `PLAYER.x + PLAYER.width`（プレイヤー右端 = 152）。
テストは数値を直書きせず、これらの定数から期待値を計算する。
「自動生成を止めた state」は、`spawnTimerMs` を十分大きな値（例 `1e9`）にして、`obstacles` を直接与えて作る。

### PRNG（`src/core/random.ts`）
| ID | Given | When | Then |
|---|---|---|---|
| AC-1 [unit] 決定的 | 任意の uint32 シード（例 0, 1, 12345, 0xffffffff） | `nextRandom(seed)` を同じ引数で 2 回呼ぶ | 2 つの戻り値が deep equal。`value` は `0 ≤ value < 1`、`seed` は `0 ≤ seed ≤ 0xffffffff` の整数 |
| AC-2 [unit] 値域 | シード 12345 | `nextRandom` を戻り値の `seed` で連鎖させて 10000 回呼ぶ | すべての `value` が `[0, 1)`。最小値 < 0.01 かつ最大値 > 0.99（偏りの粗いチェック）。また、シード 1 と 2 から始めた最初の 10 個の列は一致しない |

### AABB（`src/core/collision.ts`）
| ID | Given | When | Then |
|---|---|---|---|
| AC-3 [unit] 境界 | 矩形 `A = {left:0, top:0, right:10, bottom:10}` | `intersects(A, B)` を以下の B（`{left,top,right,bottom}` の順）で呼ぶ | 一部が重なる `{5,5,15,15}` → `true`／B が A に内包 `{2,2,8,8}` → `true`／A が B に内包 `{-5,-5,15,15}` → `true`／**右辺が接するだけ** `{10,0,20,10}` → `false`／**左辺が接するだけ** `{-10,0,0,10}` → `false`／**下辺が接するだけ** `{0,10,10,20}` → `false`／**上辺が接するだけ** `{0,-10,10,0}` → `false`／**角だけ接する** `{10,10,20,20}` → `false`／離れている `{11,0,20,10}` → `false`。引数を入れ替えても結果が同じ |
| AC-4 [unit] 矩形の作り方 | `player = {x:120, y:340, vy:0, onGround:true}`、`obstacle = {id:1, x:200, width:24, height:40}` | `playerRect(player)`、`obstacleRect(obstacle)` | `{left:120, top:308, right:152, bottom:340}`、`{left:200, top:300, right:224, bottom:340}`（`PLAYER`・`GY` から計算した値と一致） |
| AC-5 [unit] 上を通過中の境界 | `o = {id:1, x: PLAYER.x, width: W, height: HMAX}`、プレイヤーは空中 `{x: PLAYER.x, y, vy: 0, onGround: false}` | `intersects(playerRect(p), obstacleRect(o))` を y を変えて呼ぶ | `y = GY - HMAX`（足元が障害物の上端にちょうど接する）→ `false`、`y = GY - HMAX + 0.5` → `true` |

### 障害物の移動・削除・生成（`src/core/obstacles.ts` の `advanceObstacles`、および `step`）
| ID | Given | When | Then |
|---|---|---|---|
| AC-6 [unit] 移動 | 自動生成を止めた world（`obstacles = [{id:1,x:500,W,HMIN}, {id:2,x:700,W,HMAX}]`、`scrollSpeed = S`） | `advanceObstacles(world, dt)`（dt = 10, 16, MAXDT） | 各障害物の `x` が `x - S*dt/1000` と誤差 1e-9 で一致。`id`・`width`・`height` は不変。並び順（生成順＝x 昇順）は不変 |
| AC-7 [unit] 速度は state から読む | AC-6 と同じだが `scrollSpeed = 2*S` | 同上 | 移動量が `2*S*dt/1000`（GAM-5 で速度を変えられることの確認） |
| AC-8 [unit] 画面外で削除 | 自動生成を止めた world、`scrollSpeed = S`、dt = 10（移動量 `d = S*10/1000`、現行値で 3） | `advanceObstacles` | 移動後に右端 `x + width ≤ 0` となるものは削除される（例: 移動前 `x = -W + d` → 移動後の右端がちょうど 0 → **削除**）。移動後 `x + width > 0` のものは残る（例: 移動前 `x = -W + d + 0.5` → 右端 0.5 → **残る**）。残った障害物の順序は保たれる |
| AC-9 [unit] 最初の生成 | `startGame(createInitialState(seed))`（seed = 1, 42, 12345） | dt=10 で 1 フレームずつ `step`（入力なし） | 累計 `FIRST - 10` ms までは `obstacles.length === 0`。累計 `FIRST` ms のフレームで `obstacles.length === 1`、その障害物は `x === SX`（はみ出し 0 なので補正なし）、`width === W`、`height` は `[HMIN, HMAX]` の整数、`id === 1`。そのフレームの `spawnTimerMs` は `IMIN ≤ spawnTimerMs < IMAX`、`nextObstacleId === 2` |
| AC-10 [unit] 生成間隔・高さの範囲 | `createInitialState(seed)` をもとに `spawnTimerMs = FIRST` の world（seed = 1, 42, 12345） | dt = 50 で `advanceObstacles` を 600 秒ぶん（12000 回）呼ぶ。毎フレーム、隣り合う障害物の左端の差 `obstacles[i+1].x - obstacles[i].x` を検査し、生成された全障害物（id で重複除去）の高さを記録する | 差が常に `S*IMIN/1000 - 1e-6` 以上 `S*IMAX/1000 + 1e-6` 以下（現行値で 420〜720px）。高さはすべて `[HMIN, HMAX]` の整数。3 シード合計（約 900 個）で `HMIN` と `HMAX` がそれぞれ 1 回以上出現する（境界の off-by-one 検出） |
| AC-11 [unit] dt 非依存（障害物） | AC-10 と同じ初期 world（seed = 1, 42） | 合計 10000ms を次の分割で `advanceObstacles` する: `[10]×1000`、`[50]×200`、`[7,43,25,25]×100` | 3 通りの結果で、`obstacles.length`・各 `id`・各 `height`・`rngSeed`・`nextObstacleId` が `===` で一致し、各 `x` と `spawnTimerMs` が誤差 1e-6 以内で一致 |
| AC-12 [unit] dt 非依存（step 全体） | `startGame(createInitialState(12345))`（入力なし） | 合計 3000ms（何もしない場合の最初の衝突 3160ms より前）を `[10]×300`、`[20]×150`、`[50]×60`、`[5,45,30,20,50,50]×15` で `step` | 4 通りすべて `status === 'playing'`、障害物について AC-11 と同じ一致条件 |

### 衝突と gameover
| ID | Given | When | Then |
|---|---|---|---|
| AC-13 [unit] 接触は衝突ではない | `playing`、プレイヤーは地上、自動生成停止、障害物 1 つ `{id:1, x: PR + S*10/1000, width: W, height: HMIN}` | `step(s, 入力なし, 10)` → その結果をもう一度 `step(…, 入力なし, 10)` | 1 回目: 障害物の左端がちょうど `PR`（プレイヤー右端と接するだけ）で `status === 'playing'`。2 回目: 左端が `PR - S*10/1000` になり `status === 'gameover'`（`S*10/1000` は現行値で 3。浮動小数で厳密に表せる値） |
| AC-14 [unit] 何もしなければ衝突する | `playing`、プレイヤー地上、自動生成停止、障害物 1 つ `{id:1, x: SX, width: W, height: HMAX}` | 入力なしで dt ∈ {1000/60, 50} の固定 dt で step し続ける（上限 10 秒） | どこかのフレームで `status === 'gameover'` になる。そのフレームで障害物の左端は `x < PR`、ひとつ前のフレームでは `x ≥ PR`（初めて重なったフレームで判定されている） |
| AC-15 [unit] 最大高さ・最小間隔でも連続して飛び越えられる | `playing`、プレイヤー地上、自動生成停止、`obstacles = [{id:1, x:SX, W, HMAX}, {id:2, x: SX + S*IMIN/1000, W, HMAX}]` | dt ∈ {1000/144, 1000/60, 1000/30, 50} の各固定 dt で、次の方針で入力を決めて step する（上限 10 秒）: **まだ跳んでいない障害物のうち最も左のものの `x`（step 前の値）が `XJ` 以下になった最初のフレームで `jumpPressed = true`**。`XJ = PLAYER.x + PLAYER.width/2 - W/2 + S*|V|/G`（頂点で障害物とプレイヤーの中心が揃う位置。現行値 289） | 両方の障害物の右端が `PLAYER.x` 以下になるまで、全フレームで `status === 'playing'`。ジャンプ入力した 2 回のフレームはどちらも step 前に `player.onGround === true`（入力が無視されていない） |
| AC-16 [unit] 数値の妥当性（解析） | `config.ts` の定数 | 次の式を計算する | (a) 高さ `HMAX` より上にいられる時間 `2*sqrt(V² - 2*G*HMAX)/G` [s] が、障害物とプレイヤーが x 方向に重なる時間 `(PLAYER.width + W)/S` [s] の **2 倍以上**（現行値 0.873s ≥ 2×0.187s）。(b) `IMIN ≥ 2*|V|/G*1000 + MAXDT + 200`（滞空 1100ms + 着地後 1 フレーム + 反応猶予 200ms = 1350 ≤ 1400）。(c) `1 ≤ HMIN ≤ HMAX`、`0 < IMIN ≤ IMAX`、`S*MAXDT/1000 < W`（1 フレームの移動量 15px が障害物幅より小さく、x 方向のすり抜けが起きない） |
| AC-17 [unit] gameover で停止 | AC-14 で `gameover` になったフレームの state | 入力あり・なしを交互に dt=16 で 100 回 step | 毎回、入力 state と deep equal（障害物の移動・削除・生成、`spawnTimerMs`・`rngSeed` の更新がすべて止まる） |
| AC-18 [unit] ready では動かない | `createInitialState(seed)` | 入力なしで dt=50 を 100 回 step | deep equal のまま（`obstacles` は空、`spawnTimerMs === FIRST`） |

### 状態・シード・イミュータブル
| ID | Given | When | Then |
|---|---|---|---|
| AC-19 [unit] 初期状態とシード | — | `createInitialState(seed)`（seed = 0, 12345, 2**32 + 5, -1）／`createInitialState()` | `rngSeed === seed >>> 0`（それぞれ 0, 12345, 5, 4294967295）。引数省略時は `RANDOM.defaultSeed`。`obstacles` は空配列、`spawnTimerMs === FIRST`、`nextObstacleId === 1`、`scrollSpeed === S` |
| AC-20 [unit] startGame はシードを保つ | `{ ...createInitialState(777), obstacles: [障害物 1 つ], spawnTimerMs: 5, nextObstacleId: 9, scrollSpeed: 999, status: 'gameover' }` | `startGame(s)` | `status === 'playing'`、`rngSeed === 777`、`obstacles` 空、`spawnTimerMs === FIRST`、`nextObstacleId === 1`、`scrollSpeed === S`、`score === 0` |
| AC-21 [unit] 再現性 | `startGame(createInitialState(12345))` を 2 つ独立に作る／シード 12345 と 54321 で 1 つずつ作る | 同じ dt 列（`[16]×150`、入力なし）で step | 同じシードの 2 つは最終 state が deep equal。異なるシードの 2 つは、最初の障害物の `height` または最終 `spawnTimerMs` が異なる |
| AC-22 [unit] イミュータブル | 障害物を 2 つ以上含む `playing` の state、`gameover` の state、自動生成を止めていない world（`structuredClone` で控えを取る） | `step`（入力あり・なし、dt=16）、`advanceObstacles(world, 16)` | 入力が控えと deep equal（`obstacles` 配列・各要素とも書き換えられていない）。変化した場合、戻り値・`obstacles` 配列は入力と別参照（`!==`） |
| AC-23 [unit] 既存テストの更新 | GAM-1 の `tests/unit/state.test.ts` の AC-14 | — | 2 つ目のアサーション `expect(r.player === s.player && r.status === s.status).toBe(false)` を、成り立つアサーションに**置き換える**（削除はしない）。置き換え後: 「状態が変化したケースでは、変化したフィールド（`player` または `spawnTimerMs` / `obstacles` など）の少なくとも 1 つが入力と異なる」ことを明示的に検証する（`playing`・地上では `spawnTimerMs` だけが変わり、プレイヤー参照と status が同じになるため。1 つ目の `expect(r).not.toBe(s)` で「変化時は別オブジェクト」は検証できている）。それ以外の GAM-1 テストは変更せずに green |

### E2E
| ID | Given | When | Then |
|---|---|---|---|
| AC-24 [e2e] 障害物が出現して左へ動く | `/?test=1&seed=12345` を開き、canvas クリック → SPACE で `status === 'playing'` | 何も入力しない | `getState().obstacles.length >= 1` になるのを poll（timeout 5000ms）。そのときの先頭障害物の `{id, x}` を記録し、**同じ `id` の障害物**の `x` が記録値より 30 以上小さくなるのを poll（timeout 5000ms）。その時点で `status === 'playing'` |
| AC-25 [e2e] 何もしなければ衝突して gameover | AC-24 と同じ手順で `playing` | 何も入力しない | `getState().status === 'gameover'` になるのを poll（timeout 15000ms）。gameover 時の state で、`player` の矩形（左 `x`、右 `x+PLAYER.width`、上 `y-PLAYER.height`、下 `y`）と AABB で重なる障害物（左 `x`、右 `x+width`、上 `groundY-height`、下 `groundY`。辺の接触は重なりに含めない）が 1 つ以上あり、`player.onGround === true` |

## 設計

### 変更ファイル一覧
| ファイル | 種別 | 内容 |
|---|---|---|
| `src/core/config.ts` | 変更 | `SCROLL`、`OBSTACLE`、`RANDOM` を追加 |
| `src/core/random.ts` | 新規 | シード付き PRNG（mulberry32）`nextRandom` |
| `src/core/collision.ts` | 新規 | `Rect` 型、`intersects`、`playerRect`、`obstacleRect` |
| `src/core/obstacles.ts` | 新規 | `Obstacle` 型、`ObstacleWorld` 型、`advanceObstacles`（移動・削除・生成） |
| `src/core/state.ts` | 変更 | `GameState` にフィールド追加、`createInitialState(seed?)`、`startGame` のシード保持、`step` の playing 分岐に障害物と衝突判定を追加 |
| `src/scenes/GameScene.ts` | 変更 | コンストラクタでシードを受け取る。障害物の矩形を id で同期して描画 |
| `src/main.ts` | 変更 | `?seed=` を読み、なければランダムなシードを作って `GameScene` に渡す |
| `tests/unit/random.test.ts` | 新規 | AC-1, 2 |
| `tests/unit/collision.test.ts` | 新規 | AC-3, 4, 5 |
| `tests/unit/obstacles.test.ts` | 新規 | AC-6〜8, 10, 11, 16, 22（advanceObstacles 分） |
| `tests/unit/state.test.ts` | 変更 | AC-9, 12〜15, 17〜22 を追加、AC-23 の修正 |
| `tests/e2e/obstacles.spec.ts` | 新規 | AC-24, 25 |
| `docs/game-design.md` | 変更 | 障害物・スクロール・当たり判定の仕様を追記（差分案は後述） |

### 追加する型・関数（src/core、Phaser import 禁止）

#### `src/core/random.ts`（新規）
```ts
/** mulberry32。seed は uint32。戻り値の seed を次の呼び出しに渡す。 */
export function nextRandom(seed: number): { value: number; seed: number }
```
- アルゴリズム（再現性のため実装を固定する）:
  ```ts
  const s = (seed + 0x6d2b79f5) >>> 0;
  let t = s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return { value, seed: s };
  ```
- 上記の 16 進数・シフト量はアルゴリズム固有の定数でありゲームの調整値ではないため、`config.ts` ではなく `random.ts` 内の名前付き定数（例 `MULBERRY_INCREMENT`, `UINT32_RANGE`）にする
- core では `Math.random` / `Date.now` を呼ばない

#### `src/core/collision.ts`（新規）
```ts
export interface Rect { left: number; top: number; right: number; bottom: number }
/** 開区間で判定する。辺・角が接するだけ（差が 0）は衝突ではない。 */
export function intersects(a: Rect, b: Rect): boolean
// a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
export function playerRect(p: PlayerState): Rect
// { left: p.x, right: p.x + PLAYER.width, top: p.y - PLAYER.height, bottom: p.y }
export function obstacleRect(o: Obstacle): Rect
// { left: o.x, right: o.x + o.width, top: WORLD.groundY - o.height, bottom: WORLD.groundY }
```

#### `src/core/obstacles.ts`（新規）
```ts
export interface Obstacle {
  /** 1 から始まる連番。E2E と scene で同一障害物を追跡するため */
  id: number;
  /** 左端の x */
  x: number;
  width: number;
  /** 地面からの高さ（下端は常に WORLD.groundY） */
  height: number;
}

/** 障害物の更新に必要な GameState の部分集合 */
export type ObstacleWorld = Pick<GameState, 'obstacles' | 'spawnTimerMs' | 'rngSeed' | 'nextObstacleId' | 'scrollSpeed'>;

/** dtMs（クランプ済み、0 より大きい前提）ぶん障害物を進める。 */
export function advanceObstacles(world: ObstacleWorld, dtMs: number): ObstacleWorld
```
`advanceObstacles` の仕様（この順で処理する）:
1. **移動**: 各障害物 `x' = x - world.scrollSpeed * dtMs / 1000`（この式の形で計算する。AC-13 の境界がこの式に依存する）
2. **削除**: `x' + width <= 0` のものを取り除く（完全に画面左外に出たもの）
3. **タイマー**: `timer = spawnTimerMs - dtMs`
4. **生成**: `timer <= 0` なら 1 つ生成する
   - 乱数を **高さ → 間隔の順に 2 回** 引く（順序は再現性のため固定）
   - `height = HMIN + Math.floor(r1 * (HMAX - HMIN + 1))`（整数、両端含む）
   - `interval = IMIN + r2 * (IMAX - IMIN)`（`[IMIN, IMAX)`）
   - `x = SX - scrollSpeed * (-timer) / 1000`（**はみ出し時間ぶん補正する**。これにより dt の刻みによらず、生成時刻と位置が一致する＝AC-11/12）
   - `{ id: nextObstacleId, x, width: W, height }` を配列の末尾に追加し、`nextObstacleId + 1`
   - `spawnTimerMs = timer + interval`（はみ出しを持ち越す）
   - `IMIN > MAXDT` なので 1 フレームに 2 個生成されることはない（ループ不要。AC-16(b) から従う）
5. 生成しなければ `spawnTimerMs = timer`
- 戻り値は常に新しいオブジェクト（`obstacles` も新しい配列）。入力は書き換えない（AC-22）
- 配列は生成順＝x 昇順を保つ
- 戻り値に `scrollSpeed` は入力の値をそのまま含める（GAM-2 では速度を変えない）

#### `src/core/state.ts`（変更）
```ts
export interface GameState {
  status: GameStatus;
  player: PlayerState;
  score: number;
  obstacles: Obstacle[];
  /** 次の障害物生成までの残り時間 [ms] */
  spawnTimerMs: number;
  /** PRNG の状態（uint32） */
  rngSeed: number;
  nextObstacleId: number;
  /** 障害物（＝世界）が左へ流れる速度 [px/s]。GAM-5 で時間とともに変える */
  scrollSpeed: number;
}

export function createInitialState(seed: number = RANDOM.defaultSeed): GameState
// status 'ready'、player は従来どおり、score 0、obstacles []、spawnTimerMs FIRST、
// rngSeed seed >>> 0、nextObstacleId 1、scrollSpeed S

export function startGame(state: GameState): GameState
// playing なら state をそのまま返す（従来どおり）。それ以外は
// { ...createInitialState(state.rngSeed), status: 'playing' }（シードだけ引き継ぐ。AC-20）
```
`step` の変更は `playing` 分岐のみ（不正 dt → クランプ → ready / gameover の判定順は GAM-1 のまま）:
1. `player = updatePlayer(jumpPressed ? jump(state.player) : state.player, dt)`（従来どおり）
2. `world = advanceObstacles(state, dt)`
3. `hit = world.obstacles.some(o => intersects(playerRect(player), obstacleRect(o)))`
4. `{ ...state, ...world, player, status: hit ? 'gameover' : 'playing' }` を返す
- 判定は**フレーム終了時点の位置**で行う（連続衝突判定はしない。リスク欄参照）
- gameover になったフレームの位置はそのまま残す（GAM-4 のゲームオーバー画面で使える）
- `score` は変更しない（GAM-3 の範囲）

### scene 側の変更（描画・入力のみ）
`src/main.ts`:
- `const seedParam = new URLSearchParams(location.search).get('seed')`。`/^\d+$/` に一致すれば `Number(seedParam) >>> 0`、そうでなければ `Math.floor(Math.random() * 2 ** 32)`（乱数の生成は core の外で行う）
- `new GameScene(seed)` に渡す。`window.__GAME__` の公開方法は変更しない

`src/scenes/GameScene.ts`:
- `constructor(seed: number)` で `this.state = createInitialState(seed)`
- `private obstacleRects = new Map<number, Phaser.GameObjects.Rectangle>()`
- `update` の描画部で、`state.obstacles` を id で同期する: 新しい id は `add.rectangle(…).setOrigin(0, 1)` で作成、既存は `setPosition(o.x, WORLD.groundY)` と `setSize(o.width, o.height)`、state にない id は `destroy` して Map から消す
- gameover 時の表示は追加しない（GAM-4 の範囲）。状態による分岐・数値計算は書かない

### 追加する定数（config.ts）と初期値・根拠
```ts
export const SCROLL = {
  /** 開始時のスクロール速度 [px/s]。GameState.scrollSpeed の初期値 */
  initialSpeed: 300,
} as const;

export const OBSTACLE = {
  /** 幅 [px]（固定） */
  width: 24,
  /** 高さの範囲 [px]（整数、両端含む一様分布） */
  minHeight: 24,
  maxHeight: 56,
  /** 生成位置（左端の x）。画面右端のすぐ外 */
  spawnX: WORLD.width,
  /** 開始から最初の生成までの時間 [ms] */
  firstSpawnDelayMs: 1000,
  /** 生成間隔の範囲 [ms]（[min, max) の一様分布） */
  minIntervalMs: 1400,
  maxIntervalMs: 2400,
} as const;

export const RANDOM = {
  /** createInitialState にシードを渡さなかったときの既定値 */
  defaultSeed: 1,
} as const;
```
根拠（現行の PHYSICS: G=1000, V=-550 → 滞空 1.1 秒・最高 151.25px）:
- **速度 300 px/s**: 画面幅 800px を 約 2.7 秒で横切る。1 フレーム（最大 50ms）の移動量は 15px で、障害物幅 24px・プレイヤー幅 32px より小さく、x 方向のすり抜けは起きない
- **高さ 24〜56px**: 最大 56px でも、プレイヤーの最高点（足元 y=188.75）は障害物上端（y=284）より 約 95px 上。高さ 56px より上にいられる時間は `2*sqrt(302500 - 112000)/1000` ≈ **0.873 秒**。障害物とプレイヤーが x 方向に重なる時間は `(32+24)/300` ≈ **0.187 秒**なので、ジャンプのタイミングの許容幅は 約 0.69 秒（約 205px ぶん）ある
- **間隔 1400〜2400ms**（距離 420〜720px、障害物間のすき間 396〜696px）: 滞空 1100ms ＋ 着地後に次のジャンプ入力が効くまで最大 1 フレーム（50ms）＋ 反応猶予 200ms = 1350ms ≤ 1400ms。最小間隔でも着地してから次をジャンプできる
- **間隔を時間で持つ理由**: GAM-5 で速度が上がっても「着地してから次の障害物まで」の時間が保たれる（距離で持つと速度上昇で最小間隔が滞空時間を下回る）
- **最初の生成 1000ms**: 開始直後に考える時間を与える。何もしない場合の最初の衝突は `1000 + (800 - 152)/300*1000` = **3160ms** 後
- 画面内に同時に存在する障害物は最大 2〜3 個

### docs/game-design.md 差分案
```diff
 - 定数は `src/core/config.ts` の `PHYSICS`
+
+## 障害物（GAM-2）
+- 地面に置かれた矩形。幅 24px、高さ 24〜56px（整数でランダム）。種類は 1 種類のみ
+- 画面右端の外（x=800）で生成され、スクロール速度 300 px/s で左へ流れる。完全に画面左外に出たら消える
+- 開始 1.0 秒後に最初の 1 つ、以降は 1.4〜2.4 秒（ランダム）ごとに 1 つ生成する
+- プレイヤーと障害物の矩形が重なったらゲームオーバー（AABB。辺や角が接するだけでは衝突しない）
+- ゲームオーバー中は障害物の移動・生成も止まる
+- 乱数はシード付き PRNG（mulberry32）。`?seed=<整数>` で固定でき、指定がなければ起動ごとにランダム
+- 数値の根拠: 最大高さでもジャンプの最高点より約 95px 低く、最小間隔 1.4 秒は滞空 1.1 秒より長い（着地後に再ジャンプできる）
+- 定数は `src/core/config.ts` の `SCROLL`、`OBSTACLE`、`RANDOM`
```

## テスト計画

### Unit（Vitest）
共通ヘルパー（各テストファイル内に置く）:
- `noSpawn(obstacles, overrides?)`: `createInitialState()` をもとに `status:'playing'`、`spawnTimerMs: 1e9`、`obstacles` を与えた state を作る（自動生成を止める）
- `runFixedDt(state, dt, policy, maxMs)`: `policy(state) => GameInput` で入力を決めながら固定 dt で step し、フレーム列を返す（AC-14, 15 用）

`tests/unit/random.test.ts`: AC-1, 2
`tests/unit/collision.test.ts`: AC-3（9 ケース＋引数入れ替え）、AC-4、AC-5
`tests/unit/obstacles.test.ts`:
- AC-6, 7（移動）、AC-8（削除の境界 2 ケース）
- AC-10（600 秒×3 シード、間隔と高さの範囲、HMIN/HMAX の出現。1 シードあたり約 300 個生成されるので、33 通りの高さの両端が出ない確率は無視できる）
- AC-11（3 分割の一致。シード 1, 42。dt はすべて整数ミリ秒なので、最初の生成時刻 `FIRST` ではタイマーが厳密に 0 になる）
- AC-16（定数の解析チェック）
- AC-22 の `advanceObstacles` 分
`tests/unit/state.test.ts`（追記）:
- AC-9（最初の生成。dt=10 で整数ミリ秒を積むので累計は厳密に `FIRST` になる）
- AC-12（step 全体の dt 非依存。3000ms 時点で最初の障害物は x=200 付近で、まだ衝突しない）
- AC-13（接触境界）、AC-14（何もしなければ衝突。直前フレームは `x ≥ PR`）
- AC-15（最小間隔・最大高さの連続飛び越え。4 種の dt）。補足: 方針どおりなら 1 つ目のジャンプ時の障害物 1 の x は 274〜289（1 フレームの移動量 ≤ 15px のずれ）。障害物 2 が `XJ` に来るのは 1 つ目のジャンプから 約 1.4 秒後で、着地（1.1 秒＋最大 1 フレーム）より後
- AC-17（gameover で停止）、AC-18（ready で停止）、AC-19〜21、AC-22 の `step` 分
- AC-23: 既存 AC-14 の 2 つ目のアサーションを、新フィールドを含む変化検証に置き換える（削除しない）。既存テストの `playingOnGround()` は `createInitialState()` 由来なので新フィールドは自動で入る。既存 AC-6 / AC-9 は最大 約 2.6 秒しか進めず、最初の衝突（3160ms）より前なので影響しない

### E2E（Playwright）
`tests/e2e/obstacles.spec.ts`（2 シナリオ）:
- 共通: `/?test=1&seed=12345` を開き、canvas が visible → `status === 'ready'` を poll → canvas クリック → SPACE → `status === 'playing'` を poll（`jump.spec.ts` と同じ手順）
- AC-24: `expect.poll(() => obstacles.length, { intervals: [100], timeout: 5000 }).toBeGreaterThanOrEqual(1)` → 先頭の `{id, x}` を記録 → 同じ id の `x <= x0 - 30` を `{ intervals: [100], timeout: 5000 }` で poll。シードに依存する具体値（高さなど）は見ない
- AC-25: `status === 'gameover'` を `{ intervals: [100], timeout: 15000 }` で poll → state を 1 回取得して AABB の重なりをテスト側で計算（定数は `src/core/config.ts` から import してよい）
- 待ち時間の根拠:
  - ゲーム内時間で、最初の障害物は開始 1.0 秒後に出現し、何もしなければ 3.16 秒後に衝突する
  - dt は 50ms でクランプされるので、headless CI で 20fps を下回るとゲーム内時間が実時間より遅れる。10fps でも出現まで 2 秒・衝突まで 約 6.3 秒で、timeout 5 秒／15 秒に 2 倍以上の余裕がある
  - AC-24 の「30px 動く」はゲーム内 0.1 秒。出現（x=800）から衝突（x<152）まで 648px（2.16 秒）あり、poll 間隔 100ms なら衝突で止まる前に必ず観測できる
  - 固定 sleep は使わない
- 既存の `jump.spec.ts` は、ジャンプ（1.1 秒）が最初の衝突（3.16 秒）より前に終わるので影響しない。`boot.spec.ts` も影響しない

## 影響範囲・リスク
- **`GameState` の拡張**: `createInitialState` / `startGame` 以外で `GameState` リテラルを直接作っている箇所（テスト含む）は新フィールドが必要。既存テストはスプレッドで作っているので型エラーにならない見込み
- **既存テストの修正（AC-23）**: GAM-1 の AC-14 の 2 つ目のアサーションは「playing・地上では step が何も変えない」前提だったが、障害物タイマーが進むようになり成り立たなくなる。CLAUDE.md の「テスト削除禁止」に配慮し、削除ではなく新しい状態構造に合わせた置き換えとする（確認事項 Q11）
- **離散的な当たり判定**: フレーム終了時点の位置で判定するため、1 フレームで上下に最大 約 27px（550px/s × 50ms）動くプレイヤーが障害物の角をかすめた場合、見逃すことがある。x 方向は 1 フレーム 15px < 障害物幅なので正面衝突は見逃さない。swept AABB は導入しない（確認事項 Q7）
- **浮動小数**: AC-11/12 は生成時のはみ出し補正が前提。補正なしで実装すると dt の刻みによって位置が最大 15px ずれ、テストに落ちる。生成判定がしきい値ちょうど付近になる偶然でシード依存の不一致が起こりうるが、固定シードで決定的なので、一度 green なら flaky にはならない
- **gameover から抜けられない**: GAM-1 の設計どおり `step` は gameover の入力を無視するので、GAM-2 単体ではゲームオーバー後はリロードしないと再開できない。リトライは GAM-4 で `step` に追加する（`startGame` はシードを引き継ぐので、そのまま使える）
- **GAM-3 / GAM-5 への接続**: スコア（走行距離）は `scrollSpeed * dt` の積算で計算できる。速度上昇は `state.scrollSpeed` を更新すればよく、`advanceObstacles` は state の値を使う。生成間隔は時間で持つので、速度が上がっても着地後の余裕は保たれる（AC-16(a) の重なり時間は速度が上がるほど短くなり有利な方向）
- **main.ts での `Math.random`**: core の外なので規約違反ではない

## 確認事項（人間に判断してほしいこと。暫定案で設計済み）
1. **Q1 スクロール速度**: 300 px/s（画面を約 2.7 秒で横切る）でよいか
2. **Q2 障害物のサイズ・種類**: 地面に置く矩形 1 種類、幅 24px 固定、高さ 24〜56px の整数ランダムでよいか。空中の障害物やしゃがみ回避は扱わない
3. **Q3 生成間隔**: 時間ベースで 1.4〜2.4 秒の一様ランダム（距離 420〜720px）でよいか。下限 1.4 秒は「滞空 1.1 秒＋1 フレーム＋反応 0.2 秒」から決めた
4. **Q4 最初の障害物までの猶予**: 開始 1.0 秒後に生成（何もしなければ約 3.2 秒後に衝突）でよいか
5. **Q5 接触の扱い**: 辺・角が接するだけ（距離 0）は衝突にしない。重なり幅が 0 より大きいときだけゲームオーバー、でよいか
6. **Q6 難易度**: 最大高さでもジャンプのタイミングの許容幅が約 0.69 秒あり、易しめ。GAM-5 の速度上昇で難しくなる前提でこのままでよいか（難しくしたい場合は高さの上限を上げるか間隔の下限を詰める）
7. **Q7 当たり判定の精度**: フレーム終了時の位置だけで判定し、角をかすめる程度の接触は見逃しうる（swept AABB は入れない）。これでよいか
8. **Q8 ゲームオーバー時の表示**: GAM-2 ではプレイヤーと障害物がその場で止まるだけで、「GAME OVER」表示もリトライもなし（GAM-4 の範囲）。GAM-4 までの間、リロードしないと再開できない状態を許容してよいか
9. **Q9 シードの指定**: `?seed=<整数>` はテストモード以外でも有効にする（害がなく、不具合の再現に使える）。テストモード限定にすべきか
10. **Q10 当たり判定の矩形**: 見た目どおりの矩形をそのまま使い、プレイヤー側を少し小さくする「判定の甘さ」は入れない。これでよいか
11. **Q11 既存テストの更新（AC-23）**: GAM-1 の `state.test.ts` AC-14 の 2 つ目のアサーションは、障害物タイマーが進むようになると成り立たない。削除ではなく、新フィールドを含む変化検証に置き換える方針でよいか

分割は不要と判断した（core に 3 ファイル追加と step の拡張、scene は描画同期のみで 1 Issue に収まる）。

## 改訂履歴
- 初版: 新規作成（人間のコメントなし）
