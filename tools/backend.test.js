/*
 * backend.test.js — firebase-db.js against a mock of the compat SDK.
 * Proves the Firestore layer itself: control doc semantics (fail-closed),
 * realtime push, question mapping and the registration/leaderboard flow.
 *
 * Run:  node tools/backend.test.js
 */
'use strict';

// --------------------------------------------------------------- the mock
function makeFakeFirebase() {
  const cols = new Map();     // 'settings' -> Map('examControl' -> data)
  const listeners = [];       // { full, cb } — onSnapshot subscribers
  let autoId = 0;

  function notify(full) {
    listeners.forEach(function (l) {
      if (l.full !== full) return;
      const [path, id] = full.split('/');
      const m = cols.get(path);
      l.cb({ exists: m && m.has(id), data: function () { return m && m.get(id); } });
    });
  }

  const FieldValue = { serverTimestamp: function () { return { __serverTimestamp: true }; } };

  const fs = {
    collection: function (path) {
      const col = {
        _filters: [],
        _order: null,
        where: function (field, op, val) {
          if (op === '==') col._filters.push([field, val]);
          return col;
        },
        orderBy: function (field, dir) {
          col._order = [field, dir || 'asc'];
          return col;
        },
        get: function () {
          const m = cols.get(path) || new Map();
          let docs = Array.from(m.entries()).map(function (e) {
            return { id: e[0], data: function () { return e[1]; } };
          });
          col._filters.forEach(function (f) {
            docs = docs.filter(function (d) { return d.data()[f[0]] === f[1]; });
          });
          if (col._order) {
            const key = col._order[0], sign = col._order[1] === 'desc' ? -1 : 1;
            docs = docs.slice().sort(function (a, b) {
              const av = a.data()[key], bv = b.data()[key];
              return (av > bv ? 1 : av < bv ? -1 : 0) * sign;
            });
          }
          return Promise.resolve({ docs: docs });
        },
        doc: function (id) {
          id = id || 'auto-' + (++autoId);
          const full = path + '/' + id;
          function map() {
            if (!cols.has(path)) cols.set(path, new Map());
            return cols.get(path);
          }
          return {
            get: function () {
              const m = map();
              return Promise.resolve({ exists: m.has(id), data: function () { return m.get(id); } });
            },
            set: function (data, opts) {
              const m = map();
              m.set(id, opts && opts.merge ? Object.assign({}, m.get(id) || {}, data) : data);
              notify(full);
              return Promise.resolve();
            },
            update: function (patch) {
              const m = map();
              m.set(id, Object.assign({}, m.get(id) || {}, patch));
              notify(full);
              return Promise.resolve();
            },
            delete: function () {
              map().delete(id);
              notify(full);
              return Promise.resolve();
            },
            onSnapshot: function (cb) {
              listeners.push({ full: full, cb: cb });
              const m = map();
              cb({ exists: m.has(id), data: function () { return m.get(id); } });
              return function () {};
            }
          };
        }
      };
      return col;
    }
  };

  const authMock = {
    currentUser: null,
    signInWithEmailAndPassword: function (email) { return Promise.resolve({ user: { email: email } }); },
    signOut: function () { return Promise.resolve(); },
    onAuthStateChanged: function (cb) { cb(null); return function () {}; }
  };

  const app = {
    firestore: function () { return fs; },
    auth: function () { return authMock; }
  };

  return { initializeApp: function () { return app; }, firestore: { FieldValue: FieldValue } };
}

// ----------------------------------------------------------------- run
global.window = {
  APP_CONFIG: { TZ_OFFSET: '+06:00' },
  FIREBASE_CONFIG: { apiKey: 'AIza-test', projectId: 'test-project' },
  firebase: makeFakeFirebase()
};

require('../src/shared/firebase-db.js');
const db = global.window.db;

let passed = 0;
let failed = 0;
function check(label, cond, detail) {
  if (cond) { passed++; console.log('  ok   ' + label); }
  else { failed++; console.log('  FAIL ' + label + (detail !== undefined ? '  -> ' + JSON.stringify(detail) : '')); }
}

