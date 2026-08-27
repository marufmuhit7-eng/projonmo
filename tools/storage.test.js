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

  // ---------------------------------------------------------------------
  // Supabase mode: same contract, backed by a mocked storage_kv table.
  // ---------------------------------------------------------------------
  console.log('\nstorage.js supabase-mode tests\n');

  function makeFakeSupabase() {
    const rows = new Map(); // key -> parsed jsonb value
    return {
      rows,
      from() {
        const state = { eqVal: undefined, likePrefix: '' };
        const api = {
          upsert(obj) {
            return Promise.resolve().then(() => {
              const items = Array.isArray(obj) ? obj : [obj];
              for (const it of items) rows.set(it.key, JSON.parse(JSON.stringify(it.value)));
              return { data: null, error: null };
            });
          },
          select(cols) { return api; },
          eq(_col, val) { state.eqVal = val; return api; },
          like(_col, pat) { state.likePrefix = pat.replace(/%$/, ''); return api; },
          limit() { return api; },
          order() { return api; },
          maybeSingle() {
            return Promise.resolve({
              data: rows.has(state.eqVal) ? { value: rows.get(state.eqVal) } : null,
              error: null
            });
          },
          // Awaiting the builder directly is the list() path.
          then(resolve, reject) {
            const data = [...rows.keys()]
              .filter(k => k.indexOf(state.likePrefix) === 0).sort()
              .map(k => ({ key: k }));
            return Promise.resolve({ data, error: null }).then(resolve, reject);
          }
        };
        return api;
      }
    };
  }

  global.window.APP_CONFIG = { SUPABASE_URL: 'https://fake.supabase.co', SUPABASE_ANON_KEY: 'anon-test' };
  global.window.supabase = { createClient: () => makeFakeSupabase() };
  delete global.window.__uhfSupabase;
  delete require.cache[require.resolve('../src/shared/storage.js')];
  require('../src/shared/storage.js');
  const rstorage = global.window.storage;

  check('backend reports supabase', rstorage.backend === 'supabase');

  const rrec = { id: 'UHF-PQ77RS', name: 'Nadia', cls: '8', examTaken: false, score: 0 };
  const rset = await rstorage.set('participant:' + rrec.id, JSON.stringify(rrec), true);
  check('remote set() resolves true', rset === true);

  const rgot = await rstorage.get('participant:' + rrec.id, true);
  check('remote get() round-trips the record through jsonb', JSON.parse(rgot.value).name === 'Nadia');

  await rstorage.set('questions:primary', JSON.stringify([{ q: 'x' }]), true);
  const rlist = await rstorage.list('participant:', true);
  check('remote list("participant:") filters by prefix on the server',
    rlist.keys.length === 1 && rlist.keys[0] === 'participant:' + rrec.id);

  check('remote set() mirrors to localStorage as an offline cache',
    global.window.localStorage.getItem('uhf:participant:' + rrec.id) !== null);

  await expectReject('remote get() on a missing key rejects', () => rstorage.get('participant:UHF-GONE', true));
  await expectReject('remote set() with invalid JSON rejects (jsonb column)', () => rstorage.set('participant:bad', 'not-json{', true));

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
