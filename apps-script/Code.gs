/**
 * Workout Tracker — Google Apps Script backend.
 *
 * Deploy this script as a Web App (Deploy → New deployment → Web app,
 * "Execute as: Me", "Who has access: Anyone"). The deployment URL is
 * what the mobile app talks to.
 *
 * Expected sheet structure (same spreadsheet, two tabs):
 *
 *   Tab "Prescribed":
 *     A: Date (YYYY-MM-DD)   B: Exercise   C: Sets   D: Reps   E: Weight   F: Notes
 *
 *   Tab "Actuals":
 *     A: LoggedAt (ISO)   B: Date   C: Exercise   D: SetNumber   E: Reps   F: Weight   G: Notes
 *
 * ROMAN CHAT SETUP (Option A — paid Claude API):
 *   1. Get an API key at console.anthropic.com/settings/keys
 *   2. In this Apps Script editor: Project Settings (gear icon) →
 *      Script Properties → Add script property
 *      Name:  ANTHROPIC_API_KEY
 *      Value: sk-ant-api03-...
 *   3. Deploy → Manage deployments → edit → New version → Deploy.
 *      (You MUST deploy a new version any time you edit this file.)
 */

const PRESCRIBED_SHEET = 'Prescribed';
const ACTUALS_SHEET = 'Actuals';

// Use Claude Sonnet 5 — good enough for workout coaching, fast, and cheaper
// than Opus. Swap to 'claude-opus-4-8' for max quality (~5x cost).
const CLAUDE_MODEL = 'claude-sonnet-5';
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';

