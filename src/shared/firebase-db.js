/*
 * firebase-db.js — the ONE place that talks to Firebase Firestore.
 *
 * Loaded after the Firebase compat SDK (injected by tools/build.py only when
 * firebase-config.js is filled in) and before every other site script.
 *
 * Collections
 * -----------
 *   settings/examControl   { isUnlocked:false, examDate:'2026-09-25T00:00:00+06:00',
 *                            registrationStart:'2026-08-25', registrationEnd:'2026-09-20',
 *                            updatedAt }
 *   questions/{id}         { category, question, questionEn?, optionA..optionD,
 *                            optionAEn..optionDEn?, correctAnswer:'A'-'D', order, createdAt }
 *   registrations/{pid}    { name, phone, email, school, cls, area, pid,
 *                            examTaken, score, maxScore, timeTakenSec, category,
 *                            submittedAt, createdAt }
 *   leaderboard/{pid}      public score rows (name/school/area/score — no PII)
 *
 * FAIL-CLOSED RULE
 * ----------------
 * When Firebase is not configured, the SDK failed to load, or a read errors,
 * every getter resolves to the shipped defaults and the exam stays LOCKED.
 * localStorage is used ONLY as a cache of the visitor's own registration —
 * never as the source of truth for anything global.
 */
(function () {
  'use strict';

  var cfg = window.FIREBASE_CONFIG || {};
  var configured = !!(cfg.apiKey && cfg.projectId);

  var fs = null;        // Firestore instance
  var authInstance = null;
  var initError = null;

  if (configured && window.firebase) {
    try {
      var app = window.firebase.initializeApp(cfg);
      fs = app.firestore();
      try { authInstance = app.auth(); } catch (e) { /* auth compat script not loaded */ }
    } catch (e) {
      initError = e;
      console.error('[firebase-db] init failed — everything stays on fail-closed defaults.', e);
    }
  } else if (configured && !window.firebase) {
    console.warn('[firebase-db] FIREBASE_CONFIG is set but the Firebase SDK did not load ' +
      '(offline or blocked). Fail-closed defaults are in effect.');
  }

  var active = !!fs;

  // ------------------------------------------------------------- defaults
  var DEFAULT_CONTROL = {
    isUnlocked: false,                              // 🔒 THE LAW: locked unless told otherwise
    examDate: '2026-09-25T00:00:00+06:00',
    registrationStart: '2026-08-25',
    registrationEnd: '2026-09-20'
  };

  function normControl(data) {
    var d = data && typeof data === 'object' ? data : {};
    var date = (typeof d.examDate === 'string' && !isNaN(Date.parse(d.examDate)))
      ? d.examDate : DEFAULT_CONTROL.examDate;
    function normDay(v, fallback) {
      return (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) ? v : fallback;
    }
    return {
      isUnlocked: d.isUnlocked === true,             // strict: only real `true` unlocks
      examDate: date,
      registrationStart: normDay(d.registrationStart, DEFAULT_CONTROL.registrationStart),
      registrationEnd: normDay(d.registrationEnd, DEFAULT_CONTROL.registrationEnd)
    };
  }

  // --------------------------------------------------------- exam control
  function controlRef() { return fs.collection('settings').doc('examControl'); }

  function getControl() {
    if (!active) return Promise.resolve(normControl(null));
    return controlRef().get()
      .then(function (snap) { return normControl(snap.exists ? snap.data() : null); })
      .catch(function (err) {
        console.error('[firebase-db] examControl read failed — staying LOCKED.', err);
        return normControl(null);
      });
  }

  function saveControl(patch) {
    if (!active) {
      return Promise.reject(new Error('Firebase কনফিগার করা নেই — src/shared/firebase-config.js পূরণ করো'));
    }
    return getControl().then(function (current) {
      var next = normControl(Object.assign({}, current, patch || {}));
      return controlRef().set(Object.assign({}, next, {
        updatedAt: window.firebase.firestore.FieldValue.serverTimestamp()
      }), { merge: true }).then(function () { return next; });
    });
  }

  function onControl(cb) {
    if (!active) { cb(normControl(null)); return function () {}; }
    return controlRef().onSnapshot(
      function (snap) { cb(normControl(snap.exists ? snap.data() : null)); },
      function (err) { console.error('[firebase-db] examControl listener error — last known state stays.', err); }
    );
  }

  // ------------------------------------------------------------ questions
  function letterToIndex(v) {
    if (typeof v === 'number' && v >= 0 && v <= 3) return v;
    var i = 'ABCD'.indexOf(String(v || '').toUpperCase());
    return i >= 0 ? i : 0;
  }

  /** Firestore doc -> the shape the bilingual exam UI renders. */
  function docToQuestion(id, d) {
    var optsBn = [d.optionA, d.optionB, d.optionC, d.optionD];
    var optsEn = [d.optionAEn || d.optionA, d.optionBEn || d.optionB,
                  d.optionCEn || d.optionC, d.optionDEn || d.optionD];
    return {
      id: id,
      q_bn: d.question || '',
      q_en: d.questionEn || d.question || '',
      opts_bn: optsBn,
      opts_en: optsEn,
      correct: letterToIndex(d.correctAnswer),
      order: typeof d.order === 'number' ? d.order : 0
    };
  }

  function listQuestions(catKey) {
    if (!active) return Promise.resolve([]);
    return fs.collection('questions')
      .where('category', '==', catKey).orderBy('order', 'asc').get()
      .then(function (snap) { return snap.docs.map(function (d) { return docToQuestion(d.id, d.data()); }); })
      .catch(function (err) {
        console.error('[firebase-db] questions read failed — falling back to the bundled set.', err);
        return [];
      });
  }

  function saveQuestion(catKey, q, id) {
    if (!active) {
      return Promise.reject(new Error('Firebase কনফিগার করা নেই — src/shared/firebase-config.js পূরণ করো'));
    }
    var doc = {
      category: catKey,
      question: q.question || '',
      questionEn: q.questionEn || '',
      optionA: q.optionA || '', optionB: q.optionB || '',
      optionC: q.optionC || '', optionD: q.optionD || '',
      optionAEn: q.optionAEn || '', optionBEn: q.optionBEn || '',
      optionCEn: q.optionCEn || '', optionDEn: q.optionDEn || '',
      correctAnswer: 'ABCD'[letterToIndex(q.correctAnswer)],
      order: typeof q.order === 'number' ? q.order : 0
    };
    var ref = id ? fs.collection('questions').doc(id) : fs.collection('questions').doc();
    var payload = id ? Object.assign({}, doc, { updatedAt: window.firebase.firestore.FieldValue.serverTimestamp() })
                     : Object.assign({}, doc, { createdAt: window.firebase.firestore.FieldValue.serverTimestamp() });
    return ref.set(payload, { merge: true });
  }

  function deleteQuestion(id) {
    if (!active) return Promise.reject(new Error('Firebase কনফিগার করা নেই'));
    return fs.collection('questions').doc(id).delete();
  }

  // -------------------------------------------------------- registrations
  function addRegistration(rec) {
    if (!active) {
      return Promise.reject(new Error('রেজিস্ট্রেশন এখন সেভ হতে পারছে না — ডেটাবেস কনফিগার করা নেই। শীঘ্রই আবার চেষ্টা করো।'));
    }
    var payload = {
      pid: rec.pid,
      name: rec.name, phone: rec.phone, email: rec.email || '',
      school: rec.school || '',          // "institute"
      cls: rec.cls || '',
      area: rec.area || '',              // "district"
      examTaken: false, score: 0, maxScore: 0, timeTakenSec: 0,
      category: rec.category || null,
      submittedAt: null,
      createdAt: window.firebase.firestore.FieldValue.serverTimestamp()
    };
    return fs.collection('registrations').doc(rec.pid).set(payload).then(function () { return rec; });
  }

  function findRegistration(pid) {
    if (!active) return Promise.resolve(null);
    return fs.collection('registrations').doc(pid).get()
      .then(function (snap) { return snap.exists ? snap.data() : null; })
      .catch(function (err) { console.error('[firebase-db] registration lookup failed.', err); return null; });
  }

  function saveExamResult(pid, result) {
    if (!active) return Promise.reject(new Error('Firebase কনফিগার করা নেই'));
    var patch = {
      examTaken: true,
      score: result.score, maxScore: result.maxScore,
      timeTakenSec: result.timeTakenSec, category: result.category,
      submittedAt: result.submittedAt
    };
    var reg = fs.collection('registrations').doc(pid).update(patch);
    // The public leaderboard row: name/school/area/score only — no phone/email.
    var board = fs.collection('leaderboard').doc(pid).set(Object.assign({
      name: result.name, school: result.school, area: result.area
    }, patch));
    return Promise.all([reg, board]);
  }

  function listRegistrations() {
    if (!active) return Promise.resolve([]);
    return fs.collection('registrations').orderBy('createdAt', 'desc').get()
      .then(function (snap) {
        return snap.docs.map(function (d) {
          var r = d.data(); r.pid = r.pid || d.id; return r;
        });
      });
  }

  function listLeaderboard() {
    if (!active) return Promise.resolve([]);
    return fs.collection('leaderboard').get()
      .then(function (snap) { return snap.docs.map(function (d) { return d.data(); }); })
      .catch(function (err) {
        console.error('[firebase-db] leaderboard read failed.', err);
        return [];
      });
  }

  // ----------------------------------------------------- organiser auth
  var authApi = {
    available: function () { return !!authInstance; },
    signIn: function (email, password) {
      if (!authInstance) return Promise.reject(new Error('Firebase Auth লোড হয়নি'));
      return authInstance.signInWithEmailAndPassword(email, password)
        .then(function (cred) { return cred.user; });
    },
    signOut: function () {
      if (!authInstance) return Promise.resolve();
      return authInstance.signOut();
    },
    currentUser: function () {
      if (!authInstance) return Promise.resolve(null);
      return Promise.resolve(authInstance.currentUser);
    },
    onAuthChange: function (cb) {
      if (!authInstance) return function () {};
      return authInstance.onAuthStateChanged(cb);
    }
  };

  window.db = {
    active: active,                       // Firestore actually initialised?
    configured: configured,               // config values present?
    initError: initError,
    DEFAULT_CONTROL: DEFAULT_CONTROL,
    getControl: getControl,
    saveControl: saveControl,
    onControl: onControl,
    listQuestions: listQuestions,
    saveQuestion: saveQuestion,
    deleteQuestion: deleteQuestion,
    addRegistration: addRegistration,
    findRegistration: findRegistration,
    saveExamResult: saveExamResult,
    listRegistrations: listRegistrations,
    listLeaderboard: listLeaderboard,
    auth: authApi,
    _internal: { normControl: normControl, docToQuestion: docToQuestion, letterToIndex: letterToIndex }
  };
})();
