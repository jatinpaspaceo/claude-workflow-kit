---
name: analyze-video-issue
description: "Use when the user provides a video file (screen recording, bug recording, demo video) and wants to analyze it for issues, bugs, or UI problems. Triggers on phrases like 'analyze this video', 'find issues in video', 'video bug report', 'create task from video', 'what's wrong in this recording', or when the user provides a video file path and asks to identify problems."
user_invocable: true
---

# Analyze Video for Issues & Create Plan

This skill takes a video file (screen recording of a bug, UI issue, or feature gap), extracts key frames, analyzes them visually, identifies issues, and creates a structured plan MD file following the project's `docs/plans/` format.

## Prerequisites

- `ffmpeg` must be installed for frame extraction
  ```bash
  sudo apt install ffmpeg -y
  ```

## Input

The user will provide:
1. **Video file path** — Path to the video file (`.mp4`, `.webm`, `.mov`, `.avi`)
2. **Module name** (optional) — Which module/feature the video is about (e.g., "property", "contacts", "dashboard")
3. **Brief context** (optional) — What the video is showing

## Process

### Step 1: Validate Video File

1. Check if the video file exists at the given path
2. Check if `ffmpeg` is installed. If not:
   ```bash
   sudo apt install ffmpeg -y
   ```
3. Get video metadata (duration, resolution):
   ```bash
   ffprobe -v quiet -print_format json -show_format -show_streams VIDEO_PATH
   ```
4. Report to user:
   ```
   Video Info:
     File:       filename.mp4
     Duration:   X seconds
     Resolution: WxH
   ```

### Step 2: Extract Key Frames

Extract frames at regular intervals to capture the full video content.

**Strategy based on video duration:**
- Under 10 seconds: Extract 1 frame per second
- 10-30 seconds: Extract 1 frame every 2 seconds
- 30-60 seconds: Extract 1 frame every 3 seconds
- Over 60 seconds: Extract 1 frame every 5 seconds

**Maximum: 20 frames** (to stay within analysis limits)

Create a temporary directory for frames:
```bash
mkdir -p /tmp/video-analysis-frames
```

Extract frames using ffmpeg:
```bash
ffmpeg -i VIDEO_PATH -vf "fps=1/INTERVAL" -q:v 2 /tmp/video-analysis-frames/frame_%03d.jpg
```

If too many frames are extracted (>20), keep only evenly spaced 20 frames and delete the rest.

### Step 3: Analyze Each Frame

Read each extracted frame using the Read tool (Claude can view images).

For each frame, identify:
- **What screen/page is shown** — Which page of the application
- **UI elements visible** — Buttons, forms, tables, modals, etc.
- **Potential issues** — Visual bugs, layout problems, broken UI, error messages, incorrect data, missing elements
- **User action** — What the user appears to be doing (clicking, scrolling, typing)
- **State changes** — What changed compared to the previous frame

Build a chronological timeline:
```
Frame 1 (0s): User is on the Properties list page. All looks normal.
Frame 2 (2s): User clicks "Add Property" button. Modal opens.
Frame 3 (4s): Form fields visible. ISSUE: "Address" field is overlapping the "City" field.
Frame 4 (6s): User submits form. ISSUE: Error toast appears but text is cut off.
...
```

### Step 4: Identify & Categorize Issues

From the frame analysis, compile a list of all issues found.

Categorize each issue:
- **BUG** — Something is broken/not working
- **UI** — Visual/layout problem
- **UX** — Usability issue, confusing flow
- **DATA** — Wrong data displayed, missing data
- **PERFORMANCE** — Slow loading, lag visible
- **MISSING** — Feature/element that should be there but isn't

For each issue, determine:
- **Severity**: Critical / High / Medium / Low
- **Where**: Which page/component/module
- **What**: Clear description of the problem
- **Expected**: What should happen instead
- **Frame reference**: Which frame(s) show the issue

### Step 5: Present Issues to User

Before creating the plan file, present findings to the user for review:

```markdown
## Issues Found in Video: [filename]

### Issue 1: [BUG] Form field overlap on Add Property modal
- **Severity:** High
- **Location:** Property → Add Property Modal
- **Description:** The Address field overlaps with the City field when the modal is opened
- **Expected:** Fields should be properly spaced with no overlap
- **Seen in:** Frame 3 (4s), Frame 4 (6s)

### Issue 2: [UI] Error toast text truncated
...
```

