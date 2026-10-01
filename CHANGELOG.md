# Changelog

## 1.2.2 — 2026-10-01

### Fixed
- `scripts/record-verification-headless.js` — the picture no longer runs ahead of the voice after a slow
  page. `recordVideo` only gets a frame when the screen changes, so the seconds a page spent waiting for
  the next page to load were **missing** from the video while the voice kept its clock time. A frame
  heartbeat (a 1 px, near-invisible element that animates forever on every page) keeps frames coming,
  so video time equals clock time; it also stops lost frames from making the title-card trim cut into
  the card
- Step 1 no longer reloads the first page: it is already open under the title card

### Added
- A length check after recording: `length check: recorded Ns, video Ns ✔`, or `✖ Ns MISSING` when more
  than 1 s of frames is missing
- `ticket-workflow` step 13: the length check must say `✔` before attaching

## 1.2.1 — 2026-10-01

### Fixed
- `scripts/record-verification-headless.js` — every verification video now opens on the title card.
  The recorder used to log in and open the first page inside the recording, so a slow first page
  (~30 s seen in practice) became a silent intro before the title card. The login and a first load of
  `STEPS[0].goto` now run in a separate context that does **not** record, and its session
  (`storageState`) is handed to the recording context. Because `recordVideo` starts when the page is
  created, the voice clock is taken when the title card is *painted*, and the raw video is trimmed by
  the gap at transcode, so voice, subtitles and picture stay aligned however slow the page is. The run
  prints `trim: first Ns`. A session that doesn't carry over (the page lands on `LOGIN_PATH`) fails as
  loudly as a bad login, and `LOGIN_PATH` is now also used when waiting for the login to finish

## 1.2.0 — 2026-09-25

### Added
- `scripts/guard-video-attach.py` — a `PreToolUse` hook on Bash. When a command uploads a video
  (`.mp4` / `.webm` / `.mov` / `.mkv`) to an `attachments` endpoint, it runs `check-verification-video.sh`
  on each file and **blocks** the command if any check fails, so a silent or hand-rolled recording can't
  reach the ticket even when the agent skipped the rule. Exceptions go in the command itself:
  `VIDEO_SILENT_OK=1`, `VIDEO_SCREEN_GRAB_OK=1`. A failure of the guard itself never blocks

### Changed
- `ticket-workflow` step 13 — explains the block and the two exceptions

## 1.1.0 — 2026-09-25

### Added
- `scripts/record-verification-headless.js` — headless verification-video template: title/step/summary
  cards over the app, voice narration (edge-tts) with burned-in subtitles, **beats** (a drawn cursor glides
  to each element and types/clicks while its sentence plays; `when: 'after'` for a sentence about a result),
  an `.srt` beside the video, and a `⚠ TIMING` report for beats that sat silent or outran their sentence.
  Stops instead of making a silent video unless `--no-audio`. Configured by env: `BASE_URL`,
  `LOGIN_EMAIL` / `LOGIN_PASSWORD`, `VIDEO_DIR` / `$TASK_DOCS_DIR`, `TTS_PYLIB`, `TTS_VOICE`
- `scripts/check-verification-video.sh` — checks a video before it is attached: headless fingerprint,
  and narration unless `--silent-ok`

### Changed
- `ticket-workflow` step 13 — record with the template (never a hand-rolled recorder), explain with beats,
  watch every `⚠ TIMING` line, and make a silent video only when the developer asks

## 1.0.0 — 2026-08-06

First public release.

### Added
- `dev-workflow` plugin with five skills: `ticket-workflow`, `mr-review`, `security-audit`,
  `analyze-video-issue`, `rlm`
- `gates.md`, injected into context by a `SessionStart` hook so the hard gates are always on
- `scripts/inject-gates.sh` — JSON-encodes the gates via `jq`, falling back to `python3` then `perl`,
  and degrades to a one-line notice rather than failing a session
- `scripts/record-verification.sh` — record a ticket verification video and attach it to Jira
- `PROJECT.md.example` — the per-repo configuration template every placeholder reads from

### Notes
- Derived from an internal team pack. Every project-specific value (git host, project ids, branch
  names, ticket-status ids, team roster, document ids, absolute paths) was replaced with a
  `${PLACEHOLDER}` before publishing
