# GAM-1: プレイヤーのジャンプと重力

## 目的
`playing` 中に SPACE でプレイヤーがジャンプできるようにする。ジャンプは地上にいるときだけ可能（二段ジャンプ不可）。重力によって放物線を描いて落ち、地面（`WORLD.groundY`）に着地する。物理計算は dt ベースで、フレームレートが変わっても軌道は同じになる。ジャンプは「ふわっと」した感触（滞空が長め、重力は弱め）にする（差し戻しコメントによる）。

あわせて、architecture.md の `step(state, input, dtMs) => newState` パターンをこの Issue で初めて実装し、以降の Issue（GAM-2〜5）が同じ流れに乗れるようにする。

### 座標系・単位の前提（既存コードに合わせる）
- Phaser と同じく **y は下向きが正**。`player.y` は **足元の y**（地上では `WORLD.groundY` = 340）
- したがって上向き速度は **負の vy**、重力は **正の加速度**
- 速度の単位は px/s、加速度は px/s²。`step` が受け取る dt はミリ秒（Phaser の `delta` と同じ）で、内部で秒に直す

## 受入条件（Given/When/Then。すべて自動テストで検証可能な形で）

表記: `G` = `PHYSICS.gravity`、`V` = `PHYSICS.jumpVelocity`（負の値）、`GY` = `WORLD.groundY`、`MAXDT` = `PHYSICS.maxDtMs`。
テストは数値を直書きせず、この定数から期待値を計算する（数値を調整してもテストが壊れないようにするため）。

| ID | Given | When | Then | 検証 |
|---|---|---|---|---|
| AC-1 | `status='playing'`、プレイヤーが地上（`y=GY, vy=0, onGround=true`） | `step(s, {jumpPressed:true}, dt)`（`0 < dt ≤ MAXDT`） | `onGround=false`、`y < GY`、`vy` が `V + G*dt/1000` と許容誤差 1e-9 で一致 | unit |
| AC-2（二段ジャンプ不可） | `playing`、空中（`onGround=false`、上昇中・下降中のどちらでも） | `step(s, {jumpPressed:true}, dt)` | 結果が `step(s, {jumpPressed:false}, dt)` と deep equal（入力が無視される） | unit |
| AC-3（放物線・解析解一致） | `playing`、地上 | t=0 でジャンプし、合計 300ms ぶん step する | `y` が解析解 `GY + V*t + 0.5*G*t²`（t=0.3 秒）と誤差 1e-6 以内、`vy` が `V + G*t` と誤差 1e-6 以内 | unit |
| AC-4（dt 非依存: 軌道） | AC-3 と同じ | 合計 300ms を次の分割で step する: `[10]×30`、`[20]×15`、`[50]×6`、`[5,45,30,20,50,50,50,50]` | 4 通りすべての最終 `y`, `vy` が互いに誤差 1e-6 以内で一致 | unit |
| AC-5（dt 非依存: 最高到達点） | `playing`、地上 | dt = 1000/144, 1000/60, 1000/30, 50 の各固定 dt で着地まで step し、各フレームの `y` の最小値（最高点）を記録する | 各 dt の最高点が解析解 `GY - V²/(2G)` に対して誤差 1.0px 以内 | unit |
| AC-6（dt 非依存: 着地時刻） | AC-5 と同じ | 同じ（ジャンプからの経過時間を積算する） | 初めて `onGround=true` になったフレームの累積時刻 `T_land` が `T = 2*|V|/G*1000`（ms）に対して `T - 1e-6 ≤ T_land ≤ T + dt + 1e-6`（新しい値では T = 1100ms で、1000/60・1000/30・50 のいずれでも T が dt の整数倍になる。浮動小数誤差で着地が 1 フレーム遅れうるため、両端に許容誤差を持たせ上端も含める） | unit |
| AC-7（着地のスナップ） | 下降中で、次の step で地面を越える状態（例: `y = GY - 1, vy = 500, onGround=false`） | `step(s, {jumpPressed:false}, 16)` | `y === GY`、`vy === 0`、`onGround === true`（地面より下にめり込まない） | unit |
| AC-8（ちょうど地面に達する境界） | 浮動小数で厳密に表せる値で作る: `y = GY - 0.5*G*0.25`（新しい G=1000 では 340 - 125 = **215**。整数なので厳密に表せ、画面内）、`vy = 0`、`onGround=false`（t=0.5 秒で y' がちょうど GY） | `updatePlayer(p, 500)` を直接呼ぶ（step のクランプを通さない） | `y === GY`、`vy === 0`、`onGround === true` | unit |
| AC-9（地上で静止） | `playing`、地上 | `jumpPressed:false` で任意の dt を 100 回 step | `y === GY`、`vy === 0`、`onGround === true` のまま（落下・ドリフトしない） | unit |
| AC-10（playing 以外では物理・ジャンプ無視） | `status='gameover'`、地上 | `step(s, {jumpPressed:false}, 16)` | 入力 state と deep equal | unit |
| AC-11（ready での SPACE は開始のみ） | `status='ready'`、地上 | `step(s, {jumpPressed:true}, 16)` | `status='playing'`、`y=GY`、`vy=0`、`onGround=true`（同じ押下ではジャンプしない） | unit |
| AC-12（dt クランプ） | `playing`、空中 | `step(s, input, 1000)` と `step(s, input, MAXDT)` を比べる | 2 つの結果が deep equal | unit |
| AC-13（不正 dt） | 任意の state | dt が `0`、負の値、`NaN` | 入力 state と deep equal（何も変わらない） | unit |
| AC-14（イミュータブル） | 任意の state（`structuredClone` で控えを取る） | 任意の step / jump 関数を呼ぶ | 入力 state が控えと deep equal（書き換えられていない）。状態が変わる場合は戻り値が別オブジェクト（`!==`） | unit |
| AC-15（E2E: ジャンプして着地） | `/?test=1` を開き、SPACE で `playing` になっている | SPACE を 1 回押す | `getState().player.onGround === false` かつ `player.y < WORLD.groundY` になる瞬間を poll で観測し、その後 `onGround === true`、`player.y === 340`、`player.vy === 0` に戻る（タイムアウト 5 秒。根拠はテスト計画の E2E 節） | e2e |
| AC-16（既存の振る舞いを壊さない） | — | `npm run verify` | 既存の `state.test.ts`、`boot.spec.ts` を含めすべて green | verify |

