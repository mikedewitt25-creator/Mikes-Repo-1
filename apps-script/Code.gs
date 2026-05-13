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
 * Roman edits the Prescribed tab. The app reads it and writes one row per
 * logged set to the Actuals tab.
 */

const PRESCRIBED_SHEET = 'Prescribed';
const ACTUALS_SHEET = 'Actuals';

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
    return json_({ ok: false, error: 'Unknown action: ' + action });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

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
