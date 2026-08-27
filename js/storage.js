/*
 * storage.js — storage adapter for the Heritage Fest site.
 *
 * Two modes, picked automatically at load:
 *
 *   1. SUPABASE (shared, global) — active when src/shared/config.js has
 *      SUPABASE_URL and SUPABASE_ANON_KEY filled in. Every set/get/list goes
 *      to the `storage_kv` table (see supabase/schema.sql), so a registration
 *      made on ANY phone reaches the admin panel and the leaderboard
 *      instantly. Writes are mirrored to localStorage as an offline cache.
 *
 *   2. LOCAL (fallback) — plain localStorage. Registrations, questions and
 *      scores then live in ONE browser only: a participant who registers on
 *      their own phone is invisible to the admin panel on your laptop. This
 *      is the single-browser mode the site falls back to when nothing is
 *      configured.
 *
 * CONTRACT (matches exactly how app.js / admin.js use it)
 * ------------------------------------------------------
 *   await storage.set(key, valueString)  -> true on success, throws on failure
 *   await storage.get(key)               -> { value: string }, throws if absent
 *   await storage.list(prefix)           -> { keys: string[] }
 *
 *   storage.backend -> 'supabase' | 'local'   (the admin UI shows which won)
 */
(function () {
  'use strict';

  var PREFIX = 'uhf:'; // localStorage namespace so we never collide with other keys
  var TABLE = 'storage_kv';

  var cfg = window.APP_CONFIG || {};
  var client = null;

  if (cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY &&
      window.supabase && typeof window.supabase.createClient === 'function') {
    // One client shared with settings.js, so the organiser's sign-in session
    // (needed for privileged writes) is common to both modules.
    client = window.__uhfSupabase ||
      (window.__uhfSupabase = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY));
  }

  function assertAvailable() {
    if (typeof window === 'undefined' || !window.localStorage) {
      throw new Error('localStorage unavailable (private mode or storage disabled)');
    }
  }

  // ------------------------------------------------------------ local mode
  var local = {
    /**
     * @param {string} key
     * @param {string} value  already-serialised JSON string
     * @returns {Promise<true>}
     */
    set: function (key, value) {
      return new Promise(function (resolve) {
        assertAvailable();
        if (typeof key !== 'string' || !key) throw new Error('storage.set: key must be a non-empty string');
        if (typeof value !== 'string') throw new Error('storage.set: value must be a string, got ' + typeof value);
        try {
          window.localStorage.setItem(PREFIX + key, value);
        } catch (err) {
          // QuotaExceededError, or Safari private mode
          throw new Error('storage.set failed for "' + key + '": ' + err.name);
        }
        resolve(true);
      });
    },

    /**
     * @param {string} key
     * @returns {Promise<{value: string}>}  rejects when the key does not exist
     */
    get: function (key) {
      return new Promise(function (resolve) {
        assertAvailable();
        var raw = window.localStorage.getItem(PREFIX + key);
        if (raw === null) throw new Error('storage.get: key not found: ' + key);
        resolve({ value: raw });
      });
    },

    /**
     * @param {string} prefix  e.g. "participant:"
     * @returns {Promise<{keys: string[]}>}  keys are returned WITHOUT the internal namespace
     */
    list: function (prefix) {
      return new Promise(function (resolve) {
        assertAvailable();
        var wanted = PREFIX + (prefix || '');
        var keys = [];
        for (var i = 0; i < window.localStorage.length; i++) {
          var k = window.localStorage.key(i);
          if (k !== null && k.indexOf(wanted) === 0) keys.push(k.slice(PREFIX.length));
        }
        keys.sort();
        resolve({ keys: keys });
      });
    }
  };

  // ---------------------------------------------------------- supabase mode
  var remote = {
    set: function (key, value) {
      return new Promise(function (resolve, reject) {
        if (typeof key !== 'string' || !key) { reject(new Error('storage.set: key must be a non-empty string')); return; }
        if (typeof value !== 'string') { reject(new Error('storage.set: value must be a string, got ' + typeof value)); return; }
        var parsed;
        try { parsed = JSON.parse(value); }
        catch (e) { reject(new Error('storage.set: value must be valid JSON for the shared database')); return; }
        // Mirror locally so the visitor's own device still knows their ID if
        // the network drops mid-festival. The database stays authoritative.
        try { window.localStorage.setItem(PREFIX + key, value); } catch (e) { /* cache only */ }
        client.from(TABLE).upsert({ key: key, value: parsed })
          .then(function (res) {
            if (res.error) reject(new Error('storage.set failed for "' + key + '": ' + res.error.message));
            else resolve(true);
          }, function (err) {
            reject(new Error('storage.set failed for "' + key + '": ' + ((err && err.message) || 'network error')));
          });
      });
    },

    get: function (key) {
      return client.from(TABLE).select('value').eq('key', key).limit(1).maybeSingle()
        .then(function (res) {
          if (res.error) throw new Error('storage.get failed for "' + key + '": ' + res.error.message);
          if (!res.data) throw new Error('storage.get: key not found: ' + key);
          return { value: JSON.stringify(res.data.value) };
        });
    },

    list: function (prefix) {
      // Prefixes the site uses ('participant:', 'questions:') contain no LIKE
      // wildcards, so a plain prefix+'%' pattern is exact.
      return client.from(TABLE).select('key').like('key', (prefix || '') + '%').order('key')
        .then(function (res) {
          if (res.error) throw new Error('storage.list failed: ' + res.error.message);
          return { keys: (res.data || []).map(function (r) { return r.key; }) };
        });
    }
  };

  var storage = client ? remote : local;
  storage.backend = client ? 'supabase' : 'local';

  window.storage = storage;
})();
