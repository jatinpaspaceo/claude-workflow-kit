#!/usr/bin/env bash
#
# Gate a verification video before it goes anywhere near the ticket.
#
#   check-verification-video.sh "$TASK_DOCS_DIR/videos/PROJ-1234-2.mp4"
#
# Exit 0 = safe to attach. Exit 1 = do not attach.
#
# WHY THIS EXISTS
# A screen-grab recording can capture the OS top bar, the dock, the browser's own chrome and a code
# editor -- and then go onto a ticket that other people read. It is easy to miss, because the manual
# check tends to be "is the app visible?" when it needs to be "is ONLY the app visible?".
#
# A screen grab and a Playwright recordVideo capture leave different fingerprints, so the wrong
# tool can be detected mechanically instead of by eye:
#
#   headless recordVideo -> exactly the viewport, 25 fps   (nothing outside the page CAN appear)
#   x11grab screen grab  -> a window/desktop rectangle, 15 fps as hardcoded in record-verification.sh
#
# This checks the fingerprint. It cannot see what is IN the frame -- so it is a floor, not a
# substitute for opening the check frame.

set -euo pipefail

FILE=""
ALLOW_SCREEN_GRAB=0
SILENT_OK=0

# --allow-screen-grab: for a walkthrough a PERSON recorded and has reviewed frame by frame.
# The team flow permits that (a manual demo is what a teammate without Node actually has), so
# the door exists -- but it is a door you have to open on purpose, and the checklist still prints.
while [[ $# -gt 0 ]]; do
    case "$1" in
        --allow-screen-grab) ALLOW_SCREEN_GRAB=1; shift ;;
        # --silent-ok: a video that is silent ON PURPOSE (recorded with --no-audio). A headless
        # video without narration otherwise fails: a silent video usually means a hand-rolled
        # recorder was used instead of the template.
        --silent-ok) SILENT_OK=1; shift ;;
        -*) echo "Unknown option: $1" >&2; exit 1 ;;
        *)  FILE="$1"; shift ;;
    esac
done

# The headless recorder's contract: 25 fps, viewport-sized, and no audio UNLESS it is the
# recorder's own TTS narration (tagged comment=verify-tts-narration).
#
# FPS is the load-bearing check. x11grab is hardcoded to 15 in record-verification.sh, and
# recordVideo always writes 25 -- so the frame rate alone separates the two tools.
#
# Resolution is only a hint, and must NOT be pinned to one size: clean recordings exist at
# several viewport sizes (1600x900, 1366x768, ...), and pinning one fails the others for no reason.
WANT_FPS=25
KNOWN_VIEWPORTS="1600x900 1366x768 1440x900 1280x720 1920x1080"

if [[ -z "$FILE" ]]; then
    echo "Usage: $(basename "$0") <video.mp4> [--silent-ok] [--allow-screen-grab]" >&2
    exit 1
fi

if [[ ! -s "$FILE" ]]; then
    echo "✖ $FILE is missing or empty." >&2
    exit 1
fi

command -v ffprobe >/dev/null 2>&1 || { echo "✖ ffprobe not on PATH." >&2; exit 1; }

probe() {
    ffprobe -v error -select_streams v:0 -show_entries "stream=$1" -of csv=p=0 "$FILE" 2>/dev/null | head -1
}

W=$(probe width)
H=$(probe height)
FPS_RAW=$(probe r_frame_rate)        # e.g. "25/1"
DUR=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$FILE" 2>/dev/null | cut -d. -f1)
AUDIO=$(ffprobe -v error -select_streams a -show_entries stream=index -of csv=p=0 "$FILE" 2>/dev/null | wc -l)
TAG=$(ffprobe -v error -show_entries format_tags=comment -of csv=p=0 "$FILE" 2>/dev/null)

# "25/1" -> 25. Integer division is fine: we only compare against a whole number.
FPS=$(( ${FPS_RAW%%/*} / ${FPS_RAW##*/} ))

FAIL=0
WARN_SIZE=0
note() { echo "  $1"; }

echo "Checking: $FILE"
echo "  ${W}x${H} @ ${FPS} fps, ${DUR:-?}s, $(du -h "$FILE" | cut -f1)"
echo

