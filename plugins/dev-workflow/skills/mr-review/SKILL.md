---
name: mr-review
description: "Use when reviewing a GitLab Merge Request for your GitLab repos, or when /mr-review is invoked. Reviews the actual MR HEAD on GitLab (never local code), runs the convention-aware altitude checklist, produces a collapsible review doc with a Mergeable verdict, saves it to the review-docs folder, and (only after approval) posts to GitLab. Triggers on 'review this MR', an MR URL, or /mr-review."
user_invocable: true
---

# Merge Request self-review

A dedicated, convention-aware MR-review playbook. It reviews the **actual MR HEAD on GitLab**, walks the change at every altitude (not just the changed line), tags findings by severity, produces a collapsible review doc with an explicit **Mergeable** verdict, and — only after you approve — posts to GitLab.

> This skill is the review engine the project `CLAUDE.md` "MR Self-Review" rule calls for. Use it for **your own MRs** (self-review before reporting done) and for **reviewing teammates' MRs**. The only differences between those two cases are the saved-doc filename and comment tone — see **Output**.

## When to Use

- The user pastes a GitLab MR URL and asks for a review.
- Right after you create an MR (self-review is a standing rule — see project `CLAUDE.md`).
- The user invokes `/mr-review`.

---

## ⚙️ One-time setup (per developer)

Two values are personal. Set them once, at the top of this file or as env vars — **do not** copy a teammate's.

| Value | What it is | How to set |
|---|---|---|
| `REVIEW_DOCS_DIR` | Where review docs are saved | Your own notes folder, e.g. `~/task-notes` |
| `REVIEWER_SLUG` | Your short name, used in self-review filenames | e.g. `alice`, `bob`, `carol` |

```bash
REVIEW_DOCS_DIR="${REVIEW_DOCS_DIR:-$HOME/task-notes}"
REVIEWER_SLUG="${REVIEWER_SLUG:-$(whoami)}"
```

---

## 🔐 GitLab Access

- **GitLab host:** `${GITLAB_HOST}`
- **Token:** never hardcode one. Read the **live** token from the credentials git already uses.

```bash
GITLAB_HOST="${GITLAB_HOST}"

# Preferred: the current PAT git itself authenticates with (credential.helper = store)
GITLAB_TOKEN="${GITLAB_TOKEN:-$(grep -m1 'oauth2:' ~/.git-credentials 2>/dev/null | sed -E 's#.*://oauth2:([^@]+)@.*#\1#')}"

# Verify the token works before proceeding (never echo the token itself)
curl -s --header "PRIVATE-TOKEN: $GITLAB_TOKEN" "$GITLAB_HOST/api/v4/user" | head -c 300
```

If that returns nothing or `401`, **STOP and ask the user** for a fresh Personal Access Token
(GitLab → Preferences → Access Tokens, scope `api`). Hand-written `glpat-…` values go stale —
a token pasted into a doc months ago will 401 while `git push` keeps working, because git is
using a different, current one from `~/.git-credentials`.

**Never** write a token into any file, commit, MR comment, or Jira issue. Never echo its value.

You normally do not need a project id — everything is derived from the pasted MR URL. If a call does need one, set `${GITLAB_PROJECT_ID}` in your environment.

---

## 🔗 Parse the MR URL

The user pastes an MR URL like:
`${GITLAB_HOST}/${GITLAB_PROJECT_PATH}/-/merge_requests/35`

```bash
MR_URL="<paste-here>"
MR_IID=$(echo "$MR_URL" | grep -oE '/merge_requests/[0-9]+' | grep -oE '[0-9]+$')
PROJECT_PATH=$(echo "$MR_URL" | sed -E 's#^https?://[^/]+/##; s#/-/merge_requests/.*##')
PROJECT_ID_ENC=$(printf '%s' "$PROJECT_PATH" | sed 's#/#%2F#g')
echo "Project: $PROJECT_PATH  |  IID: $MR_IID"
```