const ROMAN_SYSTEM_PROMPT = `You are Roman — Mike's personal strength coach. Not a generic chatbot. You know his history, his numbers, his injuries, his life, and his goals, and you use that context to give advice that fits his reality — no generic templates.

TONE & VOICE
Lead coaching responses with "Roman:" when giving direction, check-ins, or delivering a workout. Direct, no fluff, no sugarcoating. Push Mike when he needs it, adapt when life demands it. Never soft when he needs a push, never rigid when he needs a break. Avoid patronizing language ("let's take a step back," "let's pause," "you're not broken"). Clean, scannable formatting. Don't repeat the same emoji more than once or twice per conversation.

===================================================
MIKE DEWITT — COACHING CONTEXT DUMP
(current as of July 2026)
===================================================

PROFILE
Mike DeWitt. Age 35. Rockwall TX. Former USAFA football. 6'1", 221–224 lbs morning fasted. Goal: 210 lbs, 12–13% body fat. Currently estimated 14–15% body fat. Training since early 2025 on this program.

SCHEDULE
M/T/Th/F. 45–50 min sessions. Trains 5:30 AM garage gym. Two young kids (Leighton 3, Spencer infant) — sleep disruption is real, factor into intensity. Travels periodically for work.

CURRENT STRUCTURE — HIIT TRIAL (working well, keep it)
- Monday: Lower Strength
- Tuesday: Upper Strength
- Thursday: Dedicated HIIT (1 outdoor running block + 2 garage circuits)
- Friday: Full Body Strength
- **NEXT WEEK IS A PLANNED DELOAD**

GARAGE EQUIPMENT
Barbell, squat rack, dumbbells to 90 lbs, pull-up bar, kettlebells to 30 lb (heavier available), TRX, 24" box, bike. No trap bar, no sled.

EXERCISE RULES
- No pull-ups on consecutive training days
- No Bulgarian split squats on both Day 1 and Day 3
- Power cleans Friday only — once per week, arms too fatigued after upper block to catch well
- Move power cleans EARLY in Friday session before arm fatigue sets in
- No trap bar programming
- Sled = substitute sprints, shuttles, bike
- DB flat bench with 90s too easy — use barbell for heavy pressing
- Rotate movements regularly — Mike gets bored fast

INJURIES / FLAGS
- Plantar fasciitis (heel) — improving. PF PT protocol integrated every session
  - Warm-up: calf stretch straight leg + bent knee, short foot activation
  - Cool-down: eccentric calf raises, plantar fascia stretch, foot roll (lacrosse ball or frozen bottle)
- Back: recurring tightness. Currently 100%. When tweaked: avoid heavy hinging/cleans, sub front squat for back squat, bird dogs, dead bugs, glute bridges
- Morning stiffness: minimum 8 min warm-up always. Always include pushups in warm-up
- Hip and low back tightness with squats — warm-up critical

CURRENT STRENGTH NUMBERS — PERSONAL BESTS
- Back Squat: **315 lbs** (hit Monday July 2026 — felt easy, true max likely higher; test properly after deload)
- Bench Press: **255 lbs**
- Front Squat: **235 lbs**
- Power Clean: **185–195 lbs** (bar speed priority over load)
- Weighted Pull-Up: **BW + 20 lbs** (hitting 8/8/8/8 at BW)
- 1-Arm DB Row: **85 lbs**
- DB Shoulder Press: **60 lbs**
- Barbell Shoulder Press: **125 lbs**
- Barbell Curl: **80 lbs** (75 lbs last session — push back to 80)
- DB Incline Curl: **25 lbs** (30 too heavy currently)
- KB Single-Arm Clean to Press: **35 lb KB**
- Barbell Glute Bridge: **145 lbs**
- DB Walking Lunge: **2×40 lb DBs**
- Farmer Carry: **2×65 lb DBs**
- Barbell RDL: **185–190 lbs**
- Single-Leg/Single-Arm RDL: **70 lb DB**

CONDITIONING
- HIIT Thursday: 8 rounds × 20s sprint / 40s walk → garage circuit → second garage circuit
- Strength day conditioning: 8 min, 3–4 rounds, 30s on / 15–20s off
- Upper days get more cardio than lower days
- Mike likes: sprints, hill sprints, shuttles, bike intervals, jump rope, box jumps, KB swings, renegade rows, thrusters, broad jumps, burpees
- Does NOT have a sled — sub sprints or bike

TYPICAL HIIT THURSDAY STRUCTURE
- Phase 1 (12 min): 8 rounds × 20s sprint / 40s walk — outdoor
- Phase 2 (12 min): 3 rounds — Thruster 8 reps @ 95 lbs + Pull-Up 6 reps + KB Swing 15 reps + Box Jump 5 reps
- Phase 3 (11 min): 3 rounds — Broad Jump 5 reps + Renegade Row 6 ea @ 2×30 lbs + Jump Rope 45 sec + Burpee 8 reps
- Cool-down 5 min + full PF PT

NUTRITION SNAPSHOT
- Target: 2,350–2,500 cal/day, 200–220g protein
- Weekdays solid: post-workout shake, smoothie breakfast, protein lunch, afternoon snack, home-cooked dinner
- Weekends: biggest problem. Eggs/bacon breakfast (good), lunch out (okay), dinner out with heavy drinking (this wipes the weekly deficit)
- Alcohol: drinks most weekends, sometimes heavily. Strategy: max 3–4 drinks, tequila soda or light beer, water between drinks
- Steps: 8k minimum, 10k goal
- Collagen protein does NOT count toward functional protein targets

HABITS / PATTERNS
- Misses Tuesday most often — flag it and hold him accountable
- Travels periodically — have a DB-only or hotel gym program ready
- Comes back after misses consistently — not a quitter, manages real life
- Deloads when sick or run down — fever = full deload, run down = light week
- Scale stuck at 221–224 for months despite visible fat loss — body recomposition happening simultaneously
- Weekend diet is the #1 obstacle to fat loss, not training

COACHING STYLE MIKE RESPONDS TO
- Direct, no fluff, no sugarcoating
- Prescribed weights based on actual logged numbers — not suggestions
- Brief check-ins on back and energy before prescribing
- Acknowledge missed sessions briefly then move forward — no guilt
- Push progressive overload every session
- Rotate movements to prevent boredom
- Communicates via voice transcription — interpret phonetic approximations charitably

CURRENT WEEK STATUS (baseline — check the sheet for real-time state)
- Monday Day 1 complete: Back Squat 315 (new PR, felt easy), SL/SA RDL 70 lbs, KB Clean to Press 35 lb, Lunge 40 lbs, Glute Bridge 145 lbs, conditioning done
- Tuesday Day 2: PENDING (Upper Strength)
- Thursday Day 3: PENDING (HIIT)
- Friday Day 4: PENDING (Full Body Strength)
- NEXT WEEK = DELOAD WEEK

===================================================
LIVE DATA & TOOLS (in-app only — you have these, claude.ai Roman did not)
===================================================

You have live tool access to Mike's workout Google Sheet. The sheet is the SOURCE OF TRUTH for what's actually prescribed and what he's logged. The numbers in this prompt are baseline — if a specific weight, set, or history matters, CHECK THE SHEET first before quoting it.

Tools available:
- get_workout(date): prescribed exercises + logged sets for a specific YYYY-MM-DD
- get_recent_history(start_date, end_date): all logged sets across a date range
- set_prescribed(date, exercises): write/replace prescribed workout for a date
- log_set(date, exercise, reps, weight): append one working set

Rules for using tools:
- Mike asks about today, tomorrow, yesterday, or a specific date → CALL get_workout
- Mike asks about last week / progress / trends → CALL get_recent_history
- Mike asks you to plan / prescribe / write a workout → CALL set_prescribed
- When you set_prescribed, follow the CURRENT STRUCTURE above (Mon Lower, Tue Upper, Thu HIIT, Fri Full Body). Respect the exercise rules and injury flags every time.
- Mike tells you conversationally he did a set ("just hit 5 at 245 on bench") → CALL log_set
- NEVER invent numbers — read the sheet first
- If a tool result is empty, tell him honestly

PLAN ONE DAY AT A TIME UNLESS ASKED OTHERWISE. When Mike says "plan tomorrow" or "give me today's workout" or "let's do upper strength," call set_prescribed ONCE for that one day. Do not preemptively plan the rest of the week — that produces a big multi-tool-use response that risks getting cut off. If Mike explicitly asks for the whole week, call set_prescribed once per day sequentially (4 separate tool_use turns), not all in parallel.

GROUPING RULES (critical — Mike sees exercises grouped by block in the app):
Every prescribed exercise MUST have a "group" letter (A, B, C, ...). The group tells the app how to render blocks and supersets.
- Standalone strength lift → its own letter. Bench Press alone in Block A → group: "A".
- Superset / tri-set → all exercises share the same letter, listed in performance order.
  Example: Block B is a superset of Weighted Pull-Up + 1-Arm DB Row → both get group: "B".
- Conditioning finisher circuit (e.g. thrusters + KB swings + burpees performed as a round) → all share one letter.
- Assign letters in order: first block is A, next B, next C. Do not skip letters.

Weight strings for set_prescribed and log_set: accept "225", "BW", "BW + 20", "Bands", "RPE 8", or empty. Use the format that fits the movement.

Dates are always YYYY-MM-DD. Today's date is in the first user message — use it as the anchor for "yesterday," "next Monday," "this week," etc.
`;

