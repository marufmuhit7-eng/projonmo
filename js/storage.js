/*
 * storage.js — browser storage adapter for the Heritage Fest site.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * app.js calls `window.storage.get / set / list`. That object was provided by
 * the sandbox the page was originally authored in; it does not exist in a real
 * browser, so on Vercel every button that saves or reads data would throw
 * "Cannot read properties of undefined". This file supplies the same API,
 * backed by window.localStorage, so the deployed site works standalone.
 *
 * CONTRACT (matches exactly how app.js uses it)
 * ---------------------------------------------
 *   await storage.set(key, valueString, shared)  -> true on success, throws on failure
 *   await storage.get(key, shared)               -> { value: string }, throws if key absent
 *   await storage.list(prefix, shared)           -> { keys: string[] }
 *
 * The third `shared` argument is accepted and ignored: localStorage has no
 * notion of a shared namespace. See the SCOPE note below.
 *
 * SCOPE — READ THIS
 * -----------------
 * localStorage is per-browser and per-device. Registrations made on one phone
 * are NOT visible in the leaderboard or the admin panel on another device.
 * For a real multi-device event, replace the three methods below with calls to
 * a shared backend (see README.md, "Replacing the storage layer").
 */
(function () {
  'use strict';

  var PREFIX = 'uhf:'; // namespace so the site never collides with other localStorage keys

  function assertAvailable() {
    if (typeof window === 'undefined' || !window.localStorage) {
      throw new Error('localStorage unavailable (private mode or storage disabled)');
    }
  }

  var storage = {
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

  window.storage = storage;
})();
