/*
 * End-to-end smoke test: load index.html in jsdom exactly as a browser would
 * (external scripts executed, relative paths resolved from disk) and assert
 * the page boots with zero uncaught errors.
 *
 * This is the test that catches the original deployment blocker: app.js calls
 * window.storage.*, which does not exist in a real browser.
 *
 * Run:  node tools/page.test.js       (requires: npm install --no-save jsdom)
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');

let passed = 0;
let failed = 0;
const jsErrors = [];

function check(label, cond, detail) {
  if (cond) { passed++; console.log('  ok   ' + label); }
  else { failed++; console.log('  FAIL ' + label + (detail ? '  -> ' + detail : '')); }
}

const virtualConsole = new VirtualConsole();
virtualConsole.on('jsdomError', (e) => jsErrors.push(e.message + (e.detail ? ' | ' + e.detail : '')));
virtualConsole.on('error', (msg) => jsErrors.push('console.error: ' + msg));

// Loaded over the local HTTP server (npm run dev) so that relative asset URLs
// resolve exactly as they will on Vercel, and localStorage has a real origin.
const ORIGIN = process.env.TEST_ORIGIN || 'http://127.0.0.1:8000';

JSDOM.fromURL(ORIGIN + '/', {
  runScripts: 'dangerously',
  resources: 'usable',
  virtualConsole,
  pretendToBeVisual: true
}).then(async (dom) => {
  const { window } = dom;

  // Give deferred scripts a tick to execute.
  await new Promise((r) => setTimeout(r, 400));

  const doc = window.document;
  console.log('page boot tests\n');

  // --- the blocker -------------------------------------------------------
  check('window.storage is defined (was undefined -> TypeError on every save)',
    typeof window.storage === 'object' && window.storage !== null);
  check('window.storage.get / set / list are all functions',
    ['get', 'set', 'list'].every((m) => typeof window.storage?.[m] === 'function'));

  // --- app.js actually ran -----------------------------------------------
  check('app.js executed (switchTab is a global function)', typeof window.switchTab === 'function');
  check('app.js executed (adminLogin is a global function)', typeof window.adminLogin === 'function');

  // --- assets resolved ---------------------------------------------------
  check('external stylesheet linked with a relative path',
    !!doc.querySelector('link[rel="stylesheet"][href="./css/styles.css"]'));
  check('both scripts linked with relative paths and defer',
    doc.querySelectorAll('script[src^="./js/"][defer]').length === 2);
  check('storage.js is ordered BEFORE app.js',
    [...doc.querySelectorAll('script[src]')].map((s) => s.getAttribute('src')).join(',')
      === './js/storage.js,./js/app.js');

  const imgs = [...doc.querySelectorAll('img')];
  check('no base64 data-URI images left in the markup',
    imgs.every((i) => !(i.getAttribute('src') || '').startsWith('data:')));
  check('every <img> points at a file that exists on disk',
    imgs.every((i) => fs.existsSync(path.join(ROOT, i.getAttribute('src').replace(/^\.\//, '')))),
    imgs.map((i) => i.getAttribute('src')).join(' '));

  // --- structure ---------------------------------------------------------
  const sections = [...doc.querySelectorAll('section[id]')].map((s) => s.id);
  const expected = ['home', 'register', 'exam', 'leaderboard', 'team', 'info', 'admin'];
  check('all 7 sections present: ' + expected.join(', '),
    expected.every((id) => sections.includes(id)), sections.join(','));

  check('no external <a href> is broken-relative (all http(s) or #)',
    [...doc.querySelectorAll('a[href]')].every((a) => {
      const h = a.getAttribute('href');
      return /^(https?:|#|mailto:|tel:)/.test(h) || fs.existsSync(path.join(ROOT, h.replace(/^\.\//, '')));
    }));

  // --- a real round trip through the storage layer ------------------------
  await window.storage.set('participant:UHF-TEST01',
    JSON.stringify({ id: 'UHF-TEST01', name: 'Test', cls: '7', examTaken: true, score: 5, maxScore: 10 }), true);
  const listed = await window.storage.list('participant:', true);
  check('a saved participant is listed back (leaderboard/admin path works)',
    listed.keys.includes('participant:UHF-TEST01'));

  // --- uncaught errors ----------------------------------------------------
  check('zero uncaught JS errors during page load', jsErrors.length === 0, jsErrors.join(' || '));

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}).catch((err) => {
  console.error('could not load the page at all:', err);
  console.error('is the dev server running?  npm run dev   (expected at ' + ORIGIN + ')');
  process.exit(1);
});
