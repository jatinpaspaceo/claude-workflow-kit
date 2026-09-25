/**
 * Ticket verification video — headless Playwright template (claude-workflow-kit, dev-workflow).
 * =====================================================
 *
 * WHY HEADLESS AND NOT A SCREEN GRAB:
 * recordVideo captures the page compositor, so nothing outside the browser can ever appear in the
 * file. A screen/region grab (x11grab, or a desktop recorder) captures whatever is frontmost on the
 * screen — on a desktop in active use that means Teams, VS Code, terminals and client work can land
 * in a file destined for Jira. That has actually happened: two takes recorded a terminal session
 * instead of the browser. Go straight to headless for anything script-driven.
 *
 * USAGE
 *   export BASE_URL=https://staging.example.com
 *   export LOGIN_EMAIL=<your test account>
 *   export LOGIN_PASSWORD=<its password>
 *   node record-verification-headless.js PROJ-1234                 # voice + subtitles (default)
 *   node record-verification-headless.js PROJ-1234 --no-subtitles  # voice only
 *   node record-verification-headless.js PROJ-1234 --no-audio      # silent, no subtitles
 *   Login form: LOGIN_PATH (default /login), LOGIN_EMAIL_SELECTOR (#email),
 *   LOGIN_PASSWORD_SELECTOR (#password), LOGIN_SUBMIT_SELECTOR (button[type="submit"]).
 *
 * Writes:  <VIDEO_DIR>/<TICKET>.mp4   (h264 + aac narration + burned-in subtitles)
 *          <VIDEO_DIR>/srt/<TICKET>.srt   (the same subtitles as a file; narrated runs only)
 * Needs:   ffmpeg on PATH, plus a cached playwright-core + chromium (auto-resolved below —
 *          any previous `npx playwright` run on this machine will have left both).
 *          Narration needs edge-tts (`pip3 install --target ~/.claude-workflow-kit/pylib edge-tts`)
 *          and network access.
 *          If either is missing, the run STOPS (2026-09-25) — pass --no-audio for a silent video.
 *
 * NARRATION (see the writing guide in section 3):
 *   say:       spoken while the card is up. Plain spoken English, no HTML.
 *              Missing or '' → that card is silent. Card text is NEVER read out on its own
 *              (changed 2026-09-24): whatever is spoken leaves the machine, so it must be written on purpose.
 *   sayAfter:  (steps only) spoken over the LIVE screen after act/show — point the viewer at
 *              what is highlighted and say what it proves. This is where most explaining happens.
 *   beats:     (steps only, added 2026-09-25) the screen FOLLOWS the voice. Each beat = one
 *              sentence: a visible cursor glides to `point`, outlines it, then types/clicks, while
 *              `say` is spoken; the next beat starts when the sentence ends. See section 3.
 * Every hold is stretched to fit its voice clip. Subtitles are burned into the picture,
 * sentence by sentence, timed to the voice — so a muted Jira preview still explains itself.
 * 🛑 `say` text is sent to Microsoft's speech service: ticket ids and feature descriptions only,
 *    never customer names, emails or record data.
 *
 * WHAT TO EDIT: only TITLE / STEPS / SUMMARY and the login selectors, if yours differ.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

// ---------------------------------------------------------------------------
// 0. Inputs
// ---------------------------------------------------------------------------

const TICKET = process.argv[2];
if (!TICKET || !/^[A-Z]+-\d+$/.test(TICKET)) {
  console.error('usage: node record-verification-headless.js <TICKET>   e.g. PROJ-1234');
  process.exit(1);
}

const BASE = (process.env.BASE_URL || '').replace(/\/+$/, '');
const EMAIL = process.env.LOGIN_EMAIL;
const PASSWORD = process.env.LOGIN_PASSWORD;
if (!BASE) {
  console.error('set BASE_URL to the app you are verifying, e.g. https://staging.example.com');
  process.exit(1);
}
if (!EMAIL || !PASSWORD) {
  console.error('set LOGIN_EMAIL and LOGIN_PASSWORD in the environment (never hardcode them here)');
  process.exit(1);
}

// Flat folder, all tickets, all dates together. Override with VIDEO_DIR.
// VIDEO_DIR, else $TASK_DOCS_DIR/videos, else ~/task-notes/videos.
const VIDEO_DIR = process.env.VIDEO_DIR
  || path.join(process.env.TASK_DOCS_DIR || path.join(os.homedir(), 'task-notes'), 'videos');
const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'verifyvid-'));

const VIEWPORT = { width: 1600, height: 900 };

// Narration (added 2026-09-23). recordVideo never captures sound, so voice clips are made with
// edge-tts before recording and mixed into the mp4 afterwards at each card's start time.
// Fixed install path, not __dirname: copies live beside the task MD, where there is no .pylib, and a
// __dirname lookup there silently fell back to a silent video (found 2026-09-24).
const TTS_PYLIB = process.env.TTS_PYLIB
  || [path.join(__dirname, '.pylib'), path.join(os.homedir(), '.claude-workflow-kit/pylib')]
    .find((d) => fs.existsSync(d))
  || path.join(os.homedir(), '.claude-workflow-kit/pylib');
const TTS_VOICE = process.env.TTS_VOICE || 'en-US-AriaNeural';
// check-verification-video.sh accepts an audio stream ONLY when this tag is present, so room
// noise or a desktop recorder's audio is still rejected. Keep the two in sync.
const NARRATION_TAG = 'verify-tts-narration';
let NARRATE = !process.argv.includes('--no-audio');
const SUBTITLES = !process.argv.includes('--no-subtitles');

// ---------------------------------------------------------------------------
// 1. Locate a cached playwright-core and chromium
//    (this repo deliberately has no Node toolchain, so we reuse the npx cache)
// ---------------------------------------------------------------------------

/**
 * Scan a cache root, NEWEST entry first — readdir order is not version order, and
 * picking an older build silently is worse than failing. (On this machine both
 * chromium-1178 and chromium-1228 exist; the working recordings used 1228.)
 */