# A capture the exact size of the X display is the whole desktop, beyond argument.
if command -v xdpyinfo >/dev/null 2>&1; then
    SCREEN=$(xdpyinfo 2>/dev/null | awk '/dimensions:/{print $2}' || true)
    if [[ -n "$SCREEN" && "${W}x${H}" == "$SCREEN" ]]; then
        echo "✖ ${W}x${H} is exactly this display's size -- that is a full-desktop capture."
        FAIL=1
    fi
fi

# Not a failure on its own: an unfamiliar size is usually just a different viewport. But an
# odd height is also what a browser window WITH its tab strip and URL bar looks like (e.g.
# 1600x1000) -- so it is worth a human glance.
if [[ " $KNOWN_VIEWPORTS " != *" ${W}x${H} "* ]]; then
    WARN_SIZE=1
fi

if (( FPS != WANT_FPS )); then
    echo "✖ Frame rate is ${FPS} fps, expected ${WANT_FPS}."
    note "15 fps is record-verification.sh's hardcoded x11grab rate -- this is a screen grab."
    FAIL=1
fi

NARRATED=0
SILENT_FAIL=0
if (( AUDIO > 0 )) && [[ "$TAG" == "verify-tts-narration" ]]; then
    NARRATED=1               # the headless recorder's own voice-over; nothing else sets this tag
elif (( AUDIO > 0 )); then
    echo "✖ File carries an audio stream that is not the recorder's TTS narration."
    note "Audio without the verify-tts-narration tag means room noise, or a desktop recorder was used."
    FAIL=1
fi

# A person's screen-grab walkthrough never has TTS, so --allow-screen-grab skips this.
if (( ! NARRATED )) && (( ! SILENT_OK )) && (( ! ALLOW_SCREEN_GRAB )); then
    echo "✖ No voice narration."
    note "Record from the template, which narrates by default:"
    note "  <dev-workflow plugin>/scripts/record-verification-headless.js"
    note "If this video is silent on purpose (--no-audio), re-run with --silent-ok."
    SILENT_FAIL=1
fi

if [[ -n "$DUR" ]] && (( DUR < 10 )); then
    echo "✖ Only ${DUR}s long -- too short to walk a reviewer through anything."
    FAIL=1
fi

if (( FAIL )) && (( ALLOW_SCREEN_GRAB )); then
    echo
    echo "⚠ Screen-grab fingerprint accepted because --allow-screen-grab was passed."
    echo "  Nothing about this file guarantees the desktop stayed out of frame. Before attaching,"
    echo "  scrub the WHOLE video and confirm every second shows only the app:"
    echo "    - no OS bar or clock, no dock or taskbar"
    echo "    - no browser tab strip, URL bar or window buttons"
    echo "    - no editor, terminal, chat window or notification popup"
    echo "  If any of those appear even briefly, the file is not usable -- re-record headlessly."
    exit 0
fi

# Checked after the screen-grab door: --allow-screen-grab must never excuse a missing voice
# on a headless video, and a silent headless video is not a screen grab.
if (( SILENT_FAIL )) && (( ! FAIL )); then
    echo
    echo "DO NOT ATTACH THIS FILE."
    exit 1
fi

if (( FAIL )); then
    echo
    echo "DO NOT ATTACH THIS FILE."
    echo "Re-record headlessly with Playwright recordVideo. Template:"
    echo "  <dev-workflow plugin>/scripts/record-verification-headless.js"
    echo
    echo "If a PERSON recorded this walkthrough by hand and has reviewed every frame,"
    echo "re-run with --allow-screen-grab to accept it deliberately."
    exit 1
fi

if (( NARRATED )); then
    echo "✔ Fingerprint is the headless recorder's: ${W}x${H} @ ${FPS} fps, TTS narration."
    note "Listen to it once: the voice should match each card."
else
    echo "✔ Fingerprint is the headless recorder's: ${W}x${H} @ ${FPS} fps, no audio (accepted by flag)."
fi
if (( WARN_SIZE )); then
    echo
    echo "⚠ ${W}x${H} is not one of the viewport sizes these recorders normally use"
    echo "  (${KNOWN_VIEWPORTS// /, }). Probably just a different viewport -- but confirm the"
    echo "  frame has no browser tab strip or URL bar in it, which is what an odd height can mean."
fi
echo
echo "STILL DO THIS BY EYE -- the fingerprint cannot see what is in the frame:"
echo "  Open the check frame and ask 'is ONLY the app visible?' -- no dock, no OS bar,"
echo "  no window chrome, no other application. Not merely 'is the app visible?'."
