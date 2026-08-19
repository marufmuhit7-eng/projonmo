/*
 * Smoke test for js/storage.js — run with:  node tools/storage.test.js
 * Exercises the exact call patterns app.js uses, including the failure paths
 * app.js relies on (a missing key MUST reject so the caller's catch runs).
 */
'use strict';

// --- minimal localStorage stand-in so the shim can run under Node ----------
const backing = new Map();
global.window = {
  localStorage: {
    get length() { return backing.size; },
    key(i) { return [...backing.keys()][i] ?? null; },
    getItem(k) { return backing.has(k) ? backing.get(k) : null; },
    setItem(k, v) { backing.set(k, String(v)); },
    removeItem(k) { backing.delete(k); }
  }
};

require('../src/shared/storage.js');
const storage = global.window.storage;

let passed = 0;
let failed = 0;

function check(label, cond) {
  if (cond) { passed++; console.log('  ok   ' + label); }
  else { failed++; console.log('  FAIL ' + label); }
}

async function expectReject(label, fn) {
  try { await fn(); check(label, false); }
  catch { check(label, true); }
}

(async function run() {
  console.log('storage.js contract tests\n');

  // 1. normal: register a participant, read it back (app.js lines 43 + 339)
  const rec = { id: 'UHF-AB12CD', name: 'Rafi', cls: '7', examTaken: false, score: 0 };
  const setRes = await storage.set('participant:' + rec.id, JSON.stringify(rec), true);
  check('set() returns truthy so app.js `if(!res) throw` does not fire', !!setRes);

  const got = await storage.get('participant:' + rec.id, true);
  check('get() returns { value: <string> }', typeof got.value === 'string');
  check('JSON.parse(res.value) round-trips the record', JSON.parse(got.value).name === 'Rafi');

  // 2. boundary: empty result set — leaderboard on a fresh browser
  const emptyList = await storage.list('nothing-with-this-prefix:', true);
  check('list() on an unknown prefix returns { keys: [] }', Array.isArray(emptyList.keys) && emptyList.keys.length === 0);

  // 3. boundary: prefix filtering must not leak other namespaces
  await storage.set('questions:junior', JSON.stringify([{ q: 'x' }]), true);
  await storage.set('participant:UHF-ZZ99ZZ', JSON.stringify({ id: 'UHF-ZZ99ZZ', examTaken: true }), true);
  const pList = await storage.list('participant:', true);
  check('list("participant:") returns only participant keys', pList.keys.length === 2 && pList.keys.every(k => k.startsWith('participant:')));
  check('list() strips the internal namespace so get(k) works on the result', (await storage.get(pList.keys[0], true)).value.length > 0);

  // 4. malformed / missing: app.js depends on these REJECTING
  await expectReject('get() on a missing key rejects (drives "ID not found")', () => storage.get('participant:UHF-NOPE', true));
  await expectReject('set() with a non-string value rejects', () => storage.set('participant:bad', { not: 'a string' }, true));
  await expectReject('set() with an empty key rejects', () => storage.set('', 'x', true));

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