function doGet(e) {
  try {
    const action = (e && e.parameter && e.parameter.action) || 'getWorkout';
    const date = (e && e.parameter && e.parameter.date) || todayIso_();

    if (action === 'getWorkout') {
      return json_({ ok: true, date: date, prescribed: readPrescribed_(date), actuals: readActuals_(date) });
    }
    if (action === 'getRecent') {
      const start = (e && e.parameter && e.parameter.start) || shiftIso_(todayIso_(), -60);
      const end = (e && e.parameter && e.parameter.end) || todayIso_();
      return json_({ ok: true, start: start, end: end, sets: readActualsRange_(start, end) });
    }
    if (action === 'ping') {
      return json_({ ok: true, pong: true });
    }
    return json_({ ok: false, error: 'Unknown action: ' + action });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

function shiftIso_(iso, days) {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + days);
  const tz = Session.getScriptTimeZone();
  return Utilities.formatDate(d, tz, 'yyyy-MM-dd');
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const action = body.action || 'logSet';

    if (action === 'logSet') {
      const row = appendActual_(body);
      return json_({ ok: true, row: row });
    }
    if (action === 'deleteSet') {
      const removed = deleteActual_(body);
      return json_({ ok: true, removed: removed });
    }
    if (action === 'chat') {
      const result = handleChat_(body);
      return json_({ ok: true, reply: result.reply, messages: result.messages });
    }
    return json_({ ok: false, error: 'Unknown action: ' + action });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

/* ================= Sheet helpers ================= */

function readPrescribed_(date) {
  const sheet = SpreadsheetApp.getActive().getSheetByName(PRESCRIBED_SHEET);
  if (!sheet) return [];
  const values = sheet.getDataRange().getValues();
  const out = [];
  for (let i = 1; i < values.length; i++) {
    const r = values[i];
    if (!r[0]) continue;
    if (normalizeDate_(r[0]) !== date) continue;
    out.push({
      exercise: String(r[1] || '').trim(),
      sets: Number(r[2]) || 0,
      reps: String(r[3] || '').trim(),
      weight: String(r[4] || '').trim(),
      notes: String(r[5] || '').trim(),
      group: String(r[6] || '').trim().toUpperCase(),
      rowIndex: i + 1,
    });
  }
  return out;
}

function readActuals_(date) {
  const sheet = SpreadsheetApp.getActive().getSheetByName(ACTUALS_SHEET);
  if (!sheet) return [];
  const values = sheet.getDataRange().getValues();
  const out = [];
  for (let i = 1; i < values.length; i++) {
    const r = values[i];
    if (!r[1]) continue;
    if (normalizeDate_(r[1]) !== date) continue;
    out.push({
      loggedAt: r[0] instanceof Date ? r[0].toISOString() : String(r[0]),
      date: normalizeDate_(r[1]),
      exercise: String(r[2] || '').trim(),
      setNumber: Number(r[3]) || 0,
      reps: Number(r[4]) || 0,
      weight: normalizeWeight_(r[5]),
      notes: String(r[6] || '').trim(),
      rowIndex: i + 1,
    });
  }
  return out;
}

// Weight can be a number (225), a string ("BW", "Bands", "BW+20"), or empty.
// Preserve strings as-is; return numbers as numbers so charts still work.
function normalizeWeight_(v) {
  if (v === '' || v === null || v === undefined) return 0;
  if (typeof v === 'number') return v;
  const s = String(v).trim();
  if (!s) return 0;
  const asNum = Number(s);
  return isNaN(asNum) ? s : asNum;
}

function readActualsRange_(startDate, endDate) {
  const sheet = SpreadsheetApp.getActive().getSheetByName(ACTUALS_SHEET);
  if (!sheet) return [];
  const values = sheet.getDataRange().getValues();
  const out = [];
  for (let i = 1; i < values.length; i++) {
    const r = values[i];
    if (!r[1]) continue;
    const d = normalizeDate_(r[1]);
    if (d < startDate || d > endDate) continue;
    out.push({
      date: d,
      exercise: String(r[2] || '').trim(),
      setNumber: Number(r[3]) || 0,
      reps: Number(r[4]) || 0,
      weight: normalizeWeight_(r[5]),
    });
  }
  out.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : a.setNumber - b.setNumber; });
  return out;
}

function appendActual_(body) {
  const sheet = SpreadsheetApp.getActive().getSheetByName(ACTUALS_SHEET);
  if (!sheet) throw new Error('Missing sheet: ' + ACTUALS_SHEET);
  // Weight can be numeric (225) or string ("BW", "Bands", "BW+20"). Keep numeric
  // when the user entered a number so charts still work; otherwise store text.
  let weight = body.weight;
  if (typeof weight === 'string') {
    const asNum = Number(weight.trim());
    weight = isNaN(asNum) || weight.trim() === '' ? weight : asNum;
  } else if (typeof weight !== 'number') {
    weight = 0;
  }
  const row = [
    new Date(),
    body.date || todayIso_(),
    body.exercise || '',
    Number(body.setNumber) || 0,
    Number(body.reps) || 0,
    weight,
    body.notes || '',
  ];
  sheet.appendRow(row);
  return { rowIndex: sheet.getLastRow() };
}

function deleteActual_(body) {
  const sheet = SpreadsheetApp.getActive().getSheetByName(ACTUALS_SHEET);
  if (!sheet) throw new Error('Missing sheet: ' + ACTUALS_SHEET);
  const rowIndex = Number(body.rowIndex);
  if (!rowIndex || rowIndex < 2) throw new Error('Invalid rowIndex');
  sheet.deleteRow(rowIndex);
  return { rowIndex: rowIndex };
}

function replacePrescribed_(date, exercises) {
  const sheet = SpreadsheetApp.getActive().getSheetByName(PRESCRIBED_SHEET);
  if (!sheet) throw new Error('Missing sheet: ' + PRESCRIBED_SHEET);
  // Ensure the Group header exists in column G for existing sheets.
  const header = sheet.getRange(1, 7).getValue();
  if (!header) sheet.getRange(1, 7).setValue('Group');
  const values = sheet.getDataRange().getValues();
  // Delete existing rows for this date, bottom-up so indices stay valid.
  for (let i = values.length - 1; i >= 1; i--) {
    if (values[i][0] && normalizeDate_(values[i][0]) === date) {
      sheet.deleteRow(i + 1);
    }
  }
  for (let j = 0; j < exercises.length; j++) {
    const ex = exercises[j] || {};
    sheet.appendRow([
      date,
      String(ex.exercise || '').trim(),
      Number(ex.sets) || 0,
      String(ex.reps || '').trim(),
      String(ex.weight || '').trim(),
      String(ex.notes || '').trim(),
      String(ex.group || 'A').trim().toUpperCase(),
    ]);
  }
  return { date: date, count: exercises.length };
}

/* ================= Roman chat (Claude proxy) ================= */

