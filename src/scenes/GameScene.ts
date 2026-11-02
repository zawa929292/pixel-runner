import Phaser from 'phaser';
import { PLAYER, WORLD } from '../core/config';
import { createInitialState, startGame, type GameState } from '../core/state';

/** 描画と入力の受け付けだけを担当し、ルールは src/core に委譲する。 */
export class GameScene extends Phaser.Scene {
  state: GameState = createInitialState();
  private playerRect!: Phaser.GameObjects.Rectangle;
  private message!: Phaser.GameObjects.Text;

  constructor() {
    super('GameScene');
  }

  create(): void {
    this.add.rectangle(0, WORLD.groundY, WORLD.width, WORLD.height - WORLD.groundY, 0x3a7d44).setOrigin(0, 0);
    this.playerRect = this.add.rectangle(0, 0, PLAYER.width, PLAYER.height, 0xf2c14e).setOrigin(0, 1);
    this.message = this.add
      .text(WORLD.width / 2, WORLD.height / 2 - 40, 'PIXEL RUNNER\nPress SPACE to start', { align: 'center', fontSize: '24px' })
      .setOrigin(0.5);

    this.input.keyboard?.on('keydown-SPACE', () => {
      this.state = startGame(this.state);
    });
  }

  update(): void {
    this.playerRect.setPosition(this.state.player.x, this.state.player.y);
    this.message.setVisible(this.state.status === 'ready');
  }
}
