#!/usr/bin/env bash
# SessionStart hook — load the standing rules into context on every session.
#
# The rules used to be copied into <repo>/.claude/CLAUDE.md by install.sh. A plugin cannot do
# that (a CLAUDE.md at a plugin root is NOT read as project context), so we inject the same
# text here instead. That keeps the gates always-on rather than only-when-a-skill-looks-relevant.
#
# Emits: {"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"<gates.md>"}}
# Stays silent (exit 0, no output) on any problem — a broken hook must never block a session.

set -uo pipefail

GATES="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}/gates.md"
[[ -r "$GATES" ]] || exit 0

# JSON-encode the file. jq is preferred; python3 and perl are fallbacks so this works on a
# teammate's machine without assuming any one of them is installed.
if command -v jq >/dev/null 2>&1; then
  jq -n --rawfile ctx "$GATES" \
    '{hookSpecificOutput:{hookEventName:"SessionStart",additionalContext:$ctx}}'
elif command -v python3 >/dev/null 2>&1; then
  python3 -c '
import json, sys
with open(sys.argv[1], encoding="utf-8") as fh:
    ctx = fh.read()
json.dump({"hookSpecificOutput": {"hookEventName": "SessionStart",
                                  "additionalContext": ctx}}, sys.stdout)
' "$GATES"
elif command -v perl >/dev/null 2>&1; then
  perl -0777 -e '
use strict; use warnings;
binmode(STDOUT, ":encoding(UTF-8)");
open my $fh, "<:encoding(UTF-8)", $ARGV[0] or exit 0;
my $ctx = do { local $/; <$fh> };
$ctx =~ s/(["\\])/\\$1/g;
$ctx =~ s/\n/\\n/g;
$ctx =~ s/\r/\\r/g;
$ctx =~ s/\t/\\t/g;
print qq({"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"$ctx"}});
' "$GATES"
else
  # No JSON encoder available — say so once, in a form that is still valid context.
  printf '%s' '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"dev-workflow: install jq, python3 or perl so the MRS standing rules can load. Until then, invoke the ticket-workflow skill manually at the start of every ticket."}}'
fi

exit 0
