import { parseHighScore, sanitizeHighScore } from './core/score';

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

/**
 * ハイスコアの永続化アダプタ（core の外）。
 * getStorage は呼ぶたびに評価する（window.localStorage へのアクセス自体が例外を投げうるため、関数で受け取る）。
 * ストレージが使えない・値が不正な場合は 0 として扱い、例外は外に出さない。
 */
export function createHighScoreStore(getStorage: () => KeyValueStorage | null | undefined): HighScoreStore {
  return {
    load(): number {
      try {
        const storage = getStorage();
        return storage ? parseHighScore(storage.getItem(HIGH_SCORE_KEY)) : 0;
      } catch {
        return 0;
      }
    },
    save(highScore: number): void {
      // 不正値は書かない
      if (sanitizeHighScore(highScore) !== highScore) return;
      try {
        getStorage()?.setItem(HIGH_SCORE_KEY, String(highScore));
      } catch {
        // 保存できなくてもゲームは続ける
      }
    },
  };
}
