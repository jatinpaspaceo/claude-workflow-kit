#!/usr/bin/env bash
#
# Record a Jira verification video with the correct name and location.
#
#   record-verification.sh <PROJ>-3106                 # full screen
#   record-verification.sh <PROJ>-3106 --window        # click a window to record just that
#   record-verification.sh <PROJ>-3106 --duration 90   # auto-stop after 90s
#
# Unattended / automation-friendly targeting (no interactive click):
#   record-verification.sh <PROJ>-3106 --window-id 71303172
#   record-verification.sh <PROJ>-3106 --geometry 1600x900+76+127
#
# --window-id  takes the geometry from that window AND raises it first. Find the id with:
#                xdotool search --onlyvisible --name "Google Chrome for Testing"
#              (plain `search --name Chromium` matches a hidden 10x10 clipboard helper.)
# --geometry   records an explicit region — use this to capture a browser's VIEWPORT only,
#              excluding tab strip and URL bar. Compute it in the page:
#                x = window.screenX
#                y = window.screenY + (window.outerHeight - window.innerHeight)
#                w = window.innerWidth,  h = window.innerHeight
#
# Both force even width/height (h264 requires it). After recording, a check frame is written
# next to the video as <TICKET>-frame.png — LOOK AT IT. A region grab has no idea which window
# it is pointed at, so if the target was not on top you have recorded the wrong thing.
#
# Stop with Ctrl+C. Recording also stops automatically at --duration, or at the
# MAX_SECONDS safety cap below if no duration is given — so a forgotten or
# orphaned recording (e.g. terminal closed) cannot quietly fill the disk. The file is written to:
#   $TASK_DOCS_DIR/videos/<TICKET>.mp4      (override with VIDEO_DIR)
# A second recording for the same ticket becomes <TICKET>-2.mp4, then -3, etc.,
# so an existing verification is never silently overwritten.
#
# Then attach the .mp4 in a COMMENT on the Jira ticket — that is what makes it show
# up in the weekly release note (the release-note skill scans Jira comments and
# attachments for video files; a file left only on disk is invisible to it).

set -euo pipefail

TICKET="${1:-}"
shift || true

MODE=""
DURATION=""
WINDOW_ID=""
GEOMETRY=""
MAX_SECONDS=900          # 15 min hard cap when no --duration is given
MIN_SECONDS=2            # below this ffmpeg cannot estimate a frame rate

while [[ $# -gt 0 ]]; do
    case "$1" in
        --window)   MODE="--window"; shift ;;
        --window-id)
            WINDOW_ID="${2:-}"
            if [[ ! "$WINDOW_ID" =~ ^[0-9]+$ ]]; then
                echo "Refusing: --window-id needs a numeric X window id (got '${WINDOW_ID}')." >&2
                exit 1
            fi
            MODE="--window-id"; shift 2 ;;
        --geometry)
            GEOMETRY="${2:-}"
            if [[ ! "$GEOMETRY" =~ ^[0-9]+x[0-9]+\+[0-9]+\+[0-9]+$ ]]; then
                echo "Refusing: --geometry must look like 1600x900+76+127 (got '${GEOMETRY}')." >&2
                exit 1
            fi
            MODE="--geometry"; shift 2 ;;
        --duration|-t)
            DURATION="${2:-}"
            if [[ ! "$DURATION" =~ ^[0-9]+$ ]] || (( DURATION < MIN_SECONDS )); then
                echo "Refusing: --duration needs whole seconds >= $MIN_SECONDS (got '${DURATION}')." >&2
                exit 1
            fi
            shift 2 ;;
        *) echo "Unknown option: $1" >&2; exit 1 ;;
    esac
done

if [[ -z "$TICKET" ]]; then
    echo "Usage: $(basename "$0") <TICKET-ID> [--window | --window-id ID | --geometry WxH+X+Y] [--duration SECONDS]" >&2
    echo "Example: $(basename "$0") <PROJ>-3106" >&2
    echo "         $(basename "$0") <PROJ>-3106 --geometry 1600x900+76+127 --duration 120" >&2
    exit 1
fi

# Accept <PROJ>-1234 / <PROJ2>-123 style keys only — a typo'd name is worse than a refusal.
if [[ ! "$TICKET" =~ ^[A-Z]{2,10}-[0-9]{1,6}$ ]]; then
    echo "Refusing: '$TICKET' does not look like a Jira key (expected e.g. <PROJ>-3106)." >&2
    exit 1
fi

# Flat folder, all tickets, all dates together. Override with VIDEO_DIR if your
# Claude-Prompts folder lives somewhere else.
BASE="${VIDEO_DIR:-${TASK_DOCS_DIR:-$HOME/task-notes}/videos}"
mkdir -p "$BASE"

OUT="$BASE/$TICKET.mp4"
n=2
while [[ -e "$OUT" ]]; do
    OUT="$BASE/$TICKET-$n.mp4"
    n=$((n + 1))
