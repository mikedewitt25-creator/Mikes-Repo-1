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

const ROMAN_SYSTEM_PROMPT = [
  "You are Roman, a hardcore but pragmatic strength coach helping Mike train.",
  "You have tools to read his prescribed workouts and logged sets, and to write",
  "next week's prescribed workouts into his Google Sheet.",
  "",
  "Style: direct, concise, no fluff. Use short sentences. Explain the WHY when",
  "you make programming decisions (progression, deload, exercise selection).",
  "",
  "When Mike asks about history ('what did I do last week'), CALL get_recent_history.",
  "When Mike asks about today or a specific day, CALL get_workout with that date.",
  "When Mike asks you to plan / prescribe / write next week, CALL set_prescribed.",
  "When Mike logs a set conversationally ('just did 5x5 at 225'), CALL log_set.",
  "Do NOT invent numbers — always read from the sheet before commenting on his",
  "actual training. If a tool result is empty, tell him honestly.",
  "",
  "Dates are always YYYY-MM-DD. Today's date is included in the user's first",
  "message when the app sends it. Use it as the anchor for 'yesterday', 'last",
  "week', 'tomorrow', etc.",
].join('\n');

function doGet(e) {
  try {
    const action = (e && e.parameter && e.parameter.action) || 'getWorkout';
    const date = (e && e.parameter && e.parameter.date) || todayIso_();

    if (action === 'getWorkout') {
      return json_({ ok: true, date: date, prescribed: readPrescribed_(date), actuals: readActuals_(date) });
    }
    if (action === 'ping') {
      return json_({ ok: true, pong: true });
    }
    return json_({ ok: false, error: 'Unknown action: ' + action });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
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
      weight: Number(r[5]) || 0,
      notes: String(r[6] || '').trim(),
      rowIndex: i + 1,
    });
  }
  return out;
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
      weight: Number(r[5]) || 0,
    });
  }
  out.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : a.setNumber - b.setNumber; });
  return out;
}

function appendActual_(body) {
  const sheet = SpreadsheetApp.getActive().getSheetByName(ACTUALS_SHEET);
  if (!sheet) throw new Error('Missing sheet: ' + ACTUALS_SHEET);
  const row = [
    new Date(),
    body.date || todayIso_(),
    body.exercise || '',
    Number(body.setNumber) || 0,
    Number(body.reps) || 0,
    Number(body.weight) || 0,
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
    ]);
  }
  return { date: date, count: exercises.length };
}

/* ================= Roman chat (Claude proxy) ================= */

function handleChat_(body) {
  const apiKey = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY not set. Open Apps Script Project Settings → Script Properties and add it.');
  }

  const priorMessages = Array.isArray(body.messages) ? body.messages.slice() : [];
  const userText = String(body.userMessage || '').trim();
  if (!userText) throw new Error('Empty message');

  const todayIso = body.today || todayIso_();
  // On the first turn, prepend today's date so Roman has an anchor for relative dates.
  const framedUserText = priorMessages.length === 0
    ? "(Today is " + todayIso + ".)\n\n" + userText
    : userText;

  const messages = priorMessages.concat([{ role: 'user', content: framedUserText }]);

  const tools = romanTools_();

  // Tool-use loop — max 10 iterations to prevent runaway.
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

    // end_turn, max_tokens, refusal, etc. — extract the assistant text and return.
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

  throw new Error('Tool loop exceeded 10 iterations');
}

function callClaude_(apiKey, messages, tools) {
  const payload = {
    model: CLAUDE_MODEL,
    max_tokens: 4096,
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
      description: 'Write the prescribed workout for a date. Replaces any existing prescribed rows for that date. Use when Mike asks you to program or plan a workout.',
      input_schema: {
        type: 'object',
        properties: {
          date: { type: 'string', description: 'Date YYYY-MM-DD' },
          exercises: {
            type: 'array',
            description: 'Ordered list of exercises for that day',
            items: {
              type: 'object',
              properties: {
                exercise: { type: 'string' },
                sets: { type: 'integer', description: 'Number of working sets' },
                reps: { type: 'string', description: 'e.g. "5" or "8-10" or "AMRAP"' },
                weight: { type: 'string', description: 'e.g. "225" or "bodyweight" or "RPE 8"' },
                notes: { type: 'string' },
              },
              required: ['exercise'],
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
          weight: { type: 'number' },
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
    prescribed.appendRow(['Date', 'Exercise', 'Sets', 'Reps', 'Weight', 'Notes']);
    prescribed.setFrozenRows(1);
  }
  let actuals = ss.getSheetByName(ACTUALS_SHEET);
  if (!actuals) actuals = ss.insertSheet(ACTUALS_SHEET);
  if (actuals.getLastRow() === 0) {
    actuals.appendRow(['LoggedAt', 'Date', 'Exercise', 'SetNumber', 'Reps', 'Weight', 'Notes']);
    actuals.setFrozenRows(1);
  }
}
