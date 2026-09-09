/*
 * supabase-db.js — the ONE place that talks to Supabase (Postgres + Realtime).
 *
 * Loaded after the supabase-js CDN bundle (injected by tools/build.py only
 * when supabase-config.js is filled in) and before every other site script.
 * Exposes window.db — the vendor-agnostic facade the rest of the site uses.
 *
 * SCHEMA TOLERANCE
 * ----------------
 * The live database was created from the organiser's own draft SQL, so this
 * layer detects what actually exists and degrades gracefully:
 *   settings without registration_start/end  -> defaults (Aug 25 – Sep 20)
 *   registrations without pid/exam columns   -> uuid `id` becomes the
 *                                                participant ID; scores stay
 *                                                unsaved until the patch SQL
 *   questions without category/_en columns   -> core columns only
 *   missing get_registration/save_exam_result RPCs -> REST fallbacks
 * Running supabase/migrate-existing.sql on that same database restores every
 * feature (pid column, score columns, RPCs, SECURE policies, realtime).
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

  // ---------------------------------------------- error shape recognition
  function missingColumn(err) {
    var m = String((err && err.message) || '').toLowerCase();
    return !!err && (err.code === '42703' || err.code === 'PGRST204' ||
      m.indexOf('does not exist') !== -1 || m.indexOf('could not find the table') !== -1);
  }
  function missingRpc(err) {
    var m = String((err && err.message) || '').toLowerCase();
    return !!err && (err.code === 'PGRST202' || m.indexOf('schema cache') !== -1);
  }

  // ------------------------------------------------------------- defaults
  var DEFAULT_CONTROL = {
    isUnlocked: false,                              // 🔒 THE LAW: locked unless told otherwise
    examDate: '2026-09-25T00:00:00+06:00',
    registrationStart: '2026-08-25',
    registrationEnd: '2026-09-20'
  };

  var settingsKeys = null;      // column names seen on the settings row, once read

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

  function rowToControl(r) {
    if (r) settingsKeys = Object.keys(r);
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
    return client.from('settings').select('*').eq('id', 'exam').maybeSingle()
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

  function controlPayload(next, withWindow) {
    var p = {
      id: 'exam',
      is_unlocked: next.isUnlocked,
      exam_date: next.examDate,
      updated_at: new Date().toISOString()
    };
    if (withWindow) {
      p.registration_start = next.registrationStart;
      p.registration_end = next.registrationEnd;
    }
    return p;
  }

  function upsertControl(payload) {
    return client.from('settings').upsert(payload).then(function (res) {
      if (res.error) throw res.error;
    });
  }

  function saveControl(patch) {
    if (!active) {
      return Promise.reject(new Error('Supabase কনফিগার করা নেই — src/shared/supabase-config.js পূরণ করো'));
    }
    return getControl().then(function (current) {
      var next = normControl(Object.assign({}, current, patch || {}));
      // Only send the registration-window columns when they actually exist.
      var withWindow = settingsKeys
        ? (settingsKeys.indexOf('registration_start') !== -1 && settingsKeys.indexOf('registration_end') !== -1)
        : true;                                  // unknown yet: try, then retry bare
      return upsertControl(controlPayload(next, withWindow))
        .catch(function (err) {
          if (withWindow && missingColumn(err)) return upsertControl(controlPayload(next, false));
          throw err;
        })
        .then(function () { return next; });
    });
  }

  /**
   * Realtime: the organiser flips the switch, every open browser refetches
   * within a second (needs the publication from schema.sql / migrate-existing.sql).
   */
  function onControl(cb) {
    if (!active) { cb(normControl(null)); return function () {}; }
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
      cat: r.category || '',
      q_bn: r.question || '',
      q_en: r.question_en || r.question || '',
      opts_bn: [r.option_a, r.option_b, r.option_c, r.option_d],
      opts_en: [r.option_a_en || r.option_a, r.option_b_en || r.option_b,
                r.option_c_en || r.option_c, r.option_d_en || r.option_d],
      correct: letterToIndex(r.correct_answer),
      order: typeof r.order_no === 'number' ? r.order_no : 0
    };
  }

  function coreQuestionRow(catKey, q) {
    // what every draft of the table has
    return {
      question: q.question || '',
      option_a: q.optionA || '', option_b: q.optionB || '',
      option_c: q.optionC || '', option_d: q.optionD || '',
      correct_answer: 'ABCD'[letterToIndex(q.correctAnswer)],
      order_no: typeof q.order === 'number' ? q.order : 0
    };
  }
  function fullQuestionRow(catKey, q) {
    return Object.assign(coreQuestionRow(catKey, q), {
      category: catKey,
      question_en: q.questionEn || '',
      option_a_en: q.optionAEn || '', option_b_en: q.optionBEn || '',
      option_c_en: q.optionCEn || '', option_d_en: q.optionDEn || ''
    });
  }

  function listQuestions(catKey) {
    if (!active) return Promise.resolve([]);
    return client.from('questions').select(Q_COLS).eq('category', catKey)
      .order('order_no', { ascending: true })
      .then(function (res) {
        if (res.error && missingColumn(res.error)) {
          // draft schema: no category / _en columns — list everything ordered
          return client.from('questions').select('*').order('order_no', { ascending: true })
            .then(function (r2) {
              if (r2.error) {
                console.error('[supabase-db] questions read failed — falling back to the bundled set.', r2.error);
                return [];
              }
              return (r2.data || []).map(rowToQuestion);
            });
        }
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
    function attempt(row) {
      var req = id
        ? client.from('questions').update(row).eq('id', id)
        : client.from('questions').insert(row);
      return req.then(function (res) { if (res.error) throw res.error; });
    }
    return attempt(fullQuestionRow(catKey, q))
      .catch(function (err) {
        if (missingColumn(err)) return attempt(coreQuestionRow(catKey, q));
        throw err;
      });
  }

  function deleteQuestion(id) {
    if (!active) return Promise.reject(new Error('Supabase কনফিগার করা নেই'));
    return client.from('questions').delete().eq('id', id).then(function (res) {
      if (res.error) throw res.error;
    });
  }

  /** Everything, ordered by category then order_no (exam fallback + admin). */
  function listAllQuestions() {
    if (!active) return Promise.resolve([]);
    return client.from('questions').select(Q_COLS).order('category', { ascending: true })
      .order('order_no', { ascending: true })
      .then(function (res) {
        if (res.error && missingColumn(res.error)) {
          return client.from('questions').select('*').order('order_no', { ascending: true })
            .then(function (r2) {
              if (r2.error) {
                console.error('[supabase-db] questions read failed — falling back to the bundled set.', r2.error);
                return [];
              }
              return (r2.data || []).map(rowToQuestion);
            });
        }
        if (res.error) {
          console.error('[supabase-db] questions read failed — falling back to the bundled set.', res.error);
          return [];
        }
        return (res.data || []).map(rowToQuestion);
      });
  }

  /** Bulk insert for the sheet importer — chunked, schema-tolerant. */
  function bulkInsertQuestions(rows) {
    if (!active) return Promise.reject(new Error('Supabase কনফিগার করা নেই'));
    var list = rows || [];
    if (list.length === 0) return Promise.resolve(0);

    function core(r) {
      return {
        question: r.question, option_a: r.option_a, option_b: r.option_b,
        option_c: r.option_c, option_d: r.option_d,
        correct_answer: r.correct_answer, order_no: r.order_no
      };
    }
    function full(r) {
      return Object.assign(core(r), {
        category: r.category, question_en: r.question_en || '',
        option_a_en: r.option_a_en || '', option_b_en: r.option_b_en || '',
        option_c_en: r.option_c_en || '', option_d_en: r.option_d_en || '',
        source: r.source || null, source_url: r.source_url || null,
        updated_at: new Date().toISOString()
      });
    }
    function insertChunk(chunkRows, map) {
      return client.from('questions').insert(chunkRows.map(map)).then(function (res) {
        if (res.error) throw res.error;
      });
    }

    var CHUNK = 100;
    var chunks = [];
    for (var i = 0; i < list.length; i += CHUNK) chunks.push(list.slice(i, i + CHUNK));

    var inserted = 0;
    var bare = false;   // draft schema: drop the extended columns
    return chunks.reduce(function (p, chunk) {
      return p.then(function () {
        return insertChunk(chunk, bare ? core : full).catch(function (err) {
          if (!bare && missingColumn(err)) {
            bare = true;
            return insertChunk(chunk, core);
          }
          throw err;
        }).then(function () { inserted += chunk.length; });
      });
    }, Promise.resolve()).then(function () { return inserted; });
  }

  /** Remove every question of one category (sheet "replace category" mode). */
  function deleteQuestionsByCategory(cat) {
    if (!active) return Promise.reject(new Error('Supabase কনফিগার করা নেই'));
    return client.from('questions').delete().eq('category', cat).then(function (res) {
      if (res.error) {
        if (missingColumn(res.error)) {
          throw new Error('questions টেবিলে category কলাম নেই — আগে supabase/migrate-existing.sql চালাও');
        }
        throw res.error;
      }
    });
  }

  /** Remove every question (sheet "replace all" mode). DANGER. */
  function deleteAllQuestions() {
    if (!active) return Promise.reject(new Error('Supabase কনফিগার করা নেই'));
    return client.from('questions').delete().neq('id', '00000000-0000-0000-0000-000000000000')
      .then(function (res) { if (res.error) throw res.error; });
  }

  /**
   * One-time migration: push the bundled Bangla question sets into the table
   * — only while that category has no rows, so re-clicking never duplicates.
   */
  function importBundledQuestions(catKey, bundled) {
    if (!active) return Promise.reject(new Error('Supabase কনফিগার করা নেই'));
    function countBy(cat) {
      return client.from('questions').select('id', { count: 'exact', head: true }).eq('category', cat)
        .then(function (res) {
          if (res.error && missingColumn(res.error)) {
            // no category column: emptiness is global, not per category
            return client.from('questions').select('id', { count: 'exact', head: true })
              .then(function (r2) { return r2.error ? Promise.throw(r2.error) : (r2.count || 0); });
          }
          if (res.error) throw res.error;
          return res.count || 0;
        });
    }
    function insertRows(rows) {
      return client.from('questions').insert(rows).then(function (res) {
        if (res.error) throw res.error;
      });
    }
    return countBy(catKey).then(function (n) {
      if (n > 0) return { inserted: 0, total: n };
      var full = (bundled || []).map(function (q, i) {
        return Object.assign(fullQuestionRow(catKey, { correctAnswer: q.correct, order: i + 1,
          question: q.q_bn, questionEn: q.q_en,
          optionA: q.opts_bn[0], optionB: q.opts_bn[1], optionC: q.opts_bn[2], optionD: q.opts_bn[3],
          optionAEn: q.opts_en[0], optionBEn: q.opts_en[1], optionCEn: q.opts_en[2], optionDEn: q.opts_en[3] }), { category: catKey });
      });
      if (full.length === 0) return { inserted: 0, total: 0 };
      return insertRows(full)
        .catch(function (err) {
          if (!missingColumn(err)) throw err;
          var core = full.map(function (r) {
            return { question: r.question, option_a: r.option_a, option_b: r.option_b,
              option_c: r.option_c, option_d: r.option_d,
              correct_answer: r.correct_answer, order_no: r.order_no };
          });
          return insertRows(core);
        })
        .then(function () { return { inserted: full.length, total: full.length }; });
    });
  }

  // -------------------------------------------------------- registrations
  var registrationKeys = null;   // columns seen on a registrations row

  function rowToRegistration(r) {
    if (!r) return null;
    if (!registrationKeys) registrationKeys = Object.keys(r);
    return {
      pid: r.reg_code || r.pid || '',    // সিরিয়াল কোড UHF000001… (fallback: legacy pid)
      serialNo: r.serial_no || null,
      rowId: r.id,                       // internal row key (uuid) — never shown
      name: r.name || '',
      school: r.institute || r.school || '',
      area: r.district || r.area || '',
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

  /**
   * Pull the short code out of whatever shape the RPC returns:
   * 'UHF000001' | [{reg_code:…}] | {reg_code:…}.
   */
  function extractRegCode(data) {
    if (data == null) return null;
    if (typeof data === 'string') return data;
    if (Array.isArray(data)) data = data[0];
    if (data && typeof data === 'object') return data.reg_code || data.code || null;
    return null;
  }

  /**
   * Call create_registration. The canonical RPC takes 7 named params; an
   * older 5-param deployment (p_name, p_email, p_phone, p_institute,
   * p_district) is also supported so either database shape works.
   */
  function rpcCreateRegistration(rec) {
    var full = {
      p_name: rec.name, p_phone: rec.phone, p_email: rec.email || '',
      p_institute: rec.school || '', p_district: rec.area || '',
      p_cls: rec.cls || '', p_category: rec.category || null
    };
    var minimal = {
      p_name: rec.name, p_email: rec.email || '', p_phone: rec.phone,
      p_institute: rec.school || '', p_district: rec.area || ''
    };
    function call(args) {
      return client.rpc('create_registration', args).then(function (res) {
        if (res.error) throw res.error;
        var code = extractRegCode(res.data);
        if (!code) throw new Error('রেজিস্ট্রেশন আইডি পাওয়া যায়নি');
        return code;
      });
    }
    return call(full).catch(function (errFull) {
      if (!missingRpc(errFull)) throw errFull;
      return call(minimal).catch(function (errMin) {
        if (!missingRpc(errMin)) throw errMin;
        throw errFull;   // surface the original 7-arg mismatch
      });
    });
  }

  function addRegistration(rec) {
    if (!active) {
      return Promise.reject(new Error('রেজিস্ট্রেশন এখন সেভ হতে পারছে না — ডেটাবেস কনফিগার করা নেই। শীঘ্রই আবার চেষ্টা করো।'));
    }
    // Preferred path: the create_registration RPC mints the short serial
    // reg_code (UHF000001, UHF000002, …) — no UUID ever reaches a visitor.
    return rpcCreateRegistration(rec)
      .then(function (code) { return { pid: code, degraded: false }; })
      .catch(function (rpcErr) {
        if (!missingRpc(rpcErr)) throw new Error(rpcErr.message || 'insert failed');
        console.warn('[supabase-db] create_registration RPC not found — falling back to the insert path. Run supabase/fix-reg-and-category.sql for UHF000001… serial codes.');

      var base = {
        name: rec.name,
        phone: rec.phone,
        email: rec.email || '',
        institute: rec.school || '',
        district: rec.area || ''
      };
      var extras = { pid: rec.pid, cls: rec.cls || '', category: rec.category || null };
      function insert(row) {
        return client.from('registrations').insert(row).select()
          .then(function (res) { if (res.error) throw res.error; return res.data; });
      }
      return insert(Object.assign({}, base, extras))
        .catch(function (err) {
          if (!missingColumn(err)) throw new Error(err.message || 'insert failed');
          // draft schema: no pid/cls/category columns — store the base fields
          // and hand back the generated uuid as the participant ID.
          return insert(base);
        })
        .then(function (data) {
          var pidOut = rec.pid;
          if (data && data[0] && (!data[0].pid)) pidOut = data[0].id;   // uuid fallback
          // degraded = the caller must NOT display this id (it is not a
          // database-minted UHFxxxxxx reg_code). app.js enforces this too.
          return { pid: pidOut, degraded: !/^UHF\d{4,6}$/.test(pidOut) };
        });
    });
  }

  function findRegistration(pid) {
    if (!active) return Promise.resolve(null);
    function byColumn(col, val) {
      return client.from('registrations').select('*').eq(col, val).limit(1).maybeSingle()
        .then(function (res) {
          if (res.error) throw res.error;
          return rowToRegistration(res.data);
        })
        .catch(function (err) {
          if (missingColumn(err)) return null;      // column absent in draft schema
          throw err;
        });
    }
    var asTyped = String(pid || '').trim();
    var asUpper = asTyped.toUpperCase();
    return client.rpc('get_registration', { p_pid: pid })
      .then(function (res) {
        if (res.error) throw res.error;
        return rowToRegistration(res.data);
      })
      .catch(function (rpcErr) {
        if (!missingRpc(rpcErr)) {
          console.error('[supabase-db] registration lookup failed.', rpcErr);
          return null;
        }
        // Draft schema: no RPC — walk reg_code -> pid -> uuid.
        return byColumn('reg_code', asUpper)
          .then(function (hit) { if (hit) return hit; return byColumn('pid', asUpper); })
          .then(function (hit) {
            if (hit) return hit;
            if (!/^[0-9a-fA-F-]{8,}$/.test(asTyped)) return null;
            return byColumn('id', asTyped);
          })
          .catch(function (err) {
            console.error('[supabase-db] registration lookup failed.', err);
            return null;
          });
      });
  }

  function saveExamResult(pid, result) {
    if (!active) return Promise.reject(new Error('Supabase কনফিগার করা নেই'));
    return client.rpc('save_exam_result', {
      p_pid: pid, p_score: result.score, p_max: result.maxScore,
      p_time: result.timeTakenSec, p_cat: result.category
    }).then(function (res) {
      if (res.error) throw res.error;
      return res.data === true;
    }).catch(function (rpcErr) {
      if (!missingRpc(rpcErr)) throw new Error(rpcErr.message || 'save failed');
      // Draft schema: no RPC. Try a direct update with whatever score columns
      // actually exist; without them there is nowhere to put the result.
      return findRegistration(pid).then(function (rec) {
        var keys = registrationKeys || [];
        var patch = {};
        if (keys.indexOf('exam_taken') !== -1) patch.exam_taken = true;
        if (keys.indexOf('score') !== -1) patch.score = result.score;
        if (keys.indexOf('max_score') !== -1) patch.max_score = result.maxScore;
        if (keys.indexOf('time_taken_sec') !== -1) patch.time_taken_sec = result.timeTakenSec;
        if (keys.indexOf('category') !== -1) patch.category = result.category;
        if (keys.indexOf('submitted_at') !== -1) patch.submitted_at = new Date().toISOString();
        if (Object.keys(patch).length === 0) {
          throw new Error('স্কোর সেভ করার কলাম নেই — Supabase SQL Editor-এ supabase/migrate-existing.sql চালাও');
        }
        var keyCol = keys.indexOf('reg_code') !== -1 ? 'reg_code'
                   : keys.indexOf('pid') !== -1 ? 'pid' : 'id';
        return client.from('registrations').update(patch).eq(keyCol, pid)
          .then(function (res) {
            if (res.error) throw new Error(res.error.message);
            return true;
          });
      });
    });
  }

  function listRegistrations() {
    if (!active) return Promise.resolve([]);
    // Serial order (UHF000001 first); falls back to created_at desc on the
    // draft schema where serial_no does not exist yet.
    function run(col, asc) {
      return client.from('registrations').select('*').order(col, { ascending: asc })
        .then(function (res) {
          if (res.error) throw res.error;
          return (res.data || []).map(rowToRegistration);
        });
    }
    return run('serial_no', true).catch(function (err) {
      if (!missingColumn(err)) throw new Error(err.message || 'list failed');
      return run('created_at', false);
    });
  }

  function listLeaderboard() {
    if (!active) return Promise.resolve([]);
    var COLS = 'pid,name,institute,district,score,max_score,time_taken_sec';
    return client.from('leaderboard').select(COLS)
      .then(function (res) {
        if (res.error && missingColumn(res.error)) {
          return client.from('leaderboard').select('*').then(function (r2) { return r2; });
        }
        return res;
      })
      .then(function (res) {
        if (res.error) {
          console.error('[supabase-db] leaderboard read failed.', res.error);
          return [];
        }
        return (res.data || [])
          .filter(function (r) { return typeof r.score === 'number'; })
          .map(function (r) {
            return {
              pid: r.pid, name: r.name,
              school: r.institute || r.school, area: r.district || r.area,
              score: r.score || 0, maxScore: r.max_score || 0,
              timeTakenSec: r.time_taken_sec || 0, examTaken: true
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
    listAllQuestions: listAllQuestions,
    saveQuestion: saveQuestion,
    deleteQuestion: deleteQuestion,
    bulkInsertQuestions: bulkInsertQuestions,
    deleteQuestionsByCategory: deleteQuestionsByCategory,
    deleteAllQuestions: deleteAllQuestions,
    importBundledQuestions: importBundledQuestions,
    addRegistration: addRegistration,
    findRegistration: findRegistration,
    saveExamResult: saveExamResult,
    listRegistrations: listRegistrations,
    listLeaderboard: listLeaderboard,
    auth: authApi,
    get windowSupported() { return !!(settingsKeys && settingsKeys.indexOf('registration_start') !== -1); },
    _internal: { normControl: normControl, rowToControl: rowToControl, rowToQuestion: rowToQuestion, letterToIndex: letterToIndex }
  };
})();
