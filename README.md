# claude-workflow-kit

A Claude Code **plugin marketplace** with one plugin, `dev-workflow`: the guardrails and review
routines that stop an agent from committing, pushing, opening MRs or moving ticket statuses on its own —
plus the skills that make its review and QA work actually verifiable.

Two commands to install:

```
/plugin marketplace add jatinpaspaceo/claude-workflow-kit
/plugin install dev-workflow@workflow-kit
```

If the install summary says `Run /reload-plugins to activate.`, run that.

---

## What you get

| Skill | What it does |
|---|---|
| `ticket-workflow` | The lifecycle: read the ticket → `In Progress` → plan → **wait for approval** → implement → 6-step QA → **wait for commit approval** → MR → self-review → staging verification → recording → client comment. Names who owns each status transition |
| `mr-review` | Reviews a GitLab MR against its **HEAD on the server**, never your local working copy. Runs an altitude checklist (correctness, removed behaviour, cross-file symmetry, security/RBAC, reuse, conventions), emits per-finding severities and a `Mergeable` verdict, and saves a review doc |
| `security-audit` | Stack-detecting security audit — NestJS, Express, Next.js, React, Django, Flask, FastAPI, Spring Boot, Laravel, Rails, Go, Rust, and general Node/Python/Java/PHP/.NET |
| `analyze-video-issue` | Turns a screen recording of a bug into a written, reproducible issue |
| `rlm` | Map-reduces a >100-file codebase across parallel agents without context rot |

Plus two scripts for the verification video (`ticket-workflow` step 13):

| Script | What it does |
|---|---|
| `scripts/record-verification-headless.js` | Template: title/step/summary cards over the app, voice narration with burned-in subtitles, a cursor that follows the voice (`beats`), an `.srt` beside the video, and a `⚠ TIMING` report when voice and screen drift apart |
| `scripts/check-verification-video.sh` | Checks a video before it is attached: headless fingerprint (25 fps, viewport size), and narration unless `--silent-ok` |

### The gates

`gates.md` is injected into context at **every session start** by a `SessionStart` hook, so the rules
are always on rather than only-when-a-skill-looks-relevant:

| Gate | Released only by |
|---|---|
| Plan approval | The developer confirming the plan |
| Commit / push | A literal "commit"/"push" **for this change** — "continue", "go ahead", "proceed" do not count, and approval never carries to the next change |
| Create MR / PR | A literal "create MR" — "commit and push" does not imply one |
| Ticket comment | Explicit approval |
| "Deployed to staging" status | The developer's word. Never inferred from a merged MR |
| Writes to a shared DB | Nothing. Verify by inspection |

If you have ever had an agent commit something you were still reading, that table is the reason this
plugin exists.

---

## Configure it

Nothing about your branches, board, hosts or stack is hardcoded. Copy the template into your own repo
and fill it in:

```bash
cp ~/.claude/plugins/*/dev-workflow/PROJECT.md.example ./PROJECT.md
```

Values in `${BRACES}` inside the skills come from there. Where a value is missing, the skills **ask**
instead of guessing — that is deliberate: a guessed target branch is how work lands on the wrong
release.

Optional environment:

```bash
export TASK_DOCS_DIR="$HOME/task-notes"     # where task notes and review docs go
export REVIEWER_SLUG="yourname"             # used in self-review filenames; defaults to $(whoami)
export GITLAB_TOKEN="…"                     # or let it resolve from your git credential helper
```

For `mr-review` against a self-hosted GitLab, set `GITLAB_HOST` in `PROJECT.md`.

---

## Requirements

- Claude Code with plugin support
- `jq`, `python3` **or** `perl` for the session-start hook. If none is present the hook degrades to a
  one-line notice instead of failing the session
- `git`, and API access to your GitLab / Jira for the skills that talk to them
- For verification videos (one-time, per machine):
  ```bash
  npx -y playwright@latest install chromium                  # Node + Playwright's chromium
  sudo apt install ffmpeg                                     # (macOS: brew install ffmpeg) — needs libass
  pip3 install --target ~/.claude-workflow-kit/pylib edge-tts # Microsoft neural voices, free, no key
  ```
  Overrides: `VIDEO_DIR` (default `$TASK_DOCS_DIR/videos`), `TTS_PYLIB`, `TTS_VOICE`
  (`en-US-AriaNeural`), `PW_CORE` / `PW_CHROME`, and `LOGIN_PATH` / `LOGIN_*_SELECTOR` for your login form.

## Updating

```
/plugin marketplace update
/plugin update dev-workflow
```

Releases are versioned in `.claude-plugin/marketplace.json`; see [CHANGELOG.md](CHANGELOG.md).

## Uninstalling

```
/plugin uninstall dev-workflow
```

Nothing is written into your project, so there is nothing else to clean up.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Provenance

These skills grew out of daily work on a private Yii2 codebase, then had every project-specific value
replaced with a placeholder. If something still reads as opinionated about branch naming or Jira
statuses, that is the origin showing — open an issue and it will be parameterised.

## License

MIT — see [LICENSE](LICENSE).
