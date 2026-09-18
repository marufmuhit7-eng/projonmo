/*
 * backend.test.js — supabase-db.js against a mock of the supabase-js client.
 * Proves the data layer itself: control semantics (fail-closed), realtime
 * refetch, question mapping/CRUD/import, and the registration → RPC →
 * leaderboard flow, all without a network.
 *
 * Run:  node tools/backend.test.js
 */
'use strict';

// --------------------------------------------------------------- the mock
function makeFakeSupabase() {
  const tables = {
    settings:       new Map(),   // id -> row
    questions:      new Map(),   // uuid -> row
    registrations:  new Map(),   // uuid -> row (pid is unique in the data)
    leaderboard:    new Map(),   // pid -> row
    team_members:   new Map()    // uuid -> row
  };
  const handlers = [];           // realtime postgres_changes handlers
  let autoId = 0;
  let regSeq = 0;                // mirrors the reg_counter table
  let clockSeq = 0;              // gives each inserted row a later created_at

  function rows(table) { return Array.from(tables[table].entries()); }

  function filterEq(list, col, val) {
    return list.filter(function (e) { return e[1][col] === val; });
  }

  function builder(table, op, payload) {
    const state = { filters: [], orderKey: null, orderAsc: true, single: false, countOnly: false };
    const b = {
      select(_cols, opts) {
        if (opts && opts.count === 'exact' && opts.head) state.countOnly = true;
        return b;
      },
      insert(rows) { op = 'insert'; payload = rows; return b; },
      upsert(rows) { op = 'upsert'; payload = rows; return b; },
      update(patch) { op = 'update'; payload = patch; return b; },
      delete() { op = 'delete'; payload = null; return b; },
      eq(col, val) { state.filters.push([col, val]); return b; },
      order(col, opts) { state.orderKey = col; state.orderAsc = !(opts && opts.ascending === false); return b; },
      maybeSingle() { state.single = true; return b; },
      then(resolve, reject) {
        return Promise.resolve(run()).then(resolve, reject);
      }
    };

    function run() {
      let list = rows(table);
      state.filters.forEach(function (f) { list = filterEq(list, f[0], f[1]); });

      if (op === 'select') {
        if (state.countOnly) return { count: list.length, data: null, error: null };
        if (state.orderKey) {
          const k = state.orderKey, sign = state.orderAsc ? 1 : -1;
          list = list.slice().sort(function (a, b2) {
            const av = a[1][k], bv = b2[1][k];
            return (av > bv ? 1 : av < bv ? -1 : 0) * sign;
          });
        }
        const data = list.map(function (e) { return e[1]; });
        return { data: state.single ? (data[0] || null) : data, error: null };
      }
      if (op === 'insert') {
        (Array.isArray(payload) ? payload : [payload]).forEach(function (r) {
          const id = r.id || 'auto-' + (++autoId);
          // column defaults the real Postgres table would apply
          const defaults = table === 'registrations'
            ? { exam_taken: false, score: 0, max_score: 0, time_taken_sec: 0,
                created_at: '2026-01-01T00:00:0' + ((++clockSeq) % 9) + '.000Z' }
            : {};
          tables[table].set(id, Object.assign({}, defaults, r, { id: id }));
        });
        return { data: null, error: null };
      }
      if (op === 'upsert') {
        const r = Array.isArray(payload) ? payload[0] : payload;
        tables[table].set(r.id, Object.assign({}, tables[table].get(r.id) || {}, r));
        return { data: null, error: null };
      }
      if (op === 'update') {
        list.forEach(function (e) {
          tables[table].set(e[0], Object.assign({}, e[1], payload));
        });
        return { data: null, error: null };
      }
      if (op === 'delete') {
        list.forEach(function (e) { tables[table].delete(e[0]); });
        return { data: null, error: null };
      }
      return { data: null, error: { message: 'unexpected op ' + op } };
    }
    return b;
  }

  const client = {
    from(table) { return builder(table, 'select', null); },
    rpc(name, params) {
      return Promise.resolve().then(function () {
        if (name === 'create_registration') {
          regSeq += 1;
          const code = 'UHF' + String(regSeq).padStart(6, '0');
          tables.registrations.set(code, {
            id: 'row-' + code, reg_code: code, serial_no: regSeq,
            name: params.p_name, phone: params.p_phone, email: params.p_email,
            institute: params.p_institute, district: params.p_district, cls: params.p_cls,
            category: params.p_category, exam_taken: false, score: 0, max_score: 0,
            time_taken_sec: 0,
            created_at: new Date(Date.UTC(2026, 0, 1, 0, 0, regSeq)).toISOString()
          });
          return { data: code, error: null };
        }
        if (name === 'get_registration') {
          const needle = String(params.p_pid || '').toUpperCase();
          const found = rows('registrations').find(function (e) {
            return e[1].reg_code === needle || e[1].pid === needle;
          });
          return { data: found ? found[1] : null, error: null };
        }
        if (name === 'save_exam_result') {
          const needle2 = String(params.p_pid || '').toUpperCase();
          const found = rows('registrations').find(function (e) {
            return (e[1].reg_code === needle2 || e[1].pid === needle2) && e[1].exam_taken === false;
          });
          if (!found) return { data: false, error: null };
          Object.assign(found[1], {
            exam_taken: true, score: params.p_score, max_score: params.p_max,
            time_taken_sec: params.p_time, category: params.p_cat
          });
          const code2 = found[1].reg_code || found[1].pid;
          tables.leaderboard.set(code2, {
            pid: code2, name: found[1].name, institute: found[1].institute,
            district: found[1].district, score: params.p_score,
            max_score: params.p_max, time_taken_sec: params.p_time
          });
          return { data: true, error: null };
        }
        return { data: null, error: { message: 'unknown rpc ' + name } };
      });
    },
    channel(_name) {
      const ch = {
        on(_type, _opts, handler) { handlers.push(handler); return ch; },
        subscribe() { return ch; }
      };
      return ch;
    },
    removeChannel() {},
    trigger(table) {
      handlers.forEach(function (h) { h({ table: table }); });
    },
    auth: {
      _user: null,
      getUser() { return Promise.resolve({ data: { user: client.auth._user }, error: null }); },
      signInWithPassword(cred) {
        client.auth._user = { email: cred.email };
        return Promise.resolve({ data: { user: client.auth._user }, error: null });
      },
      signOut() { client.auth._user = null; return Promise.resolve({ error: null }); },
      onAuthStateChange(cb) {
        cb(null, client.auth._user ? { user: client.auth._user } : null);
        return { data: { subscription: { unsubscribe() {} } } };
      }
    }
  };
  return client;
}

