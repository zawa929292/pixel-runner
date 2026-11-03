import Phaser from 'phaser';
import { HUD, PLAYER, WORLD } from '../core/config';
import { formatHud } from '../core/hud';
import { createInitialState, step, type GameState } from '../core/state';
import type { HighScoreStore } from '../highScoreStore';

const OBSTACLE_COLOR = 0x8b4513;
const HUD_FONT_FAMILY = 'monospace';

/** 描画と入力の受け付けだけを担当し、ルールは src/core に委譲する。 */
export class GameScene extends Phaser.Scene {
  state: GameState;
  private playerRect!: Phaser.GameObjects.Rectangle;
  /** 障害物 id → 描画用の矩形 */
  private obstacleRects = new Map<number, Phaser.GameObjects.Rectangle>();
  private message!: Phaser.GameObjects.Text;
  private hud?: Phaser.GameObjects.Text;
  /** 前フレーム以降に SPACE が新たに押されたか */
  private pendingJump = false;

  constructor(
    seed: number,
    private readonly highScoreStore: HighScoreStore,
  ) {
    super('GameScene');
    this.state = createInitialState(seed, highScoreStore.load());
  }

  /** HUD テキストの現在の表示文字列（E2E 用） */
  get hudText(): string {
    return this.hud?.text ?? '';
  }

  create(): void {
    this.add.rectangle(0, WORLD.groundY, WORLD.width, WORLD.height - WORLD.groundY, 0x3a7d44).setOrigin(0, 0);
    this.playerRect = this.add.rectangle(0, 0, PLAYER.width, PLAYER.height, 0xf2c14e).setOrigin(0, 1);
    this.message = this.add
      .text(WORLD.width / 2, WORLD.height / 2 - 40, 'PIXEL RUNNER\nPress SPACE to start', { align: 'center', fontSize: '24px' })
      .setOrigin(0.5);
    // 右上基準。等幅フォントで桁を揃える
    this.hud = this.add
      .text(WORLD.width - HUD.marginPx, HUD.marginPx, formatHud(this.state), {
        fontSize: `${HUD.fontSizePx}px`,
        fontFamily: HUD_FONT_FAMILY,
      })
      .setOrigin(1, 0);

    this.input.keyboard?.on('keydown-SPACE', (event: KeyboardEvent) => {
      // キーリピートでは再ジャンプしない
      if (event.repeat) return;
      this.pendingJump = true;
    });
  }

  update(_time: number, delta: number): void {
    const prev = this.state;
    this.state = step(prev, { jumpPressed: this.pendingJump }, delta);
    this.pendingJump = false;
    // core がハイスコアを更新したとき（gameover への遷移時）だけ保存する
    if (this.state.highScore !== prev.highScore) this.highScoreStore.save(this.state.highScore);

    this.playerRect.setPosition(this.state.player.x, this.state.player.y);
    this.syncObstacles();
    this.message.setVisible(this.state.status === 'ready');
    this.hud?.setText(formatHud(this.state));
  }

  /** state.obstacles を id で突き合わせ、矩形の作成・更新・破棄を行う。 */
  private syncObstacles(): void {
    const alive = new Set<number>();
    for (const o of this.state.obstacles) {
      alive.add(o.id);
      const rect = this.obstacleRects.get(o.id);
      if (rect) {
        rect.setPosition(o.x, WORLD.groundY);
        rect.setSize(o.width, o.height);
      } else {
        this.obstacleRects.set(o.id, this.add.rectangle(o.x, WORLD.groundY, o.width, o.height, OBSTACLE_COLOR).setOrigin(0, 1));
      }
    }
    for (const [id, rect] of this.obstacleRects) {
      if (!alive.has(id)) {
        rect.destroy();
        this.obstacleRects.delete(id);
      }
    }
  }
}
