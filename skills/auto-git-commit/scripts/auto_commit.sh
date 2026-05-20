#!/usr/bin/env bash
set -euo pipefail

TYPE=""
SUBJECT=""
DRY_RUN=0
ADD_ALL=0
INCLUDE_UNTRACKED=0
SPLIT=0
SPLIT_DRY_RUN=0
SPLIT_MAX_BATCHES=4
declare -a BULLETS=()

has_cjk() {
  LC_ALL=C grep -q '[^ -~]' <<<"$1"
}

is_generic_subject() {
  local text="$1"
  [[ "$text" =~ ^更新代码改动([[:space:]]*[（(][0-9]+[[:space:]]*files[）)])?$ ]] && return 0
  [[ "$text" =~ ^自动提交当前改动([[:space:]]*[（(][0-9]+[[:space:]]*files[）)])?$ ]] && return 0
  [[ "$text" =~ ^提交当前改动([[:space:]]*[（(][0-9]+[[:space:]]*files[）)])?$ ]] && return 0
  [[ "$text" =~ ^更新文件变更([[:space:]]*[（(][0-9]+[[:space:]]*files[）)])?$ ]] && return 0
  [[ "$text" =~ ^更新项目文件([[:space:]]*[（(][0-9]+[[:space:]]*files[）)])?$ ]] && return 0
  return 1
}

subject_from_bullets() {
  local bullet text
  for bullet in "${BULLETS[@]}"; do
    text="${bullet#"${bullet%%[![:space:]]*}"}"
    text="${text#-}"
    text="${text#"${text%%[![:space:]]*}"}"
    text="${text%"${text##*[![:space:]。；;,.，、]}"}"
    if [[ -n "$text" ]] && has_cjk "$text"; then
      echo "${text:0:40}"
      return 0
    fi
  done
  return 1
}

resolve_split_type_from_file() {
  local path="$1"
  if [[ "$path" =~ (^|/)(docs|README|CHANGELOG|logs)/ ]] || [[ "$path" =~ \.md$ ]]; then
    echo "docs"
    return 0
  fi
  if [[ "$path" =~ (^|/)(src/renderer/) ]] || [[ "$path" =~ \.(css|scss|less)$ ]]; then
    echo "style"
    return 0
  fi
  if [[ "$path" =~ (^|/)(package\.json|package-lock\.json|build/|script/|scripts/|\.github/) ]]; then
    echo "chore"
    return 0
  fi
  echo "fix"
}

split_default_subject() {
  local type="$1"
  local file_count="$2"
  case "$type" in
    style) echo "拆分并提交界面样式改动" ;;
    chore) echo "拆分并提交工程配置调整" ;;
    docs) echo "拆分并提交文档记录更新" ;;
    *) echo "拆分并提交代码改动 (${file_count} files)" ;;
  esac
}

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
  --split                         启用文件级分批提交
  --split-dry-run                 仅生成并输出分批计划，不执行 commit
  --split-max-batches <1-12>      限制分批数量（默认 4）
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
    --split)
      SPLIT=1
      shift
      ;;
    --split-dry-run)
      SPLIT=1
      SPLIT_DRY_RUN=1
      shift
      ;;
    --split-max-batches)
      SPLIT_MAX_BATCHES="${2:-}"
      shift 2
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

if ! [[ "$SPLIT_MAX_BATCHES" =~ ^[0-9]+$ ]]; then
  echo "Error: --split-max-batches 必须是 1-12 的整数。" >&2
  exit 1
fi
if (( SPLIT_MAX_BATCHES < 1 || SPLIT_MAX_BATCHES > 12 )); then
  echo "Error: --split-max-batches 必须在 1-12 之间。" >&2
  exit 1
fi

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
plan_script="${script_dir}/ai_split_plan.ps1"
apply_script="${script_dir}/apply_split_plan.ps1"

if (( SPLIT_DRY_RUN == 1 )); then
  DRY_RUN=1
fi