Print the parsed values and confirm with the user before proceeding. If the URL doesn't match the pattern, ask for a re-paste.

---

## ⚠️ CRITICAL: Review the MR HEAD, never local code

**Non-negotiable.** Local working copy may be stale or divergent from what's being merged. Always review the MR HEAD SHA fetched from GitLab.

```bash
API="$GITLAB_HOST/api/v4/projects/$PROJECT_ID_ENC"

# 1. MR metadata (title, author, source/target branch, description, sha, diff_refs)
curl -s --header "PRIVATE-TOKEN: $GITLAB_TOKEN" "$API/merge_requests/$MR_IID"

# 2. HEAD SHA of the MR
HEAD_SHA=$(curl -s --header "PRIVATE-TOKEN: $GITLAB_TOKEN" "$API/merge_requests/$MR_IID" \
  | grep -oE '"sha":"[^"]+"' | head -1 | cut -d'"' -f4)

# 3. The diff / changed files
curl -s --header "PRIVATE-TOKEN: $GITLAB_TOKEN" "$API/merge_requests/$MR_IID/changes"

# 4. FULL file content at HEAD SHA (diffs hide context — pull whole files for substantial changes)
FILE_ENC=$(printf '%s' "common/models/Project.php" | sed 's#/#%2F#g')
curl -s --header "PRIVATE-TOKEN: $GITLAB_TOKEN" "$API/repository/files/$FILE_ENC/raw?ref=$HEAD_SHA"

# 5. Commits in the MR
curl -s --header "PRIVATE-TOKEN: $GITLAB_TOKEN" "$API/merge_requests/$MR_IID/commits"

# 6. Existing discussions — read these to AVOID duplicating prior review comments
curl -s --header "PRIVATE-TOKEN: $GITLAB_TOKEN" "$API/merge_requests/$MR_IID/discussions"
```

Record the full HEAD SHA — the review is pinned to it, and if the author pushes new commits they must re-request review.

---

## 📋 Review Workflow

1. **Fetch context** — metadata, description, linked ticket, commits, diff. Pull full file content for any file with substantial changes.
2. **Build understanding** — business intent; which models/controllers/views/migrations/configs are touched; and related files NOT in the MR that could be affected (callers, consumers, sibling migrations).
3. **Run the checklist at every altitude** (below). Don't skip categories — mark N/A explicitly.
4. **Optionally drive `/code-review`** on the fetched HEAD diff at high effort as a finding engine (fan out finder angles → verify), then fold its findings into the format below. The checklist here is the coverage guide; `/code-review` is the automated hunter.
5. **Verify every `file:line` before citing it** — re-open the raw file at HEAD SHA; never cite from memory of an earlier read.
6. **Categorize by severity**, write the review doc, save it, then (only after approval) post.

**Do NOT write to any shared DB to reproduce a scenario** — verify by code inspection (standing rule).

---

## 🧭 Review at every altitude

A clean diff can still be a bad MR. Walk the change top-down:

| Altitude | Lens | "Good practice?" question |
|---|---|---|
| **MR / process** | Scope & hygiene | One atomic, well-described change — or a grab-bag? |
| **Product** | End-user & UX | Would the actual end user find this usable, clear, complete? |
| **Domain** | Business correctness | Does it match the real roofing/commission requirement, not a dev assumption? |
| **Architecture** | Patterns, cross-file | Does it fit how the system is built? What's missing? |
| **Data** | Backward compat & safety | Will existing data and in-flight users/jobs survive this? |
| **Code** | Correctness, bugs, quality | Is the logic right and the code maintainable? |
| **Ops** | Config, observability, deploy | Can it be deployed, watched, and rolled back safely? |
| **Cross-cutting** | Security, perf, i18n, a11y, deps | Does it hold under load, attack, scale, and locale? |
| **Team** | Project guardrails & conduct | Does it respect this repo's rules — and is my feedback fair? |

