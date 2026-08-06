---
name: ticket-workflow
description: The full ticket lifecycle from picking up a Jira ticket through to verified-on-staging — status transitions and who owns each, branch and MR targeting, the local QA pass, staging verification, the verification recording, and the client-facing comment. Use at the START of any ticket, and whenever asked to commit, open an MR, move a ticket status, verify on staging, or record a verification video. Triggers on a Jira ticket key, "start this task", "it's deployed on staging", "move it to QA done".
user_invocable: true
---

# Ticket lifecycle — start → verified on staging

Follow these in order. Three gates are **blocking**: plan approval, commit/push, MR creation. Two more
wait on the developer's word: the "deployed to staging" status, and any ticket comment outside the
deploy-notification flow.

**Vocabulary:** "the developer" = the person you are working with. "the client" = the ticket reporter.

**Project-specific values** live in `PROJECT.md` at the repo root, or in environment variables. If one
is missing, **ask** — do not guess a branch name, a project id or a transition id.

| Placeholder | Meaning |
|---|---|
| `${FEATURE_BRANCH}` | Where day-to-day work lands |
| `${MR_TARGET_BRANCH}` | What MRs target |
| `${INTEGRATION_BRANCH}` `${STAGING_BRANCH}` `${PREPROD_BRANCH}` `${PROD_BRANCH}` | The promotion chain |
| `${GITLAB_HOST}` `${GITLAB_PROJECT_ID}` | Where MRs are created |
| `${JIRA_HOST}` | The ticket tracker |
| `$TASK_DOCS_DIR` | Where task notes go (default `$HOME/task-notes`) |

---

## Step 1 — Read the ticket before doing anything

- Read description, comments, reporter, attachments, and **the current status**.
- Never transition blindly. A teammate may already have moved it; if it is already at the status you
  would set, do nothing and say so.
- If the analysis concludes the work should not be done, say that instead of moving it to `In Progress`
  and then proposing closure. An accurate board beats a busy one.

## Step 2 — Move it to `In Progress`

Unprompted, as the **first** step — not at the end, not when reminded.

Fetch the transition list rather than assuming an id; ids differ per workflow and change when the board
is edited:

```bash
curl -s -u "$JIRA_EMAIL:$JIRA_TOKEN" \
  "$JIRA_BASE/rest/api/3/issue/<TICKET-KEY>/transitions" | jq '.transitions[]|{id,name}'
```

**Why:** the board is how the team sees who is on what. A ticket sitting in `To Do` while it is being
worked looks unclaimed, and two people pick up the same thing.

⚠️ This is a status change only. It does **not** carry approval to comment on the ticket.

## Step 3 — Analyse, then write the task notes *first*

Document findings **before** changing code.

- Path: `$TASK_DOCS_DIR/<yyyy-mm-dd>/<task-name>.md`
- Must contain a `## Plan to Implement` section.
- Every file reference is a full absolute clickable path with a line number:
  `[/abs/path/file.ext:319](vscode://file/abs/path/file.ext:319)`. A bare path or `file:///` will not
  link.
- Add a `Staging URL:` line for every page touched — later tooling reads this instead of guessing URLs,
  and guessed URLs ship dead links.

## Step 4 — 🛑 Wait for plan approval

Blocking. No code until the developer has reviewed the plan and confirmed.

## Step 5 — Implement

- Commits stack on `${FEATURE_BRANCH}`. Do **not** split onto per-task branches unless asked, it is a
  long-running spike, or it is a hotfix bypassing the normal flow.
- A justified one-off branch is named for the feature, with no developer-name prefix.
- Schema changes go through a **migration**, with existence checks for tables, columns, indexes and
  constraints, and error handling around constraints that may fail on legacy data. Never modify the
  database directly.
- **Find every affected place.** Grep all sibling surfaces; resolve components, templates and renamed
  payload keys. One grep is not an audit — report the coverage you achieved.
- Preserve original line endings; some files in older repos are CRLF. Check `git diff --numstat`.
- Make only the requested change. No unrequested improvements.

## Step 6 — Verify locally first, then the 6-step QA pass

A real run of the real application. Not a test harness, not code reasoning.

1. **Code audit** — re-read every changed file *and its callers*. Lint each one with whatever your
   stack uses (`php -l`, `node --check`, `ruff`, `go vet`, `tsc --noEmit`). Look for leftover debug
   output, missing auth/CSRF checks on endpoints, missing null guards, and hardcoded values that
   belong in config.
2. **Positive path** — walk the golden flow end to end. Capture each step, confirm no console errors,
   then reload and re-verify the data actually persisted.
3. **Negative paths — at least 3.** Input boundaries (empty, whitespace, very long, unicode); a
   different permission role; concurrent actions (rapid double-click, two tabs, back button mid-flow);
   empty and edge data (0 rows, 1 row, 200+ rows).
4. **Fix loop** — fix everything found in steps 1–3 *now* and re-run that scenario. Do not defer to a
   follow-up MR unless it genuinely touches unrelated code, and then say so explicitly.