function handleChat_(body) {
  // Trim whitespace / newlines that often sneak in on copy-paste and cause
  // a spurious 401 "API key is invalid" from Claude.
  const rawKey = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
  const apiKey = rawKey ? String(rawKey).trim() : '';
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY not set. Open Apps Script Project Settings → Script Properties and add it.');
  }
  if (!/^sk-ant-/.test(apiKey)) {
    throw new Error('ANTHROPIC_API_KEY does not look like a valid Anthropic key (should start with "sk-ant-"). Re-check the value in Project Settings → Script Properties.');
  }

  // Sanitize incoming history: strip any orphan tool_use / tool_result blocks
  // that would make Claude reject the request. Corruption can happen if a prior
  // turn hit max_tokens mid-tool-use, or if the client's trim broke pairing.
  const priorMessages = sanitizeMessages_(
    Array.isArray(body.messages) ? body.messages.slice() : []
  );
  const userText = String(body.userMessage || '').trim();
  if (!userText) throw new Error('Empty message');

  const todayIso = body.today || todayIso_();
  const framedUserText = priorMessages.length === 0
    ? "(Today is " + todayIso + ".)\n\n" + userText
    : userText;

  const messages = priorMessages.concat([{ role: 'user', content: framedUserText }]);

  const tools = romanTools_();

  for (let iter = 0; iter < 10; iter++) {
    const resp = callClaude_(apiKey, messages, tools);

    if (resp.stop_reason === 'tool_use') {
      messages.push({ role: 'assistant', content: resp.content });
      const toolResults = [];
      for (let k = 0; k < resp.content.length; k++) {
        const block = resp.content[k];
        if (block.type !== 'tool_use') continue;
        let result;
        try {
          result = runTool_(block.name, block.input || {});
        } catch (err) {
          result = { error: String(err) };
        }
        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: JSON.stringify(result),
        });
      }
      messages.push({ role: 'user', content: toolResults });
      continue;
    }

    // If Claude got cut off by max_tokens mid-tool-use, DO NOT persist the
    // truncated assistant message — it would corrupt history for future turns.
    // Instead throw a clear error so the client can retry with a smaller ask.
    if (resp.stop_reason === 'max_tokens') {
      const hasUnclosedToolUse = resp.content.some(function (b) { return b.type === 'tool_use'; });
      if (hasUnclosedToolUse) {
        throw new Error('Response was cut off while generating tool calls. Try a smaller ask (e.g. one day at a time instead of a whole week).');
      }
    }

    // end_turn, max_tokens (text-only), refusal, etc.
    let text = '';
    for (let k = 0; k < resp.content.length; k++) {
      const block = resp.content[k];
      if (block.type === 'text') text += block.text;
    }
    if (!text && resp.stop_reason === 'refusal') {
      text = "I can't help with that one.";
    }
    messages.push({ role: 'assistant', content: resp.content });
    return { reply: text || '(no reply)', messages: messages };
  }

  throw new Error('Tool loop exceeded 10 iterations. Try a smaller ask.');
}

// Strip corrupted history blocks that would 400 at the Claude API. The API
// requires: every assistant tool_use is followed by a user tool_result, and
// every user tool_result is preceded by an assistant tool_use. Corruption can
// arrive here from a prior max_tokens truncation or from client-side trim.
function sanitizeMessages_(messages) {
  const cleaned = messages.slice();

  // Drop trailing assistant messages whose content includes any tool_use.
  // If the pair was complete we'd never truncate; if it's incomplete we drop it.
  while (cleaned.length > 0) {
    const last = cleaned[cleaned.length - 1];
    if (last && last.role === 'assistant' && Array.isArray(last.content) &&
        last.content.some(function (b) { return b.type === 'tool_use'; })) {
      // Peek ahead — this shouldn't happen at the tail, but if the "next"
      // is a matching tool_result we keep it. Since it's the last message,
      // there is no next → drop.
      cleaned.pop();
      continue;
    }
    break;
  }

  // Drop leading user messages that are purely tool_result (orphaned by trim).
  while (cleaned.length > 0) {
    const first = cleaned[0];
    if (first && first.role === 'user' && Array.isArray(first.content) &&
        first.content.length > 0 &&
        first.content.every(function (b) { return b.type === 'tool_result'; })) {
      cleaned.shift();
      continue;
    }
    break;
  }

  return cleaned;
}

function callClaude_(apiKey, messages, tools) {
  const payload = {
    model: CLAUDE_MODEL,
    // 16K is the safe non-streaming ceiling and gives Roman enough room to
    // emit multi-day plans with detailed tool_use blocks.
    max_tokens: 16384,
    system: ROMAN_SYSTEM_PROMPT,
    tools: tools,
    messages: messages,
  };
  const res = UrlFetchApp.fetch(ANTHROPIC_API_URL, {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });
  const code = res.getResponseCode();
  const bodyText = res.getContentText();
  if (code < 200 || code >= 300) {
    throw new Error('Claude API ' + code + ': ' + bodyText);
  }
  return JSON.parse(bodyText);
}

function romanTools_() {
  return [
    {
      name: 'get_workout',
      description: 'Read the prescribed workout and any logged sets for a specific date. Use for questions about "today", "tomorrow", "yesterday", or a specific date.',
      input_schema: {
        type: 'object',
        properties: {
          date: { type: 'string', description: 'Date in YYYY-MM-DD format' },
        },
        required: ['date'],
      },
    },
    {
      name: 'get_recent_history',
      description: 'Read all logged sets in a date range. Use for questions about training history, patterns, progression, or "last week".',
      input_schema: {
        type: 'object',
        properties: {
          start_date: { type: 'string', description: 'Start date YYYY-MM-DD (inclusive)' },
          end_date: { type: 'string', description: 'End date YYYY-MM-DD (inclusive)' },
        },
        required: ['start_date', 'end_date'],
      },
    },
    {
      name: 'set_prescribed',
      description: 'Write the prescribed workout for a date. Replaces any existing prescribed rows for that date. Use when Mike asks you to program or plan a workout. Group exercises into blocks using the "group" letter: same letter = same block / superset.',
      input_schema: {
        type: 'object',
        properties: {
          date: { type: 'string', description: 'Date YYYY-MM-DD' },
          exercises: {
            type: 'array',
            description: 'Ordered list of exercises for that day, in the order Mike should perform them.',
            items: {
              type: 'object',
              properties: {
                exercise: { type: 'string' },
                sets: { type: 'integer', description: 'Number of working sets' },
                reps: { type: 'string', description: 'e.g. "5" or "8-10" or "AMRAP"' },
                weight: { type: 'string', description: 'e.g. "225", "BW", "BW + 20", "Bands", or "RPE 8"' },
                notes: { type: 'string', description: 'Coaching cue or rest time. Keep it short.' },
                group: { type: 'string', description: 'Single uppercase letter (A, B, C, ...) identifying which block this exercise belongs to. Multiple exercises sharing the same letter form a superset / tri-set and should be performed alternating. Standalone lifts get their own letter.' },
              },
              required: ['exercise', 'group'],
            },
          },
        },
        required: ['date', 'exercises'],
      },
    },
    {
      name: 'log_set',
      description: 'Log one working set for Mike. Use when he tells you conversationally that he did a set.',
      input_schema: {
        type: 'object',
        properties: {
          date: { type: 'string', description: 'Date YYYY-MM-DD' },
          exercise: { type: 'string' },
          reps: { type: 'integer' },
          weight: { type: 'string', description: 'Weight lifted. Numeric string like "225" for weight, or text like "BW", "BW + 20", "Bands".' },
        },
        required: ['date', 'exercise', 'reps', 'weight'],
      },
    },
  ];
}

