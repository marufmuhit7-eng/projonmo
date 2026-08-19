/*
 * settings.test.js — exam-timer settings layer, localStorage backend.
 * Date/timezone conversion gets normal, boundary and malformed cases.
 *
 * Run:  node tools/settings.test.js
 */
'use strict';

const backing = new Map();
const listeners = [];
global.window = {
  APP_CONFIG: { SUPABASE_URL: '', SUPABASE_ANON_KEY: '', TZ_OFFSET: '+06:00', POLL_INTERVAL_MS: 60000 },
  localStorage: {
    get length() { return backing.size; },
    key(i) { return [...backing.keys()][i] ?? null; },
    getItem(k) { return backing.has(k) ? backing.get(k) : null; },
    setItem(k, v) { backing.set(k, String(v)); },
    removeItem(k) { backing.delete(k); }
  },
  addEventListener(type, fn) { listeners.push([type, fn]); },
  removeEventListener() {}
};
global.console.warn = () => {};

require('../src/shared/settings.js');
const S = global.window.examSettings;

let passed = 0;
let failed = 0;
function check(label, cond, detail) {
  if (cond) { passed++; console.log('  ok   ' + label); }
  else { failed++; console.log('  FAIL ' + label + (detail !== undefined ? '  -> ' + JSON.stringify(detail) : '')); }
}

(async function run() {
  console.log('exam settings\n');

  check("backend is 'local' when SUPABASE_URL is empty", S.backend === 'local', S.backend);
  check('isRemote is false on the local backend', S.isRemote === false);

  // ---- defaults -------------------------------------------------------
  const d = await S.load();
  check('fresh browser falls back to defaults', d.timerEnabled === true && d.offBehavior === 'live', d);
  check('default exam date is the original 25 Sep 2026 +06:00',
    d.examStartDate === '2026-09-25T00:00:00+06:00', d.examStartDate);

  // ---- datetime-local <-> ISO, normal case ----------------------------
  check('toDhakaInput: normal — midnight Dhaka renders as 00:00, not shifted',
    S.toDhakaInput('2026-09-25T00:00:00+06:00') === '2026-09-25T00:00', S.toDhakaInput('2026-09-25T00:00:00+06:00'));
  check('fromDhakaInput: normal — form value gains the +06:00 offset',
    S.fromDhakaInput('2026-09-25T00:00') === '2026-09-25T00:00:00+06:00', S.fromDhakaInput('2026-09-25T00:00'));
  check('round trip ISO -> input -> ISO is stable',
    S.fromDhakaInput(S.toDhakaInput('2026-12-31T18:30:00+06:00')) === '2026-12-31T18:30:00+06:00');

  // ---- boundary -------------------------------------------------------
  check('boundary: a UTC instant is converted INTO Dhaka time (+6h)',
    S.toDhakaInput('2026-09-24T18:00:00Z') === '2026-09-25T00:00', S.toDhakaInput('2026-09-24T18:00:00Z'));
  check('boundary: month end rolls over correctly',
    S.toDhakaInput('2026-01-31T20:00:00Z') === '2026-02-01T02:00', S.toDhakaInput('2026-01-31T20:00:00Z'));
  check('boundary: leap day survives the round trip',
    S.fromDhakaInput('2028-02-29T23:59') === '2028-02-29T23:59:00+06:00');
  check('boundary: year rollover',
    S.toDhakaInput('2026-12-31T19:00:00Z') === '2027-01-01T01:00', S.toDhakaInput('2026-12-31T19:00:00Z'));

  // ---- malformed ------------------------------------------------------
  check('malformed: empty input string -> null (save must be rejected)', S.fromDhakaInput('') === null);
  check('malformed: garbage input -> null', S.fromDhakaInput('25/09/2026 midnight') === null);
  check('malformed: undefined -> null', S.fromDhakaInput(undefined) === null);
  check('malformed: unparseable ISO -> empty input value', S.toDhakaInput('not-a-date') === '');
  check('malformed: impossible date is rejected', S.fromDhakaInput('2026-02-30T10:00') === null,
    S.fromDhakaInput('2026-02-30T10:00'));

  // ---- normalise guards ----------------------------------------------
  check('normalise: junk object falls back to defaults', S.normalise({ timerEnabled: 'yes' }).timerEnabled === true);
  check('normalise: bad date falls back to the default date',
    S.normalise({ examStartDate: 'lol' }).examStartDate === S.DEFAULTS.examStartDate);
  check('normalise: unknown offBehavior collapses to "live"',
    S.normalise({ offBehavior: 'explode' }).offBehavior === 'live');
  check('normalise: null is safe', S.normalise(null).timerEnabled === true);

  // ---- Bangla rendering (design must not change) ----------------------
  check('formatBnDateTime renders Bangla digits and month',
    S.formatBnDateTime('2026-09-25T00:00:00+06:00') === '২৫ সেপ্টেম্বর, ২০২৬, ১২:০০ AM',
    S.formatBnDateTime('2026-09-25T00:00:00+06:00'));
  check('toBnDigits converts every digit', S.toBnDigits('2026') === '২০২৬', S.toBnDigits('2026'));

  // ---- save / load round trip ----------------------------------------
  const saved = await S.save({ timerEnabled: false, offBehavior: 'message', customMessage: 'পরীক্ষা এখন চলছে!' });
  check('save() returns the merged settings', saved.timerEnabled === false && saved.offBehavior === 'message');
  check('save() preserves fields not in the patch', saved.examStartDate === S.DEFAULTS.examStartDate);
  const reloaded = await S.load();
  check('load() reads back what save() wrote', reloaded.customMessage === 'পরীক্ষা এখন চলছে!', reloaded);
  check('current() exposes the cached value without a round trip', S.current().offBehavior === 'message');

  const patched = await S.save({ timerEnabled: true });
  check('a later partial save keeps the custom message', patched.customMessage === 'পরীক্ষা এখন চলছে!');

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
