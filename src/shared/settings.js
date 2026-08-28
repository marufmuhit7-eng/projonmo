/*
 * settings.js — exam-control facade over Firestore + Bangladesh date helpers.
 *
 * The single source of truth is the Firestore document `settings/examControl`
 * (read/written through window.db from firebase-db.js). localStorage is never
 * consulted: a fresh browser, an offline phone and a broken database all get
 * the same answer — LOCKED.
 *
 *   await examSettings.load()            -> control object (never rejects to OPEN)
 *   await examSettings.save(patch)       -> merges into settings/examControl
 *   examSettings.subscribe(cb)           -> realtime onSnapshot; stop-fn returned
 *   examSettings.current()               -> last loaded value (defaults = LOCKED)
 *   examSettings.examStatus(s)           -> 'live' | 'countdown'
 *   toDhakaInput / fromDhakaInput / formatBnDateTime — Dhaka (+06:00) helpers
 */
(function () {
  'use strict';

  var cfg = window.APP_CONFIG || {};
  var TZ = cfg.TZ_OFFSET || '+06:00';

  var db = window.db;   // firebase-db.js must load before this file

  // ------------------------------------------------------------- helpers
  function pad(n) { return String(n).padStart(2, '0'); }

  /** Minutes of offset for a '+06:00' / '-05:30' style string. */
  function offsetMinutes(tz) {
    var m = /^([+-])(\d{2}):(\d{2})$/.exec(tz);
    if (!m) throw new Error('bad TZ offset: ' + tz);
    var mins = Number(m[2]) * 60 + Number(m[3]);
    return m[1] === '-' ? -mins : mins;
  }

  /** ISO string -> <input type="datetime-local"> value in Dhaka wall clock. */
  function toDhakaInput(iso) {
    var ms = Date.parse(iso);
    if (isNaN(ms)) return '';
    var shifted = new Date(ms + offsetMinutes(TZ) * 60000);
    return shifted.getUTCFullYear() + '-' + pad(shifted.getUTCMonth() + 1) + '-' + pad(shifted.getUTCDate()) +
      'T' + pad(shifted.getUTCHours()) + ':' + pad(shifted.getUTCMinutes());
  }

  /** datetime-local value (Dhaka wall clock) -> ISO with +06:00. null if invalid. */
  function fromDhakaInput(value) {
    if (typeof value !== 'string') return null;
    var m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim());
    if (!m) return null;
    var y = Number(m[1]), mo = Number(m[2]), da = Number(m[3]);
    var h = Number(m[4]), mi = Number(m[5]), se = Number(m[6] || 0);
    // Date.parse happily rolls 2026-02-30 into March — check the calendar.
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

  /** Today in Dhaka as 'YYYY-MM-DD' — used for the registration window. */
  function dhakaToday() {
    return toDhakaInput(new Date().toISOString()).slice(0, 10);
  }

  /** Is the registration window open right now? Fail-open question, fail-closed exam. */
  function registrationOpen(s) {
    var n = normalise(s);
    var today = dhakaToday();
    return today >= n.registrationStart && today <= n.registrationEnd;
  }

  /**
   * 'live'      -> the organiser explicitly unlocked the exam
   * 'countdown' -> everything else: locked, countdown to examDate
   */
  function examStatus(s) {
    return normalise(s).isUnlocked === true ? 'live' : 'countdown';
  }

  function normalise(raw) { return db._internal.normControl(raw); }

  // ---------------------------------------------------------- the facade
  var cached = null;

  window.examSettings = {
    DEFAULTS: db.DEFAULT_CONTROL,
    backend: db.active ? 'firestore' : 'unconfigured',
    isRemote: db.active,

    current: function () { return cached ? cached : normalise(null); },

    load: function () {
      return db.getControl().then(function (s) { cached = s; return s; });
    },

    /** Merge a partial update into settings/examControl. Admin only. */
    save: function (patch) {
      return db.saveControl(patch).then(function (s) { cached = s; return s; });
    },

    /** Realtime: the organiser flips the switch, every open browser follows. */
    subscribe: function (cb) {
      return db.onControl(function (s) { cached = s; cb(s); });
    },

    // exposed for the admin form and for tests
    normalise: normalise,
    examStatus: examStatus,
    registrationOpen: registrationOpen,
    dhakaToday: dhakaToday,
    toDhakaInput: toDhakaInput,
    fromDhakaInput: fromDhakaInput,
    formatBnDateTime: formatBnDateTime
  };
})();