function findNewest(globRoot, matcher) {
  if (!fs.existsSync(globRoot)) return null;
  const entries = fs.readdirSync(globRoot)
    .map((name) => ({ name, ver: parseInt((name.match(/(\d+)$/) || [])[1] || '0', 10) }))
    .sort((a, b) => b.ver - a.ver);
  for (const { name } of entries) {
    const hit = matcher(path.join(globRoot, name));
    if (hit) return hit;
  }
  return null;
}

const PW_CORE = process.env.PW_CORE || findNewest(
  path.join(os.homedir(), '.npm/_npx'),
  (dir) => {
    const p = path.join(dir, 'node_modules/playwright-core');
    return fs.existsSync(p) ? p : null;
  },
);

// Pass executablePath explicitly: the npx-cached builds often want a
// chromium_headless_shell-* version that was never downloaded.
const CHROME = process.env.PW_CHROME || findNewest(
  path.join(os.homedir(), '.cache/ms-playwright'),
  (dir) => {
    if (!path.basename(dir).startsWith('chromium-')) return null;
    for (const rel of ['chrome-linux64/chrome', 'chrome-linux/chrome']) {
      const p = path.join(dir, rel);
      if (fs.existsSync(p)) return p;
    }
    return null;
  },
);

if (!PW_CORE || !CHROME) {
  console.error('could not locate a cached playwright-core / chromium.');
  console.error('  playwright-core:', PW_CORE || 'NOT FOUND (set PW_CORE)');
  console.error('  chromium:       ', CHROME || 'NOT FOUND (set PW_CHROME)');
  console.error('fix: run `npx playwright install chromium` once, or set the two vars above.');
  process.exit(1);
}

const { chromium } = require(PW_CORE);

// ---------------------------------------------------------------------------
// 2. The card overlay — injected INTO the page so it dims the app behind it
//    and reads as part of the product. Accent colour #efad52 (amber); change it to your brand's.
// ---------------------------------------------------------------------------