## 設計

### 変更ファイル一覧
| ファイル | 種別 | 内容 |
|---|---|---|
| `src/core/config.ts` | 変更 | `PHYSICS` 定数を追加 |
| `src/core/player.ts` | 新規 | プレイヤーの物理を担う純関数（`jump`, `updatePlayer`） |
| `src/core/state.ts` | 変更 | `GameInput` 型と `step` を追加 |
| `src/scenes/GameScene.ts` | 変更 | SPACE 押下をフラグに記録し、`update` で `step` を呼ぶ |
| `tests/unit/player.test.ts` | 新規 | AC-1〜9, 12〜14 のうち player 関数のぶん |
| `tests/unit/state.test.ts` | 変更 | `step` のテスト（AC-2, 10, 11, 12, 13, 14）を追加 |
| `tests/e2e/jump.spec.ts` | 新規 | AC-15 |
| `docs/game-design.md` | 変更 | 物理パラメータと操作の詳細を追記（差分案は後述） |

`src/main.ts` は変更しない（`window.__GAME__.getState()` は `scene.state` を返すので、`step` の結果がそのまま公開される）。

### 変更/追加する型・関数（src/core）

#### `src/core/player.ts`（新規、Phaser import 禁止）
```ts
/** 地上にいればジャンプを開始した PlayerState を返す。空中なら同じ参照をそのまま返す。 */
export function jump(player: PlayerState): PlayerState
// onGround=true のとき → { ...player, vy: PHYSICS.jumpVelocity, onGround: false }
// onGround=false のとき → player（同じ参照）

/** dtMs（呼び出し側でクランプ済み、0 より大きい前提）ぶん重力を適用して位置を進め、着地を判定する。 */
export function updatePlayer(player: PlayerState, dtMs: number): PlayerState
```
`updatePlayer` の仕様:
1. `onGround === true` なら `player` をそのまま返す（地上では重力を積分しない。AC-9）
2. `t = dtMs / 1000`
3. **等加速度の厳密解で積分する**: `y' = y + vy*t + 0.5*G*t²`、`vy' = vy + G*t`
   - 半陰的 Euler ではなく厳密解を使う理由: 加速度が一定なら dt をどう分割しても、同じ時刻での位置・速度が（浮動小数誤差の範囲で）一致する。これにより AC-4 を厳密に満たせる
   - 重力 G は上昇中も下降中も同じ値を使う（上昇と下降で重力を変える「落下を速くする」調整はしない。変えると AC-3/AC-4 の解析解が崩れる）
