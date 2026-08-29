/*
 * supabase-db.js — the ONE place that talks to Supabase (Postgres + Realtime).
 *
 * Loaded after the supabase-js CDN bundle (injected by tools/build.py only
 * when supabase-config.js is filled in) and before every other site script.
 * Exposes window.db — the same facade the site already uses — so app.js,
 * admin.js and settings.js do not care which vendor is behind it.
 *
 * Tables (see supabase/schema.sql)
 * ---------------------------------
 *   settings (id='exam')   is_unlocked, exam_date, registration_start,
 *                          registration_end, updated_at
 *   questions              category, question, question_en,
 *                          option_a..option_d (+ _en), correct_answer,
 *                          order_no
 *   registrations          pid, name, phone, email, institute, district,
 *                          cls, category, exam_taken, score, max_score,
 *                          time_taken_sec, submitted_at
 *   leaderboard            pid, name, institute, district, score… (no PII)
 *
 * SECURITY MODEL (RLS, enforced by Postgres — not by this file)
 * -------------------------------------------------------------
 *   • everyone (anon) may: read settings/questions/leaderboard,
 *     INSERT a registration, look up their own registration by pid
 *     (through the get_registration RPC), save their exam score
 *     (through the save_exam_result RPC)
 *   • only a signed-in organiser (Supabase Auth) may: flip the exam
 *     lock, edit questions, list/update/delete registrations
 *
 * FAIL-CLOSED: unconfigured / offline / error ⇒ defaults ⇒ exam LOCKED.
 * localStorage is never a source of truth for anything global.
 */