const CARD_JS = `
window.__C = function (t, a, b) {
  var o = document.getElementById('__vc'); if (o) o.remove();
  var d = document.createElement('div'); d.id = '__vc';
  d.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:rgba(26,26,26,.94);'
    + 'display:flex;flex-direction:column;align-items:center;justify-content:center;'
    + 'font-family:Arial,Helvetica,sans-serif;text-align:center;padding:0 8%;';
  d.innerHTML = '<div style="color:#efad52;font-size:38px;font-weight:700;margin-bottom:20px;">' + t + '</div>'
    + '<div style="color:#fff;font-size:21px;line-height:1.5;margin-bottom:12px;">' + (a || '') + '</div>'
    + '<div style="color:#c9c9c9;font-size:17px;line-height:1.5;">' + (b || '') + '</div>';
  document.body.appendChild(d);
  var p = document.getElementById('__vp'); if (p) p.style.visibility = 'hidden';
};
window.__X = function () {
  var o = document.getElementById('__vc'); if (o) o.remove();
  var p = document.getElementById('__vp'); if (p) p.style.visibility = 'visible';
};
`;

/**
 * Visible cursor (added 2026-09-25). recordVideo never draws the real mouse, so this draws an
 * arrow in the page. Installed with addInitScript, so it is there on every page load, and it
 * keeps its last position across navigations (sessionStorage). Used by step.beats only.
 */
const CURSOR_JS = `
(function () {
  if (window.__P) return;
  var SVG = '<svg width="28" height="28" viewBox="0 0 28 28"><path d="M4 2 L4 22 L9.5 17 L13 25 '
    + 'L16.5 23.5 L13 15.8 L20 15.8 Z" fill="#fff" stroke="#1a1a1a" stroke-width="1.6" '
    + 'stroke-linejoin="round"/></svg>';
  function pos() { try { return JSON.parse(sessionStorage.getItem('__vp') || 'null'); } catch (e) { return null; } }
  function el() {
    var c = document.getElementById('__vp');
    if (!c && document.body) {
      var p = pos() || { x: innerWidth / 2, y: innerHeight / 2 };
      c = document.createElement('div'); c.id = '__vp'; c.innerHTML = SVG;
      // the arrow's tip is at (4,2) inside the svg, so offset the box to put the tip on the point
      c.style.cssText = 'position:fixed;left:' + (p.x - 4) + 'px;top:' + (p.y - 2) + 'px;'
        + 'z-index:2147483646;pointer-events:none;transition:left .7s ease-in-out,top .7s ease-in-out;'
        + 'filter:drop-shadow(0 2px 3px rgba(0,0,0,.45));';
      document.body.appendChild(c);
    }
    return c;
  }
  window.__P = {
    move: function (x, y, ms) {
      var c = el(); if (!c) return;
      c.style.transitionDuration = (ms / 1000) + 's';
      c.style.left = (x - 4) + 'px'; c.style.top = (y - 2) + 'px';
      try { sessionStorage.setItem('__vp', JSON.stringify({ x: x, y: y })); } catch (e) {}
    },
    click: function () {
      var p = pos(); if (!p) return;
      var r = document.createElement('div');
      r.style.cssText = 'position:fixed;left:' + (p.x - 14) + 'px;top:' + (p.y - 14) + 'px;width:28px;'
        + 'height:28px;border-radius:50%;border:3px solid #efad52;z-index:2147483646;'
        + 'pointer-events:none;transition:transform .5s,opacity .5s;';
      document.body.appendChild(r);
      requestAnimationFrame(function () { r.style.transform = 'scale(2.2)'; r.style.opacity = '0'; });
      setTimeout(function () { r.remove(); }, 600);
    },
    mark: function (e) {   // amber outline on the beat's element; the previous beat's is removed
      document.querySelectorAll('[data-vh]').forEach(function (o) {
        o.style.outline = o.getAttribute('data-vh'); o.removeAttribute('data-vh');
      });
      if (!e) return;
      e.setAttribute('data-vh', e.style.outline || '');
      e.style.outline = '3px solid #efad52'; e.style.outlineOffset = '2px';
    },
  };
  // after a page load, bring the cursor back where it was (only once beats have used it)
  document.addEventListener('DOMContentLoaded', function () { if (pos()) el(); });
})();
`;

/** Outline detail-view rows whose <th> label matches, so the eye lands on them. */
const highlightRows = (labels) => `
Array.from(document.querySelectorAll('.detail-view tr')).forEach(function (r) {
  var th = r.querySelector('th'); if (!th) return;
  if (${JSON.stringify(labels)}.indexOf(th.textContent.trim()) !== -1) {
    r.style.outline = '2px solid #efad52'; r.style.background = '#fff8ec';
  }
});
`;

