/*
 * firestore.test.js — the Firestore backend and, above all, the fail-closed
 * guarantee that the exam lock now rests on.
 *
 * A fake modular SDK stands in for Firebase: it records writes, replays
 * snapshots to onSnapshot listeners, and can be told to fail. No network.
 *
 * Run:  node tools/firestore.test.js
 */
'use strict';

let passed = 0;
let failed = 0;
function check(label, cond, detail) {
  if (cond) { passed++; console.log('  ok   ' + label); }
  else { failed++; console.log('  FAIL ' + label + (detail !== undefined ? '  -> ' + JSON.stringify(detail) : '')); }
}

// ---------------------------------------------------------------- fake SDK

function makeFakeFirestore() {
  const state = { data: null, exists: false, listeners: [], writes: [], failNext: null };

  function snapshot() {
    return { exists: () => state.exists, data: () => state.data };
  }

  const fs = {
    getFirestore: () => ({}),
    doc: (_db, col, id) => ({ path: col + '/' + id }),
    getDoc: () => {
      if (state.failNext === 'read') { state.failNext = null; return Promise.reject(new Error('offline')); }
      return Promise.resolve(snapshot());
    },
    setDoc: (_ref, data, _opts) => {
      if (state.failNext === 'write') { state.failNext = null; return Promise.reject(new Error('permission-denied')); }
      state.writes.push(data);
      state.data = Object.assign({}, state.data, data);
      state.exists = true;
      state.listeners.forEach((l) => l(snapshot()));
      return Promise.resolve();
    },
    onSnapshot: (_ref, cb) => {
      state.listeners.push(cb);
      cb(snapshot());                       // fire immediately, like the real SDK
      return () => { state.listeners = state.listeners.filter((l) => l !== cb); };
    }
  };
  return { fs, state };
}

function loadSettingsWithFirestore(fake) {
  // settings.js is an IIFE reading globals, so reset the module cache and the
  // globals it touches for each scenario.
  delete require.cache[require.resolve('../src/shared/settings.js')];
  global.window = {
    APP_CONFIG: {
      FIREBASE: { apiKey: 'fake-key', projectId: 'fake-project' },
      SUPABASE_URL: '', SUPABASE_ANON_KEY: '',
      TZ_OFFSET: '+06:00', POLL_INTERVAL_MS: 60000
    },
    firebaseSDK: { initializeApp: () => ({}), firestore: fake.fs },
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    addEventListener: () => {},
    removeEventListener: () => {}
  };
  require('../src/shared/settings.js');
  return global.window.examSettings;
}

