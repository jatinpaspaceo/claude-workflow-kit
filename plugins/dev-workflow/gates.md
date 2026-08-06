# Standing rules for every ticket

These apply to **every** task in this repo. Read them as instructions, not background.

Values in `${BRACES}` are project-specific — they come from `PROJECT.md` at the root of the repo you
are working in, or from environment variables. **If one is not set, ask rather than guess.**

## Start of every ticket — do this unprompted

1. **Invoke the `ticket-workflow` skill** before touching anything. It carries the full lifecycle and
   the staging/QA procedure. Do not reconstruct the steps from memory.
2. **Read the ticket's current status first.** A teammate has often already moved it — if it is
   already where you would put it, do nothing.
3. **Move the ticket to `In Progress`.** First step, before any code or analysis write-up. Fetch the
   transition list (`GET /rest/api/3/issue/<KEY>/transitions`) rather than trusting a remembered id.
   *A status change does NOT authorise a ticket comment — that is a separate gate.*
4. **Write the task notes first**, with a `## Plan to Implement` section, then **stop and wait** for
   the developer to approve the plan. No code before that approval.

## 🛑 Hard gates — stop and wait, every single time

| Gate | Released only by |
|---|---|
| **Plan approval** — no code changes | The developer confirming the plan in the task notes |
| **Commit / push** | A literal "commit" / "push" **for this specific change**. "continue", "go ahead", "fix it", "proceed" are NOT authorization, and approval never carries over to the next change |
| **Create MR / PR** | A literal "create MR" / "open PR" / "submit for review". "commit and push" does NOT imply an MR |
| **Ticket comment** | Explicit approval — *except* the deploy-notification flow (see the skill), which is standing |
| **"deployed to staging" status** | The developer saying the code is on staging. Never infer it from a merged MR |
| **Writes to a shared DB / staging / production records** | Nothing. Verify by inspection instead — never INSERT/UPDATE to demonstrate something works |

## Branches, MRs, ticket ids

- Work stays on `${FEATURE_BRANCH}`. Don't split onto per-task branches unless asked.
- MR target = `${MR_TARGET_BRANCH}`. **Never** the repo's default branch unless that *is* the target —
  in many setups the default branch is a stale label outside the deploy flow. Ignore the MR URL that
  `git push` prints; it targets the default branch.
  **If `${MR_TARGET_BRANCH}` does not exist yet, STOP and ASK** — never silently pick another.
- MR title = the ticket summary **verbatim**. Set "delete source branch when merged" at creation.
- After creating any MR, **immediately self-review it with the `mr-review` skill** against the MR HEAD
  on the server, before reporting it done. Don't post the review publicly unless asked.
- **Then move the ticket to `Code Review`** — unprompted, same standing as `In Progress`. It means
  "MR is open, awaiting review/merge". Only for your own MRs — a teammate's status is theirs to drive.
- Deploy chain:
  `${FEATURE_BRANCH}` → `${MR_TARGET_BRANCH}` → `${INTEGRATION_BRANCH}` → `${STAGING_BRANCH}` → `${PREPROD_BRANCH}` → `${PROD_BRANCH}`
  Record in `PROJECT.md` whether these promote by CI/CD or by a manual pull — it changes what you may
  assume has happened.
- Transition ids are per-project. **Fetch them, never guess.** Record yours in `PROJECT.md`.
  The "on staging" status must land before the "staging verified" status.

## Two statuses, two owners

- **"deployed to staging"** is a *deploy* fact. Claude cannot observe a deploy → it waits on the
  developer's word.
- **"staging verified"** is a *verification* fact and Claude's to assert — earned by exercising the
  real code path on staging in a browser, plus a verification recording. Never from "the code looks
  right".

## Before claiming anything is done

- **Verify locally first** — a real run of the real app, not a test harness.
- Run the QA pass: lint every changed file → positive path → **at least 3 negative paths** (input
  boundaries, a different permission role, concurrent actions, empty/edge data) → fix everything
  found *now*, don't defer it to a follow-up MR → optimization sweep → report a `QA Pass` section.
- QA on a **fresh page load**, and register scripts the way the framework intends rather than inlining
  them, so a reload reproduces what you tested.
- Find **all** affected places — grep every sibling surface, resolve components and renamed payload
  keys, and report the coverage. One grep is not an audit.
- Schema changes go through a **migration** with existence checks for tables/columns/indexes/FKs and
  error handling on constraints. Never modify the database directly.

## Documentation and hygiene

- Every task gets a notes file at `$TASK_DOCS_DIR/<yyyy-mm-dd>/<task-name>.md`, updated **in the same
  response** as any code edit — never as a separate request. Include a `Staging URL:` line for every
  page touched.
- Reference files as full absolute clickable paths with line numbers:
  `[/abs/path/file.ext:319](vscode://file/abs/path/file.ext:319)`.
- Commit only related files, by explicit path — split by page/feature even within one ticket.
- **Never stage `CLAUDE.md`, `.claude/`, or any AI-assistant artifact.** No AI attribution in commit
  messages. Commit format: `[<PROJ>-1234] - Brief description`, then `- detail` bullets.
- Keep QA runbooks and test aids **out of a repo that deploys by pull** — anything tracked reaches
  staging and production.
- Make only the requested change. No unrequested improvements.
