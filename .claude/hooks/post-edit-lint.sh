#!/usr/bin/env bash
# PostToolUse(Edit|Write): 編集された TS ファイルを即座に lint し、問題があれば Claude にフィードバックする。
file=$(node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{process.stdout.write(JSON.parse(d).tool_input.file_path||"")}catch{}})')
[[ $file == *.ts ]] || exit 0
[[ -f $file ]] || exit 0
cd "$CLAUDE_PROJECT_DIR" || exit 0
if ! out=$(npx eslint --no-warn-ignored "$file" 2>&1); then
  echo "ESLint errors in $file — 修正してください:" >&2
  echo "$out" >&2
  exit 2
fi
exit 0