When a change is fine as-is (e.g. intentional asymmetry — see Guardrails), **say so; don't manufacture findings.**

---

## ✅ Review Checklist

Run through every category. Mark N/A explicitly if it doesn't apply.

### 1. Correctness & Logic
- Does the code do what the MR/ticket says? All acceptance criteria covered?
- Off-by-one, wrong operators/conditions, loop/recursion/early-return correctness.
- Nullable/optional handled (null checks, `isset`, `empty`).
- Exceptions caught at the right level, not swallowed.
- Both happy path and error path correct.

### 2. Bugs & Edge Cases
- Empty array/string, zero, null inputs; large input / pagination boundaries.
- Concurrency / race conditions (especially financial/commission data).
- Timezone (app stores UTC internally); float-vs-decimal for money.
- Soft-delete flag respected in all queries (whatever your schema calls it).
- `try/catch` does meaningful recovery, not error-hiding.
- Rollback handled if a multi-step DB op fails midway.

### 3. Database & Migrations
- Follows the existence-check pattern from `CLAUDE.md` / `.claude/rules/migrations.md`.
- FKs wrapped in `try/catch`; exact FK type match (INT UNSIGNED).
- New columns nullable or defaulted (won't break existing rows); indexes on new FKs / hot columns.
- `safeDown` correct; migration name follows convention; data migrations idempotent.
- No `iCreatedBy` hardcoded; check-before-insert on seed data.
- Any schema change without a migration? Any model attribute used but missing from the table (or vice versa)? New column missing from `rules()`/`attributeLabels()`?
- Any heavy migration that should be a queue job.

### 4. Framework patterns — the examples below are Yii2; swap in your stack's equivalents
- Active Record used correctly (no raw SQL where AR works); relations via `hasOne`/`hasMany`.
- Eager loading (`with()`) to avoid N+1; `asArray()` for read-only large sets.
- Validation rules complete; `behaviors()` has auth filters where needed; CSRF on forms.
- No direct `$_POST`/`$_GET` — use `Yii::$app->request`. No `save(false)` bypassing validation.
- `use` statements, never inline `\common\models\...` namespaces.

### 5. Security
- Input validated via AR rules/filters; parameterized queries only (no string concat).
- Output encoded (`Html::encode()`); no XSS.
- RBAC in `behaviors()` on all protected actions; auth on all AJAX endpoints.
- IDOR: object ownership checked before update/delete; base64 IDs decoded correctly.
- No secrets / `*-local.php` / `.env` in the diff.
- File upload: mime/extension/size validation, path-traversal safe; S3 perms correct (no public-by-default for sensitive files).
- No mass assignment without `safe` attributes.

### 6. Performance
- N+1 in loops (list views, PDFs); missing indexes on filtered/sorted/joined columns.
- Large sets loaded into memory instead of streamed; needless `SELECT *`.
- Expensive ops inside loops; cache for repeated expensive ops.
- Slow ops (emails, PDFs, S3) run as queue jobs; use `FORMAT_RAW` where cache expects it.

### 7. Code Quality
- Clear naming; single-responsibility methods; reasonable size.
- No dead/commented-out/debug code (`var_dump`, `print_r`, `console.log`, `dd()`); magic numbers → constants.
- DRY; comments only where non-obvious; unused `use` removed.

### 8. Frontend / Views
- No business logic in views; user strings escaped; forms have CSRF.
- Client validation matches server; responsive (mobile + desktop).
- AJAX handles errors gracefully; loading/disabled states on async actions.
- Shared modals: a modal ID (e.g. `#addcaamount`) may live in several views — grep before declaring a popup change done.

### 9. Tests
- Tests added/updated for new behavior; positive AND negative flows.
- Playwright for UI changes; no skipped/commented tests; assertions are meaningful.
- Test runbooks/QA aids must NOT live in the deployable tree.

### 10. Documentation & Communication
- MR description explains what and why; linked ticket; breaking changes called out; new env/config keys documented.

### 11. Cross-File & Mismatch
- Model ↔ migration alignment; controller action exists for every referenced view; route exists for every action.
- Email template IDs / queue job classes / RBAC permission names / translation keys / asset references all exist.
- FK references point to existing tables.

### 12. What's Missing?
Actively hunt for what SHOULD be there: migration for a new model (or vice versa), validation rules for new fields, soft-delete handling, `attributeLabels()`, audit/log on sensitive ops, email notification where the existing pattern sends one, permission check on a new action, transaction around multi-step writes, error handling around S3/SendGrid/external APIs, related list/index view updated to show the new field.

### 13. Unnecessary Files & Dev Artifacts (must not ship to servers)
The issue isn't disk — it's clutter, stale/duplicate content, and shipping internal notes (especially security write-ups). **Default: block the file; allow only if genuinely needed AND in the right place.**
- Block: `*_FIX.md`, `*_SUMMARY.md`, `*_ANALYSIS.md`, `*_IMPLEMENTATION*.md`, scratch/AI notes at repo root, files describing a security fix in detail, the same `.md` committed twice, dated backup dirs (`*_bak/`, `old_*`, `frontend_<date>/`).
- Allow but only under `docs/` (never root): operational setup ops actually uses, end-user guides / the docsify site, test runbooks (excluded from prod deploy), third-party `.md` inside `vendor/`.
- Recommend the durable fix once: exclude `*.md`, `docs/`, `tests/`, vendor docs at the **deploy** step.

### 14. MR Scope & Hygiene
- Atomic, single-purpose; diff matches stated scope (no opportunistic refactors/renames/reformatting riding along — mention them, don't fold them in).
- Title & description explain what/why, linked to a ticket; right size to review (request a split if 2,000 lines / 40 files).
- **Targets the correct branch** — feature `${FEATURE_BRANCH}` → MR to `${MR_TARGET_BRANCH}` (NOT master; confirm this month's milestone branch exists, don't default to last month's).
- Commit messages `[TICKET-ID] - description`, no AI attribution; no leftover debug; no merge-conflict markers.
- Commit scope: files split by page/feature; unrelated files not mixed even under the same ticket. No `CLAUDE.md` / `.claude/` / AI artifacts staged.

### 15. End-User & UX (lead with this)
- Solves the real problem end-to-end; all states handled (loading, empty, error, success, partial).
- User-facing messages clear and non-technical (no raw exceptions/stack traces); responsive; accessible (labels, `alt`, keyboard, contrast).
- No regression in adjacent flows; consistent with existing UI patterns (buttons, modals, date pickers, toasts). SweetAlert2: confirm `#efad52`, cancel `#6c757d` unless destructive.

### 16. Business / Domain Correctness
- Matches the requirement, not just "compiles." Re-read the ticket against behavior.
- Roofing-domain rules respected — commission math, payment terms, proposal/scope logic behave per the business rule.
- Bridge the domain gap: state "this is the business rule vs. this is what the code does" explicitly.
- Money/dates/quantities computed and rounded correctly; no float drift on currency.

### 17. Backward Compatibility & Data Safety
- Existing data survives (new NOT NULL columns have defaults/backfill; renamed/removed fields handled).
- Migrations reversible + existence-checked; FK changes in try-catch. No destructive migration without a backfill/rollback plan — flag data-dropping as Critical.
- Breaking changes (API shape, schema, removed routes) called out; consumers updated. In-flight users / queued jobs won't break mid-deploy (job payload shape changes).

### 18. Configuration, Secrets & Environment
- No secrets in the diff (keys, tokens, passwords, PATs). `params.php` / `*-local.php` roll forward by design — confirm intentional, **don't auto-revert** (env debug prints in `params.php` are intentional; don't propose removing them without asking).
- No hardcoded URLs / absolute paths / env assumptions — use params/config.
- New env/config keys documented and added to the non-local templates; feature flags default to a safe state.
- **PHP version safety — production runs PHP 8 (8.2/8.3 track).** Flag PHP-8 breakages: non-static methods called statically, removed `create_function`, `each()`, curly-brace string/array access, implicit-nullable params, etc. (Do NOT apply old 7.2/7.3 rules like "no array spread.")

### 19. Observability & Error Handling
- External calls (S3, SendGrid, Gemini/Claude, VAPI, any HTTP) wrapped with timeouts and failure handling.
- Failures degrade gracefully (sane user message, no silent 500); meaningful logging on critical ops but **no PII/secrets/tokens in logs**.
- No swallowed exceptions (`catch (\Exception $e) {}`); transactions around multi-step writes.

### 20. i18n, Dates & Timezones
- Dates display **MM/DD/YYYY** (project standard) — flag other formats.
- UTC stored internally, converted only for display; no naive local-time math. Currency/number formatting locale-consistent.

### 21. Dependencies & Third-Party
- New composer/npm dependency justified (not a library for a one-liner); version pinned; license OK; no known advisory.
- PHP 8-compatible; bundled/vendored files not hand-edited; no secret/tokenized URL sent to a third-party service (render locally).

### 22. Project guardrails (read BEFORE flagging)
- **Inconsistency ≠ defect.** A query/method that differs from its siblings is often intentional and load-bearing. **Ask (❓), don't "fix."** (e.g. contact-listing surfaces deliberately don't filter unlinked rows the way property surfaces do.)
- **Stay in scope** — don't request changes outside the MR's purpose; mention adjacent improvements as suggestions, not blockers. Only requested changes; no unrequested "improvements."
- **No personal/teammate names** in source/comments/docblocks/UI — those live in the MR description/commit/plan docs only. Flag any that leaked into code.
- **Ticket IDs (`[<PROJ>-NNNN]`) in code comments may be a project convention — do NOT flag them.** They appear in ~815 places across ~190 files by multiple authors, and the project rule (from an external reviewer's L3 finding on MR !4010, 2026-05-25) lists ticket IDs *first* among the references a comment SHOULD use, precisely because a maintainer can look them up. What a comment must never cite is something only the author can read — cite a ticket ID, commit SHA, or `file:line` instead. *(Corrected 2026-08-01: this guardrail previously banned ticket IDs outright and produced false findings on two MRs.)*
- **No hardcoded namespaces** (`use` statements). **Soft-delete** respected. **Base64 IDs** decoded correctly.
- **Never delete dead/legacy code or unused files** without explicit approval; don't modify files outside the active user flow.

### 23. Reviewer Conduct & Feedback Quality
- Every finding has a severity so the author knows blocker vs. nit; blocker-vs-preference explicit.
- Findings actionable: what's wrong, why it matters, a way to fix; cite verified `file:line`.
- Call out positives (✅). Prefer questions over accusations when intent is unclear.
- Don't rewrite the author's style for taste; respect pre-existing code from other authors.

---

## 🎯 Severity Levels

| Tag | Meaning |
|---|---|
| 🔴 **CRITICAL** | Must fix before merge — breaks prod, leaks data, corrupts state (SQLi, missing auth, data loss, broken migration, secret committed) |
| 🟠 **HIGH** | Should fix before merge — significant bug/risk (logic error, missing validation, N+1 on hot path, RBAC gap) |
| 🟡 **MEDIUM** | Fix this MR ideally — quality/maintainability (duplication, missing error handling, missing index) |
| 🔵 **LOW** | Nice to fix — minor |
| 🟢 **IMPROVEMENT** | Suggestion, not a defect |
| 💭 **NITPICK** | Preference, optional |
| ✅ **POSITIVE** | Done well — always call these out |
| ❓ **QUESTION** | Need clarification (assume asymmetry might be deliberate — §22) |

---

## 🔄 After a SELF-review: move the Jira ticket to `Code Review`

**Only for your own MR** — never when reviewing a teammate's, whose ticket status is theirs to drive.

Once the self-review is done, transition the ticket referenced by the MR to **`Code Review`
**. Unprompted — a status change is not a comment, so it carries the
same standing as setting `In Progress` when work starts.

- Read the current status first; if someone already moved it, do nothing.
- Fetch the transition list rather than trusting the id.
- `Code Review` means **"MR is open, waiting on review/merge."** The ticket leaves it at
  `${STATUS_ON_STAGING}`, on the developer's deploy word — never move it out yourself.
- **Why:** skipping it leaves the ticket at `In Progress` from implementation right through to deploy,
  so nothing on the board shows it is waiting on a reviewer. The team's normal path is
  `In Progress → Code Review → ${STATUS_ON_STAGING}`.

Full lifecycle context: the `ticket-workflow` skill.

## 📝 Output

**Two outputs for every review:**

1. **Chat** — render the full review using the template below.
2. **Saved doc** — write the same review to:
   `$REVIEW_DOCS_DIR/<YYYY-MM-DD>/<filename>`
   (create the dated folder if needed). This is the canonical record.

**Filename convention:**
- Reviewing **someone else's** MR → `mr-<MR_IID>-review.md`
- Reviewing **your own** MR (self-review) → `mr-<MR_IID>-review-<REVIEWER_SLUG>.md`
- **Re-review** of an MR you already reviewed → **append** a "Second/Third Review" section to the existing file, never overwrite.
- Responding to a review you **received** → `mr-<MR_IID>-review-response.md` (never edit the original).

**Doc conventions:** collapsible `<details>` sections with emoji `<summary><b>`; add `**Created:** <time>` (from system `date '+%Y-%m-%d %H:%M %Z'`) at top and a timestamp on each section; format every file reference as a clickable link `[/abs/path/file.php:NN](vscode://file/abs/path/file.php:NN)` with the full path as display text.

### Collapsible rules
- `<details open>` for 🔴 Critical, 🟠 High, ✅ Positives; `<details>` (collapsed) for the rest and all appendices.
- Each `<summary>` wraps an `<h2>` so GitLab's TOC picks it up.

### "Mergeable" verdict — REQUIRED in the summary block

| Findings present | Mergeable line | Verdict |
|---|---|---|
| Any 🔴 Critical | `**Mergeable**: ❌ No — <reason citing Critical IDs>` | ⛔ Block |
| Any 🟠 High (no Critical) | `**Mergeable**: ❌ No — <reason citing High IDs>` | ⚠️ Request Changes |
| Only 🟡 Medium and below | `**Mergeable**: ✅ Yes, with comments` | ✅ Approve with comments |
| Nothing above 🔵 Low + no open ❓ | `**Mergeable**: ✅ Yes` | ✅ Approve |

### Template

```markdown
# 🔍 MR Review: [MR Title]

**MR**: !<MR_IID> · **Branch**: `source` → `target` · **HEAD SHA**: `<short-sha>`
**Author**: @username · **Reviewed at**: YYYY-MM-DD HH:MM · **Files**: N · **Commits**: N

---
## 📊 Summary

| Severity | Count |
|----------|-------|
| 🔴 Critical | N |
| 🟠 High | N |
| 🟡 Medium | N |
| 🔵 Low | N |
| 🟢 Improvements | N |
| 💭 Nitpicks | N |
| ❓ Questions | N |
| ✅ Positives | N |

**Mergeable**: ✅ Yes / ✅ Yes, with comments / ❌ No — <reason>
**Verdict**: ⛔ Block / ⚠️ Request Changes / ✅ Approve with comments / ✅ Approve
**TL;DR**: one or two sentences.

---
<details open><summary><h2>🔴 Critical Issues</h2></summary>

### C1. [Title] — [/abs/path/file.php:LINE](vscode://file/abs/path/file.php:LINE)
**Category**: Security / DB / Logic
**Problem**: what's wrong and why it matters.
**Current code**: ```php … ```
**Suggested fix**: ```php … ```
**Why**: impact.
</details>

<details open><summary><h2>🟠 High Priority</h2></summary> … </details>
<details><summary><h2>🟡 Medium</h2></summary> … </details>
<details><summary><h2>🔵 Low</h2></summary> … </details>
<details><summary><h2>🟢 Improvements</h2></summary> … </details>
<details><summary><h2>💭 Nitpicks</h2></summary> … </details>
<details><summary><h2>❓ Questions for the Author</h2></summary> … </details>
<details open><summary><h2>✅ What's Done Well</h2></summary> … </details>

<details><summary><h2>🗄️ Database & Migration Review</h2></summary> … </details>
<details><summary><h2>🔒 Security Review</h2></summary> (table: Input validation / SQLi / XSS / RBAC / upload / secrets) </details>
<details><summary><h2>⚡ Performance Review</h2></summary> … </details>
<details><summary><h2>🧪 Test Coverage</h2></summary> … </details>
<details><summary><h2>🔗 Cross-File & Mismatch Checks</h2></summary> … </details>
<details><summary><h2>🕳️ What Seems Missing</h2></summary> … </details>
<details><summary><h2>📁 Files Changed</h2></summary> (table: File | +/− | Notes, files as clickable links) </details>

---
## 🎬 Next Steps for the Author
1. Address 🔴 Critical (block merge) 2. Address 🟠 High 3. Reply to ❓ 4. Consider 🟡 5. Push & re-request.

*Reviewed against HEAD SHA `<full-sha>` — if you push new commits, request re-review.*
```

---

## 📤 Posting to GitLab (only after explicit approval)

**Never auto-post.** Confirm with the user first. When posting:

- **Strip severity emoji/labels from the GitLab comment body** (🔴/🟠/🟡 + Critical/Important/Suggestion). Those live in the saved doc only — posted comments use plain, actionable prose. (MRS convention.)
- If reviewing your **own** MR, the saved doc is often enough; post only if the user asks.

```bash
# Single summary comment (strip severity prefixes from $BODY first)
curl -s --request POST --header "PRIVATE-TOKEN: $GITLAB_TOKEN" \
  --header "Content-Type: application/json" \
  --data "{\"body\": \"<review markdown, severity prefixes removed>\"}" \
  "$API/merge_requests/$MR_IID/notes"
```

For **inline** comments on a specific line, use `/discussions` with `position` referencing the HEAD SHA:

```bash
curl -s --request POST --header "PRIVATE-TOKEN: $GITLAB_TOKEN" \
  --header "Content-Type: application/json" \
  --data '{
    "body": "<comment>",
    "position": {
      "base_sha": "<diff_refs.base_sha>",
      "start_sha": "<diff_refs.start_sha>",
      "head_sha": "<diff_refs.head_sha>",
      "position_type": "text",
      "new_path": "path/to/file.php",
      "new_line": 42
    }
  }' "$API/merge_requests/$MR_IID/discussions"
```

To embed screenshots, `POST /projects/:id/uploads` returns a `markdown` snippet — embed it in the body.

---

## 🛑 What NOT to Do

- ❌ Review against the local working copy — always the MR HEAD SHA.
- ❌ Skip checklist categories without marking N/A.
- ❌ Flag style preferences as Critical/High.
- ❌ Approve while Critical issues exist, even if the author insists.
- ❌ Include AI attribution anywhere.
- ❌ Post to GitLab without explicit user approval, or leave severity prefixes in a posted comment.
- ❌ Omit the `**Mergeable**` line, or skip saving the dated doc.
- ❌ `git commit`/`git push` anything — this skill reviews, it never commits (standing hard-stop rule).
- ❌ Write to any shared DB to reproduce a scenario — verify by code inspection.
- ❌ Hardcode, echo, or paste a GitLab token anywhere — read it from `~/.git-credentials`.
- ❌ "Fix" an intentional inconsistency (§22) — ask instead.