// ---------------------------------------------------------------------------
// 3. ►►► EDIT THIS ◄◄◄  The walkthrough.
//
//     Shape: title card → per-step card → live screen with the relevant
//     bits highlighted → … → summary card.  ~4-5s per card, ~5s per live
//     hold. Five steps lands around 85 seconds.
//
//     Bug fix  → show the previously-broken case now working.
//     Feature  → walk the main path a reviewer would try first.
//
//     WRITING THE NARRATION — explain, don't label. Someone who never read the ticket should
//     understand the video with the sound on, or from the subtitles with it muted.
//       TITLE.say     what was asked for, who asked / why, where it is being verified.
//       step.say      what we are about to do, and what the viewer should expect to see.
//       step.sayAfter what is on screen right now: name the highlighted thing, say what it
//                     proves, and mention the before-state for a bug fix.
//       SUMMARY.say   each thing that was proven, and that nothing was left behind.
//     2-3 short sentences each (~15s of voice). Short sentences = readable subtitles.
// ---------------------------------------------------------------------------

const TITLE = {
  heading: `${TICKET} &mdash; <feature name>`,
  line2: 'What was requested, in one line',
  line3: 'Scope &middot; where this was verified',
  say: `This video verifies ticket ${TICKET.replace('-', ' ')}. `
    + 'The request was to <say what was asked for, in plain words>. '
    + 'It was verified on <environment>, logged in as <role>, and each step below shows one part of the change.',
};

const STEPS = [
  {
    heading: 'Step 1 &mdash; <what this shows>',
    line2: 'The change, with <b>key terms</b> in bold',
    line3: 'Why it matters to whoever reads the ticket',
    goto: '/<page-under-test>',
    // Runs after the card is removed. Highlight what the step is proving.
    show: highlightRows(['<Row label>', '<Another label>']),
    hold: 5200,
    say: 'In step one, we open <the page>. '
      + 'We are checking that <the thing this step proves>, because <why it matters to the user>.',
    sayAfter: 'Here is <the page>. The highlighted <rows or fields> show <what is now correct>. '
      + 'Before this change, <what used to happen>.',
  },
  // ... more steps. Anything Playwright can do is fair game — see the example
  //     script for form fills, saves, navigation races and cleanup.
  //
  // BEATS — the screen follows the voice, one sentence per beat (preferred for explaining a flow):
  // {
  //   heading: 'Step 2 &mdash; Find a record', line2: '...', goto: '/<list-page>',
  //   say: 'In step two, we search for a record by name.',
  //   beats: [
  //     { point: 'input[name="search"]', type: 'ABC',
  //       say: 'First, we type A B C in the name search box.' },
  //     { point: '#results tbody tr:first-child', waitFor: '#results tbody tr',
  //       say: 'The list now shows only records whose name matches.' },
  //     { point: 'a[title="View Record"]', click: true,
  //       say: 'Opening the first one shows its saved details.' },
  //     { waitFor: '#record-detail', when: 'after',      // a RESULT: spoken once the page is up
  //       say: 'The detail page is now open, with the record name at the top.' },
  //   ],
  // },
  // Beat keys: point (CSS selector; cursor glides there and outlines it — highlight:false skips
  // the outline), type (text typed into it), click (true = click it, with a ripple), run (async
  // (page) => {...} for anything else), waitFor (selector to wait for after the action), hold (ms,
  // for a beat with no say / with --no-audio; default 2500), when ('during' = default: the sentence
  // plays WHILE the beat acts — "Now we press Save"; 'after' = the sentence plays once the actions
  // have finished — use it for a RESULT, e.g. after a reload: "The page now shows the error").
  // The run prints ⚠ TIMING for a beat that sat >4s with no voice, or whose actions ran >2s past
  // the end of its sentence. 🛑 click and type are REAL: on a
  // create/edit form, block the save first (see ticket-workflow step 13), exactly as for act.
];

const SUMMARY = {
  heading: 'All items verified',
  line2: 'One line listing what was proven',
  line3: 'Any test data created was deleted &mdash; environment left as found',
  say: 'That completes the verification. <List each thing that was proven, one short sentence each>. '
    + 'No test data was left behind, so the environment is exactly as it was before.',
};