(async function run() {
  console.log('firebase-db — Firestore layer (mocked SDK)\n');

  check('db.active when config + SDK are present', db.active === true);
  check('letterToIndex: B -> 1', db._internal.letterToIndex('B') === 1);
  check('letterToIndex: number 3 stays 3', db._internal.letterToIndex(3) === 3);
  check('letterToIndex: junk -> 0', db._internal.letterToIndex('Z') === 0);

  // ---- exam control: missing doc = LOCKED --------------------------------
  let ctrl = await db.getControl();
  check('missing examControl doc resolves LOCKED (fail-closed)', ctrl.isUnlocked === false, ctrl);
  check('missing doc still carries the official dates',
    ctrl.examDate === '2026-09-25T00:00:00+06:00' && ctrl.registrationStart === '2026-08-25');

  // ---- realtime: onSnapshot hears the organiser's flip -------------------
  let latest = null;
  db.onControl(function (s) { latest = s; });
  check('onControl fires immediately with the (locked) current state',
    latest && latest.isUnlocked === false);

  await db.saveControl({ isUnlocked: true });
  check('after saveControl({isUnlocked:true}) the listener saw LIVE', latest && latest.isUnlocked === true);

  ctrl = await db.getControl();
  check('saveControl merged — examDate untouched by the unlock', ctrl.examDate === '2026-09-25T00:00:00+06:00');
  check('saveControl persisted the registration window',
    ctrl.registrationStart === '2026-08-25' && ctrl.registrationEnd === '2026-09-20');

  await db.saveControl({ examDate: '2026-10-16T10:00:00+06:00', registrationEnd: '2026-10-01' });
  ctrl = await db.getControl();
  check('saveControl updates dates and keeps the unlock',
    ctrl.examDate === '2026-10-16T10:00:00+06:00' && ctrl.registrationEnd === '2026-10-01' && ctrl.isUnlocked === true);

  await db.saveControl({ isUnlocked: false });
  ctrl = await db.getControl();
  check('re-locking works', ctrl.isUnlocked === false);

  // ---- junk in the doc must not open anything ----------------------------
  await db.saveControl({ isUnlocked: true });
  // write junk directly through the mock
  global.window.firebase.firestore.FieldValue; // touch to keep lint quiet
  const raw = db._internal;
  check('normControl: "true" string is NOT an unlock', raw.normControl({ isUnlocked: 'true' }).isUnlocked === false);
  check('normControl: bad examDate falls back', raw.normControl({ examDate: 'garbage' }).examDate === db.DEFAULT_CONTROL.examDate);

  // ---- questions ----------------------------------------------------------
  await db.saveQuestion('primary', {
    question: 'রংপুর বিভাগ কয়টি জেলা?', questionEn: 'How many districts?',
    optionA: '৬টি', optionB: '৭টি', optionC: '৮টি', optionD: '৯টি',
    optionAEn: '6', optionBEn: '7', optionCEn: '8', optionDEn: '9',
    correctAnswer: 'C', order: 2
  });
  await db.saveQuestion('primary', {
    question: 'রাজধানী?', optionA: 'ঢাকা', optionB: 'খুলনা', optionC: 'রংপুর', optionD: 'বরিশাল',
    correctAnswer: 0, order: 1
  });
  let qs = await db.listQuestions('primary');
  check('listQuestions returns both questions', qs.length === 2, qs.length);
  check('ordered by "order" (1 first)', qs[0].order === 1 && qs[1].order === 2);
  check('mapping: optionA-D -> opts_bn', qs[1].opts_bn.join(',') === '৬টি,৭টি,৮টি,৯টি');
  check('mapping: English options fall back to Bangla when absent',
    qs[0].opts_en[0] === 'ঢাকা');
  check('mapping: correctAnswer C -> index 2', qs[1].correct === 2);
  check('mapping: numeric correctAnswer 0 -> index 0', qs[0].correct === 0);
  const junior = await db.listQuestions('junior');
  check('empty category returns [] (caller falls back to bundled set)', junior.length === 0);

  const qid = qs[0].id;
  await db.saveQuestion('primary', {
    question: 'সম্পাদিত প্রশ্ন?', optionA: 'ক', optionB: 'খ', optionC: 'গ', optionD: 'ঘ',
    correctAnswer: 'D', order: 1
  }, qid);
  qs = await db.listQuestions('primary');
  check('editing keeps one copy and updates fields',
    qs.length === 2 && qs.find(function (q) { return q.id === qid; }).q_bn === 'সম্পাদিত প্রশ্ন?');

  await db.deleteQuestion(qid);
  qs = await db.listQuestions('primary');
  check('deleteQuestion removes the row', qs.length === 1 && qs[0].id !== qid);

  // ---- registrations + exam result + leaderboard ---------------------------
  await db.addRegistration({
    pid: 'UHF-AB12CD', name: 'রাফি', school: 'স্কুল', cls: 'প্রাইমারি: ৫ম',
    area: 'রংপুর', phone: '01410785155', email: 'r@example.com', category: 'primary'
  });
  const rec = await db.findRegistration('UHF-AB12CD');
  check('addRegistration + findRegistration round-trip', rec && rec.name === 'রাফি');
  check('new registration has examTaken false', rec.examTaken === false);

  const missing = await db.findRegistration('UHF-NOPE');
  check('unknown pid resolves null (drives "ID not found")', missing === null);

  await db.saveExamResult('UHF-AB12CD', {
    name: 'রাফি', school: 'স্কুল', area: 'রংপুর',
    examTaken: true, score: 80, maxScore: 100, timeTakenSec: 320,
    category: 'primary', submittedAt: '2026-09-25T10:05:00+06:00'
  });
  const after = await db.findRegistration('UHF-AB12CD');
  check('saveExamResult marks examTaken + score', after.examTaken === true && after.score === 80);
  const board = await db.listLeaderboard();
  check('leaderboard row written with score but no phone',
    board.length === 1 && board[0].score === 80 && board[0].phone === undefined);

  const regs = await db.listRegistrations();
  check('listRegistrations returns the row', regs.length === 1 && regs[0].pid === 'UHF-AB12CD');

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
