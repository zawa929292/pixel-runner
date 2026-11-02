---
description: 設計改善ループ — Linear Issue を分析し specs を作成して Design Review に回す
argument-hint: GAM-n
---
Linear Issue $ARGUMENTS の設計ループを実行してください。

1. Linear MCP で $ARGUMENTS を取得する（説明・コメント・ラベル）。コメントに人間からの差し戻しがあれば最優先で反映する
2. Issue を `Planning` に移動する
3. `designer` サブエージェントに Issue 内容（差し戻しコメント含む）を渡し `specs/$ARGUMENTS.md` を作成/更新させる
4. 作成された spec を自分で読み、受入条件がテスト可能か・規約に沿うかを確認。不十分なら designer に再依頼（最大 2 回）
5. Linear に以下をコメントする:
   - 設計の要約（3〜5 行）、受入条件一覧、確認事項
   - 「承認する場合は `Approved` へ、差し戻す場合はコメントして `Planning` のままにしてください」
6. Issue を `Design Review` に移動する
7. spec ファイルは `main` からの作業ブランチ（Linear の gitBranchName）でコミットする

ここで停止し、実装には進まないこと。