5. **Optimization sweep** — N+1 queries, missing eager-loading, duplicate network calls, aggregates
   computed in the view layer, heavy synchronous work that belongs in a background job.
6. **Report** a `QA Pass` section covering all of the above.

Rules that catch real regressions:

- QA on a **fresh page load** — re-navigate before calling it a pass, and register scripts the way the
  framework intends rather than inlining them, so a reload reproduces what you tested.
- Bind behaviour to a specific element id, never a page-wide selector like `$('form')` — broad
  selectors silently break unrelated flows.
- 🛑 **Never write to a shared database** (staging or production) to test something. Verify by
  inspection.

## Step 7 — Update the task notes

In the **same response** as the code edit, never as a separate request: what changed with `file:line`,
the QA results, and the `Staging URL:`.

## Step 8 — 🛑 Commit and push (explicit approval, every time)

Default after implementing: report status and **stop**. "Changes are ready. Want me to commit?"

- "continue" / "go ahead" / "fix it" / "proceed" are **not** commit authorization. Only a literal
  "commit" / "push" **for this change**.
- Approval never carries forward to the next change.
- Immediately before committing, re-verify `git branch --show-current` **in the same step**.
- Commit only related files, by explicit path — split by page/feature even within one ticket.
- **Never stage `CLAUDE.md`, `.claude/`, or any AI-assistant file.**
- Message format, no AI attribution:

  ```
  [<PROJ>-1234] - Brief description of changes

  - Detailed change 1
  - Detailed change 2
  ```

## Step 9 — 🛑 MR (explicit "create MR" required), then self-review

"commit and push" does not imply an MR. Pushing never implies an MR.

- Target = `${MR_TARGET_BRANCH}`. If your project uses a dated or rotating target (a monthly milestone
  branch, a release train), derive it from today's date **every time** — never reuse one from an
  earlier session or an old task note. Confirm it exists with `git ls-remote --heads origin`.
- 🛑 **If the expected target branch does not exist yet, STOP and ASK.** Never fall back to an older
  one just because it is the newest that exists.
- Never target the repo's default branch unless it genuinely is the target. The MR URL that
  `git push` prints targets the default branch — do not surface it. Build the URL with explicit
  `source_branch` and `target_branch` params against `${GITLAB_PROJECT_ID}`.
- MR title = the ticket summary **verbatim**, not a paraphrase.
- Set "delete source branch when merged" at creation, and delete the local copy after it merges.
- **Then self-review immediately, before reporting the MR done** — invoke the `mr-review` skill on the
  MR URL. It pins to the MR HEAD SHA on the server rather than your possibly-stale working copy, runs
  the altitude checklist, and emits per-finding severities plus a `Mergeable` verdict. Fix the small,
  clear findings in a follow-up commit.

## Step 10 — Move the ticket to `Code Review`

Unprompted, same standing as `In Progress`. It means "MR is open, awaiting review/merge". Only for your
own MRs — a teammate's ticket status is theirs to drive.

## Step 11 — Confirm where the code actually is

Before claiming anything about an environment, check:

```bash
git branch -r --contains <sha>      # for every commit on the ticket
```

If the commits are not on `${STAGING_BRANCH}`, the ticket is not ready for a staging status, whatever
the MR says.

## Step 12 — "Deployed to staging" — waits on the developer's word

🛑 This status is a **deploy** fact. You cannot observe a deploy, so you cannot assert it. A merged MR
is not a deploy. Wait for the developer to say the code is on staging.

When they do say it, that same message is standing approval for the rest of this flow — verify, set the
status, record the video, post the client comment. Do not re-ask at each step.

## Step 13 — Verify on staging → recording → comment → "staging verified"

1. **Exercise the real code path on staging** in a browser. Not the local app, not a code read.
2. **Record the verification** once it works — after the fix is confirmed, not while debugging.
3. **Attach the recording to the ticket as a comment**, not as a bare attachment, so the reader sees
   the context.
4. **Post the client-facing comment** — 2–4 lines, opening with a real @-mention of the reporter. If
   you are the reporter yourself, address whoever raised the underlying request.
5. **Then move the ticket to the "staging verified" status.** This one *is* yours to assert, because it
   is a verification fact and you did the verification.

🛑 Never comment on a ticket outside this flow without explicit approval. "continue" and "proceed" are
not approval to comment.

## Step 14 — Production

The promotion continues `${STAGING_BRANCH}` → `${PREPROD_BRANCH}` → `${PROD_BRANCH}`. The "on
production" status waits on the developer's word; the "production verified" status follows your own
verification, exactly as on staging.

⚠️ Verifying on production means touching **real** data. Restrict it to a brand-new record or a
designated test record — never someone else's live record.

## Transition ids — record yours

| Status | Id | Notes |
|---|---|---|
| In Progress | | set unprompted at step 2 |
| Code Review | | set at MR creation, step 10 |
| Deployed to staging | | waits on the developer's word |
| Staging verified | | yours to assert, after real verification |
| On production | | waits on the developer's word |
| Production verified | | yours to assert |

A transition being *global* means it is reachable from any status — still fetch the list rather than
trusting a remembered id.
