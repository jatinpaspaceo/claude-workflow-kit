# Changelog

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
