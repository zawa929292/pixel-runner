#!/usr/bin/env bash
# PreToolUse(Bash): 危険なコマンドを遮断する。exit 2 で実行をブロックし理由を Claude に返す。
cmd=$(node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{process.stdout.write(JSON.parse(d).tool_input.command||"")}catch{}})')

block() { echo "BLOCKED by harness: $1 (CLAUDE.md の禁止事項を参照)" >&2; exit 2; }

[[ $cmd =~ git[[:space:]]+push.*(--force|[[:space:]]-f([[:space:]]|$)) ]] && block "force push は禁止"
[[ $cmd =~ git[[:space:]]+push.*[[:space:]](origin[[:space:]]+)?(HEAD:)?main([[:space:]]|$) ]] && block "main への直接 push は禁止。PR を作成すること"
[[ $cmd =~ rm[[:space:]]+-[a-zA-Z]*r[a-zA-Z]*f?[[:space:]]+(/|~|\$HOME)([[:space:]]|$) ]] && block "ルート/ホームの再帰削除"
[[ $cmd =~ (^|[[:space:];|&])(cat|less|head|tail|source|\.)[[:space:]]+[^[:space:]]*\.env ]] && block ".env の読み取りは禁止"
[[ $cmd =~ (it|describe|test)\.skip ]] && block "テストの skip による green 化は禁止"
exit 0
