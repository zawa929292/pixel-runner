---
description: Linear の待ち行列を見て次にやるべき作業を実行する
---
Linear の Game チームから以下を取得し、優先度順に 1 件だけ処理してください。

1. `Approved` の Issue があれば → `/implement` の手順を実行
2. なければ、`Triage` または `Backlog` で `ai-ready` ラベル付きの Issue → `/plan-issue` の手順を実行
3. `Planning` で人間の差し戻しコメントがある Issue → `/plan-issue` の手順で再設計
4. 該当なしなら、`Design Review` / `Merge Approved` / `Needs Human` で人の対応待ちの Issue を一覧表示して終了
