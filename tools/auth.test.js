/*
 * auth.test.js — admin login gate.
 * Run:  node tools/auth.test.js
 */
'use strict';

function makeStore() {
  const m = new Map();
  return {
    get length() { return m.size; },
    key(i) { return [...m.keys()][i] ?? null; },
    getItem(k) { return m.has(k) ? m.get(k) : null; },
    setItem(k, v) { m.set(k, String(v)); },
    removeItem(k) { m.delete(k); },
    clear() { m.clear(); }
  };
}

global.window = { localStorage: makeStore(), sessionStorage: makeStore() };
// Node 20 already exposes a Web Crypto `crypto` global with .subtle,
// which is exactly what auth.js looks for in the browser.
global.TextEncoder = require('util').TextEncoder;

require('../src/shared/auth.js');
const auth = global.window.adminAuth;

let passed = 0;
let failed = 0;
function check(label, cond, detail) {
  if (cond) { passed++; console.log('  ok   ' + label); }
  else { failed++; console.log('  FAIL ' + label + (detail !== undefined ? '  -> ' + JSON.stringify(detail) : '')); }
}
async function expectCode(label, code, fn) {
  try { await fn(); check(label, false, 'no error thrown'); }
  catch (e) { check(label, e.code === code, e.code + ': ' + e.message); }
}
const cred = () => JSON.parse(global.window.localStorage.getItem('uhf:admin:credential'));

(async function run() {
  console.log('admin auth\n');

  // ---- seeding --------------------------------------------------------
  await auth.ready();
  check('seeds the default credential on first load', cred().username === 'muhit123');
  check('the plaintext password is NEVER stored',
    !JSON.stringify(cred()).includes('ami muhit 321'), cred());
  check('a random salt is generated', typeof cred().salt === 'string' && cred().salt.length >= 16);
  check('SHA-256 is used in a secure context', cred().algo === 'sha-256', cred().algo);
  check('flagged as still-default so the UI can nag', cred().isDefault === true);
  check('nobody is logged in before signing in', auth.isLoggedIn() === false);

  // ---- login: failure paths ------------------------------------------
  await expectCode('empty username rejected', 'empty', () => auth.login('', 'ami muhit 321'));
  await expectCode('empty password rejected', 'empty', () => auth.login('muhit123', ''));
  await expectCode('wrong password rejected', 'bad-credentials', () => auth.login('muhit123', 'wrong'));
  await expectCode('wrong username rejected', 'bad-credentials', () => auth.login('root', 'ami muhit 321'));
  check('a failed login does not open a session', auth.isLoggedIn() === false);
  check('wrong username and wrong password give the SAME error code (no user enumeration)', true);

  // ---- login: success -------------------------------------------------
  await auth.login('muhit123', 'ami muhit 321');
  check('default credentials admin / admin123 log in', auth.isLoggedIn() === true);
  check('session records the username', auth.currentUser() === 'muhit123');
  check('the session lives in sessionStorage, not localStorage',
    global.window.sessionStorage.getItem('uhf:admin:session') !== null &&
    global.window.localStorage.getItem('uhf:admin:session') === null);
  check('username is case-insensitive', true);
  auth.logout();
  await auth.login('  MUHIT123  ', 'ami muhit 321');
  check('username tolerates case and surrounding spaces', auth.isLoggedIn() === true);

  // ---- logout ---------------------------------------------------------
  auth.logout();
  check('logout clears the session', auth.isLoggedIn() === false && auth.currentUser() === null);
  check('logout does NOT wipe the stored credential', cred().username === 'muhit123');

  // ---- change password: failure paths ---------------------------------
  await expectCode('change: empty fields rejected', 'empty', () => auth.changePassword('', 'newpass1', 'newpass1'));
  await expectCode('change: mismatch rejected', 'mismatch', () => auth.changePassword('ami muhit 321', 'newpass1', 'newpass2'));
  await expectCode('change: too short rejected', 'too-short', () => auth.changePassword('ami muhit 321', 'abc', 'abc'));
  await expectCode('change: reusing the current password rejected', 'same-as-current',
    () => auth.changePassword('ami muhit 321', 'ami muhit 321', 'ami muhit 321'));
  await expectCode('change: wrong current password rejected', 'wrong-current',
    () => auth.changePassword('nope123', 'newpass1', 'newpass1'));
  check('a failed change leaves the old password working', cred().isDefault === true);

  // ---- change password: success ---------------------------------------
  const saltBefore = cred().salt;
  await auth.changePassword('ami muhit 321', 'heritage2026', 'heritage2026');
  check('password changed', cred().isDefault === false);
  check('a fresh salt is generated on change', cred().salt !== saltBefore);
  check('the new plaintext is not stored either',
    !JSON.stringify(cred()).includes('heritage2026'));
  check('updatedAt is recorded', typeof cred().updatedAt === 'string');

  await expectCode('the OLD password no longer works', 'bad-credentials', () => auth.login('muhit123', 'ami muhit 321'));
  await auth.login('muhit123', 'heritage2026');
  check('the NEW password works', auth.isLoggedIn() === true);
  check('isUsingDefaultPassword() is false once changed', auth.isUsingDefaultPassword() === false);

  // ---- persistence ----------------------------------------------------
  const stored = global.window.localStorage.getItem('uhf:admin:credential');
  check('the credential persists in localStorage across reloads', stored !== null);
  check('the default password contains spaces and is matched exactly',
    auth.DEFAULT_PASSWORD === 'ami muhit 321' && auth.DEFAULT_USERNAME === 'muhit123');

  // ---- reset ----------------------------------------------------------
  await auth.resetToDefaults();
  check('reset clears the session', auth.isLoggedIn() === false);
  await auth.login('muhit123', 'ami muhit 321');
  check("reset restores muhit123 / ami muhit 321", auth.isLoggedIn() === true);
  check('reset marks the credential default again', auth.isUsingDefaultPassword() === true);

  // ---- seed migration: the trap when shipped defaults change --------------
  console.log('\n  -- seed migration --');

  // A browser still on an OLD default credential must pick up the new one.
  global.window.localStorage.clear();
  global.window.sessionStorage.clear();
  global.window.localStorage.setItem('uhf:admin:credential', JSON.stringify({
    username: 'admin', salt: 'oldsalt', hash: 'oldhash', algo: 'sha-256',
    isDefault: true, seedVersion: 1, updatedAt: '2026-01-01T00:00:00.000Z'
  }));
  await auth.ready();
  check('an untouched OLD default is re-seeded to the new credentials',
    cred().username === 'muhit123' && cred().seedVersion === 2, cred());
  await auth.login('muhit123', 'ami muhit 321');
  check('the new defaults log in after migration', auth.isLoggedIn() === true);

  // A password the organiser actually chose must survive a seed bump.
  global.window.localStorage.clear();
  global.window.sessionStorage.clear();
  await auth.ready();
  await auth.changePassword('ami muhit 321', 'chosen-by-me', 'chosen-by-me');
  const chosen = cred().hash;
  await auth.ready();
  check('a password the organiser chose is NEVER overwritten by a seed bump',
    cred().hash === chosen && cred().isDefault === false);
  await auth.login('muhit123', 'chosen-by-me');
  check('their chosen password still logs in', auth.isLoggedIn() === true);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
