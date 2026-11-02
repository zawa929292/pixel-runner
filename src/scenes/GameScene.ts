import Phaser from 'phaser';
import { PLAYER, WORLD } from '../core/config';
import { createInitialState, step, type GameState } from '../core/state';

const OBSTACLE_COLOR = 0x8b4513;

/** 描画と入力の受け付けだけを担当し、ルールは src/core に委譲する。 */
export class GameScene extends Phaser.Scene {
  state: GameState;
  private playerRect!: Phaser.GameObjects.Rectangle;
  /** 障害物 id → 描画用の矩形 */
  private obstacleRects = new Map<number, Phaser.GameObjects.Rectangle>();
  private message!: Phaser.GameObjects.Text;
  /** 前フレーム以降に SPACE が新たに押されたか */
  private pendingJump = false;

  constructor(seed: number) {
    super('GameScene');
    this.state = createInitialState(seed);
  }

  create(): void {
    this.add.rectangle(0, WORLD.groundY, WORLD.width, WORLD.height - WORLD.groundY, 0x3a7d44).setOrigin(0, 0);
    this.playerRect = this.add.rectangle(0, 0, PLAYER.width, PLAYER.height, 0xf2c14e).setOrigin(0, 1);
    this.message = this.add
      .text(WORLD.width / 2, WORLD.height / 2 - 40, 'PIXEL RUNNER\nPress SPACE to start', { align: 'center', fontSize: '24px' })
      .setOrigin(0.5);

    this.input.keyboard?.on('keydown-SPACE', (event: KeyboardEvent) => {
      // キーリピートでは再ジャンプしない
      if (event.repeat) return;
      this.pendingJump = true;
    });
  }

  update(_time: number, delta: number): void {
    this.state = step(this.state, { jumpPressed: this.pendingJump }, delta);
    this.pendingJump = false;

    this.playerRect.setPosition(this.state.player.x, this.state.player.y);
    this.syncObstacles();
    this.message.setVisible(this.state.status === 'ready');
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
