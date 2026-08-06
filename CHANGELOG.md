# Changelog

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
