---
description: Linear の待ち行列を見て次にやるべき作業を 1 件実行する
---
Linear の Game チームから Issue を取得し、以下の優先順で **1 件だけ** 処理してください。
「未対応の人の指示」= 最新の `🤖` コメントより新しい、`🤖` で始まらないコメント。

1. `In Progress` / `Needs Human` で未対応の人の指示がある → `/implement` の手順（rework）
2. `Planning` で未対応の人の指示がある → `/plan-issue` の手順（再設計）
3. `Approved` → `/implement` の手順（new）
4. `Triage` / `Backlog` / `Todo` で `ai-ready` ラベル付き → `/plan-issue` の手順（新規設計）。優先度が高いものから
5. 該当なし → `Design Review` / `In Review` / `Merge Approved` / `Needs Human` の人の対応待ち Issue を一覧表示して終了