if (( SPLIT == 1 )); then
  if command -v pwsh >/dev/null 2>&1 && [[ -f "$plan_script" ]] && [[ -f "$apply_script" ]]; then
    plan_path="$(pwsh -NoProfile -ExecutionPolicy Bypass -File "$plan_script" -MaxBatches "$SPLIT_MAX_BATCHES" | sed -n 's/.*plan generated: //p' | tail -n 1 | tr -d '\r')"
    if [[ -z "$plan_path" || ! -f "$plan_path" ]]; then
      echo "Error: 分批计划生成失败（未得到有效 plan 路径）。" >&2
      exit 1
    fi
    echo "[auto-commit] split plan: ${plan_path}"

    if (( SPLIT_DRY_RUN == 1 || DRY_RUN == 1 )); then
      echo "[auto-commit] [split-dry-run] Plan generated. Skip apply/commit."
      cat "$plan_path"
      exit 0
    fi

    pwsh -NoProfile -ExecutionPolicy Bypass -File "$apply_script" -PlanPath "$plan_path"
    echo "[auto-commit] Done."
    exit 0
  fi

  echo "[auto-commit] split mode: local bash fallback (pwsh unavailable)"
  split_tmp_dir="$(mktemp -d)"
  trap 'rm -rf "$split_tmp_dir"' EXIT
  touch "$split_tmp_dir/group_fix.txt" "$split_tmp_dir/group_style.txt" "$split_tmp_dir/group_chore.txt" "$split_tmp_dir/group_docs.txt"

  mapfile -t split_staged_files < <(git diff --cached --name-only)
  for file_path in "${split_staged_files[@]}"; do
    [[ -n "$file_path" ]] || continue
    split_type="$(resolve_split_type_from_file "$file_path")"
    printf '%s\n' "$file_path" >> "$split_tmp_dir/group_${split_type}.txt"
  done

  declare -a split_batch_types=()
  declare -a split_batch_subjects=()
  declare -a split_batch_files_lists=()

  for split_type in fix style chore docs; do
    group_file="$split_tmp_dir/group_${split_type}.txt"
    [[ -s "$group_file" ]] || continue
    awk '!seen[$0]++' "$group_file" > "$group_file.unique"
    mv "$group_file.unique" "$group_file"
    file_count="$(grep -c . "$group_file" || true)"
    [[ "$file_count" -gt 0 ]] || continue
    split_batch_types+=("$split_type")
    split_batch_subjects+=("$(split_default_subject "$split_type" "$file_count")")
    split_batch_files_lists+=("$group_file")
  done

  if [[ ${#split_batch_types[@]} -eq 0 ]]; then
    echo "Error: 未能生成有效分批计划。" >&2
    exit 1
  fi

  while [[ ${#split_batch_types[@]} -gt $SPLIT_MAX_BATCHES ]]; do
    last_index=$((${#split_batch_types[@]} - 1))
    prev_index=$((last_index - 1))
    cat "${split_batch_files_lists[$last_index]}" >> "${split_batch_files_lists[$prev_index]}"
    awk '!seen[$0]++' "${split_batch_files_lists[$prev_index]}" > "${split_batch_files_lists[$prev_index]}.merged"
    mv "${split_batch_files_lists[$prev_index]}.merged" "${split_batch_files_lists[$prev_index]}"

    unset 'split_batch_types[last_index]'
    unset 'split_batch_subjects[last_index]'
    unset 'split_batch_files_lists[last_index]'
    split_batch_types=("${split_batch_types[@]}")
    split_batch_subjects=("${split_batch_subjects[@]}")
    split_batch_files_lists=("${split_batch_files_lists[@]}")
  done

  split_total="${#split_batch_types[@]}"
  echo "[auto-commit] split plan: local (${split_total} batches)"
  for ((i = 0; i < split_total; i++)); do
    batch_no=$((i + 1))
    batch_file_count="$(grep -c . "${split_batch_files_lists[$i]}" || true)"
    echo "[split-plan] batch ${batch_no}/${split_total}: batch-${batch_no} type=${split_batch_types[$i]} files=${batch_file_count} subject=${split_batch_subjects[$i]}"
    if (( SPLIT_DRY_RUN == 1 || DRY_RUN == 1 )); then
      sed 's/^/[split-plan]   - /' "${split_batch_files_lists[$i]}"
    fi
  done

  if (( SPLIT_DRY_RUN == 1 || DRY_RUN == 1 )); then
    echo "[auto-commit] [split-dry-run] Plan generated. Skip apply/commit."
    exit 0
  fi

  for ((i = 0; i < split_total; i++)); do
    batch_no=$((i + 1))
    echo "[split-apply] batch ${batch_no}/${split_total}: batch-${batch_no}"
    echo "[split-apply] git restore --staged :/"
    git restore --staged :/

    mapfile -t batch_files < "${split_batch_files_lists[$i]}"
    if [[ ${#batch_files[@]} -eq 0 ]]; then
      echo "Error: batch-${batch_no} 文件列表为空。" >&2
      exit 1
    fi

    echo "[split-apply] git add -- (${#batch_files[@]} files)"
    git add -- "${batch_files[@]}"

    title="${split_batch_types[$i]}:${split_batch_subjects[$i]}"
    echo "[split-apply] commit message: ${title}"
    git commit -m "${title}" -m "- 按文件级规则自动分组"
  done

  if ! git diff --cached --quiet; then
    echo "Error: 分批提交结束后 staged 区域不为空。" >&2
    exit 1
  fi
  echo "[split-apply] Done."
  echo "[auto-commit] Done."
  exit 0
fi

subject_provided=0
if [[ -n "$SUBJECT" ]]; then
  subject_provided=1
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

if [[ $subject_provided -eq 0 && ${#BULLETS[@]} -gt 0 ]] && { [[ -z "$SUBJECT" ]] || is_generic_subject "$SUBJECT"; }; then
  summary_subject="$(subject_from_bullets || true)"
  if [[ -n "$summary_subject" ]]; then
    SUBJECT="$summary_subject"
  fi
fi

if [[ -z "$SUBJECT" ]]; then
  file_count="$(git diff --cached --name-only | wc -l | tr -d ' ')"
  SUBJECT="更新代码改动 (${file_count} files)"
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