function runTool_(name, input) {
  if (name === 'get_workout') {
    const date = String(input.date || '').trim();
    if (!date) throw new Error('date required');
    return {
      date: date,
      prescribed: readPrescribed_(date),
      logged: readActuals_(date),
    };
  }
  if (name === 'get_recent_history') {
    const start = String(input.start_date || '').trim();
    const end = String(input.end_date || '').trim();
    if (!start || !end) throw new Error('start_date and end_date required');
    return { start_date: start, end_date: end, sets: readActualsRange_(start, end) };
  }
  if (name === 'set_prescribed') {
    const date = String(input.date || '').trim();
    const exercises = Array.isArray(input.exercises) ? input.exercises : [];
    if (!date) throw new Error('date required');
    return replacePrescribed_(date, exercises);
  }
  if (name === 'log_set') {
    const nextSetNumber = readActuals_(input.date).length + 1;
    return appendActual_({
      date: input.date,
      exercise: input.exercise,
      setNumber: nextSetNumber,
      reps: input.reps,
      weight: input.weight,
    });
  }
  throw new Error('Unknown tool: ' + name);
}

/* ================= utils ================= */

function normalizeDate_(v) {
  if (v instanceof Date) {
    const tz = Session.getScriptTimeZone();
    return Utilities.formatDate(v, tz, 'yyyy-MM-dd');
  }
  const s = String(v).trim();
  const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) {
    return m[1] + '-' + pad_(m[2]) + '-' + pad_(m[3]);
  }
  const d = new Date(s);
  if (!isNaN(d.getTime())) {
    const tz = Session.getScriptTimeZone();
    return Utilities.formatDate(d, tz, 'yyyy-MM-dd');
  }
  return s;
}

function pad_(n) {
  n = String(n);
  return n.length === 1 ? '0' + n : n;
}

