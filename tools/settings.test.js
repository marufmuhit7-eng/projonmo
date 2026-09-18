/*
 * settings.test.js — exam-control facade + Dhaka date helpers.
 * Supabase is NOT mocked here: this file proves the fail-closed behaviour of
 * an UNCONFIGURED site (no SDK, no config) — the state every fresh visitor's
 * browser would be in if Supabase were missing, blocked or offline.
 *
 * Run:  node tools/settings.test.js
 */
'use strict';

global.window = { APP_CONFIG: { TZ_OFFSET: '+06:00' } };

require('../src/shared/supabase-config.js');
require('../src/shared/supabase-db.js');
require('../src/shared/settings.js');
const S = global.window.examSettings;

let passed = 0;
let failed = 0;
function check(label, cond, detail) {
  if (cond) { passed++; console.log('  ok   ' + label); }
  else { failed++; console.log('  FAIL ' + label + (detail !== undefined ? '  -> ' + JSON.stringify(detail) : '')); }
}

(async function run() {
  console.log('exam settings — unconfigured / fail-closed\n');

  check("backend is 'unconfigured' when SUPABASE_URL is empty", S.backend === 'unconfigured', S.backend);
  check('isRemote is false without Supabase', S.isRemote === false);

  // ---- defaults: THE SECURITY BOUNDARY ---------------------------------
  const d = await S.load();
  check('SHIPPED DEFAULT: exam is LOCKED', d.isUnlocked === false, d);
  check('default examStatus is "countdown", never "live"', S.examStatus(d) === 'countdown');
  check('default examDate is 30 Sep 2026 +06:00', d.examDate === '2026-09-30T00:00:00+06:00', d.examDate);
  check('default registration window is Aug 25 – Sep 29, 2026',
    d.registrationStart === '2026-08-25' && d.registrationEnd === '2026-09-29', d);

  // ---- the gate: only a real boolean true opens the exam ----------------
  check('examStatus({isUnlocked:true}) is "live"', S.examStatus({ isUnlocked: true }) === 'live');
  check('examStatus("true") stays locked', S.examStatus({ isUnlocked: 'true' }) === 'countdown');
  check('examStatus(1) stays locked', S.examStatus({ isUnlocked: 1 }) === 'countdown');
  check('examStatus(junk) stays locked', S.examStatus({ isUnlocked: {} }) === 'countdown');

  // ---- normalise guards --------------------------------------------------
  check('normalise: junk examDate falls back to the default',
    S.normalise({ examDate: 'not-a-date' }).examDate === S.DEFAULTS.examDate);
  check('normalise: bad registration date format falls back',
    S.normalise({ registrationStart: '25/08/2026' }).registrationStart === '2026-08-25');
  check('normalise: valid values survive',
    S.normalise({ isUnlocked: true, examDate: '2026-10-01T09:30:00+06:00' }).examDate === '2026-10-01T09:30:00+06:00');

  // ---- unconfigured writes must reject (never pretend to be global) ------
  let rejected = false;
  try { await S.save({ isUnlocked: true }); } catch (e) { rejected = true; }
  check('save() rejects while Supabase is unconfigured', rejected);

  // ---- subscribe with no backend: fires once with LOCKED defaults --------
  let seen = null;
  const stop = S.subscribe(function (s) { seen = s; });
  check('subscribe() on unconfigured site delivers LOCKED defaults', seen && seen.isUnlocked === false);
  check('subscribe() returns a stop function', typeof stop === 'function');
  stop();

  // ---- datetime-local <-> ISO, normal and boundary cases -----------------
  check('toDhakaInput: midnight Dhaka renders as 00:00, not shifted',
    S.toDhakaInput('2026-09-30T00:00:00+06:00') === '2026-09-30T00:00');
  check('fromDhakaInput: form value gains the +06:00 offset',
    S.fromDhakaInput('2026-09-30T00:00') === '2026-09-30T00:00:00+06:00');
  check('round trip ISO -> input -> ISO is stable',
    S.fromDhakaInput(S.toDhakaInput('2026-12-31T18:30:00+06:00')) === '2026-12-31T18:30:00+06:00');
  check('boundary: a UTC instant is converted INTO Dhaka time (+6h)',
    S.toDhakaInput('2026-09-29T18:00:00Z') === '2026-09-30T00:00');
  check('boundary: month end rolls over correctly',
    S.toDhakaInput('2026-01-31T20:00:00Z') === '2026-02-01T02:00');
  check('boundary: leap day survives the round trip',
    S.fromDhakaInput('2028-02-29T23:59') === '2028-02-29T23:59:00+06:00');
  check('malformed: empty input -> null (save must be rejected)', S.fromDhakaInput('') === null);
  check('malformed: garbage -> null', S.fromDhakaInput('25/09/2026 midnight') === null);
  check('malformed: impossible date is rejected', S.fromDhakaInput('2026-02-30T10:00') === null);

  // ---- registration window (uses the real Dhaka calendar day) ------------
  const today = S.dhakaToday();
  const tomorrow = today.slice(0, 8) + String(Number(today.slice(8, 10)) + 1).padStart(2, '0');
  check('registrationOpen: window that spans today is open',
    S.registrationOpen({ registrationStart: '2000-01-01', registrationEnd: '2999-01-01' }) === true);
  check('registrationOpen: window that ended yesterday is closed',
    S.registrationOpen({ registrationStart: '2000-01-01', registrationEnd: '2000-01-02' }) === false);
  check('registrationOpen: window that starts tomorrow is closed',
    S.registrationOpen({ registrationStart: tomorrow, registrationEnd: '2999-01-01' }) === false);

  // ---- Bengali date rendering --------------------------------------------
  check('formatBnDateTime renders Bangla digits and month',
    S.formatBnDateTime('2026-09-30T00:00:00+06:00') === '৩০ সেপ্টেম্বর, ২০২৬, ১২:০০ AM',
    S.formatBnDateTime('2026-09-30T00:00:00+06:00'));

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
