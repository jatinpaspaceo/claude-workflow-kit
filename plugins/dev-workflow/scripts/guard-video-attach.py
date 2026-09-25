#!/usr/bin/env python3
"""PreToolUse hook (Bash): check a verification video BEFORE it is uploaded to the ticket.

Why: an agent can have the rule "record from the template, run the checker" and still skip both,
sending a silent, card-less screen capture of its QA run to the ticket. A written rule is not
enough, so the check runs at the one moment that matters: the upload. It does not care how the
video was made.

Fires when a Bash command mentions an `attachments` endpoint (e.g. Jira's) AND a video file
(.mp4/.webm/.mov/.mkv). For each such file it runs check-verification-video.sh (next to this
script); if any check fails, the command is BLOCKED (exit 2, reason on stderr, which Claude sees).

Deliberate exceptions, written into the command itself so they are visible in the transcript:
  VIDEO_SILENT_OK=1        the developer asked for a silent video  (checker --silent-ok)
  VIDEO_SCREEN_GRAB_OK=1   a person's own screen recording, reviewed frame by frame
                           (checker --allow-screen-grab)

Paths are resolved WITHOUT running anything from the command: ~ and $VAR / ${VAR} are expanded
from this process's environment only. A path that still cannot be found is looked up by file
name in the usual videos folders; if it is still missing the upload is blocked, because an
unchecked video is exactly what this guard exists to stop.

Any failure of the guard itself (bad JSON, no checker) lets the command through: a broken hook
must never block unrelated work.
"""
import json
import os
import re
import subprocess
import sys

VIDEO_RE = re.compile(r"""@?["']?([^\s"'=;|&<>()]+\.(?:mp4|webm|mov|mkv))\b""", re.I)


def video_dirs():
    home = os.path.expanduser("~")
    dirs = [os.environ.get("VIDEO_DIR"),
            os.path.join(os.environ.get("TASK_DOCS_DIR") or os.path.join(home, "task-notes"), "videos")]
    return [d for d in dirs if d and os.path.isdir(d)]


def resolve(raw):
    p = os.path.expanduser(os.path.expandvars(raw.lstrip("@").strip("'\"")))
    if os.path.isfile(p):
        return p
    name = os.path.basename(p)
    for d in video_dirs():
        cand = os.path.join(d, name)
        if os.path.isfile(cand):
            return cand
    return None


def main():
    try:
        data = json.load(sys.stdin)
    except Exception:
        return 0
    if data.get("tool_name") != "Bash":
        return 0
    cmd = (data.get("tool_input") or {}).get("command") or ""
    if "attachments" not in cmd.lower():
        return 0
    videos = sorted({m.group(1) for m in VIDEO_RE.finditer(cmd)})
    if not videos:
        return 0

    checker = os.path.join(os.path.dirname(os.path.realpath(__file__)), "check-verification-video.sh")
    if not os.access(checker, os.X_OK):
        return 0
    flags = []
    if re.search(r"\bVIDEO_SILENT_OK=1\b", cmd):
        flags.append("--silent-ok")
    if re.search(r"\bVIDEO_SCREEN_GRAB_OK=1\b", cmd):
        flags.append("--allow-screen-grab")

    problems = []
    for raw in videos:
        path = resolve(raw)
        if not path:
            problems.append(f"{raw}: file not found, so it cannot be checked. Use the video's absolute path.")
            continue
        try:
            r = subprocess.run([checker, path, *flags], capture_output=True, text=True, timeout=60)
        except Exception as e:  # checker could not run: do not block on our own failure
            print(f"guard-video-attach: checker did not run ({e}); not blocking", file=sys.stderr)
            continue
        if r.returncode != 0:
            why = [l.strip() for l in (r.stdout + r.stderr).splitlines() if l.strip().startswith("✖")]
            problems.append(f"{path}: " + ("; ".join(why) or "failed check-verification-video.sh"))

    if not problems:
        return 0
    print("BLOCKED: this uploads a verification video that fails check-verification-video.sh.\n"
          + "\n".join(f"  - {p}" for p in problems)
          + "\nRecord it from the plugin's template (ticket-workflow step 13: scripts/record-verification-headless.js),"
          " run the checker, then attach.\nIf the developer asked for a silent video, put VIDEO_SILENT_OK=1"
          " in the command; for a person's own reviewed screen recording, VIDEO_SCREEN_GRAB_OK=1.",
          file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main())