(function () {
  'use strict';

  var cfg = (window.SUPABASE_CONFIG || {});
  var configured = !!(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY);

  var client = null;
  if (configured && window.supabase && typeof window.supabase.createClient === 'function') {
    try {
      client = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
    } catch (e) {
      console.error('[supabase-db] createClient failed — staying on fail-closed defaults.', e);
      client = null;
    }
  } else if (configured) {
    console.warn('[supabase-db] SUPABASE_CONFIG is set but the supabase-js SDK did not load ' +
      '(offline or blocked). Fail-closed defaults are in effect.');
  }

  var active = !!client;

  // ------------------------------------------------------------- defaults
  var DEFAULT_CONTROL = {
    isUnlocked: false,                              // 🔒 THE LAW: locked unless told otherwise
    examDate: '2026-09-25T00:00:00+06:00',
    registrationStart: '2026-08-25',
    registrationEnd: '2026-09-20'
  };

  function normControl(raw) {
    var d = raw && typeof raw === 'object' ? raw : {};
    var date = (typeof d.examDate === 'string' && !isNaN(Date.parse(d.examDate)))
      ? d.examDate : DEFAULT_CONTROL.examDate;
    function normDay(v, fallback) {
      return (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) ? v.slice(0, 10) : fallback;
    }
    return {
      isUnlocked: d.isUnlocked === true,            // strict: only a real boolean true unlocks
      examDate: date,
      registrationStart: normDay(d.registrationStart, DEFAULT_CONTROL.registrationStart),
      registrationEnd: normDay(d.registrationEnd, DEFAULT_CONTROL.registrationEnd)
    };
  }

  /** settings টেবিলের সারি -> facade-এর control অবজেক্ট */
  function rowToControl(r) {
    if (!r) return normControl(null);
    return normControl({
      isUnlocked: r.is_unlocked,
      examDate: r.exam_date,
      registrationStart: r.registration_start,
      registrationEnd: r.registration_end
    });
  }

  // --------------------------------------------------------- exam control
  function getControl() {
    if (!active) return Promise.resolve(normControl(null));
    return client.from('settings').select('id,is_unlocked,exam_date,registration_start,registration_end')
      .eq('id', 'exam').maybeSingle()
      .then(function (res) {
        if (res.error) {
          console.error('[supabase-db] settings read failed — staying LOCKED.', res.error);
          return normControl(null);
        }
        return rowToControl(res.data);
      }, function (err) {
        console.error('[supabase-db] settings read failed — staying LOCKED.', err);
        return normControl(null);
      });
  }

  function saveControl(patch) {
    if (!active) {
      return Promise.reject(new Error('Supabase কনফিগার করা নেই — src/shared/supabase-config.js পূরণ করো'));
    }
    return getControl().then(function (current) {
      var next = normControl(Object.assign({}, current, patch || {}));
      return client.from('settings').upsert({
        id: 'exam',
        is_unlocked: next.isUnlocked,
        exam_date: next.examDate,
        registration_start: next.registrationStart,
        registration_end: next.registrationEnd,
        updated_at: new Date().toISOString()
      }).then(function (res) {
        if (res.error) throw new Error(res.error.message);
        return next;
      });
    });
  }

  /**
   * Realtime: the organiser flips the switch, every open browser refetches
   * within a second. Needs `alter publication supabase_realtime add table
   * settings;` (included in schema.sql). Falls back to nothing extra — the
   * page still loads the truth on every visit.
   */
  function onControl(cb) {
    if (!active) { cb(normControl(null)); return function () {}; }
    // fire once immediately so a fresh page paints the right state
    getControl().then(cb).catch(function () { /* already logged */ });
    var channel = client.channel('uhf-exam-control')
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'settings' },
        function () { getControl().then(cb).catch(function () {}); })
      .subscribe();
    return function () { try { client.removeChannel(channel); } catch (e) { /* already gone */ } };
  }

  // ------------------------------------------------------------ questions
  function letterToIndex(v) {
    if (typeof v === 'number' && v >= 0 && v <= 3) return v;
    var i = 'ABCD'.indexOf(String(v || '').toUpperCase());
    return i >= 0 ? i : 0;
  }

  var Q_COLS = 'id,category,question,question_en,option_a,option_b,option_c,option_d,' +
    'option_a_en,option_b_en,option_c_en,option_d_en,correct_answer,order_no';

  function rowToQuestion(r) {
    return {
      id: r.id,
      q_bn: r.question || '',
      q_en: r.question_en || r.question || '',
      opts_bn: [r.option_a, r.option_b, r.option_c, r.option_d],
      opts_en: [r.option_a_en || r.option_a, r.option_b_en || r.option_b,
                r.option_c_en || r.option_c, r.option_d_en || r.option_d],
      correct: letterToIndex(r.correct_answer),
      order: typeof r.order_no === 'number' ? r.order_no : 0
    };
  }

  function listQuestions(catKey) {
    if (!active) return Promise.resolve([]);
    return client.from('questions').select(Q_COLS).eq('category', catKey)
      .order('order_no', { ascending: true })
      .then(function (res) {
        if (res.error) {
          console.error('[supabase-db] questions read failed — falling back to the bundled set.', res.error);
          return [];
        }
        return (res.data || []).map(rowToQuestion);
      });
  }

  function saveQuestion(catKey, q, id) {
    if (!active) {
      return Promise.reject(new Error('Supabase কনফিগার করা নেই — src/shared/supabase-config.js পূরণ করো'));
    }
    var row = {
      category: catKey,
      question: q.question || '',
      question_en: q.questionEn || '',
      option_a: q.optionA || '', option_b: q.optionB || '',
      option_c: q.optionC || '', option_d: q.optionD || '',
      option_a_en: q.optionAEn || '', option_b_en: q.optionBEn || '',
      option_c_en: q.optionCEn || '', option_d_en: q.optionDEn || '',
      correct_answer: 'ABCD'[letterToIndex(q.correctAnswer)],
      order_no: typeof q.order === 'number' ? q.order : 0
    };
    var req = id
      ? client.from('questions').update(row).eq('id', id)
      : client.from('questions').insert(row);
    return req.then(function (res) {
      if (res.error) throw new Error(res.error.message);
    });
  }

  function deleteQuestion(id) {
    if (!active) return Promise.reject(new Error('Supabase কনফিগার করা নেই'));
    return client.from('questions').delete().eq('id', id).then(function (res) {
      if (res.error) throw new Error(res.error.message);
    });
  }

  /**
   * One-time migration helper: push the bundled Bangla question sets into
   * the `questions` table — only when that category has no rows yet, so a
   * second click can never duplicate anything.
   */
  function importBundledQuestions(catKey, bundled) {
    if (!active) return Promise.reject(new Error('Supabase কনফিগার করা নেই'));
    return client.from('questions').select('id', { count: 'exact', head: true })
      .eq('category', catKey)
      .then(function (res) {
        if (res.error) throw new Error(res.error.message);
        if ((res.count || 0) > 0) return { inserted: 0, total: res.count };
        var rows = (bundled || []).map(function (q, i) {
          return {
            category: catKey,
            question: q.q_bn || '',
            question_en: q.q_en || '',
            option_a: q.opts_bn[0] || '', option_b: q.opts_bn[1] || '',
            option_c: q.opts_bn[2] || '', option_d: q.opts_bn[3] || '',
            option_a_en: q.opts_en[0] || '', option_b_en: q.opts_en[1] || '',
            option_c_en: q.opts_en[2] || '', option_d_en: q.opts_en[3] || '',
            correct_answer: 'ABCD'[letterToIndex(q.correct)],
            order_no: i + 1
          };
        });
        if (rows.length === 0) return { inserted: 0, total: 0 };
        return client.from('questions').insert(rows).then(function (r2) {
          if (r2.error) throw new Error(r2.error.message);
          return { inserted: rows.length, total: rows.length };
        });
      });
  }

  // -------------------------------------------------------- registrations
  function rowToRegistration(r) {
    if (!r) return null;
    return {
      pid: r.pid || r.id,
      name: r.name || '',
      school: r.institute || '',     // "institute" in the schema
      area: r.district || '',        // "district" in the schema
      phone: r.phone || '',
      email: r.email || '',
      cls: r.cls || '',
      category: r.category || null,
      examTaken: r.exam_taken === true,
      score: r.score || 0,
      maxScore: r.max_score || 0,
      timeTakenSec: r.time_taken_sec || 0,
      submittedAt: r.submitted_at || null,
      createdAt: r.created_at || null
    };
  }

  function addRegistration(rec) {
    if (!active) {
      return Promise.reject(new Error('রেজিস্ট্রেশন এখন সেভ হতে পারছে না — ডেটাবেস কনফিগার করা নেই। শীঘ্রই আবার চেষ্টা করো।'));
    }
    return client.from('registrations').insert({
      pid: rec.pid,
      name: rec.name,
      phone: rec.phone,
      email: rec.email || '',
      institute: rec.school || '',
      district: rec.area || '',
      cls: rec.cls || '',
      category: rec.category || null
    }).then(function (res) {
      if (res.error) throw new Error(res.error.message);
      return rec;
    });
  }

  /** Exam sign-in: fetch exactly one row by the participant's random ID (RPC). */
  function findRegistration(pid) {
    if (!active) return Promise.resolve(null);
    return client.rpc('get_registration', { p_pid: pid })
      .then(function (res) {
        if (res.error) {
          console.error('[supabase-db] registration lookup failed.', res.error);
          return null;
        }
        return res.data ? rowToRegistration(res.data) : null;
      }, function (err) {
        console.error('[supabase-db] registration lookup failed.', err);
        return null;
      });
  }

  /** Save the score through the security-definer RPC (updates + leaderboard). */
  function saveExamResult(pid, result) {
    if (!active) return Promise.reject(new Error('Supabase কনফিগার করা নেই'));
    return client.rpc('save_exam_result', {
      p_pid: pid,
      p_score: result.score,
      p_max: result.maxScore,
      p_time: result.timeTakenSec,
      p_cat: result.category
    }).then(function (res) {
      if (res.error) throw new Error(res.error.message);
      return res.data === true;
    });
  }

  function listRegistrations() {
    if (!active) return Promise.resolve([]);
    return client.from('registrations').select('*').order('created_at', { ascending: false })
      .then(function (res) {
        if (res.error) throw new Error(res.error.message);
        return (res.data || []).map(rowToRegistration);
      });
  }

  function listLeaderboard() {
    if (!active) return Promise.resolve([]);
    return client.from('leaderboard').select('pid,name,institute,district,score,max_score,time_taken_sec,created_at')
      .then(function (res) {
        if (res.error) {
          console.error('[supabase-db] leaderboard read failed.', res.error);
          return [];
        }
        return (res.data || []).map(function (r) {
          return {
            pid: r.pid, name: r.name, school: r.institute, area: r.district,
            score: r.score, maxScore: r.max_score, timeTakenSec: r.time_taken_sec,
            examTaken: true
          };
        });
      });
  }

  // ----------------------------------------------------- organiser auth
  var authApi = {
    available: function () { return active; },
    signIn: function (email, password) {
      if (!active) return Promise.reject(new Error('Supabase কনফিগার করা নেই'));
      return client.auth.signInWithPassword({ email: email, password: password })
        .then(function (res) {
          if (res.error) throw new Error(res.error.message);
          return res.data.user;
        });
    },
    signOut: function () {
      if (!active) return Promise.resolve();
      return client.auth.signOut();
    },
    currentUser: function () {
      if (!active) return Promise.resolve(null);
      return client.auth.getUser().then(function (res) {
        return (res.data && res.data.user) || null;
      }).catch(function () { return null; });
    },
    onAuthChange: function (cb) {
      if (!active) return function () {};
      var sub = client.auth.onAuthStateChange(function (_ev, session) {
        cb(session ? session.user : null);
      });
      return function () {
        try { sub.data.subscription.unsubscribe(); } catch (e) { /* already gone */ }
      };
    }
  };

  window.db = {
    active: active,
    configured: configured,
    DEFAULT_CONTROL: DEFAULT_CONTROL,
    getControl: getControl,
    saveControl: saveControl,
    onControl: onControl,
    listQuestions: listQuestions,
    saveQuestion: saveQuestion,
    deleteQuestion: deleteQuestion,
    importBundledQuestions: importBundledQuestions,
    addRegistration: addRegistration,
    findRegistration: findRegistration,
    saveExamResult: saveExamResult,
    listRegistrations: listRegistrations,
    listLeaderboard: listLeaderboard,
    auth: authApi,
    _internal: { normControl: normControl, rowToControl: rowToControl, rowToQuestion: rowToQuestion, letterToIndex: letterToIndex }
  };
})();