(async function run() {
  console.log('firestore exam lock\n');

  // ---- backend selection ------------------------------------------------
  {
    const fake = makeFakeFirestore();
    const S = loadSettingsWithFirestore(fake);
    check("backend is 'firestore' when FIREBASE.projectId is set", S.backend === 'firestore', S.backend);
    check('isRemote is true', S.isRemote === true);
  }

  // ---- THE BUG: a browser that has never seen the admin panel -----------
  {
    const fake = makeFakeFirestore();           // no document exists
    const S = loadSettingsWithFirestore(fake);
    const s = await S.load();
    check('FRESH BROWSER, no document -> LOCKED', s.isUnlocked === false, s);
    check('FRESH BROWSER shows the countdown', S.examStatus(s) === 'countdown', S.examStatus(s));
  }

  // ---- offline / read failure -------------------------------------------
  {
    const fake = makeFakeFirestore();
    fake.state.exists = true;
    fake.state.data = { isUnlocked: true, targetDate: '2026-09-25T00:00:00' };
    const S = loadSettingsWithFirestore(fake);
    fake.state.failNext = 'read';
    let threw = false;
    try { await S.load(); } catch (e) { threw = true; }
    check('a failed read rejects rather than inventing an unlock', threw);
    check('current() after a failed read is still LOCKED', S.current().isUnlocked === false, S.current());
  }

  // ---- reading a real unlocked document ---------------------------------
  {
    const fake = makeFakeFirestore();
    fake.state.exists = true;
    fake.state.data = { isUnlocked: true, targetDate: '2026-09-25T00:00:00' };
    const S = loadSettingsWithFirestore(fake);
    const s = await S.load();
    check('isUnlocked true is read back as an unlock', s.isUnlocked === true);
    check('examStatus is "live" when unlocked', S.examStatus(s) === 'live');
    check('bare targetDate gets the +06:00 Dhaka offset applied',
      s.examStartDate === '2026-09-25T00:00:00+06:00', s.examStartDate);
  }

  // ---- a hostile / malformed document ------------------------------------
  {
    const cases = [
      ['string "true"', { isUnlocked: 'true' }],
      ['number 1', { isUnlocked: 1 }],
      ['object', { isUnlocked: {} }],
      ['missing field', { targetDate: '2026-09-25T00:00:00' }],
      ['null', { isUnlocked: null }]
    ];
    for (const [label, data] of cases) {
      const fake = makeFakeFirestore();
      fake.state.exists = true;
      fake.state.data = data;
      const S = loadSettingsWithFirestore(fake);
      const s = await S.load();
      check('malformed isUnlocked (' + label + ') stays LOCKED', s.isUnlocked === false, s.isUnlocked);
    }
  }

  // ---- admin writes ------------------------------------------------------
  {
    const fake = makeFakeFirestore();
    const S = loadSettingsWithFirestore(fake);
    await S.load();
    await S.save({ isUnlocked: true });
    const w = fake.state.writes[0];
    check('admin unlock writes isUnlocked:true', w.isUnlocked === true, w);
    check('admin unlock writes targetDate WITHOUT an offset, as specified',
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(w.targetDate), w.targetDate);
    check('the written targetDate is the 25 Sep 2026 Dhaka wall clock',
      w.targetDate === '2026-09-25T00:00:00', w.targetDate);

    await S.save({ isUnlocked: false });
    check('admin re-lock writes isUnlocked:false', fake.state.writes[1].isUnlocked === false);
  }

  // ---- a rejected write must not lie -------------------------------------
  {
    const fake = makeFakeFirestore();
    const S = loadSettingsWithFirestore(fake);
    await S.load();
    fake.state.failNext = 'write';
    let threw = false;
    try { await S.save({ isUnlocked: true }); } catch (e) { threw = true; }
    check('a rejected write rejects (admin UI reverts the switch)', threw);
    check('cached state after a rejected write is still LOCKED', S.current().isUnlocked === false);
  }

  // ---- onSnapshot realtime ------------------------------------------------
  {
    const fake = makeFakeFirestore();
    const S = loadSettingsWithFirestore(fake);
    const seen = [];
    const unsub = S.subscribe((s) => seen.push(s.isUnlocked));
    check('onSnapshot fires immediately with the current (locked) state',
      seen.length === 1 && seen[0] === false, seen);

    // The admin, in another browser, unlocks.
    await fake.fs.setDoc(null, { isUnlocked: true, targetDate: '2026-09-25T00:00:00' });
    check('every open browser is pushed the unlock in realtime',
      seen[seen.length - 1] === true, seen);

    // And re-locks mid-exam.
    await fake.fs.setDoc(null, { isUnlocked: false, targetDate: '2026-09-25T00:00:00' });
    check('a re-lock is pushed out too', seen[seen.length - 1] === false, seen);

    check('current() tracks the pushed value', S.current().isUnlocked === false);
    unsub();
    await fake.fs.setDoc(null, { isUnlocked: true, targetDate: '2026-09-25T00:00:00' });
    check('unsubscribe really detaches the listener', seen[seen.length - 1] === false, seen);
  }

  // ---- no polling on top of onSnapshot ------------------------------------
  {
    const fake = makeFakeFirestore();
    const S = loadSettingsWithFirestore(fake);
    const realSetInterval = global.setInterval;
    let intervals = 0;
    global.setInterval = function () { intervals++; return realSetInterval.apply(null, arguments); };
    const unsub = S.subscribe(() => {});
    global.setInterval = realSetInterval;
    check('firestore does not also poll (no wasted reads)', intervals === 0, intervals);
    unsub();
  }

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