Ask the user using `AskUserQuestion`:
- **"Are these issues correct? Should I create the plan file?"**
  - Yes, create plan for all issues
  - Let me select which issues to include
  - I want to add more context first

### Step 6: Map Issues to Project Code

For each confirmed issue, search the codebase to find relevant files:

1. **Identify the route/page** — Search in `src/app/` for the relevant page
2. **Find the component** — Search in `src/components/` for the UI component
3. **Find validation** — Search in `src/lib/validations/` for related Zod schemas
4. **Find hooks** — Search in `src/hooks/` for related API hooks
5. **Find API calls** — Search in `src/api/generated/` for relevant endpoints

Use Glob and Grep to search:
```
Glob: src/app/dashboard/**/*{keyword}*
Grep: "ComponentName" in src/components/
```

### Step 7: Create Plan MD File

Create a plan file at `docs/plans/` following the project's standard format.

**File name:** `YYYY-MM-DD_HH-MM_video-issue-{module-name}.md`

**Template:**

````markdown
# Task: Fix Issues Found in Video — [Module Name]
**Date**: [YYYY-MM-DD]
**Time**: [HH:MM AM/PM]
**Module**: [module name]
**Video Source**: [video filename]

## Task Description
[Summary of issues found in the video analysis]

## Video Analysis Summary

### Timeline
| Time | Frame | Screen | Observation |
|------|-------|--------|-------------|
| 0s | Frame 1 | [page] | [what's shown] |
| 2s | Frame 2 | [page] | [what's shown] |
| ... | ... | ... | ... |

## Issues Found

### Issue 1: [Category] [Title]
- **Severity:** [Critical/High/Medium/Low]
- **Location:** [Page → Component]
- **Description:** [What's wrong]
- **Expected Behavior:** [What should happen]
- **Video Reference:** Frame X (Xs) - Frame Y (Ys)

### Issue 2: [Category] [Title]
...

## Current Understanding
[What was found after analyzing the project structure — existing pages, components, hooks, etc.]

## Plan

### Step 1: [Fix for Issue 1]
- **File:** `src/components/...`
- **Change:** [What to change]
- **Why:** [Brief explanation]

### Step 2: [Fix for Issue 2]
...

## Files to be Created/Modified
- [ ] `src/app/dashboard/...` — [what will be done]
- [ ] `src/components/...` — [what will be done]
- [ ] `src/lib/validations/...` — [what will be done]

## Pages/Routes Affected
| Route | Page File | Issue |
|-------|-----------|-------|
| `/dashboard/...` | `src/app/dashboard/.../page.tsx` | [issue] |

## Dependencies
- [Any packages or changes needed]

## Completion Status
- [x] Video analyzed
- [x] Issues identified
- [x] Plan created
- [ ] Code implemented
- [ ] Tested
- [ ] Task completed
````

### Step 8: Save Extracted Frames (Optional)

Ask the user if they want to keep the extracted frames:
- **Yes, save to project** — Move frames to `docs/plans/screenshots/` for reference
- **No, clean up** — Delete `/tmp/video-analysis-frames/`

### Step 9: Cleanup

Delete temporary frames if user didn't want to keep them:
```bash
rm -rf /tmp/video-analysis-frames
```

### Step 10: Present Final Summary

```markdown
## Analysis Complete

- **Video:** [filename] ([duration]s)
- **Frames analyzed:** [count]
- **Issues found:** [count] ([X] Critical, [Y] High, [Z] Medium, [W] Low)
- **Plan file:** docs/plans/YYYY-MM-DD_HH-MM_video-issue-module.md
- **Drive sync:** Run `npm run sync:plans` to upload to Google Drive
```

## Important Notes

1. **Frame extraction quality** — Use `-q:v 2` for high quality JPEG extraction
2. **Large videos** — Cap at 20 frames max to avoid overwhelming analysis
3. **Multiple issues** — Group related issues into a single plan step where possible
4. **Backend vs Frontend** — Clearly identify whether each issue needs frontend fix, backend fix, or both
5. **Always search code first** — Before suggesting fixes, find the actual files and understand current implementation
6. **Follow project patterns** — Fixes should use existing components from `src/components/ui/`, Zod schemas, React Hook Form, etc.
7. **Plan file format** — Must match the project's standard `docs/plans/` format as defined in CLAUDE.md
