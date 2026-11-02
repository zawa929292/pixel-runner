import { OBSTACLE } from './config';
import { nextRandom } from './random';
import type { GameState } from './state';

const MS_PER_SECOND = 1000;

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

/**
 * dtMs（クランプ済み、0 より大きい前提）ぶん障害物を進める。
 * 移動 → 画面左外の削除 → タイマー → 生成 の順に処理し、常に新しいオブジェクトを返す。
 */
export function advanceObstacles(world: ObstacleWorld, dtMs: number): ObstacleWorld {
  const { scrollSpeed } = world;
  const moved = world.obstacles
    .map((o) => ({ ...o, x: o.x - (scrollSpeed * dtMs) / MS_PER_SECOND }))
    .filter((o) => o.x + o.width > 0);
  const timer = world.spawnTimerMs - dtMs;

  if (timer > 0) {
    return {
      obstacles: moved,
      spawnTimerMs: timer,
      rngSeed: world.rngSeed,
      nextObstacleId: world.nextObstacleId,
      scrollSpeed,
    };
  }

  // 乱数は 高さ → 間隔 の順に引く（再現性のため固定）
  const r1 = nextRandom(world.rngSeed);
  const r2 = nextRandom(r1.seed);
  const height = OBSTACLE.minHeight + Math.floor(r1.value * (OBSTACLE.maxHeight - OBSTACLE.minHeight + 1));
  const interval = OBSTACLE.minIntervalMs + r2.value * (OBSTACLE.maxIntervalMs - OBSTACLE.minIntervalMs);
  // はみ出した時間ぶん進んだ位置に置く（dt の刻みによらず位置が一致する）
  const x = OBSTACLE.spawnX - (scrollSpeed * -timer) / MS_PER_SECOND;

  return {
    obstacles: [...moved, { id: world.nextObstacleId, x, width: OBSTACLE.width, height }],
    spawnTimerMs: timer + interval,
    rngSeed: r2.seed,
    nextObstacleId: world.nextObstacleId + 1,
    scrollSpeed,
  };
}