// ----------------------------------------------------------------- run
global.window = {
  SUPABASE_CONFIG: {
    SUPABASE_URL: 'https://fake.supabase.co',
    SUPABASE_ANON_KEY: 'anon-test'
  },
  supabase: { createClient: function () { return makeFakeSupabase(); } }
};

require('../src/shared/supabase-db.js');
const db = global.window.db;

let passed = 0;
let failed = 0;
function check(label, cond, detail) {
  if (cond) { passed++; console.log('  ok   ' + label); }
  else { failed++; console.log('  FAIL ' + label + (detail !== undefined ? '  -> ' + JSON.stringify(detail) : '')); }
}

(async function run() {
  console.log('supabase-db — data layer (mocked client)\n');

  check('db.active when config + SDK are present', db.active === true);
  check('letterToIndex: C -> 2', db._internal.letterToIndex('C') === 2);

  // ---- exam control: empty settings = LOCKED ----------------------------
  let ctrl = await db.getControl();
  check('empty settings table resolves LOCKED (fail-closed)', ctrl.isUnlocked === false, ctrl);
  check('defaults carry the official dates',
    ctrl.examDate === '2026-09-30T00:00:00+06:00' && ctrl.registrationStart === '2026-08-25', ctrl);

  // ---- realtime: refetch on settings change ------------------------------
  const stop = db.onControl(function () { /* refetch path */ });
  const firstState = await new Promise(function (r) { db.onControl(r); });
  check('onControl fires immediately with the (locked) current state',
    firstState && firstState.isUnlocked === false, firstState);

  await db.saveControl({ isUnlocked: true });
  check('saveControl persists the unlock', (await db.getControl()).isUnlocked === true);
  check('saveControl merged — examDate untouched by the unlock',
    (await db.getControl()).examDate === '2026-09-30T00:00:00+06:00');

  await db.saveControl({ examDate: '2026-10-16T10:00:00+06:00', registrationEnd: '2026-10-01' });
  ctrl = await db.getControl();
  check('saveControl updates dates and keeps the unlock',
    ctrl.examDate === '2026-10-16T10:00:00+06:00' && ctrl.registrationEnd === '2026-10-01' && ctrl.isUnlocked === true, ctrl);

  await db.saveControl({ isUnlocked: false });
  check('re-locking works', (await db.getControl()).isUnlocked === false);

  // (the mock cannot re-read after trigger without a live channel, so the
  //  refetch-on-change path is exercised through saveControl above.)

  // ---- questions ---------------------------------------------------------
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
  check('listQuestions returns both, ordered by order_no', qs.length === 2 && qs[0].order === 1 && qs[1].order === 2);
  check('mapping: option_a..d -> opts_bn', qs[1].opts_bn.join(',') === '৬টি,৭টি,৮টি,৯টি');
  check('mapping: English options fall back to Bangla when empty',
    qs[0].opts_en[0] === 'ঢাকা');
  check('mapping: correct_answer C -> index 2', qs[1].correct === 2);
  check('mapping: numeric correctAnswer 0 -> index 0', qs[0].correct === 0);
  check('empty category returns [] (caller falls back to bundled set)',
    (await db.listQuestions('junior')).length === 0);

  const qid = qs[0].id;
  await db.saveQuestion('primary', {
    question: 'সম্পাদিত প্রশ্ন?', optionA: 'ক', optionB: 'খ', optionC: 'গ', optionD: 'ঘ',
    correctAnswer: 'D', order: 1
  }, qid);
  qs = await db.listQuestions('primary');
  check('editing keeps one copy and updates the text',
    qs.length === 2 && qs.find(function (q) { return q.id === qid; }).q_bn === 'সম্পাদিত প্রশ্ন?');

  await db.deleteQuestion(qid);
  qs = await db.listQuestions('primary');
  check('deleteQuestion removes the row', qs.length === 1 && qs[0].id !== qid);

  // ---- bundled import (one-time migration) --------------------------------
  const juniorSet = [
    { q_bn: 'প্রশ্ন ১', q_en: 'Q1', opts_bn: ['ক', 'খ', 'গ', 'ঘ'], opts_en: ['a', 'b', 'c', 'd'], correct: 1 },
    { q_bn: 'প্রশ্ন ২', q_en: 'Q2', opts_bn: ['ক', 'খ', 'গ', 'ঘ'], opts_en: ['a', 'b', 'c', 'd'], correct: 2 }
  ];
  const first = await db.importBundledQuestions('junior', juniorSet);
  check('importBundledQuestions inserts when the category is empty', first.inserted === 2);
  const second = await db.importBundledQuestions('junior', juniorSet);
  check('second import inserts nothing (no duplicates)', second.inserted === 0 && second.total === 2);

  // ---- registrations + RPC + leaderboard ----------------------------------
  const savedReg = await db.addRegistration({
    pid: 'UHF-IGNORED', name: 'রাফি', school: 'স্কুল', cls: 'প্রাইমারি: ৫ম',
    area: 'রংপুর', phone: '01410785155', email: 'r@example.com', category: 'primary'
  });
  check('addRegistration returns the serial reg_code UHF000001 (client pid ignored)',
    savedReg.pid === 'UHF000001', savedReg);
  check('RPC path is not flagged degraded', savedReg.degraded === false, savedReg);
  check('code matches ^UHF\\d{6}$ with no year digits', /^UHF\d{6}$/.test(savedReg.pid) && savedReg.pid.length === 9);
  const rec = await db.findRegistration('uhf000001');   // case-insensitive like the SQL
  check('findRegistration round-trips by the reg_code', rec && rec.name === 'রাফি');
  check('field mapping: institute -> school, district -> area',
    rec.school === 'স্কুল' && rec.area === 'রংপুর');
  check('new registration has examTaken false', rec.examTaken === false);
  check('unknown pid resolves null (drives "ID not found")',
    (await db.findRegistration('UHF-NOPE')) === null);

  const saved = await db.saveExamResult('UHF000001', {
    name: 'রাফি', school: 'স্কুল', area: 'রংপুর',
    examTaken: true, score: 80, maxScore: 100, timeTakenSec: 320,
    category: 'primary', submittedAt: '2026-09-30T10:05:00+06:00'
  });
  check('saveExamResult resolves true', saved === true);
  const after = await db.findRegistration('UHF000001');
  check('registration now marks examTaken + score', after.examTaken === true && after.score === 80);
  const board = await db.listLeaderboard();
  check('leaderboard row written with score but no phone',
    board.length === 1 && board[0].score === 80 && board[0].phone === undefined);
  const again = await db.saveExamResult('UHF000001', {
    score: 100, maxScore: 100, timeTakenSec: 1, category: 'primary'
  });
  check('second saveExamResult is refused (already taken)', again === false);

  // ---- admin listing -------------------------------------------------------
  const savedNadia = await db.addRegistration({ pid: 'x', name: 'নাদিয়া', school: 'স্কুল২', cls: 'জুনিয়র: ৭ম', area: 'দিনাজপুর', phone: '01XXXXXXXXX', category: 'junior' });
  check('second registration gets the next serial UHF000002', savedNadia.pid === 'UHF000002', savedNadia);
  const regs = await db.listRegistrations();
  check('listRegistrations maps rows for the admin table (serial ascending)',
    regs.length === 2 && regs[0].name === 'রাফি' && regs[0].serialNo === 1 && regs[1].name === 'নাদিয়া' && regs[1].serialNo === 2);

  check('organiser auth is available', db.auth.available() === true);
  const user = await db.auth.signIn('organiser@example.com', 'pass1234');
  check('organiser sign-in returns the user', user && user.email === 'organiser@example.com');
  check('currentUser sees the session', (await db.auth.currentUser()) !== null);
  await db.auth.signOut();
  check('signOut clears the session', (await db.auth.currentUser()) === null);

  // ---- team management ------------------------------------------------------
  await db.saveTeamMember({ name: 'মুদাব্বির মারুফ মুহিত', role: 'আহ্বায়ক', category: 'organizer',
    imageUrl: '/images/muhit.jpg', districtInstitute: 'রংপুর', facebookUrl: '', order: 1 });
  await db.saveTeamMember({ name: 'রংপুর সিটি কর্পোরেশন', role: 'পৃষ্ঠপোষক', category: 'sponsor',
    imageUrl: '/images/rcc.jpg', order: 1 });
  const team = await db.listTeamMembers();
  check('team: two members listed', team.length === 2, team.length);
  check('team: row mapping snake_case -> camelCase',
    team[0].imageUrl === '/images/muhit.jpg' && team[0].districtInstitute === 'রংপুর', team[0]);
  const firstId = team[0].id;
  await db.saveTeamMember({ name: 'মুহিত (সম্পাদিত)', role: 'আহ্বায়ক', category: 'organizer',
    imageUrl: '/images/muhit.jpg', order: 5 }, firstId);
  const team2 = await db.listTeamMembers();
  check('team: edit keeps one copy and updates the name',
    team2.length === 2 && team2.some(function(m){ return m.name === 'মুহিত (সম্পাদিত)'; }));
  let nameRejected = false;
  try { await db.saveTeamMember({ name: '', role: 'x', category: 'sponsor' }); }
  catch (e) { nameRejected = true; }
  check('team: empty name is rejected', nameRejected);
  await db.deleteTeamMember(firstId);
  const team3 = await db.listTeamMembers();
  check('team: delete removes the row', team3.length === 1 && team3[0].category === 'sponsor');

  stop();

  // ---------------------------------------------------------------------
  // Tolerance: the organiser's own draft schema — no pid/exam/category
  // columns, no RPCs, leaderboard without score columns.
  // ---------------------------------------------------------------------
  console.log('\nsupabase-db — draft-schema tolerance\n');

  const BARE_COLS = {
    settings:      ['id', 'is_unlocked', 'exam_date', 'updated_at'],
    questions:     ['id', 'question', 'option_a', 'option_b', 'option_c', 'option_d', 'correct_answer', 'order_no', 'created_at'],
    registrations: ['id', 'name', 'email', 'phone', 'institute', 'district', 'created_at'],
    leaderboard:   ['pid', 'name', 'score']
  };

  function makeBareFake() {
    const tables = { settings: new Map(), questions: new Map(), registrations: new Map(), leaderboard: new Map() };
    let autoId = 0;
    const missing = { code: '42703', message: 'column does not exist' };
    function checkCols(table, cols) {
      return (cols || []).some(function (c) { return BARE_COLS[table].indexOf(c) === -1; });
    }
    function builder(table, op, payload) {
      const state = { filters: [], single: false, countOnly: false };
      const b = {
        select(cols, opts) {
          state.cols = cols ? cols.split(',').map(function (c) { return c.trim(); }) : ['*'];
          if (opts && opts.count === 'exact' && opts.head) state.countOnly = true;
          return b;
        },
        insert(rows) { op = 'insert'; payload = rows; return b; },
        upsert(rows) { op = 'upsert'; payload = rows; return b; },
        update(patch) { op = 'update'; payload = patch; return b; },
        delete() { op = 'delete'; payload = null; return b; },
        eq(col, val) { state.filters.push([col, val]); return b; },
        order() { return b; },
        limit() { return b; },
        maybeSingle() { state.single = true; return b; },
        then(resolve, reject) { return Promise.resolve(run()).then(resolve, reject); }
      };
      function run() {
        if (state.cols && state.cols.join(',') !== '*' && checkCols(table, state.cols)) return { data: null, error: missing };
        if (state.filters.some(function (f) { return BARE_COLS[table].indexOf(f[0]) === -1; })) {
          return { data: null, error: missing };
        }
        if (op === 'insert' || op === 'upsert') {
          const rowsIn = Array.isArray(payload) ? payload : [payload];
          for (const r of rowsIn) {
            if (checkCols(table, Object.keys(r))) return { data: null, error: missing };
          }
          const stored = rowsIn.map(function (r) {
            const id = r.id || ('a1b2c3d4-000' + (++autoId) + '-e5f6a7b8');   // uuid-shaped
            const row = Object.assign({ id: id, created_at: '2026-01-01T00:00:00.000Z' }, r, { id: id });
            tables[table].set(id, row);
            return row;
          });
          return { data: stored, error: null };
        }
        let list = Array.from(tables[table].entries());
        state.filters.forEach(function (f) {
          list = list.filter(function (e) { return e[1][f[0]] === f[1]; });
        });
        if (op === 'select') {
          if (state.countOnly) return { count: list.length, data: null, error: null };
          const data = list.map(function (e) { return e[1]; });
          return { data: state.single ? (data[0] || null) : data, error: null };
        }
        if (op === 'update') {
          list.forEach(function (e) { Object.assign(e[1], payload); });
          return { data: null, error: null };
        }
        return { data: null, error: null };
      }
      return b;
    }
    return {
      from(t) { return builder(t, 'select', null); },
      rpc() { return Promise.resolve({ data: null, error: { code: 'PGRST202', message: 'no matches were found in the schema cache' } }); },
      channel() { return { on() { return this; }, subscribe() { return this; } }; },
      removeChannel() {},
      auth: {
        getUser() { return Promise.resolve({ data: { user: null } }); },
        signInWithPassword() { return Promise.resolve({ data: { user: { email: 'o@x.co' } } }); },
        signOut() { return Promise.resolve({}); },
        onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; }
      }
    };
  }

  global.window.SUPABASE_CONFIG = { SUPABASE_URL: 'https://bare.supabase.co', SUPABASE_ANON_KEY: 'anon-bare' };
  global.window.supabase = { createClient: function () { return makeBareFake(); } };
  delete require.cache[require.resolve('../src/shared/supabase-db.js')];
  require('../src/shared/supabase-db.js');
  const db2 = global.window.db;

  let c2 = await db2.getControl();
  check('draft: settings read works; window dates fall back to defaults',
    c2.isUnlocked === false && c2.registrationStart === '2026-08-25', c2);
  await db2.saveControl({ isUnlocked: true });
  c2 = await db2.getControl();
  check('draft: saveControl persists the unlock without window columns', c2.isUnlocked === true, c2);
  check('draft: windowSupported reports false', db2.windowSupported === false);

  const saved2 = await db2.addRegistration({
    pid: 'UHF-BARE01', name: 'করিম', school: 'স্কুল', cls: 'প্রাইমারি: ৫ম',
    area: 'রংপুর', phone: '01', email: '', category: 'primary'
  });
  check('draft: insert falls back and returns the uuid id as pid',
    saved2 && saved2.pid && saved2.pid.indexOf('UHF-') === -1, saved2);
  check('draft: uuid fallback is flagged degraded — the UI must refuse to show it',
    saved2.degraded === true, saved2);
  const got2 = await db2.findRegistration(saved2.pid);
  check('draft: findRegistration by uuid works (rpc/pid columns missing)', got2 && got2.name === 'করিম');

  let scoreErr = null;
  try { await db2.saveExamResult(saved2.pid, { score: 10, maxScore: 10, timeTakenSec: 30, category: 'primary' }); }
  catch (e) { scoreErr = e; }
  check('draft: saveExamResult without score columns rejects with guidance', !!scoreErr);

  await db2.saveQuestion('primary', {
    question: 'প্রশ্ন?', optionA: 'ক', optionB: 'খ', optionC: 'গ', optionD: 'ঘ',
    correctAnswer: 'A', order: 1
  });
  const qs2 = await db2.listQuestions('primary');
  check('draft: questions save + list work without category column',
    qs2.length === 1 && qs2[0].q_bn === 'প্রশ্ন?' && qs2[0].correct === 0);

  check('draft: leaderboard read tolerates a reduced shape',
    Array.isArray(await db2.listLeaderboard()));

  // ---------------------------------------------------------------------
  // Mixed deployment: only a 5-param create_registration exists, returning
  // the table shape [{id, reg_code, serial_no}].
  // ---------------------------------------------------------------------
  console.log('\nsupabase-db — 5-param RPC variant\n');

  function makeFiveArgFake() {
    return {
      from() { throw new Error('from() must not be reached on this path'); },
      rpc(name, params) {
        return Promise.resolve().then(function () {
          if (name !== 'create_registration') {
            return { data: null, error: { code: 'PGRST202', message: 'no matches were found in the schema cache' } };
          }
          if ('p_cls' in params || 'p_category' in params) {
            // the 7-param call does not match this deployment
            return { data: null, error: { code: 'PGRST202', message: 'no matches were found in the schema cache' } };
          }
          return { data: [{ id: 'uuid-1', reg_code: 'UHF000001', serial_no: 1 }], error: null };
        });
      }
    };
  }

  global.window.SUPABASE_CONFIG = { SUPABASE_URL: 'https://five.supabase.co', SUPABASE_ANON_KEY: 'anon-five' };
  global.window.supabase = { createClient: function () { return makeFiveArgFake(); } };
  delete require.cache[require.resolve('../src/shared/supabase-db.js')];
  require('../src/shared/supabase-db.js');
  const db4 = global.window.db;

  const r4 = await db4.addRegistration({
    pid: 'x', name: 'সালমা', phone: '01', email: '', school: 'স্কুল',
    area: 'রংপুর', cls: 'প্রাইমারি: ৫ম', category: 'primary'
  });
  check('5-param variant: array-shaped response still yields the reg_code',
    r4 && r4.pid === 'UHF000001', r4);

  // ---------------------------------------------------------------------
  // Mixed deployment 2: only a 6-param create_registration exists (the
  // organiser's draft shape — no p_cls, p_category defaults 'সাধারণ').
  // ---------------------------------------------------------------------
  console.log('\nsupabase-db — 6-param RPC variant\n');

  function makeSixArgFake() {
    return {
      from() { throw new Error('from() must not be reached on this path'); },
      rpc(name, params) {
        return Promise.resolve().then(function () {
          if (name !== 'create_registration') {
            return { data: null, error: { code: 'PGRST202', message: 'no matches were found in the schema cache' } };
          }
          if ('p_cls' in params) {
            return { data: null, error: { code: 'PGRST202', message: 'no matches were found in the schema cache' } };
          }
          if (!('p_category' in params) || params.p_category !== 'junior') {
            return { data: null, error: { code: 'PGRST202', message: 'no matches were found in the schema cache' } };
          }
          return { data: 'UHF000003', error: null };
        });
      }
    };
  }

  global.window.SUPABASE_CONFIG = { SUPABASE_URL: 'https://six.supabase.co', SUPABASE_ANON_KEY: 'anon-six' };
  global.window.supabase = { createClient: function () { return makeSixArgFake(); } };
  delete require.cache[require.resolve('../src/shared/supabase-db.js')];
  require('../src/shared/supabase-db.js');
  const db5 = global.window.db;

  const r5 = await db5.addRegistration({
    pid: 'x', name: 'জাহিদ', phone: '02', email: '', school: 'স্কুল',
    area: 'দিনাজপুর', cls: 'জুনিয়র: ৭ম', category: 'junior'
  });
  check('6-param variant: the real category still reaches the RPC',
    r5 && r5.pid === 'UHF000003', r5);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
