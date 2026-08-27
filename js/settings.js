/*
 * settings.js — shared exam-timer settings, with a swappable backend.
 *
 * Exposes window.examSettings. Both the public exam page and the admin panel
 * use it; neither knows or cares which backend is active.
 *
 *   await examSettings.load()            -> ExamSettings
 *   await examSettings.save(patch)       -> ExamSettings   (admin only)
 *   examSettings.subscribe(cb)           -> unsubscribe fn
 *   examSettings.backend                 -> 'supabase' | 'local'
 *
 * ExamSettings shape:
 *   {
 *     timerEnabled:  boolean,   // show the countdown at all?
 *     examStartDate: string,    // ISO 8601 with offset, e.g. 2026-09-25T00:00:00+06:00
 *     offBehavior:   'live' | 'message',   // what to do when timerEnabled === false
 *     customMessage:   string,  // Bangla,  shown when offBehavior === 'message'
 *     customMessageEn: string   // English, shown when offBehavior === 'message'
 *   }
 *
 * BACKENDS
 *   supabase — one shared row every visitor reads; realtime push on change.
 *              Active when window.APP_CONFIG.SUPABASE_URL is set.
 *   local    — localStorage. Per browser, per origin. A fallback for offline
 *              development, NOT something an event can run on: the admin panel
 *              and the public site are different origins, so a setting saved in
 *              one is invisible to the other. The admin UI says so on screen.
 */
