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
# No PR, fix in the current working files after independent verification:
npx @ihgen/web-kit review @autofix --no-pr
```

1. Perform the same adversarial **read-only review of current changes**.
2. Create a temporary isolated Git worktree based on the target branch and copy
   only that current diff into it. The original staged, unstaged and untracked
   work stays unchanged; old unrelated feature-branch commits are not copied.
3. Start a **second fresh Codex session** with scoped write access to fix verified
   findings in the original changed code and directly related test files. New
   test files must match the changed module's filename; unrelated existing tests
   and production files are outside scope and stop automatic publication.
4. Stage the proposed candidate in the **temporary fixer worktree**, record
   its Git tree SHA, and materialize that tree in a separate **fresh disposable
   checkout** without the fixer's ignored files. Start an independent post-fix
   verification session there, reconstruct necessary generated artifacts from
   tracked sources, and run real tests/checks. Require each validation command
   to explicitly enter the clean candidate Git root in the same fail-fast shell
   invocation (`cd "<absolute-candidate-checkout>" && ...`),
   because Codex command events do not reliably identify the actual cwd,
   reject non-executing test options (such as `--help`), masked failures (such as
   `npm test || true`), inline environment overrides and unverified npmrc
   workspace selection, zero/all-skipped or contradictory runner summaries,
   fabricated runner summaries from arbitrary Node scripts and opaque test
   wrappers (for example `node tests/fake.mjs` or `make test`),
   npm test scripts that only invoke check/audit/lint aliases without a
   directly recognized test runner, and custom Node `--test-reporter` modules
   that can forge passing counters for skipped tests, including underscore
   flag aliases, executable Node preloads (`--import`, `--require`/`-r`) and
   loaders that can exit before tests run, and Node's file-only synthetic
   passes or built-in spec output without trustworthy TAP test events,
   failing commands hidden behind diagnostic prefixes, missing real positive
   test counts, failed validations and unexpected command errors. A standalone
   read-only search yielding no matches (`rg`
   exit 1) is not a failed validation. Reject any modifications to the verified
   source snapshot. The final staged Git tree must equal the clean verified
   candidate tree. Codex's shell environment policy must exclude provider API
   keys from model-run project commands. Then start a fresh read-only re-review
   on the same clean candidate. Automatically repeat the fix/verification/re-review
   cycle up to three times if findings or required checks remain unresolved.
5. **Only** with successful executed tests, a clean Git diff and `READY TO OPEN
   PR` with no known P0/P1/material P2 findings, commit the isolated changes,
   check for high-confidence credentials including provider keys (`sk-proj-`)
   in added lines and staged text files,
   block uninspectable binary files, push its new feature branch and open a PR
   using the authenticated `gh` CLI.

The explicit `--no-pr` option is **local-only**: do not commit, push, or open a PR.
After the same strict fix/verification/re-review gate, safely apply the approved
fixes and directly related tests into the original working files while preserving
the original Git index. This mode needs neither a GitHub CLI nor an `origin`
remote. Do not apply fixes if the original changes moved during review.

If checks are missing, verification fails, or the new PR diff cannot be isolated
cleanly, **do not open a PR**. Explain the problem and retain the isolated
worktree for recovery. The auto-fix shortcut requires Git history, an `origin`
remote, an accessible local Codex CLI and GitHub CLI authentication. It is not
enabled by an ordinary "review" request; `--auto-fix=false` is the default.
Dot remains the CI/CD owner; this command does not dispatch GitHub Actions.
Git and GitHub CLI subprocesses are also bounded (default 120 seconds each;
set `WEB_KIT_REVIEW_COMMAND_TIMEOUT_SECONDS` to an integer 1–3600). A timeout
or termination aborts publication and retains the isolated fixer worktree.

Inside an existing Codex CLI conversation, saying **"review these changes"**
starts the separate read-only reviewer and returns its report in the same chat.
Saying **"review these changes @autofix"** also starts the separate fresh
fixing session and gated PR flow. Neither command clears or resets the original
conversation. Saying **"review these changes @autofix --no-pr"** performs the
same gated fixing flow but applies results locally and never publishes a PR;
`@autofix` is a chat/CLI shortcut, **not a Git release tag**.

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