4. 着地判定: `y' >= WORLD.groundY` かつ `vy' >= 0` なら `{ y: WORLD.groundY, vy: 0, onGround: true }` にスナップする（AC-7, AC-8）
   - 着地は「地面を越えたフレームで地面に合わせる」。そのため着地時刻は最大 1 フレーム遅れる（AC-6 の許容範囲 `[T, T+dt]`（± 1e-6）はこれを前提にしている）
5. それ以外は `{ ...player, y: y', vy: vy', onGround: false }` を返す
- `x` は変更しない

#### `src/core/state.ts`（追記）
```ts
/** 1 フレーム分の入力。jumpPressed は「前フレーム以降に SPACE が新たに押されたか」（押下の瞬間だけ true）。 */
export interface GameInput {
  jumpPressed: boolean;
}

export function step(state: GameState, input: GameInput, dtMs: number): GameState
```
`step` の仕様（上から順に判定する）:
1. `dtMs` が有限な正の数でなければ `state` をそのまま返す（AC-13）
2. `dt = Math.min(dtMs, PHYSICS.maxDtMs)`（AC-12）
3. `status === 'ready'` のとき: `input.jumpPressed` なら `startGame(state)` を返し、そうでなければ `state` を返す。**このフレームでは物理もジャンプも処理しない**（AC-11）
4. `status === 'gameover'` のとき: `state` をそのまま返す（AC-10。リトライは GAM-4 の範囲）
5. `status === 'playing'` のとき:
   - `player = input.jumpPressed ? jump(state.player) : state.player`
   - `player = updatePlayer(player, dt)`（ジャンプしたフレームでも同じ dt で積分する。AC-1）
   - `{ ...state, player }` を返す。`player` が変わっていなければ `state` をそのまま返してよい
- `score` など他のフィールドは変更しない
- `startGame` は既存のシグネチャのまま残す（既存テストのため）

### scene 側の変更（描画・入力のみ）
`src/scenes/GameScene.ts`:
- `private pendingJump = false` を追加する
- `keydown-SPACE` ハンドラ: **キーリピートのイベント（`event.repeat === true`）は無視し**、それ以外なら `this.pendingJump = true` にするだけにする。`startGame` を直接呼ぶ処理は削除する（ready → playing の遷移は `step` が行う）
- `update(_time, delta)`:
  1. `this.state = step(this.state, { jumpPressed: this.pendingJump }, delta)`
  2. `this.pendingJump = false`
  3. これまでどおり描画を更新する（`playerRect.setPosition(player.x, player.y)`、`message` の表示切り替え）
- 状態による分岐や数値計算は scene に書かない

### 追加する定数（config.ts）と初期値・根拠
```ts
export const PHYSICS = {
  /** 重力加速度 [px/s²]（y 下向きが正）。上昇中・下降中とも一定 */
  gravity: 1000,
  /** ジャンプ初速 [px/s]（上向きなので負） */
  jumpVelocity: -550,
  /** 1 step で積分する dt の上限 [ms]。タブ復帰時などの巨大な delta 対策 */
  maxDtMs: 50,
} as const;
```
- 根拠（差し戻し「ふわっとジャンプする挙動にして」を反映した値）:
  - ふわっと感は重力を弱めて実現する: 重力 2400 → **1000 px/s²**（約 0.42 倍）。高さが上がりすぎないよう、初速も 800 → **550 px/s** に下げる
  - 滞空時間 = 2|V|/G = 1100/1000 = **1.1 秒**（初版の約 0.67 秒の約 1.65 倍。目安の 1.0〜1.2 秒の中央）
  - 最高到達高さ = V²/(2G) = 302500/2000 = **151.25px**（初版の約 133px よりやや高い。プレイヤー 32px の約 4.7 倍）
  - 最高点の足元 y = 340 - 151.25 = **188.75**。そのときのプレイヤー上端 y = 188.75 - 32 = **156.75**（> 0 で画面上端まで十分余裕がある）
  - `maxDtMs = 50` は 20fps 相当。これより遅いと 1 フレームで動く量が大きくなり、GAM-2 の当たり判定で障害物をすり抜けるおそれがあるため（初版から変更なし）
- テストでの参考値（t=300ms のとき）: `y = 340 + (-550*0.3) + 0.5*1000*0.09 = 340 - 165 + 45 = 220`、`vy = -550 + 1000*0.3 = -250`（まだ上昇中）
- 上昇から下降に変わる時刻: t = |V|/G = **550ms**

