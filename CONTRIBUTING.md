# Contributing

Issues and pull requests are welcome, especially "this still assumes your setup" reports.

## Adding or changing a skill

1. Skills live at `plugins/dev-workflow/skills/<name>/SKILL.md`. Supporting files sit alongside it.
2. Frontmatter needs `name` and `description`. The `description` is what Claude matches on, so write it
   as *when to use this*, with trigger phrases — not as a summary of what it does. Keep placeholders
   **out** of the description; they hurt matching.
3. Bump `version` in both `.claude-plugin/marketplace.json` and `plugins/dev-workflow/.claude-plugin/plugin.json`,
   and add a `CHANGELOG.md` entry. Without a bump, nobody receives the change.

## Keep it project-agnostic

This repo must not acquire anyone's specifics. No real hosts, project ids, ticket keys, transition ids,
document ids, email addresses, people's names, or `/home/<user>` paths. Anything project-shaped becomes a
`${PLACEHOLDER}` documented in `PROJECT.md.example`, and the skill **asks** when it is unset rather than
falling back to a default that happens to be right for one team.

## Testing before you open a PR

```bash
claude plugin validate ./plugins/dev-workflow
bash -n plugins/dev-workflow/scripts/*.sh
```

Then install it from your local checkout — the only way to catch a broken relative source:

```
/plugin marketplace add /path/to/your/claude-workflow-kit
/plugin install dev-workflow@workflow-kit
```

If you touched the hook, run `scripts/inject-gates.sh` directly. It must print valid JSON and exit 0
even when `gates.md` is missing and when no JSON encoder is installed.

## Never commit

Tokens or credentials of any kind — not even as a "team default" fallback. Scan before pushing:

```bash
grep -rInE '(glpat|ghp_|gho_|github_pat_|ATATT|xox|AKIA)[A-Za-z0-9_.-]{15,}' . --exclude-dir=.git
```