done

DISP="${DISPLAY:-:0}"

if [[ "$MODE" == "--window" ]]; then
    command -v xdotool >/dev/null 2>&1 || {
        echo "--window needs xdotool (sudo apt install xdotool). Falling back to full screen." >&2
        MODE=""
    }
fi

if [[ "$MODE" == "--geometry" ]]; then
    # 1600x900+76+127 -> W H X Y
    W=${GEOMETRY%%x*}; rest=${GEOMETRY#*x}
    H=${rest%%+*};     rest=${rest#*+}
    X=${rest%%+*};     Y=${rest#*+}
    W=$((W - W % 2)); H=$((H - H % 2))
    GRAB=("-video_size" "${W}x${H}" "-i" "${DISP}+${X},${Y}")
    echo "Recording explicit region ${W}x${H} at +${X},${Y}"
    echo "NOTE: a region grab does not follow a window. Make sure the target is on top and stays there."
elif [[ "$MODE" == "--window-id" ]]; then
    command -v xdotool >/dev/null 2>&1 || { echo "--window-id needs xdotool." >&2; exit 1; }
    xdotool getwindowname "$WINDOW_ID" >/dev/null 2>&1 || {
        echo "Refusing: no window with id $WINDOW_ID." >&2; exit 1; }
    echo "Target window: $(xdotool getwindowname "$WINDOW_ID")"
    # Raise it first -- x11grab captures whatever occupies the region, not the window itself.
    xdotool windowactivate "$WINDOW_ID" 2>/dev/null || true
    sleep 1
    eval "$(xdotool getwindowgeometry --shell "$WINDOW_ID")"
    W=$((WIDTH - WIDTH % 2)); H=$((HEIGHT - HEIGHT % 2))
    GRAB=("-video_size" "${W}x${H}" "-i" "${DISP}+${X},${Y}")
    echo "Recording window ${W}x${H} at +${X},${Y}"
elif [[ "$MODE" == "--window" ]]; then
    echo "Click the window you want to record..."
    WID=$(xdotool selectwindow)
    xdotool windowactivate "$WID" 2>/dev/null || true
    sleep 1
    eval "$(xdotool getwindowgeometry --shell "$WID")"
    # x11grab needs even dimensions for h264
    W=$((WIDTH - WIDTH % 2)); H=$((HEIGHT - HEIGHT % 2))
    GRAB=("-video_size" "${W}x${H}" "-i" "${DISP}+${X},${Y}")
    echo "Recording window ${W}x${H} at +${X},${Y}"
else
    RES=$(xdpyinfo | awk '/dimensions:/{print $2}')
    GRAB=("-video_size" "$RES" "-i" "$DISP")
    echo "Recording full screen ($RES)"
    echo "NOTE: this captures your ENTIRE desktop. Close anything you don't want recorded."
fi

LIMIT="${DURATION:-$MAX_SECONDS}"
if [[ -n "$DURATION" ]]; then
    echo "Auto-stop after ${DURATION}s (or Ctrl+C)"
else
    echo "No --duration given: safety cap ${MAX_SECONDS}s. Ctrl+C to stop sooner."
fi
echo "Output: $OUT"
echo

# -crf 28 + preset veryfast keeps files small enough to attach to Jira.
# No audio: verification videos are visual, and it avoids capturing room noise.
ffmpeg -hide_banner -loglevel warning \
    -f x11grab -framerate 15 "${GRAB[@]}" -t "$LIMIT" \
    -c:v libx264 -preset veryfast -crf 28 -pix_fmt yuv420p \
    -movflags +faststart \
    "$OUT" || true

echo
if [[ -s "$OUT" ]]; then
    SIZE=$(du -h "$OUT" | cut -f1)
    DUR=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$OUT" 2>/dev/null | cut -d. -f1 || echo "?")
    echo "✔ Saved: $OUT  (${SIZE}, ${DUR}s)"

    # Write a check frame. A region grab records whatever was on screen, so the only way to
    # know the right window was captured is to look. Cheap insurance against a wasted take --
    # or worse, publishing a recording of something unintended.
    FRAME="${OUT%.mp4}-frame.png"
    if ffmpeg -v error -ss 3 -i "$OUT" -frames:v 1 "$FRAME" -y 2>/dev/null && [[ -s "$FRAME" ]]; then
        echo "  Check frame: $FRAME  <-- OPEN THIS and confirm it shows the app"
    fi
    echo
    echo "NEXT STEP — do not skip:"
    echo "  Attach this file in a COMMENT on $TICKET in Jira."
    echo "  https://${JIRA_HOST}/browse/$TICKET"
    echo "  Until it is on the ticket it is invisible to the weekly release note."
else
    echo "✖ Nothing recorded — $OUT is empty or missing." >&2
    rm -f "$OUT"
    exit 1
fi