// ---------------------------------------------------------------------------
// 4. Driver — you should not need to touch anything below.
// ---------------------------------------------------------------------------

/** Seconds of audio in a file, via ffprobe. */
const mediaSeconds = (f) => parseFloat(execFileSync('ffprobe', [
  '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f,
]).toString().trim());

/** "00:00:04,137" -> 4137 */
const srtMs = (t) => { const [h, m, x] = t.split(':'); const [sec, ms] = x.split(',');
  return ((+h * 60 + +m) * 60 + +sec) * 1000 + +ms; };

/** edge-tts writes sentence-level SRT cues alongside the mp3. */
function readCues(file) {
  return fs.readFileSync(file, 'utf8').trim().split(/\r?\n\r?\n/).map((b) => {
    const l = b.split(/\r?\n/); const [a, z] = l[1].split(' --> ');
    return { s: srtMs(a), e: srtMs(z), text: l.slice(2).join(' ') };
  });
}

let clipN = 0;
/** One mp3 + its cues for a piece of text. */
function makeVoice(text) {
  const base = path.join(TMP_DIR, `say-${clipN++}`);
  execFileSync('python3', ['-m', 'edge_tts', '--voice', TTS_VOICE, '--text', text,
    '--write-media', `${base}.mp3`, '--write-subtitles', `${base}.srt`],
  { env: { ...process.env, PYTHONPATH: TTS_PYLIB }, stdio: ['ignore', 'ignore', 'pipe'] });
  return { clip: `${base}.mp3`, ms: Math.ceil(mediaSeconds(`${base}.mp3`) * 1000),
    cues: readCues(`${base}.srt`) };
}

/**
 * Make every voice clip BEFORE recording, so each hold can be stretched to fit. Any failure
 * (edge-tts missing, offline) turns narration off for the whole run → silent video, as before.
 */
function prepareNarration(cards, steps) {
  if (!NARRATE) return;
  try {
    cards.forEach((c) => {
      if (c.say) c.voice = makeVoice(c.say);   // no `say` → silent card
    });
    steps.forEach((st) => {
      if (st.sayAfter) st.afterVoice = makeVoice(st.sayAfter);
      (st.beats || []).forEach((b) => { if (b.say) b.voice = makeVoice(b.say); });
    });
    console.log(`narration: ${clipN} clip(s), voice ${TTS_VOICE}, subtitles ${SUBTITLES ? 'on' : 'off'}`);
  } catch (e) {
    // Stop, don't fall back (changed 2026-09-25): a silent video should only exist when someone
    // asked for one. The old fallback printed one ⚠ line that was easy to scroll past.
    console.error('✖ narration failed:', String(e.stderr || e.message).trim().split('\n').pop());
    console.error(`  edge-tts needs network (run with the sandbox off) and a .pylib (looked in ${TTS_PYLIB}).`);
    console.error('  Install once: pip3 install --target ~/.claude-workflow-kit/pylib edge-tts');
    console.error('  For a silent video on purpose, re-run with --no-audio.');
    process.exit(1);
  }
  if (clipN === 0) {
    console.error('✖ no card has a `say` / `sayAfter` / beat `say` line, so the video would be silent.');
    console.error('  Write the narration (section 3), or re-run with --no-audio for a silent video.');
    process.exit(1);
  }
}

/** Every sentence on the VIDEO's timeline: each clip's cues shifted to when that clip plays. */
function timeline(placed) {
  const out = [];
  placed.forEach((p) => p.voice.cues.forEach((q, i, all) => {
    const end = i + 1 < all.length ? Math.min(q.e, all[i + 1].s) : q.e + 400;  // no overlap
    out.push({ s: p.atMs + q.s, e: p.atMs + end, text: q.text.replace(/\n/g, ' ') });
  }));
  return out;
}

/**
 * Keep the subtitles beside the video (added 2026-09-25): <VIDEO_DIR>/srt/<video name>.srt, same
 * base name as the mp4 (so PROJ-1234-2.mp4 → srt/PROJ-1234-2.srt and a re-take never overwrites).
 */
