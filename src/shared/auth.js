/*
 * auth.js — admin login gate for the organiser panel.
 *
 * ── WHAT THIS IS, HONESTLY ────────────────────────────────────────────────
 * This runs entirely in the visitor's browser, so it is a LOCK ON A DOOR THAT
 * HAS NO WALLS. Anyone can open DevTools and set the session flag by hand, or
 * read every registration straight out of localStorage without logging in at
 * all. Treat it as "keeps honest people out", never as access control.
 *
 * What it does do properly, given that limit:
 *   - the password is never stored in readable form: only a random salt and a
 *     SHA-256 hash of (salt + password) are kept
 *   - comparison is constant-time, so timing does not leak the password
 *   - the session lives in sessionStorage, so closing the tab logs you out
 *   - credentials live in localStorage, so a changed password survives reloads
 *
 * Real access control needs a server. supabase/schema.sql already restricts
 * writes to a signed-in organiser; see README → Security.
 *
 * Storage keys
 *   uhf:admin:credential  {username, salt, hash, algo, updatedAt}   localStorage
 *   uhf:admin:session     {username, at}                            sessionStorage
 */
(function () {
  'use strict';

  var CRED_KEY = 'uhf:admin:credential';
  var SESSION_KEY = 'uhf:admin:session';

  // Seeded on first run. Change them from the panel; these are only the bootstrap.
  var DEFAULT_USERNAME = 'muhit123';
  var DEFAULT_PASSWORD = 'ami muhit 321';

  /*
   * Bump this whenever DEFAULT_USERNAME / DEFAULT_PASSWORD change.
   *
   * Credentials are seeded into localStorage on first load, so without this a
   * browser that already ran an older build would keep the old defaults forever
   * and the new ones would appear not to work. On a version bump we re-seed —
   * but ONLY if the organiser never set a password of their own. A password
   * they chose is never overwritten.
   */
  var SEED_VERSION = 2;

  var MIN_PASSWORD_LENGTH = 6;

  // ------------------------------------------------------------- hashing

  function toHex(buffer) {
    return Array.prototype.map
      .call(new Uint8Array(buffer), function (b) { return b.toString(16).padStart(2, '0'); })
      .join('');
  }

  /**
   * SHA-256 of salt + password, hex encoded.
   *
   * crypto.subtle only exists in a secure context (https, or localhost). On a
   * plain-http LAN address it is undefined; rather than fail the login we fall
   * back to a clearly-labelled non-cryptographic digest and warn, so the panel
   * still opens during local testing. The stored `algo` records which was used.
   */
  function hashPassword(salt, password) {
    var input = salt + '|' + password;
    if (typeof crypto !== 'undefined' && crypto.subtle && typeof TextEncoder !== 'undefined') {
      return crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
        .then(function (buf) { return { algo: 'sha-256', hash: toHex(buf) }; });
    }
    console.warn('[auth] crypto.subtle unavailable (not a secure context). ' +
      'Falling back to a NON-CRYPTOGRAPHIC digest. Serve over https for the real thing.');
    // FNV-1a, 64 bits, purely so the value is not the plaintext password.
    var h1 = 0x811c9dc5, h2 = 0x01000193;
    for (var i = 0; i < input.length; i++) {
      h1 = (h1 ^ input.charCodeAt(i)) >>> 0;
      h1 = (h1 * 0x01000193) >>> 0;
      h2 = (h2 ^ (input.charCodeAt(i) + i)) >>> 0;
      h2 = (h2 * 0x85ebca6b) >>> 0;
    }
    return Promise.resolve({
      algo: 'fnv1a-insecure',
      hash: h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0')
    });
  }

  function randomSalt() {
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
      return toHex(crypto.getRandomValues(new Uint8Array(16)));
    }
    return String(Date.now()) + Math.random().toString(36).slice(2);
  }

  /** Length-independent comparison so a wrong guess takes the same time. */
  function safeEqual(a, b) {
    var x = String(a);
    var y = String(b);
    var diff = x.length ^ y.length;
    for (var i = 0; i < Math.max(x.length, y.length); i++) {
      diff |= (x.charCodeAt(i) || 0) ^ (y.charCodeAt(i) || 0);
    }
    return diff === 0;
  }

  // --------------------------------------------------------- credentials

  function readCredential() {
    try {
      var raw = window.localStorage.getItem(CRED_KEY);
      if (!raw) return null;
      var c = JSON.parse(raw);
      if (!c || !c.username || !c.salt || !c.hash) return null;
      return c;
    } catch (err) {
      return null;
    }
  }

  function writeCredential(cred) {
    window.localStorage.setItem(CRED_KEY, JSON.stringify(cred));
  }

  /**
   * Create the default credential the first time the panel loads, and refresh
   * it if the shipped defaults changed while the organiser was still on them.
   */
  function ensureSeeded() {
    var existing = readCredential();

    // A password the organiser chose themselves is never touched.
    if (existing && !existing.isDefault) return Promise.resolve(existing);

    // Still on the shipped defaults and already at the current version: nothing to do.
    if (existing && existing.seedVersion === SEED_VERSION) return Promise.resolve(existing);

    var salt = randomSalt();
    return hashPassword(salt, DEFAULT_PASSWORD).then(function (h) {
      var cred = {
        username: DEFAULT_USERNAME,
        salt: salt,
        hash: h.hash,
        algo: h.algo,
        isDefault: true,
        seedVersion: SEED_VERSION,
        updatedAt: new Date().toISOString()
      };
      writeCredential(cred);
      if (existing) {
        // The old default is gone; whoever was signed in with it must sign in again.
        window.sessionStorage.removeItem(SESSION_KEY);
        console.info('[auth] default credentials updated to seed v' + SEED_VERSION + '; please sign in again.');
      }
      return cred;
    });
  }

  // ------------------------------------------------------------- session

  function readSession() {
    try {
      var raw = window.sessionStorage.getItem(SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (err) {
      return null;
    }
  }

  // ---------------------------------------------------------- public API

  var api = {
    DEFAULT_USERNAME: DEFAULT_USERNAME,
    DEFAULT_PASSWORD: DEFAULT_PASSWORD,
    MIN_PASSWORD_LENGTH: MIN_PASSWORD_LENGTH,

    ready: ensureSeeded,

    /** True while a session is open in THIS tab. */
    isLoggedIn: function () { return !!readSession(); },

    currentUser: function () {
      var s = readSession();
      return s ? s.username : null;
    },

    /** True while the password is still the shipped default — the UI nags about it. */
    isUsingDefaultPassword: function () {
      var c = readCredential();
      return !!(c && c.isDefault);
    },

    /**
     * @returns {Promise<{ok: true}>} on success
     * @throws  {Error} with a code: 'empty' | 'bad-credentials'
     */
    login: function (username, password) {
      return ensureSeeded().then(function (cred) {
        if (!username || !password) {
          var e = new Error('username and password are required');
          e.code = 'empty';
          throw e;
        }
        return hashPassword(cred.salt, password).then(function (h) {
          var userOk = safeEqual(username.trim().toLowerCase(), cred.username.toLowerCase());
          var passOk = safeEqual(h.hash, cred.hash);
          // Both are evaluated before branching, so a wrong username and a wrong
          // password cost the same and neither can be probed separately.
          if (!(userOk && passOk)) {
            var err = new Error('invalid credentials');
            err.code = 'bad-credentials';
            throw err;
          }
          window.sessionStorage.setItem(SESSION_KEY,
            JSON.stringify({ username: cred.username, at: new Date().toISOString() }));
          return { ok: true };
        });
      });
    },

    logout: function () {
      window.sessionStorage.removeItem(SESSION_KEY);
    },

    /**
     * @returns {Promise<{ok: true}>}
     * @throws  {Error} code: 'empty' | 'wrong-current' | 'too-short' | 'mismatch' | 'same-as-current'
     */
    changePassword: function (currentPassword, newPassword, confirmPassword) {
      return ensureSeeded().then(function (cred) {
        function fail(code, message) {
          var e = new Error(message);
          e.code = code;
          throw e;
        }
        if (!currentPassword || !newPassword || !confirmPassword) fail('empty', 'all three fields are required');
        if (newPassword !== confirmPassword) fail('mismatch', 'new password and confirmation differ');
        if (newPassword.length < MIN_PASSWORD_LENGTH) fail('too-short', 'password too short');
        if (currentPassword === newPassword) fail('same-as-current', 'new password matches the old one');

        return hashPassword(cred.salt, currentPassword).then(function (h) {
          if (!safeEqual(h.hash, cred.hash)) fail('wrong-current', 'current password is wrong');
          // New salt on every change, so the same password never yields the same hash twice.
          var salt = randomSalt();
          return hashPassword(salt, newPassword).then(function (nh) {
            writeCredential({
              username: cred.username,
              salt: salt,
              hash: nh.hash,
              algo: nh.algo,
              isDefault: false,
              seedVersion: SEED_VERSION,
              updatedAt: new Date().toISOString()
            });
            return { ok: true };
          });
        });
      });
    },

    /** Escape hatch for a forgotten password: wipes back to the shipped defaults. */
    resetToDefaults: function () {
      window.localStorage.removeItem(CRED_KEY);
      window.sessionStorage.removeItem(SESSION_KEY);
      return ensureSeeded();
    }
  };

  window.adminAuth = api;
})();
