#!/usr/bin/env bash
set -euo pipefail

TYPE=""
SUBJECT=""
DRY_RUN=0
ADD_ALL=0
INCLUDE_UNTRACKED=0
declare -a BULLETS=()

usage() {
  cat <<'EOF'
Usage:
  auto_commit.sh [options]

Options:
  --type <fix|feat|style|chore|refactor|docs|debug>
  --subject <中文标题>
  --bullet <说明小点>              (可重复)
  --all                           使用 git add -A
  --include-untracked             添加未跟踪文件 (git add .)
  --dry-run                       仅打印提交信息，不提交
  -h, --help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --type)
      TYPE="${2:-}"
      shift 2
      ;;
    --subject)
      SUBJECT="${2:-}"
      shift 2
      ;;
    --bullet)
      BULLETS+=("${2:-}")
      shift 2
      ;;
    --all)
      ADD_ALL=1
      shift
      ;;
    --include-untracked)
      INCLUDE_UNTRACKED=1
      shift
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if [[ ! -d .git ]]; then
  echo "Error: 当前目录不是 Git 仓库根目录（未找到 .git）。" >&2
  exit 1
fi

if [[ $INCLUDE_UNTRACKED -eq 1 ]]; then
  git add .
elif [[ $ADD_ALL -eq 1 ]]; then
  git add -A
else
  git add -u
fi

if git diff --cached --quiet; then
  echo "No staged changes. 跳过提交。"
  exit 0
fi

if [[ -z "$TYPE" ]]; then
  changed_files="$(git diff --cached --name-only)"
  if echo "$changed_files" | grep -Eq '(^|/)(docs|README|CHANGELOG)|\.md$'; then
    TYPE="docs"
  elif echo "$changed_files" | grep -Eq '(^|/)(src/renderer/|.*\.(css|scss|less)$)'; then
    TYPE="style"
  elif echo "$changed_files" | grep -Eq '(^|/)(package\.json|package-lock\.json|build/|script/|\.github/)'; then
    TYPE="chore"
  else
    TYPE="fix"
  fi
fi

if [[ -z "$SUBJECT" ]]; then
  file_count="$(git diff --cached --name-only | wc -l | tr -d ' ')"
  SUBJECT="自动提交当前改动（${file_count} files）"
fi

commit_cmd=(git commit -m "${TYPE}:${SUBJECT}")
for bullet in "${BULLETS[@]}"; do
  commit_cmd+=(-m "- ${bullet}")
done

echo "Commit message:"
echo "  ${TYPE}:${SUBJECT}"
if [[ ${#BULLETS[@]} -gt 0 ]]; then
  for bullet in "${BULLETS[@]}"; do
    echo "  - ${bullet}"
  done
fi

if [[ $DRY_RUN -eq 1 ]]; then
  echo "[dry-run] Skip git commit"
  exit 0
fi

"${commit_cmd[@]}"
echo "Done."