function writeSrt(placed, mp4) {
  const ts = (ms) => { const t = Math.max(0, Math.round(ms));
    const h = Math.floor(t / 3600000); const m = Math.floor(t / 60000) % 60;
    const sec = Math.floor(t / 1000) % 60; const r = t % 1000;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')},`
      + String(r).padStart(3, '0'); };
  const dir = path.join(path.dirname(mp4), 'srt');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${path.basename(mp4, '.mp4')}.srt`);
  fs.writeFileSync(file, `${timeline(placed)
    .map((c, i) => `${i + 1}\n${ts(c.s)} --> ${ts(c.e)}\n${c.text}\n`).join('\n')}`);
  return file;
}

/** ASS subtitle file: white text on a dark box, bottom centre, sized for the viewport. */
function writeAss(placed) {
  const ts = (ms) => { const cs = Math.max(0, Math.round(ms / 10));
    const h = Math.floor(cs / 360000); const m = Math.floor(cs / 6000) % 60;
    const sec = Math.floor(cs / 100) % 60; const c = cs % 100;
    return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(c).padStart(2, '0')}`; };
  const lines = timeline(placed).map((c) => `Dialogue: 0,${ts(c.s)},${ts(c.e)},Sub,,0,0,0,,`
    + c.text.replace(/[{}]/g, ''));
  const file = path.join(TMP_DIR, 'narration.ass');
  fs.writeFileSync(file, [
    '[Script Info]', 'ScriptType: v4.00+', `PlayResX: ${VIEWPORT.width}`, `PlayResY: ${VIEWPORT.height}`,
    'WrapStyle: 0', '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, '
      + 'Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, '
      + 'Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    // BorderStyle 3 = opaque box; the box colour is OutlineColour (&HAABBGGRR, 00 = opaque).
    'Style: Sub,DejaVu Sans,30,&H00FFFFFF,&H00FFFFFF,&H50000000,&H50000000,0,0,0,0,100,100,0,0,'
      + '3,10,0,2,160,160,38,1', '',
    '[Events]', 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    ...lines, '',
  ].join('\n'));
  return file;
}

