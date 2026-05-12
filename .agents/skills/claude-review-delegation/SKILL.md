---
name: claude-review-delegation
description: Farm out independent code, migration milestone, and acceptance-criteria review tasks to Claude Code from the local CLI. Use when a Luke change needs a second-pass review, when `LOCAL_JOB_WORKBENCH_MIGRATION_PLAN.md` asks for an independent agent review, when Codex wants scoped findings from another model before marking work complete, or when large frontend/backend/backend-go changes benefit from parallel reviewer coverage.
---

# Claude Review Delegation

## Overview

Use Claude Code as an independent local CLI reviewer. Keep Claude's task scoped, read-only by default, and focused on concrete findings that Codex can verify, fix, defer, or record.

## Workflow

1. Define the review target before invoking Claude:
   - Code area: `frontend`, `backend`, `backend-go`, or a narrower path list.
   - Review basis: changed files, a milestone section, an acceptance checklist, or a specific regression concern.
   - Expected output: findings with severity, file/line evidence, and a short rationale.

2. Prefer read-only Claude Code runs:
   - Use `claude -p` for non-interactive CLI review.
   - Use `--permission-mode dontAsk` so Claude does not pause for permissions.
   - Use read-only tools such as `Read`, `Grep`, `Glob`, and tightly scoped `Bash(...)`.
   - Do not use `--dangerously-skip-permissions` for review delegation.

3. Save Claude's output when the review is part of a milestone:
   - Use a doc under `backend-go/docs/` for backend-go milestone reviews.
   - Use a concise markdown summary with findings, dispositions, and checks run.
   - If no issues are found, record that explicitly and include residual risks.

4. Triage results before acting:
   - Verify each finding locally before changing code.
   - Fix true positives in Codex, not by asking Claude to edit.
   - Mark false positives or deferred items explicitly in the review notes.
   - Run the relevant repo checks after fixes.

## Commands

For a scoped review, use the helper script:

```bash
.agents/skills/claude-review-delegation/scripts/claude-review.sh \
  --name localdata-m4-review \
  --scope backend-go/internal/localdata \
  --basis LOCAL_JOB_WORKBENCH_MIGRATION_PLAN.md \
  --focus "Review Milestone 4 acceptance criteria and compatibility risks."
```

The helper writes Claude's review to `.tmp/claude-reviews/<name>.md`.

For an ad hoc review without the helper:

```bash
printf '%s\n' "$PROMPT" | claude -p \
  --model sonnet \
  --permission-mode dontAsk \
  --allowedTools "Read,Grep,Glob,Bash(git diff *),Bash(git status *),Bash(rg *)"
```

Use `claude ultrareview <target>` only for branch-wide or PR-wide review when cloud-hosted multi-agent review is desired. The default Luke workflow is local CLI review with `claude -p`.

## Prompt Shape

Ask Claude to act like a reviewer, not an implementer:

```text
You are reviewing the Luke repository from a read-only stance.

Target scope:
- <paths or package>

Review basis:
- <plan section, acceptance criteria, diff, or concern>

Find bugs, regressions, missing tests, contract mismatches, and acceptance-criteria gaps.
Return only actionable findings. For each finding include severity, file/line evidence,
why it matters, and a concrete fix direction. If you find no issues, say so and list
the checks or residual risks.
```

## Luke Review Gates

Match checks to the affected package:

- Frontend: `npm run build --prefix frontend` and `npm run lint --prefix frontend`.
- Go backend: run from `backend-go`; prefer `./check.sh` for full gates and targeted `go test ./...` for quick verification.
- Repo hooks: `prek run` from the repo root when staged-file hooks matter.

## Guardrails

- Keep Claude read-only unless the user explicitly asks for Claude to edit.
- Do not pass secrets, `.env` contents, private keys, or credentials into prompts.
- Prefer narrow scopes over whole-repo prompts.
- Do not treat Claude output as authoritative; verify before changing code.
- Keep Codex responsible for final edits, checks, and user-facing conclusions.