(function () {
  'use strict';

  var cfg = window.APP_CONFIG || {};
  var TZ = cfg.TZ_OFFSET || '+06:00';
  var LOCAL_KEY = 'uhf:settings:exam';
  var TABLE = 'settings';
  var ROW_ID = 1;

  /*
   * Shipped defaults = exam LOCKED. This is a security boundary, not a
   * preference.
   *
   * The old defaults were the opposite (timerEnabled:false + offBehavior:'live'
   * => 'live'), which meant any visitor the settings had never reached — a
   * fresh browser, a phone, a new device, a backend that was down, a fetch that
   * failed — was shown an OPEN exam. The lock only ever existed in the one
   * browser that had written to localStorage.
   *
   * isUnlocked is now the single authoritative gate and it FAILS CLOSED:
   * nothing short of a backend explicitly answering `true` opens the exam.
   * Loading, offline, no row, parse error, junk value -> locked.
   */
  var DEFAULTS = {
    isUnlocked: false,
    timerEnabled: true,
    examStartDate: '2026-09-25T00:00:00' + TZ,
    offBehavior: 'live',
    customMessage: '',
    customMessageEn: ''
  };

  // ---------------------------------------------------------------- helpers

  /** Coerce anything into a valid ExamSettings, filling gaps from DEFAULTS. */
  function normalise(raw) {
    var s = raw && typeof raw === 'object' ? raw : {};
    var date = typeof s.examStartDate === 'string' && !isNaN(Date.parse(s.examStartDate))
      ? s.examStartDate
      : DEFAULTS.examStartDate;
    return {
      // Strict identity check, deliberately. 'true', 1, {} and undefined are
      // all NOT an unlock. Only a real boolean true opens the exam.
      isUnlocked: s.isUnlocked === true,
      timerEnabled: typeof s.timerEnabled === 'boolean' ? s.timerEnabled : DEFAULTS.timerEnabled,
      examStartDate: date,
      offBehavior: s.offBehavior === 'message' ? 'message' : 'live',
      customMessage: typeof s.customMessage === 'string' ? s.customMessage : '',
      customMessageEn: typeof s.customMessageEn === 'string' ? s.customMessageEn : ''
    };
  }

  function pad(n) { return String(n).padStart(2, '0'); }

  /** Minutes of offset for a '+06:00' / '-05:30' style string. */
  function offsetMinutes(tz) {
    var m = /^([+-])(\d{2}):(\d{2})$/.exec(tz);
    if (!m) throw new Error('bad TZ offset: ' + tz);
    var mins = Number(m[2]) * 60 + Number(m[3]);
    return m[1] === '-' ? -mins : mins;
  }

  /**
   * ISO string -> the value a <input type="datetime-local"> expects,
   * expressed as Bangladesh wall-clock time. Returns '' for unparseable input.
   */
  function toDhakaInput(iso) {
    var ms = Date.parse(iso);
    if (isNaN(ms)) return '';
    var shifted = new Date(ms + offsetMinutes(TZ) * 60000);
    return shifted.getUTCFullYear() + '-' + pad(shifted.getUTCMonth() + 1) + '-' + pad(shifted.getUTCDate()) +
      'T' + pad(shifted.getUTCHours()) + ':' + pad(shifted.getUTCMinutes());
  }

  /**
   * <input type="datetime-local"> value (Bangladesh wall clock) -> ISO string
   * carrying the +06:00 offset. Returns null when the field is empty/invalid,
   * so callers can reject the save instead of writing a broken date.
   */
  function fromDhakaInput(value) {
    if (typeof value !== 'string') return null;
    var m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim());
    if (!m) return null;
    var y = Number(m[1]), mo = Number(m[2]), da = Number(m[3]);
    var h = Number(m[4]), mi = Number(m[5]), se = Number(m[6] || 0);

    // Date.parse happily rolls 2026-02-30 over into March, so check the
    // calendar explicitly instead of trusting it.
    var probe = new Date(Date.UTC(y, mo - 1, da, h, mi, se));
    if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== da ||
        probe.getUTCHours() !== h || probe.getUTCMinutes() !== mi || probe.getUTCSeconds() !== se) {
      return null;
    }

    var iso = m[1] + '-' + m[2] + '-' + m[3] + 'T' + m[4] + ':' + m[5] + ':' + pad(se) + TZ;
    return isNaN(Date.parse(iso)) ? null : iso;
  }

  var BN_DIGITS = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];
  var BN_MONTHS = ['জানুয়ারি', 'ফেব্রুয়ারি', 'মার্চ', 'এপ্রিল', 'মে', 'জুন',
    'জুলাই', 'আগস্ট', 'সেপ্টেম্বর', 'অক্টোবর', 'নভেম্বর', 'ডিসেম্বর'];

  function toBnDigits(str) {
    return String(str).replace(/\d/g, function (d) { return BN_DIGITS[Number(d)]; });
  }

  /** '2026-09-25T00:00:00+06:00' -> '২৫ সেপ্টেম্বর, ২০২৬, ১২:০০ AM' (Dhaka time). */
  function formatBnDateTime(iso) {
    var local = toDhakaInput(iso);
    if (!local) return '';
    var d = local.split('T')[0].split('-');
    var t = local.split('T')[1].split(':');
    var h24 = Number(t[0]);
    var ampm = h24 < 12 ? 'AM' : 'PM';
    var h12 = h24 % 12 === 0 ? 12 : h24 % 12;
    return toBnDigits(Number(d[2])) + ' ' + BN_MONTHS[Number(d[1]) - 1] + ', ' +
      toBnDigits(d[0]) + ', ' + toBnDigits(pad(h12)) + ':' + toBnDigits(t[1]) + ' ' + ampm;
  }

  /**
   * Reduce the raw settings to the one thing everybody actually asks:
   * can a candidate sit the exam right now?
   *
   * 'live'      -> exam is open, the countdown box is hidden
   * 'countdown' -> locked, counting down to examStartDate
   * 'closed'    -> locked, showing the organiser's message
   */
  function examStatus(s) {
    var n = normalise(s);

    // The gate. Locked unless the backend said true, full stop. Note what is
    // NOT here any more: the exam no longer opens itself just because
    // examStartDate slipped past. A date passing is not consent — the
    // organiser flips the switch.
    if (n.isUnlocked !== true) {
      return (!n.timerEnabled && n.offBehavior === 'message') ? 'closed' : 'countdown';
    }
    return 'live';
  }

  // -------------------------------------------------------- local backend

  var localBackend = {
    name: 'local',
    remote: false,
    load: function () {
      return new Promise(function (resolve) {
        var raw = null;
        try { raw = window.localStorage.getItem(LOCAL_KEY); } catch (e) { /* private mode */ }
        if (!raw) return resolve(normalise(null));
        try { resolve(normalise(JSON.parse(raw))); }
        catch (e) { resolve(normalise(null)); }
      });
    },
    save: function (next) {
      return new Promise(function (resolve) {
        window.localStorage.setItem(LOCAL_KEY, JSON.stringify(next));
        resolve(next);
      });
    },
    subscribe: function (cb) {
      // Fires only for OTHER tabs on the SAME origin. Cross-origin is impossible.
      function onStorage(e) {
        if (e.key === LOCAL_KEY) {
          try { cb(normalise(JSON.parse(e.newValue))); } catch (err) { /* ignore */ }
        }
      }
      window.addEventListener('storage', onStorage);
      return function () { window.removeEventListener('storage', onStorage); };
    }
  };

  // ----------------------------------------------------- supabase backend

  function makeSupabaseBackend(client) {
    return {
      name: 'supabase',
      remote: true,
      client: client,

      load: function () {
        return client.from(TABLE).select('*').eq('id', ROW_ID).maybeSingle()
          .then(function (res) {
            if (res.error) throw new Error('settings load failed: ' + res.error.message);
            // Row absent on a fresh project -> defaults, not a crash.
            if (!res.data) return normalise(null);
            return normalise({
              timerEnabled: res.data.timer_enabled,
              examStartDate: res.data.exam_start_date,
              offBehavior: res.data.off_behavior,
              customMessage: res.data.custom_message,
              customMessageEn: res.data.custom_message_en
            });
          });
      },

      save: function (next) {
        return client.from(TABLE).upsert({
          id: ROW_ID,
          timer_enabled: next.timerEnabled,
          exam_start_date: next.examStartDate,
          off_behavior: next.offBehavior,
          custom_message: next.customMessage,
          custom_message_en: next.customMessageEn,
          updated_at: new Date().toISOString()
        }).select().single().then(function (res) {
          if (res.error) {
            // RLS rejects an unauthenticated write — surface it plainly.
            throw new Error('settings save rejected: ' + res.error.message);
          }
          return next;
        });
      },

      subscribe: function (cb) {
        var channel = client
          .channel('exam-settings')
          .on('postgres_changes',
            { event: '*', schema: 'public', table: TABLE },
            function () { api.load().then(cb).catch(function () { /* keep last known */ }); })
          .subscribe();
        return function () { client.removeChannel(channel); };
      }
    };
  }

  // ------------------------------------------------------------ selection

  var backend = localBackend;
  var supabaseClient = null;

  if (cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY) {
    // The SDK is loaded from a CDN by a <script> tag before this file. If that
    // request failed (offline, blocked, sandboxed preview) we degrade instead
    // of throwing, and the admin UI reports which backend actually won.
    if (window.supabase && typeof window.supabase.createClient === 'function') {
      // Shared with storage.js (window.__uhfSupabase) so there is exactly one
      // client, one auth session and one realtime socket per browser.
      supabaseClient = window.__uhfSupabase ||
        (window.__uhfSupabase = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY));
      backend = makeSupabaseBackend(supabaseClient);
    } else {
      console.warn('[settings] SUPABASE_URL is configured but the supabase-js SDK did not load. ' +
        'Falling back to localStorage — settings will NOT be shared between visitors.');
    }
  }

  // ------------------------------------------------------------ public API

  var cached = null;
  var pollTimer = null;

  var api = {
    DEFAULTS: DEFAULTS,
    backend: backend.name,
    isRemote: backend.remote,

    /** Last value returned by load(), or DEFAULTS if load() has not run yet. */
    current: function () { return cached ? cached : normalise(null); },

    load: function () {
      return backend.load().then(function (s) { cached = s; return s; });
    },

    /** Merge a partial update into the current settings and persist. */
    save: function (patch) {
      var next = normalise(Object.assign({}, cached || normalise(null), patch || {}));
      return backend.save(next).then(function () { cached = next; return next; });
    },

    /**
     * Call cb(settings) whenever they change elsewhere. Realtime on Supabase;
     * a storage event plus slow polling otherwise. Returns an unsubscribe fn,
     * which callers MUST invoke on teardown or the poll timer leaks.
     */
    subscribe: function (cb) {
      var stop = backend.subscribe(function (s) { cached = s; cb(s); });

      var interval = cfg.POLL_INTERVAL_MS || 60000;
      pollTimer = setInterval(function () {
        api.load().then(function (s) {
          if (JSON.stringify(s) !== JSON.stringify(cached)) cb(s);
        }).catch(function () { /* transient; try again next tick */ });
      }, interval);
      return function () {
        stop();
        if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
      };
    },

    // --- organiser auth (Supabase only) ---------------------------------
    auth: {
      available: function () { return !!supabaseClient; },
      signIn: function (email, password) {
        if (!supabaseClient) return Promise.reject(new Error('no remote backend configured'));
        return supabaseClient.auth.signInWithPassword({ email: email, password: password })
          .then(function (res) {
            if (res.error) throw new Error(res.error.message);
            return res.data.user;
          });
      },
      signOut: function () {
        if (!supabaseClient) return Promise.resolve();
        return supabaseClient.auth.signOut();
      },
      currentUser: function () {
        if (!supabaseClient) return Promise.resolve(null);
        return supabaseClient.auth.getSession().then(function (res) {
          return res.data && res.data.session ? res.data.session.user : null;
        });
      }
    },

    // --- exposed for the admin form and for tests ------------------------
    normalise: normalise,
    examStatus: examStatus,
    toDhakaInput: toDhakaInput,
    fromDhakaInput: fromDhakaInput,
    formatBnDateTime: formatBnDateTime,
    toBnDigits: toBnDigits
  };

  window.examSettings = api;
})();