(async () => {
  fs.mkdirSync(VIDEO_DIR, { recursive: true });
  prepareNarration([TITLE, ...STEPS, SUMMARY], STEPS);

  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const ctx = await browser.newContext({
    viewport: VIEWPORT,
    recordVideo: { dir: TMP_DIR, size: VIEWPORT },
    permissions: [],           // deny everything; see the geolocation note below
  });
  await ctx.addInitScript(CURSOR_JS);
  const page = await ctx.newPage();
  // The video starts roughly when the page is created, so clip offsets are measured from here.
  // Taken a little late, so voices can land ~100-300ms early; fine over a 4-5s card.
  const t0 = Date.now();
  const placed = [];                  // [{ voice, atMs }] for the audio mix and subtitles
  const speak = (voice) => { placed.push({ voice, atMs: Date.now() - t0 }); return voice.ms + 600; };

  const card = async (c, hold = 4200) => {
    await page.evaluate(CARD_JS);
    await page.evaluate(([t, a, b]) => window.__C(t, a, b), [c.heading, c.line2, c.line3]);
    // never move on while the voice is talking
    if (NARRATE && c.voice) hold = Math.max(hold, speak(c.voice));
    await page.waitForTimeout(hold);
  };
  const uncard = () => page.evaluate(() => window.__X && window.__X());

  // Beats that spent a long time with no voice, or whose screen changed only after their sentence
  // ended. Printed at the end so a mismatch is caught before the video goes to Jira (2.3.0).
  const timingWarnings = [];
  const SILENT_WARN_MS = 4000;   // a beat with no voice that takes longer than this
  const OUTRUN_WARN_MS = 2000;   // a beat whose actions end this long after its sentence

  /**
   * One sentence at a time. Default (`when: 'during'`): start the voice, then glide the cursor,
   * outline, act — for sentences about what is being DONE ("Now we press Save").
   * `when: 'after'`: act first, then speak — for sentences about the RESULT ("The page reloads and
   * shows the answer"), so the voice never runs ahead of a slow reload or wait.
   */
  const runBeats = async (beats, label) => {
    for (const [i, b] of beats.entries()) {
      const where = `${label}, beat ${i + 1}`;
      const voiced = NARRATE && b.voice;
      const after = b.when === 'after';
      let talk = 0;
      let started = Date.now();
      if (voiced && !after) talk = speak(b.voice);
      const actStart = Date.now();
      let target = null;
      if (b.point) {
        target = page.locator(b.point).first();
        await target.scrollIntoViewIfNeeded({ timeout: 10000 });
        const box = await target.boundingBox();
        if (box) {
          await page.evaluate(([x, y]) => window.__P.move(x, y, 700),
            [box.x + Math.min(box.width / 2, 60), box.y + box.height / 2]);
          await page.waitForTimeout(750);
        }
        if (b.highlight !== false) await target.evaluate((e) => window.__P.mark(e));
      }
      if (target && b.type != null) {
        await target.click();
        await target.fill('');
        await page.keyboard.type(String(b.type), { delay: 90 });
      }
      if (target && b.click) {
        await page.evaluate(() => window.__P.click());
        await page.waitForTimeout(300);
        await target.click();
      }
      if (b.run) await b.run(page);
      if (b.waitFor) await page.waitForSelector(b.waitFor, { timeout: 20000 });
      const actMs = Date.now() - actStart;
      const s1 = (ms) => `${(ms / 1000).toFixed(1)}s`;
      if (!voiced && actMs > SILENT_WARN_MS) {
        timingWarnings.push(`${where}: ${s1(actMs)} with no voice (a wait probably timed out, or give it a say)`);
      } else if (voiced && !after && actMs > b.voice.ms + OUTRUN_WARN_MS) {
        timingWarnings.push(`${where}: the actions took ${s1(actMs)} but the sentence only ${s1(b.voice.ms)}, `
          + 'so the screen changed after the voice ended (use when: \'after\' for a result sentence, or shorten the wait)');
      }
      if (voiced && after) { started = Date.now(); talk = speak(b.voice); }
      if (!voiced) talk = b.hold || 2500;
      const left = talk - (Date.now() - started);
      if (left > 0) await page.waitForTimeout(left);
    }
  };

  // --- login. Not part of the story: get through it and get to the point.
  await page.goto(BASE + (process.env.LOGIN_PATH || '/login'), { waitUntil: 'load' });
  await page.fill(process.env.LOGIN_EMAIL_SELECTOR || '#email', EMAIL);
  await page.fill(process.env.LOGIN_PASSWORD_SELECTOR || '#password', PASSWORD);
  // Navigation race: a bare waitForLoadState after click() resolves too early and the
  // next goto() dies with net::ERR_ABORTED. Wait for the URL to leave /login.
  await Promise.all([
    page.waitForURL((u) => !String(u).includes('/login'), { timeout: 45000 }),
    page.click(process.env.LOGIN_SUBMIT_SELECTOR || 'button[type="submit"]'),
  ]);
  await page.waitForLoadState('load');
  if (page.url().includes(process.env.LOGIN_PATH || '/login')) throw new Error('login did not complete');
  console.log('logged in:', page.url());

  // --- title card
  if (STEPS[0] && STEPS[0].goto) {
    await page.goto(BASE + STEPS[0].goto, { waitUntil: 'domcontentloaded' });
  }
  await card(TITLE, 5200);

  // --- steps
  for (const step of STEPS) {
    if (step.goto) {
      await page.goto(BASE + step.goto, { waitUntil: 'domcontentloaded' });
      // Address inputs use onFocus="geolocate()", which makes Chrome show a
      // "wants to Know your location" bubble that covers the form. Playwright cannot
      // click browser chrome, so stub it in the page before focusing any address field.
      await page.evaluate(() => {
        try { navigator.geolocation.getCurrentPosition = function () {}; } catch (e) { /* noop */ }
      });
    }
    await card(step);
    await uncard();
    if (step.beats) await runBeats(step.beats, `Step ${STEPS.indexOf(step) + 1}`);
    if (step.act) await step.act(page);
    if (step.show) await page.evaluate(step.show);
    let live = step.hold || (step.beats ? 1200 : 5000);   // beats already paced themselves
    if (NARRATE && step.afterVoice) live = Math.max(live, speak(step.afterVoice));
    await page.waitForTimeout(live);
    // the cursor belongs to its beats: don't let it reappear on the next, beat-less step
    if (step.beats) {
      await page.evaluate(() => {
        try { sessionStorage.removeItem('__vp'); } catch (e) { /* noop */ }
        const p = document.getElementById('__vp'); if (p) p.remove();
      });
      // and park the real (invisible) mouse on the empty right edge, or its hover — a tooltip, a
      // highlighted row — carries over onto the next step's page
      await page.mouse.move(VIEWPORT.width - 6, VIEWPORT.height / 2);
    }
  }

  // --- summary card
  await card(SUMMARY, 5200);

  const video = page.video();
  await ctx.close();
  await browser.close();
  const webm = await video.path();
  console.log('webm:', webm);

  // --- transcode to h264 so Jira previews it. Even dimensions are mandatory for h264.
  const out = path.join(VIDEO_DIR, `${TICKET}.mp4`);
  const final = fs.existsSync(out)
    ? (() => {                      // never silently overwrite a verification
      let n = 2;
      while (fs.existsSync(path.join(VIDEO_DIR, `${TICKET}-${n}.mp4`))) n += 1;
      return path.join(VIDEO_DIR, `${TICKET}-${n}.mp4`);
    })()
    : out;

  const vArgs = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart'];
  if (NARRATE && placed.length) {
    // Each clip delayed to its card's start, mixed without level-halving, padded to video length.
    const inputs = placed.flatMap((p) => ['-i', p.voice.clip]);
    const delayed = placed.map((p, i) => `[${i + 1}:a]adelay=${p.atMs}|${p.atMs}[a${i}]`);
    const mix = `${placed.map((_, i) => `[a${i}]`).join('')}amix=inputs=${placed.length}`
      + ':normalize=0:dropout_transition=0,apad[aout]';
    execFileSync('ffmpeg', [
      '-y', '-i', webm, ...inputs,
      '-filter_complex', [...delayed, mix].join(';'),
      '-map', '0:v', '-map', '[aout]',
      ...(SUBTITLES ? ['-vf', `subtitles=${writeAss(placed)}`] : []), ...vArgs,
      '-c:a', 'aac', '-b:a', '96k', '-shortest',
      '-metadata', `comment=${NARRATION_TAG}`,
      final,
    ], { stdio: 'inherit' });
  } else {
    execFileSync('ffmpeg', ['-y', '-i', webm, ...vArgs, final], { stdio: 'inherit' });
  }

  // --- check frame: LOOK AT THIS before attaching anything to Jira.
  const frame = final.replace(/\.mp4$/, '-frame.png');
  execFileSync('ffmpeg', ['-y', '-ss', '3', '-i', final, '-frames:v', '1', frame],
    { stdio: 'inherit' });

  // --- audio check: the first narrated card must actually be audible.
  if (NARRATE && placed.length) {
    const p = placed[0];
    // volumedetect reports on stderr, hence spawnSync rather than execFileSync.
    const r = spawnSync('ffmpeg', ['-hide_banner', '-ss', String(p.atMs / 1000 + 0.5),
      '-t', '3', '-i', final, '-vn', '-af', 'volumedetect', '-f', 'null', '-']);
    const m = String(r.stderr).match(/max_volume: (-?[\d.]+) dB/);
    const db = m ? parseFloat(m[1]) : -91;
    console.log(`AUDIO: ${placed.length} clip(s); first at ${(p.atMs / 1000).toFixed(1)}s peaks ${db} dB`
      + (db > -30 ? '  ✔ audible' : '  ✖ SILENT — do not attach, check the mix'));
  }

  const srt = NARRATE && placed.length ? writeSrt(placed, final) : null;

  const kb = Math.round(fs.statSync(final).size / 1024);
  console.log(`\nVIDEO: ${final}  (${kb} KB)`);
  if (timingWarnings.length) {
    console.log(`\n⚠ TIMING: ${timingWarnings.length} beat(s) where the voice and the screen may not match:`);
    timingWarnings.forEach((w) => console.log(`  - ${w}`));
    console.log('  Watch those moments before attaching; fix the waits or the beat and re-record.');
  }
  console.log(`FRAME: ${frame}  <-- open it and confirm it shows the app`);
  if (srt) console.log(`SRT:   ${srt}`);
  console.log('\nNext: attach to Jira, VERIFY the attachment landed, then post a 2-4 line comment.');
})().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