### docs/game-design.md 差分案
```diff
 ## 操作
 | 入力 | 動作 |
 |---|---|
 | SPACE（ready 時） | ゲーム開始 |
-| SPACE（playing 時） | ジャンプ（地上にいるときのみ） |
+| SPACE（playing 時） | ジャンプ（地上にいるときのみ。空中での入力は無視＝二段ジャンプ不可） |
 | SPACE（gameover 時） | リトライ |
+
+- SPACE は押した瞬間だけ有効。押しっぱなし（キーリピート）では再ジャンプしない
+- ready で押した SPACE は開始だけに使い、同じ押下ではジャンプしない
+
+## 物理（GAM-1）
+- 座標は y 下向きが正。プレイヤーの y は足元の位置
+- ふわっとしたジャンプ: 重力 1000 px/s²（上昇中・下降中とも一定）、ジャンプ初速 550 px/s（上向き）
+  → 最高到達 約 151px（足元 y ≈ 188.75、プレイヤー上端 y ≈ 156.75）、滞空 1.1 秒
+- ジャンプの高さは一定（押す長さで変わらない）。先行入力・コヨーテタイムはなし
+- 1 フレームの dt は最大 50ms にクランプする（超えたぶんは捨てる）
+- 定数は `src/core/config.ts` の `PHYSICS`
```
（ロードマップ表の「状態」列は Done 時に更新する運用とし、この Issue の差分には含めない）

## テスト計画

### Unit（Vitest）
テスト用ヘルパー（テストファイル内に置く）: `simulate(state, dts: number[])` は `dts` を順に step して、各フレームの state 列を返す。最初の要素だけ `jumpPressed: true` にするオプションを付ける。

`tests/unit/player.test.ts`:
- `jump`: 地上 → `vy=V`、`onGround=false`、`y` は変わらない
- `jump`: 空中（上昇中 `vy<0` / 下降中 `vy>0`）→ 同じ参照が返る
- `updatePlayer`: 地上なら同じ参照が返る（AC-9）
- `updatePlayer`: 空中で 1 step 進めた結果が厳密解の式と一致する（誤差 1e-9）
- 境界: 着地の 1 フレーム前（`y' < GY`）は `onGround=false` のまま
- 境界: `y'` がちょうど `GY` → スナップする（AC-8。`y=215, vy=0` から `updatePlayer(p, 500)`）
- 境界: `y'` が `GY` を越える → `y===GY`、`vy===0`、`onGround===true`（AC-7。新しい値では `y' = 339 + 8 + 0.128 = 347.128` で GY を越える）
- 境界: 上昇中（`vy' < 0`）は、仮に `y' >= GY` でも着地にしない（`vy' >= 0` 条件の確認。y 下向き座標では負の vy で y は減るので、`y' >= GY` かつ `vy' < 0` になるよう開始 y を GY より少し下（y > GY）に置くケース）
- イミュータブル: 入力が書き換えられていない（AC-14）

`tests/unit/state.test.ts`（追記）:
- AC-1: playing・地上でジャンプ入力 → 空中に出て vy が期待値になる
- AC-2: 空中（上昇中・下降中それぞれ）でジャンプ入力しても、入力なしの結果と deep equal
- AC-3: 合計 300ms 後の y, vy が解析解と一致（参考値 y=220, vy=-250）
- AC-4: 4 通りの dt 分割で最終 y, vy が一致
- AC-5: dt ∈ {1000/144, 1000/60, 1000/30, 50} で最高点が解析解（足元 y=188.75）±1.0px。サンプリングによる離散化誤差の理論上限は `0.5*G*(dt/2)²` で、dt=50ms では 0.5*1000*0.025² = **0.3125px**、dt=1000/30 では約 0.139px。いずれも許容誤差 1.0px に十分収まる
- AC-6: 同じ dt 群で `T - 1e-6 ≤ T_land ≤ T + dt + 1e-6`（T = 1100ms）、着地フレームで `y===GY`、`vy===0`
- AC-9: 地上で入力なしに 100 回 step しても変化しない
- AC-10: gameover では入力の有無にかかわらず state が変わらない
- AC-11: ready でジャンプ入力 → playing、プレイヤーは地上のまま
- AC-11 の補足: ready で入力なし → state が変わらない
- AC-12: dt=1000 と dt=MAXDT の結果が一致。境界として dt=MAXDT ちょうどはクランプされない（dt=MAXDT と同じ結果）ことも確認
- AC-13: dt = 0, -16, NaN, Infinity → state が変わらない（Infinity も「有限な正の数」ではないので弾く）
- AC-14: step の前後で入力 state が `structuredClone` の控えと deep equal
- 既存 2 ケースは変更しない

