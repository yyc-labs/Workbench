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
USE_AI=0
API_BASE_URL=""
API_KEY=""
MODEL=""
DEFAULT_MAX_BULLETS=8
MAX_BULLETS="${AI_COMMIT_MAX_BULLETS:-$DEFAULT_MAX_BULLETS}"
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

is_valid_type() {
  case "$1" in
    fix|feat|style|chore|refactor|docs|debug) return 0 ;;
    *) return 1 ;;
  esac
}

normalize_and_limit_bullets() {
  local -a output=()
  local raw line
  for raw in "$@"; do
    line="${raw#"${raw%%[![:space:]]*}"}"
    line="${line%"${line##*[![:space:]]}"}"
    [[ -n "$line" ]] || continue
    output+=("$line")
    if (( ${#output[@]} >= MAX_BULLETS )); then
      break
    fi
  done
  BULLETS=("${output[@]}")
}

resolve_ai_base_url() {
  local raw="$API_BASE_URL"
  if [[ -z "${raw// }" ]]; then
    raw="${AI_COMMIT_API_BASE_URL:-}"
  fi
  if [[ -z "${raw// }" ]]; then
    raw="https://api.openai.com/v1"
  fi
  raw="${raw%/}"
  if [[ "$raw" =~ /v1$ ]]; then
    printf '%s\n' "${raw}/chat/completions"
  else
    printf '%s\n' "${raw}/v1/chat/completions"
  fi
}

resolve_ai_key() {
  if [[ -n "${API_KEY// }" ]]; then
    printf '%s\n' "$API_KEY"
    return 0
  fi
  printf '%s\n' "${AI_COMMIT_API_KEY:-}"
}

resolve_ai_model() {
  if [[ -n "${MODEL// }" ]]; then
    printf '%s\n' "$MODEL"
    return 0
  fi
  if [[ -n "${AI_COMMIT_MODEL:-}" ]]; then
    printf '%s\n' "$AI_COMMIT_MODEL"
    return 0
  fi
  printf '%s\n' "gpt-4o-mini"
}

extract_json_object_node() {
  node -e '
const fs = require("fs");
let text = fs.readFileSync(0, "utf8").trim();
if (!text) process.exit(1);
if (text.startsWith("```")) {
  text = text.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/, "").trim();
}
const start = text.indexOf("{");
const end = text.lastIndexOf("}");
if (start >= 0 && end > start) {
  process.stdout.write(text.slice(start, end + 1));
} else {
  process.stdout.write(text);
}
' 2>/dev/null
}

extract_json_object_py() {
  python3 -c '
import re, sys
text = sys.stdin.read().strip()
if not text:
    raise SystemExit(1)
if text.startswith("```"):
    text = re.sub(r"^```json\s*", "", text, flags=re.I)
    text = re.sub(r"^```\s*", "", text, flags=re.I)
    text = re.sub(r"\s*```$", "", text).strip()
start = text.find("{")
end = text.rfind("}")
sys.stdout.write(text[start:end+1] if start >= 0 and end > start else text)
' 2>/dev/null
}

extract_json_object_any() {
  if command -v node >/dev/null 2>&1; then
    extract_json_object_node
    return $?
  fi
  if command -v python3 >/dev/null 2>&1; then
    extract_json_object_py
    return $?
  fi
  return 1
}

build_request_json_node() {
  local model="$1"
  node -e '
const fs = require("fs");
const model = process.argv[1];
const prompt = fs.readFileSync(0, "utf8");
const body = {
  model,
  temperature: 0.2,
  messages: [
    { role: "system", content: "You are a senior engineer. Output JSON only. Every textual field must be Simplified Chinese." },
    { role: "user", content: prompt },
  ],
};
process.stdout.write(JSON.stringify(body));
' "$model"
}

build_request_json_py() {
  local model="$1"
  python3 -c '
import json, sys
model = sys.argv[1]
prompt = sys.stdin.read()
body = {
  "model": model,
  "temperature": 0.2,
  "messages": [
    {"role": "system", "content": "You are a senior engineer. Output JSON only. Every textual field must be Simplified Chinese."},
    {"role": "user", "content": prompt},
  ],
}
sys.stdout.write(json.dumps(body, ensure_ascii=False))
' "$model"
}

extract_choice_content_node() {
  node -e '
const fs = require("fs");
const text = fs.readFileSync(0, "utf8");
try {
  const data = JSON.parse(text);
  const content = data?.choices?.[0]?.message?.content ?? "";
  process.stdout.write(String(content));
} catch {
  process.exit(1);
}
'
}

extract_choice_content_py() {
  python3 -c '
import json, sys
try:
    data = json.loads(sys.stdin.read())
except Exception:
    raise SystemExit(1)
choice = ((data or {}).get("choices") or [{}])[0]
message = (choice.get("message") or {})
content = message.get("content")
if isinstance(content, list):
    parts = []
    for item in content:
        if isinstance(item, dict):
            text = item.get("text")
            if text:
                parts.append(str(text))
        elif item:
            parts.append(str(item))
    content = "\n".join(parts)
if not content:
    content = choice.get("text") or (data or {}).get("output_text") or ""
sys.stdout.write(str(content))
'
}

extract_ai_type_node() {
  node -e '
const fs = require("fs");
const text = fs.readFileSync(0, "utf8");
try {
  const data = JSON.parse(text);
  process.stdout.write(String(data?.type ?? "").trim().toLowerCase());
} catch {
  process.exit(1);
}
'
}

extract_ai_type_py() {
  python3 -c '
import json, sys
try:
    data = json.loads(sys.stdin.read())
except Exception:
    raise SystemExit(1)
sys.stdout.write(str((data or {}).get("type") or "").strip().lower())
'
}

extract_ai_subject_node() {
  node -e '
const fs = require("fs");
const text = fs.readFileSync(0, "utf8");
try {
  const data = JSON.parse(text);
  process.stdout.write(String(data?.subject ?? "").trim());
} catch {
  process.exit(1);
}
'
}

extract_ai_subject_py() {
  python3 -c '
import json, sys
try:
    data = json.loads(sys.stdin.read())
except Exception:
    raise SystemExit(1)
sys.stdout.write(str((data or {}).get("subject") or "").strip())
'
}

extract_ai_bullets_node() {
  node -e '
const fs = require("fs");
const text = fs.readFileSync(0, "utf8");
try {
  const data = JSON.parse(text);
  const bullets = Array.isArray(data?.bullets) ? data.bullets : [];
  for (const item of bullets) {
    const line = String(item ?? "").trim();
    if (line) process.stdout.write(line + "\n");
  }
} catch {
  process.exit(1);
}
'
}

extract_ai_bullets_py() {
  python3 -c '
import json, sys
try:
    data = json.loads(sys.stdin.read())
except Exception:
    raise SystemExit(1)
bullets = (data or {}).get("bullets") or []
if not isinstance(bullets, list):
    bullets = []
for item in bullets:
    line = str(item or "").strip()
    if line:
        sys.stdout.write(line + "\n")
'
}

try_apply_ai_message() {
  local current_type="$1"
  local current_subject="$2"

  if ! command -v curl >/dev/null 2>&1; then
    echo "[auto-commit] AI enabled but curl not found, fallback to local message."
    return 0
  fi
  if ! command -v node >/dev/null 2>&1 && ! command -v python3 >/dev/null 2>&1; then
    echo "[auto-commit] AI enabled but neither node nor python3 found, fallback to local message."
    return 0
  fi

  local api_key api_url model
  api_key="$(resolve_ai_key)"
  if [[ -z "${api_key// }" ]]; then
    echo "[auto-commit] AI enabled but no API key provided, fallback to local message."
    return 0
  fi
  api_url="$(resolve_ai_base_url)"
  model="$(resolve_ai_model)"

  local files stat patch
  files="$(git diff --cached --name-only)"
  stat="$(git diff --cached --stat)"
  patch="$(git diff --cached --unified=0)"
  if (( ${#patch} > 12000 )); then
    patch="${patch:0:12000}"
  fi

  local user_prompt
  user_prompt="$(cat <<EOF
Generate a Chinese git commit suggestion from staged changes.
Return JSON only with shape:
{"type":"fix|feat|style|chore|refactor|docs|debug","subject":"<=40 chars","bullets":["0-${MAX_BULLETS} items, each <=50 chars"]}

Rules:
1) JSON only, no markdown.
2) subject and bullets MUST be Simplified Chinese.
3) subject MUST describe the most important concrete change, not file count or generic wording.
4) Do not use generic subjects like "更新代码改动", "提交当前改动", "更新文件变更".
5) Prefer deriving subject from the strongest summary bullet when appropriate.
6) bullets can be [] and should adapt to change scope (0-${MAX_BULLETS} items).

Files:
$files

Stats:
$stat

Patch:
$patch
EOF
)"

  echo "[ai] model=${model}"
  echo "[ai] endpoint=${api_url}"
  echo "[auto-commit] Calling AI API (${model})"

  local request_json response content_raw json_text
  if command -v node >/dev/null 2>&1; then
    request_json="$(build_request_json_node "$model" <<<"$user_prompt")"
  else
    request_json="$(build_request_json_py "$model" <<<"$user_prompt")"
  fi

  if ! response="$(curl -sS --max-time 90 \
    -H "Authorization: Bearer ${api_key}" \
    -H "Content-Type: application/json" \
    -d "$request_json" \
    "$api_url")"; then
    echo "[auto-commit] AI request failed, fallback to local message."
    return 0
  fi

  if command -v node >/dev/null 2>&1; then
    content_raw="$(extract_choice_content_node <<<"$response" || true)"
  else
    content_raw="$(extract_choice_content_py <<<"$response" || true)"
  fi
  if [[ -z "${content_raw// }" ]]; then
    echo "[auto-commit] AI response parse failed, fallback to local message."
    return 0
  fi 

  if ! json_text="$(extract_json_object_any <<<"$content_raw")"; then
    echo "[auto-commit] AI JSON extraction failed, fallback to local message."
    return 0
  fi

  local ai_type ai_subject
  if command -v node >/dev/null 2>&1; then
    ai_type="$(extract_ai_type_node <<<"$json_text" 2>/dev/null || true)"
    ai_subject="$(extract_ai_subject_node <<<"$json_text" 2>/dev/null || true)"
    mapfile -t ai_bullets < <(extract_ai_bullets_node <<<"$json_text" 2>/dev/null || true)
  else
    ai_type="$(extract_ai_type_py <<<"$json_text" 2>/dev/null || true)"
    ai_subject="$(extract_ai_subject_py <<<"$json_text" 2>/dev/null || true)"
    mapfile -t ai_bullets < <(extract_ai_bullets_py <<<"$json_text" 2>/dev/null || true)
  fi

  if [[ -z "$TYPE" ]] && [[ -n "$ai_type" ]] && is_valid_type "$ai_type"; then
    TYPE="$ai_type"
  fi
  if [[ -z "$SUBJECT" ]] && [[ -n "$ai_subject" ]] && has_cjk "$ai_subject"; then
    SUBJECT="$ai_subject"
  fi
  if [[ ${#BULLETS[@]} -eq 0 ]] && [[ ${#ai_bullets[@]} -gt 0 ]]; then
    BULLETS=("${ai_bullets[@]}")
  fi

  echo "[ai] final type=${TYPE:-$current_type}"
  echo "[ai] final subject=${SUBJECT:-$current_subject}"
}

usage() {
  cat <<'EOF'
Usage:
  auto_commit.sh [options]

Options:
  --type <fix|feat|style|chore|refactor|docs|debug>
  --subject <中文标题>
  --bullet <说明小点>              (可重复)
  --max-bullets <1-20>            限制小点数量（默认 8，可用 AI_COMMIT_MAX_BULLETS）
  --all                           使用 git add -A
  --include-untracked             添加未跟踪文件 (git add .)
  --dry-run                       仅打印提交信息，不提交
  --split                         启用文件级分批提交
  --split-dry-run                 仅生成并输出分批计划，不执行 commit
  --split-max-batches <1-12>      限制分批数量（默认 4）
  --use-ai                        启用 AI 生成提交信息
  --api-base-url <url>            AI API base URL（默认 https://api.openai.com/v1）
  --api-key <key>                 AI API key（可用 AI_COMMIT_API_KEY）
  --model <name>                  AI 模型（默认 gpt-4o-mini）
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
    --max-bullets)
      MAX_BULLETS="${2:-}"
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
    --use-ai)
      USE_AI=1
      shift
      ;;
    --api-base-url)
      API_BASE_URL="${2:-}"
      shift 2
      ;;
    --api-key)
      API_KEY="${2:-}"
      shift 2
      ;;
    --model)
      MODEL="${2:-}"
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

if ! [[ "$MAX_BULLETS" =~ ^[0-9]+$ ]]; then
  echo "Error: --max-bullets 必须是 1-20 的整数。" >&2
  exit 1
fi
if (( MAX_BULLETS < 1 || MAX_BULLETS > 20 )); then
  echo "Error: --max-bullets 必须在 1-20 之间。" >&2
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
    plan_path="$(pwsh -NoProfile -ExecutionPolicy Bypass -File "$plan_script" -MaxBatches "$SPLIT_MAX_BATCHES" -MaxBullets "$MAX_BULLETS" | sed -n 's/.*plan generated: //p' | tail -n 1 | tr -d '\r')"
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

    pwsh -NoProfile -ExecutionPolicy Bypass -File "$apply_script" -PlanPath "$plan_path" -MaxBullets "$MAX_BULLETS"
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

if (( USE_AI == 1 )); then
  try_apply_ai_message "$TYPE" "$SUBJECT"
fi

normalize_and_limit_bullets "${BULLETS[@]}"

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
