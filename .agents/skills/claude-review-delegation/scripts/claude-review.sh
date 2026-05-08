#!/usr/bin/env bash
set -euo pipefail

name=""
scope=""
basis=""
focus=""
model="${CLAUDE_REVIEW_MODEL:-sonnet}"
out_dir="${CLAUDE_REVIEW_OUT_DIR:-.tmp/claude-reviews}"

usage() {
  cat <<'USAGE'
Usage:
  claude-review.sh --name NAME --scope PATHS --basis FILE_OR_TEXT --focus TEXT

Runs a read-only Claude Code CLI review and writes markdown output to:
  .tmp/claude-reviews/NAME.md

Environment:
  CLAUDE_REVIEW_MODEL     Claude model alias, default: sonnet
  CLAUDE_REVIEW_OUT_DIR   Output directory, default: .tmp/claude-reviews
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --name)
      name="${2:-}"
      shift 2
      ;;
    --scope)
      scope="${2:-}"
      shift 2
      ;;
    --basis)
      basis="${2:-}"
      shift 2
      ;;
    --focus)
      focus="${2:-}"
      shift 2
      ;;
    --model)
      model="${2:-}"
      shift 2
      ;;
    --out-dir)
      out_dir="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ -z "$name" || -z "$scope" || -z "$basis" || -z "$focus" ]]; then
  usage >&2
  exit 2
fi

mkdir -p "$out_dir"
out_file="$out_dir/$name.md"

prompt=$(cat <<PROMPT
You are reviewing the Luke repository from a read-only stance.

Target scope:
$scope

Review basis:
$basis

Review focus:
$focus

Find bugs, regressions, missing tests, contract mismatches, and acceptance-criteria gaps.
Return only actionable findings. For each finding include:
- Severity
- File and line evidence where possible
- Why it matters
- Concrete fix direction

If you find no issues, say that clearly and list residual risks or checks that would still be useful.
Do not edit files. Do not run destructive commands.
PROMPT
)

printf '%s\n' "$prompt" | claude -p \
  --model "$model" \
  --permission-mode dontAsk \
  --allowedTools "Read,Grep,Glob,Bash(git diff *),Bash(git status *),Bash(rg *),Bash(sed *),Bash(nl *)" \
  > "$out_file"

printf '%s\n' "$out_file"