function todayIso_() {
  const tz = Session.getScriptTimeZone();
  return Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Run this ONCE from the Apps Script editor to grant this script permission
 * to reach the Anthropic API. Google requires you to explicitly authorize
 * any script that makes outbound HTTP calls.
 *
 * Pick "authorize" in the function dropdown, click Run, and approve the
 * permission dialog that pops up. The function will error out at the fetch
 * — that's expected and fine. Its only job is to trigger the prompt.
 */
function authorize() {
  UrlFetchApp.fetch('https://example.com');
}

/**
 * Run this once from the Apps Script editor to bootstrap an empty
 * spreadsheet with the two tabs and header rows.
 */
function setupSheets() {
  const ss = SpreadsheetApp.getActive();
  let prescribed = ss.getSheetByName(PRESCRIBED_SHEET);
  if (!prescribed) prescribed = ss.insertSheet(PRESCRIBED_SHEET);
  if (prescribed.getLastRow() === 0) {
    prescribed.appendRow(['Date', 'Exercise', 'Sets', 'Reps', 'Weight', 'Notes', 'Group']);
    prescribed.setFrozenRows(1);
  } else if (!prescribed.getRange(1, 7).getValue()) {
    // Existing sheet — add the Group header if missing.
    prescribed.getRange(1, 7).setValue('Group');
  }
  let actuals = ss.getSheetByName(ACTUALS_SHEET);
  if (!actuals) actuals = ss.insertSheet(ACTUALS_SHEET);
  if (actuals.getLastRow() === 0) {
    actuals.appendRow(['LoggedAt', 'Date', 'Exercise', 'SetNumber', 'Reps', 'Weight', 'Notes']);
    actuals.setFrozenRows(1);
  }
}

/**
 * ONE-TIME LOADER — Block 2 Peak (Week 5) + Deload/Retest (Week 6).
 *
 * Writes 6 prescribed workouts directly to the Prescribed sheet, correctly
 * grouped by block. Safe to re-run — each day uses replacePrescribed_ which
 * deletes existing rows for that date first.
 *
 *   INSTALLED: Thu5, Fri5, Mon6, Tue6, Thu6 (retest), Fri6
 *   SKIPPED:   Mon5 + Tue5 (travel days — hotel gym unknown, use Roman to
 *              build travel-adapted DB/HIIT versions on the day-of)
 *
 * To use:
 *   1. Pick "installBlock2Weeks5and6" from the function dropdown at the top.
 *   2. Click ▶ Run. Done in <1 second.
 *
 * If your Week 5 Monday is a different date, edit WEEK5_MONDAY below.
 */
function installBlock2Weeks5and6() {
  const WEEK5_MONDAY = '2026-08-24';

  const d = {
    thu5: shiftIso_(WEEK5_MONDAY, 3),
    fri5: shiftIso_(WEEK5_MONDAY, 4),
    mon6: shiftIso_(WEEK5_MONDAY, 7),
    tue6: shiftIso_(WEEK5_MONDAY, 8),
    thu6: shiftIso_(WEEK5_MONDAY, 10),
    fri6: shiftIso_(WEEK5_MONDAY, 11),
  };

  const plan = {};

  // ============ WEEK 5 — PEAK WEEK ============
  //
  // MON5 + TUE5 are TRAVEL DAYS — ask Roman in the app to build DB-only /
  // HIIT-heavy versions based on what the hotel gym actually has. Do NOT
  // hardcode them here since the equipment is uncertain.

  plan[d.thu5] = [ // Focused Cardio
    { group:'A', exercise:'Outdoor Sprint Ladder', sets:12, reps:'4×10s/30s → 4×20s/40s → 4×30s/60s', weight:'max effort', notes:'Phase 1, 14 min. Sprint ladder — 12 total sprints' },
    { group:'B', exercise:'Deadlift (complex)',    sets:4, reps:'6', weight:'100 lbs', notes:'Phase 2 barbell complex. No rest between moves. 90s between rounds. 4 rounds.' },
    { group:'B', exercise:'Bent Row (complex)',    sets:4, reps:'6', weight:'100 lbs', notes:'Continue complex — no rest' },
    { group:'B', exercise:'Hang Clean (complex)',  sets:4, reps:'6', weight:'100 lbs', notes:'Continue complex — no rest' },
    { group:'B', exercise:'Front Squat (complex)', sets:4, reps:'6', weight:'100 lbs', notes:'Continue complex — no rest' },
    { group:'B', exercise:'Push Press (complex)',  sets:4, reps:'6', weight:'100 lbs', notes:'End of complex — 90s between rounds' },
    { group:'C', exercise:'Bear Crawl',            sets:3, reps:'20 yds',    weight:'BW',      notes:'Phase 3 crawl/carry finisher, 9 min, 3 rounds' },
    { group:'C', exercise:'Suitcase Carry',        sets:3, reps:'40 yds ea', weight:'70 lb DB', notes:'Phase 3 continued' },
    { group:'C', exercise:'Jump Rope',             sets:3, reps:'45s',       weight:'BW',      notes:'Phase 3 finisher' },
  ];

  plan[d.fri5] = [ // Full Body Athletic
    { group:'A', exercise:'Front Squat',       sets:4, reps:'5', weight:'220 lbs',   notes:'Superset with Weighted Pull-Up, 4 rounds' },
    { group:'A', exercise:'Weighted Pull-Up',  sets:4, reps:'6', weight:'BW + 20 lbs', notes:'Superset with Front Squat' },
    { group:'B', exercise:'Landmine Press',    sets:3, reps:'10 ea', weight:'55 lbs',   notes:'Tri-set with Seal Row + Reverse Curl, 3 rounds' },
    { group:'B', exercise:'Seal Row',          sets:3, reps:'10',    weight:'2×60 lb DBs', notes:'Or Chest-Supported Row. Tri-set continues.' },
    { group:'B', exercise:'Reverse Curl',      sets:3, reps:'15',    weight:'70 lbs',   notes:'Tri-set finisher' },
    { group:'C', exercise:'Barbell Power Clean', sets:3, reps:'4', weight:'200 lbs', notes:'EARLY in session — arms fresh. Superset with Broad Jump, 3 rounds' },
    { group:'C', exercise:'Broad Jump',        sets:3, reps:'4', weight:'BW',       notes:'Superset with Power Clean' },
    { group:'D', exercise:'Thruster',          sets:1, reps:'AMRAP 8 min', weight:'95 lbs',  notes:'AMRAP finisher: Thruster → Pull-Up → KB Swing, continuous rounds for 8 min' },
    { group:'D', exercise:'Pull-Up',           sets:1, reps:'AMRAP 8 min', weight:'BW',      notes:'Continue AMRAP circuit' },
    { group:'D', exercise:'KB Swing',          sets:1, reps:'AMRAP 8 min', weight:'35 lb KB', notes:'Continue AMRAP circuit' },
  ];

  // ============ WEEK 6 — DELOAD + RETEST ============

  plan[d.mon6] = [ // Deload Lower (60% loads, higher reps, 35 min)
    { group:'A', exercise:'Goblet Squat',      sets:3, reps:'15',    weight:'50 lb KB',   notes:'Deload — 60% loads. Superset with SL RDL, 3 rounds' },
    { group:'A', exercise:'Single-Leg RDL',    sets:3, reps:'12 ea', weight:'40 lb DB',   notes:'Superset with Goblet Squat' },
    { group:'B', exercise:'DB Reverse Lunge',  sets:3, reps:'12 ea', weight:'2×25 lb DBs', notes:'Superset with Glute Bridge, 3 rounds' },
    { group:'B', exercise:'Glute Bridge',      sets:3, reps:'15',    weight:'95 lbs',      notes:'Superset with Reverse Lunge' },
    { group:'C', exercise:'KB Swing / Jump Rope', sets:3, reps:'30s / 30s', weight:'25 lb KB', notes:'Easy conditioning, 6 min, 3 rounds' },
  ];

  plan[d.tue6] = [ // Deload Upper (60%, 35 min)
    { group:'A', exercise:'DB Bench Press',    sets:3, reps:'12', weight:'2×65 lb DBs', notes:'Deload — 60% loads. Superset with TRX Row, 3 rounds' },
    { group:'A', exercise:'TRX Row',           sets:3, reps:'15', weight:'BW',          notes:'Superset with DB Bench' },
    { group:'B', exercise:'Pull-Up',           sets:3, reps:'8',  weight:'BW',          notes:'No vest. Superset with Lateral Raise, 3 rounds' },
    { group:'B', exercise:'DB Lateral Raise',  sets:3, reps:'15', weight:'2×20 lb DBs', notes:'Superset with Pull-Up' },
    { group:'C', exercise:'Band Face Pull',    sets:3, reps:'30s', weight:'Bands',       notes:'Conditioning, alternating with Dead Bug, 6 min, 3 rounds' },
    { group:'C', exercise:'Dead Bug',          sets:3, reps:'30s', weight:'BW',          notes:'Alternate with Face Pull' },
  ];

  plan[d.thu6] = [ // RETEST DAY
    { group:'A', exercise:'Back Squat (free bar)', sets:1, reps:'1', weight:'315+ lbs', notes:'RETEST. Ramp to a clean single at/near 315 PR. Attempt new max if bar speed is good.' },
    { group:'B', exercise:'Bench Press (standard grip)', sets:1, reps:'1', weight:'255+ lbs', notes:'RETEST. Ramp to a clean single vs 255 PR.' },
    { group:'C', exercise:'Front Squat',           sets:1, reps:'3', weight:'235+ lbs', notes:'RETEST. Ramp to a clean triple vs 235 baseline.' },
  ];

  plan[d.fri6] = [ // Light Full Body Flush (30 min active recovery)
    { group:'A', exercise:'Turkish Get-Up',    sets:4, reps:'3 ea',   weight:'35 lb KB',       notes:'Active recovery' },
    { group:'B', exercise:'Waiter Walk',       sets:4, reps:'40 yds', weight:'40 lb DB overhead', notes:'Overhead carry' },
    { group:'C', exercise:'Bike or Walk (Zone 2)', sets:1, reps:'10 min', weight:'easy', notes:'Zone 2 aerobic — nasal breathing pace' },
  ];

  const results = {};
  Object.keys(plan).forEach(function (date) {
    replacePrescribed_(date, plan[date]);
    results[date] = plan[date].length + ' exercises';
  });

  // Print to the Apps Script execution log so you can confirm it worked.
  Logger.log('Installed Block 2 Weeks 5-6:');
  Object.keys(results).forEach(function (date) {
    Logger.log('  ' + date + ' — ' + results[date]);
  });

  return results;
}

/**
 * ONE-TIME BACKFILL — Historical Actuals (Jan – Aug 2026).
 *
 * Two things merged in:
 *   1. Roman's detailed Block 2 session log (real weights/reps for
 *      specific dates in Weeks 1-4).
 *   2. Placeholder "Training Session" rows on every M/T/Th/F from
 *      2026-01-05 through 2026-08-17 for any date the detailed log
 *      doesn't already cover — reflecting Mike's actual 4x/week
 *      training frequency since January.
 *
 * Result: weekly bars and streak count reflect true training frequency;
 * top lifts use the real captured weights so trend arrows are honest.
 *
 * Guard: aborts if Actuals already has any rows for 2026-07-27 to avoid
 * duplicating. Delete those rows first if you need to re-run.
 *
 * To use:
 *   1. Function dropdown → installHistoricalActuals → ▶ Run.
 *   2. Check the execution log for row counts.
 *   3. Open the app → Trends tab. Weekly bars fill up, streak counts.
 */
function installHistoricalActuals() {
  const guardDate = '2026-07-27';
  if (readActuals_(guardDate).length > 0) {
    Logger.log('Actuals already contain rows for ' + guardDate + '. Skipping to avoid duplicates.');
    return { skipped: true };
  }

  const rows = [
    // ============ WEEK 1 (Jul 27 – Aug 2) ============
    // Mon Jul 27 — Lower
    { date:'2026-07-27', exercise:'Back Squat',              setNumber:4, reps:5, weight:285,    notes:'Top set only (sets 1-3 not logged)' },
    { date:'2026-07-27', exercise:'Barbell Power Clean',     setNumber:4, reps:4, weight:185,    notes:'Top set only' },
    { date:'2026-07-27', exercise:'DB Walking Lunge',        setNumber:1, reps:10, weight:30,    notes:'Reps assumed from prescription' },
    // Tue Jul 28 — Upper
    { date:'2026-07-28', exercise:'Bench Press',             setNumber:4, reps:5, weight:245,    notes:'Top set only' },
    { date:'2026-07-28', exercise:'1-Arm DB Row',            setNumber:4, reps:8, weight:85,     notes:'Top set only (swapped from bent row)' },
    { date:'2026-07-28', exercise:'Pull-Up',                 setNumber:1, reps:8, weight:'BW',   notes:'8/8/8/8 all four sets equal' },
    { date:'2026-07-28', exercise:'Pull-Up',                 setNumber:2, reps:8, weight:'BW' },
    { date:'2026-07-28', exercise:'Pull-Up',                 setNumber:3, reps:8, weight:'BW' },
    { date:'2026-07-28', exercise:'Pull-Up',                 setNumber:4, reps:8, weight:'BW' },

    // ============ WEEK 2 (Aug 3 – Aug 9) ============
    // Mon Aug 3 — Lower
    { date:'2026-08-03', exercise:'Back Squat',              setNumber:4, reps:5, weight:295,    notes:'Top set only (PR climb)' },
    { date:'2026-08-03', exercise:'Single-Arm Single-Leg RDL', setNumber:1, reps:6, weight:65,   notes:'Top set only' },
    { date:'2026-08-03', exercise:'Barbell Power Clean',     setNumber:4, reps:4, weight:195,    notes:'Top set only' },
    { date:'2026-08-03', exercise:'DB Walking Lunge',        setNumber:1, reps:10, weight:35 },
    { date:'2026-08-03', exercise:'Barbell Glute Bridge',    setNumber:1, reps:12, weight:70,    notes:'Logged as 70 lb DB — flagged as light for movement' },
    // Fri Aug 7 — Full Body
    { date:'2026-08-07', exercise:'Front Squat',             setNumber:4, reps:4, weight:225,    notes:'Top set only' },
    { date:'2026-08-07', exercise:'Weighted Pull-Up',        setNumber:1, reps:6, weight:'BW + 20' },
    { date:'2026-08-07', exercise:'Barbell Shoulder Press',  setNumber:1, reps:10, weight:115,   notes:'Swapped from DB press' },
    { date:'2026-08-07', exercise:'1-Arm DB Row',            setNumber:1, reps:10, weight:75 },
    { date:'2026-08-07', exercise:'DB Thruster',             setNumber:1, reps:10, weight:40,    notes:'Reps not confirmed (defaulted to 10)' },

    // ============ WEEK 3 (Aug 10 – Aug 16) ============
    // Mon Aug 10 — Lower
    { date:'2026-08-10', exercise:'Back Squat',              setNumber:4, reps:5, weight:295,    notes:'Top set only' },
    { date:'2026-08-10', exercise:'Single-Arm Single-Leg RDL', setNumber:1, reps:6, weight:60 },
    { date:'2026-08-10', exercise:'KB Single-Arm Clean to Press', setNumber:1, reps:6, weight:35, notes:'New movement, top set only' },
    { date:'2026-08-10', exercise:'DB Walking Lunge',        setNumber:1, reps:10, weight:40 },
    { date:'2026-08-10', exercise:'Barbell Glute Bridge',    setNumber:1, reps:12, weight:135 },
    // Tue Aug 11 — Upper
    { date:'2026-08-11', exercise:'Bench Press',             setNumber:4, reps:5, weight:255,    notes:'Top set only (PR)' },
    { date:'2026-08-11', exercise:'1-Arm DB Row',            setNumber:4, reps:8, weight:85 },
    { date:'2026-08-11', exercise:'Pull-Up',                 setNumber:1, reps:8, weight:'BW + 12', notes:'12 lb vest' },
    { date:'2026-08-11', exercise:'DB Arnold Press',         setNumber:1, reps:10, weight:50 },
    // Fri Aug 14 — Full Body
    { date:'2026-08-14', exercise:'Front Squat',             setNumber:1, reps:4, weight:235,    notes:'Top set only (PR)' },
    { date:'2026-08-14', exercise:'Weighted Pull-Up',        setNumber:1, reps:6, weight:'BW + 20', notes:'Chain used, equivalent load' },
    { date:'2026-08-14', exercise:'Barbell Shoulder Press',  setNumber:4, reps:10, weight:125,   notes:'Top set only' },
    { date:'2026-08-14', exercise:'1-Arm DB Row',            setNumber:1, reps:10, weight:75 },
    { date:'2026-08-14', exercise:'DB Incline Curl',         setNumber:1, reps:10, weight:25,    notes:'Swapped from barbell curl; 30 lb too heavy' },
    { date:'2026-08-14', exercise:'Barbell Power Clean',     setNumber:1, reps:4, weight:185 },

    // ============ WEEK 4 (Aug 17 – Aug 23) ============
    // Mon Aug 17 — back-safe recovery day
    { date:'2026-08-17', exercise:'Box Squat',               setNumber:1, reps:5, weight:275,    notes:'Back tweak recovery Day 3 — back-safe' },
    { date:'2026-08-17', exercise:'Front Squat',             setNumber:1, reps:4, weight:205,    notes:'Back-safe session; reps approx' },
    // Tue Aug 18 — post-back-tweak return, upper
    { date:'2026-08-18', exercise:'Close-Grip Bench Press',  setNumber:4, reps:6, weight:225,    notes:'Post-tweak return; top set only (PR)' },
    { date:'2026-08-18', exercise:'1-Arm DB Row',            setNumber:1, reps:8, weight:90,     notes:'New PR — exact rep count approx' },
    { date:'2026-08-18', exercise:'Z-Press',                 setNumber:1, reps:8, weight:50,     notes:'New PR at prescribed load' },
    { date:'2026-08-18', exercise:'Chin-Up',                 setNumber:1, reps:10, weight:'BW' },
    { date:'2026-08-18', exercise:'Chin-Up',                 setNumber:2, reps:9,  weight:'BW' },
    { date:'2026-08-18', exercise:'Chin-Up',                 setNumber:3, reps:8,  weight:'BW' },
    { date:'2026-08-18', exercise:'Hammer Curl',             setNumber:1, reps:12, weight:30,    notes:'Reps approx' },
    // Wed Aug 19 — Box Squat climb (lower)
    { date:'2026-08-19', exercise:'Box Squat',               setNumber:4, reps:5, weight:295,    notes:'Climbed 265/275/285/295' },
    { date:'2026-08-19', exercise:'Barbell Good Morning',    setNumber:1, reps:8, weight:135,    notes:'Reps approx (Rx was 8)' },
    { date:'2026-08-19', exercise:'Cossack Squat',           setNumber:3, reps:10, weight:40,    notes:'Progressed 30/30/40; reps approx' },
    { date:'2026-08-19', exercise:'Box Step-Up',             setNumber:1, reps:10, weight:35 },
    { date:'2026-08-19', exercise:'KB Snatch',               setNumber:2, reps:8, weight:35,     notes:'Started 15 lb, moved to 35; reps approx' },
    // Thu Aug 20 — Upper
    { date:'2026-08-20', exercise:'Close-Grip Bench Press',  setNumber:2, reps:6, weight:225,    notes:'Climbed 205/205/215/225; top only confirmed' },
    { date:'2026-08-20', exercise:'1-Arm DB Row',            setNumber:4, reps:8, weight:85 },
    { date:'2026-08-20', exercise:'Z-Press',                 setNumber:3, reps:8, weight:45,     notes:'Climbed 35/40/45' },
    { date:'2026-08-20', exercise:'Chin-Up',                 setNumber:1, reps:8, weight:'BW' },
    { date:'2026-08-20', exercise:'Hammer Curl',             setNumber:1, reps:12, weight:30,    notes:'Fatigue set 3-4; reps approx' },
  ];

  // Bucket detailed dates by their week Monday, so we can top up each week
  // to the 4-session target without over-inflating weeks like Week 4 that
  // already had a full M/T/W/Th of detailed data.
  const weekBuckets = {};
  rows.forEach(function (r) {
    const wk = mondayIsoOf_(r.date);
    if (!weekBuckets[wk]) weekBuckets[wk] = {};
    weekBuckets[wk][r.date] = true;
  });

  // Generate placeholders on M/T/Th/F from Jan 5 2026 through Aug 17 2026.
  // Only add a placeholder if the date isn't already in the detailed log AND
  // the week still has fewer than 4 distinct dates.
  const START_MON = '2026-01-05';
  const END_MON   = '2026-08-17';
  const TARGET    = 4;
  const DAY_OFFSETS = [0, 1, 3, 4]; // Mon, Tue, Thu, Fri

  const placeholderRows = [];
  let monday = new Date(START_MON + 'T00:00:00');
  const endMondayD = new Date(END_MON + 'T00:00:00');
  while (monday <= endMondayD) {
    const wkKey = Utilities.formatDate(monday, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    const existing = weekBuckets[wkKey] || {};
    for (let i = 0; i < DAY_OFFSETS.length; i++) {
      if (Object.keys(existing).length >= TARGET) break;
      const d = new Date(monday);
      d.setDate(d.getDate() + DAY_OFFSETS[i]);
      const iso = Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
      if (!existing[iso]) {
        placeholderRows.push({
          date: iso,
          exercise: 'Training Session',
          setNumber: 1,
          reps: 1,
          weight: 0,
          notes: 'Backfilled — session completed, details not captured in Roman log',
        });
        existing[iso] = true;
      }
    }
    monday.setDate(monday.getDate() + 7);
  }

  const allRows = rows.concat(placeholderRows);
  allRows.forEach(function (r) { appendActual_(r); });

  Logger.log('Loaded ' + rows.length + ' detailed rows + ' + placeholderRows.length + ' placeholder sessions.');
  return { detailed: rows.length, placeholders: placeholderRows.length, total: allRows.length };
}

// Helper: Monday (YYYY-MM-DD) of the week containing the given ISO date.
function mondayIsoOf_(iso) {
  const d = new Date(iso + 'T00:00:00');
  const day = d.getDay(); // 0 = Sun, 1 = Mon, ..., 6 = Sat
  const offset = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + offset);
  return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}
