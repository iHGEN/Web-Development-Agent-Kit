# Changes Review — Strict, Scoped, Fresh

When the user says **"review these changes"**, **"review my changes"** or an
equivalent review-only request, run one independent reviewer and return its report.
This is source analysis, not formal PR-readiness approval.

From the installed project root:

```bash
node .agent-core/bin/changes-review.mjs \
  --request '<original user request>'
```

When no selection is specified, review the current staged, unstaged and relevant
untracked changes; exclude committed changes. For a narrower review-only request,
optionally add `--selection '<requested files/diff/range>'`. Do **not** add this
option for auto-fix, which must include all current changes. The command starts a **fresh,
ephemeral, read-only Codex CLI session**, without resuming the caller's context.
Wait for its report and present it to the user.

Review the **current changes only**. Inspect directly affected callers, tests,
contracts and configuration as needed to understand their effects, but never
report unrelated pre-existing defects as findings. Act as a challenging senior
engineering, security, architecture and QA reviewer. Try hard to uncover real
P0–P3 problems involving access control, secrets, injection, incorrect state,
edge cases, error paths, concurrency, performance, regressions and missing tests.
For each finding give a precise location, trigger, evidence, impact and remedy.
Score security (25%), architecture (20%), correctness (20%), testing (15%),
performance (10%) and maintainability (10%) on a 0–5 scale, marking irrelevant
categories N/A. Be strict, not speculative: do not manufacture findings or
promise that every possible bug can be found.

## Shortcut: review, then auto-fix and open a PR

Only when the user explicitly requests auto-fix by saying `@autofix`,
`#autofix`, "auto fix true", or using `--auto-fix=true`:

```bash
npx @ihgen/web-kit review --auto-fix=true
# Equivalent terminal shorthand:
npx @ihgen/web-kit review @autofix
```

1. Perform the same adversarial **read-only review of current changes**.
2. Create a temporary isolated Git worktree based on the target branch and copy
   only that current diff into it. The original staged, unstaged and untracked
   work stays unchanged; old unrelated feature-branch commits are not copied.
3. Start a **second fresh Codex session** with scoped write access to fix verified
   findings in the original changed code and directly related test files, and
   execute real tests/checks. Other production-file edits stop automatic PR
   publication pending a separate scoped request.
4. Start a fresh read-only re-review. Automatically repeat the fix/re-review
   cycle up to three times if findings or required checks remain unresolved.
5. **Only** with successful executed tests, a clean Git diff and `READY TO OPEN
   PR` with no known P0/P1/material P2 findings, commit the isolated changes,
   check for high-confidence credentials in added lines, push its new feature
   branch and open a PR using the authenticated `gh` CLI.

If checks are missing, verification fails, or the new PR diff cannot be isolated
cleanly, **do not open a PR**. Explain the problem and retain the isolated
worktree for recovery. The auto-fix shortcut requires Git history, an `origin`
remote, an accessible local Codex CLI and GitHub CLI authentication. It is not
enabled by an ordinary "review" request; `--auto-fix=false` is the default.
Dot remains the CI/CD owner; this command does not dispatch GitHub Actions.

Inside an existing Codex CLI conversation, saying **"review these changes"**
starts the separate read-only reviewer and returns its report in the same chat.
Saying **"review these changes @autofix"** also starts the separate fresh
fixing session and gated PR flow. Neither command clears or resets the original
conversation; `@autofix` is a chat/CLI shortcut, **not a Git release tag**.

There is **no review task registration, handoff folder, request.json, ready.json,
report.md, result.json or supervisor transition** for this ordinary review.
Do not invoke `task-handoff.mjs request-review`, `report-ready`, or the strict
PR-readiness runner for a review-only request. Existing project work, staged and
unstaged changes, task records, approval fields and user instructions stay intact.

The ordinary reviewer does not modify source or run project code/tests. Do not
claim tests that were not performed. If the independent process cannot return a
report, show its error; never invent a review or fall back to the caller's
conversation. Auto-fix is the only path above that can mutate a separate
worktree, execute checks, and—after its readiness gate—open a PR.

Explicit implementation, test execution, security-review and formal PR-readiness
requests retain their separate existing workflows.