### E2E（Playwright）
`tests/e2e/jump.spec.ts`（1 シナリオ, AC-15）:
1. `/?test=1` を開き、canvas をクリックしてフォーカスし、SPACE → `status === 'playing'` を poll で待つ
2. SPACE を押す
3. `expect.poll(() => getState().player.onGround)` が `false` になるのを待ち、そのとき `player.y < 340` であることを確認
4. `expect.poll` で `onGround === true && y === 340 && vy === 0` になるのを待つ（timeout **5000ms**）
- タイムアウトの根拠: 滞空はゲーム内時間で 1.1 秒。ただし dt を 50ms でクランプしているため、CI の headless 環境で 20fps を下回るとゲーム内時間が実時間より遅く進む（例: 10fps なら実時間 2.2 秒）。初版の 3 秒では余裕が約 0.8 秒しかないので、5 秒に延ばす（10fps でも 2 倍以上の余裕がある）
- 手順 3 の空中の観測: 空中にいる時間が 1.1 秒あるので、Playwright の poll 間隔（100→250→500→1000ms）でも見逃さない
- `boot.spec.ts` は変更しない。SPACE による開始が `step` 経由（1 フレーム遅れ）になっても poll しているので通る

## 影響範囲・リスク
- **ready → playing の遷移を `step` に移す**: keydown ハンドラから `startGame` を直接呼ばなくなり、遷移が次の `update` まで最大 1 フレーム遅れる。`boot.spec.ts` は poll で検証しているので影響はない見込み
- **gameover の SPACE**: 今は keydown → `startGame` でリトライできる（ただし gameover に入る経路がまだない）。この設計では `step` が gameover の入力を無視するので、リトライは GAM-4 で `step` に追加する必要がある。GAM-4 の spec でこの点を拾うこと
- **浮動小数点**: AC-4 は厳密解での積分を前提にしている。実装で半陰的 Euler などを使うと AC-4（誤差 1e-6）を満たせないので、実装では必ず厳密解を使う
- **キーリピート**: Phaser の `keydown-SPACE` は OS のキーリピートでも発火するので、`event.repeat` で除外する。除外し忘れると、押しっぱなしで着地直後に再ジャンプしてしまう（unit では検出できない。E2E でも検証していない。レビューで確認する）
- **dt クランプ**: 50ms を超えるフレームが続くと、ゲーム内の時間が実時間より遅く進む（意図した挙動）
- **ふわっとしたジャンプとゲームバランス**: 滞空が 1.1 秒と長いので、GAM-2 で障害物の間隔が短すぎると、着地する前に次の障害物に当たってしまう。障害物の最小間隔はスクロール速度 × 1.1 秒以上を目安にすること（GAM-2 / GAM-5 の設計で考慮する）
- GAM-2（当たり判定）は `player.y`（足元）と `PLAYER.height` から矩形を作る前提になる

## 決定事項（Design Review で人間が暫定案を承認したもの）
1. **押しっぱなし**: 押した瞬間だけ有効。押しっぱなし（キーリピート）では再ジャンプしない
2. **可変ジャンプ高**: なし（高さは一定）。必要になったら別 Issue にする
3. **先行入力・コヨーテタイム**: どちらもなし（着地の直前に押した SPACE は無視する）。必要になったら別 Issue にする
4. **ready での SPACE**: 開始だけに使い、同じ押下ではジャンプしない
5. **dt クランプ**: 上限 50ms で、超えたぶんは捨てる（固定タイムステップで分割積分する方式は採用しない）
6. **ready → playing の遷移**: `step` で処理する。gameover からのリトライは GAM-4 で `step` に追加する

## 確認事項（人間に判断してほしいこと）
1. **Q1 物理パラメータ（「ふわっと」を反映済み）**: `gravity=1000 px/s²`、`jumpVelocity=-550 px/s`、`maxDtMs=50` に変更した。最高到達 約 151px（足元 y=188.75、上端 y=156.75）、滞空 1.1 秒。この感触でよいか。障害物のサイズ（GAM-2）が決まったあとに再調整する可能性がある

## 変更履歴
- 初版: 暫定パラメータ（G=2400, V=-800）で作成
- Design Review の差し戻し（「ふわっとジャンプする挙動にして。あとは暫定案でOK」）を反映: G=1000, V=-550 に変更（滞空 1.1 秒・最高 約 151px）。パラメータに依存する参考値（t=300ms の y/vy、AC-5 の誤差上限、AC-8 の y=215）を再計算し、E2E のタイムアウトを 5 秒に延ばした。初版の Q2〜Q7 は「決定事項」に移した
