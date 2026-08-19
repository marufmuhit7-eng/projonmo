/*
 * apps.test.js — verifies the two deployments in isolation, and demonstrates
 * the one thing that splitting them breaks.
 *
 * Needs both dev servers running:
 *   (cd public-site && python3 -m http.server 8000 --bind 0.0.0.0)
 *   (cd admin-panel && python3 -m http.server 8001 --bind 0.0.0.0)
 *
 * Run:  node tools/apps.test.js       (or: npm test)
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const PUBLIC_ORIGIN = process.env.PUBLIC_ORIGIN || 'http://127.0.0.1:8000';
const ADMIN_ORIGIN = process.env.ADMIN_ORIGIN || 'http://127.0.0.1:8001';

let passed = 0;
let failed = 0;

function check(label, cond, detail) {
  if (cond) { passed++; console.log('  ok   ' + label); }
  else { failed++; console.log('  FAIL ' + label + (detail ? '  -> ' + detail : '')); }
}

function load(origin) {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => errors.push(e.message));
  vc.on('error', (m) => errors.push('console.error: ' + m));
  return JSDOM.fromURL(origin + '/', {
    runScripts: 'dangerously',
    resources: 'usable',
    virtualConsole: vc,
    pretendToBeVisual: true
  }).then(async (dom) => {
    await new Promise((r) => setTimeout(r, 400));
    return { dom, errors };
  });
}

const text = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

(async function run() {
  // =====================================================================
  console.log('\nA. PUBLIC SITE  (' + PUBLIC_ORIGIN + ')\n');
  const { dom: pub, errors: pubErrors } = await load(PUBLIC_ORIGIN);
  const pdoc = pub.window.document;

  const sections = [...pdoc.querySelectorAll('section[id]')].map((s) => s.id);
  check('has the 6 public sections', ['home', 'register', 'exam', 'leaderboard', 'team', 'info']
    .every((id) => sections.includes(id)), sections.join(','));
  check('has NO admin section', !sections.includes('admin'), sections.join(','));
  check('has NO admin nav tab', !pdoc.querySelector('[data-tab="admin"]'));
  check('no link anywhere points at an admin route',
    [...pdoc.querySelectorAll('a[href]')].every((a) => !/admin/i.test(a.getAttribute('href'))));
  check('public JS bundle does not ship ADMIN_PASSWORD',
    !text('public-site/js/app.js').includes('ADMIN_PASSWORD') &&
    !text('public-site/js/common.js').includes('ADMIN_PASSWORD'));
  check('public folder ships no admin.js', !fs.existsSync(path.join(ROOT, 'public-site/js/admin.js')));
  check('public app booted (switchTab defined)', typeof pub.window.switchTab === 'function');
  check('registration form is present', !!pdoc.getElementById('regForm'));
  check('robots.txt allows indexing', text('public-site/robots.txt').includes('Allow: /'));
  check('meta robots = index, follow',
    pdoc.querySelector('meta[name="robots"]')?.content === 'index, follow');
  check('zero uncaught JS errors', pubErrors.length === 0, pubErrors.join(' || '));

  // =====================================================================
  console.log('\nB. ADMIN PANEL  (' + ADMIN_ORIGIN + ')\n');
  const { dom: adm, errors: admErrors } = await load(ADMIN_ORIGIN);
  const adoc = adm.window.document;

  check('admin section exists and is visible without a tab router',
    adoc.querySelector('#admin')?.classList.contains('active'));
  check('login gate is rendered', !!adoc.getElementById('adminLogin'));
  check('admin panel starts hidden', adoc.getElementById('adminPanel')?.classList.contains('hidden'));
  check('admin app booted (adminLogin defined)', typeof adm.window.adminLogin === 'function');
  check('admin app booted (loadAdminRegistrations defined)', typeof adm.window.loadAdminRegistrations === 'function');
  check('shares getCategoryKey from common.js', typeof adm.window.getCategoryKey === 'function');
  check('ships no public exam/registration code',
    !fs.existsSync(path.join(ROOT, 'admin-panel/js/app.js')) &&
    typeof adm.window.startExam === 'undefined');
  check('meta robots = noindex, nofollow, ...',
    /noindex/.test(adoc.querySelector('meta[name="robots"]')?.content || ''));
  check('robots.txt disallows everything', /Disallow:\s*\/\s*$/m.test(text('admin-panel/robots.txt')));
  check('vercel.json sends X-Robots-Tag: noindex',
    JSON.stringify(JSON.parse(text('admin-panel/vercel.json')))
      .includes('"X-Robots-Tag"') &&
    text('admin-panel/vercel.json').includes('noindex'));
  check('vercel.json sends no-store so admin data is never cached',
    text('admin-panel/vercel.json').includes('no-store'));
  check('vercel.json sets X-Frame-Options DENY', text('admin-panel/vercel.json').includes('"DENY"'));
  check('no link back to the public site', adoc.querySelectorAll('nav a').length === 0);
  check('zero uncaught JS errors', admErrors.length === 0, admErrors.join(' || '));

  // =====================================================================
  console.log('\nC. CONSEQUENCE OF SPLITTING (this is expected to be BROKEN)\n');
  await pub.window.storage.set('participant:UHF-CROSS1',
    JSON.stringify({ id: 'UHF-CROSS1', name: 'Origin Test', examTaken: true, score: 9, maxScore: 10 }), true);
  const seenByPublic = await pub.window.storage.list('participant:', true);
  const seenByAdmin = await adm.window.storage.list('participant:', true);

  check('the public origin sees the registration it just saved',
    seenByPublic.keys.includes('participant:UHF-CROSS1'));
  console.log('       public origin keys : ' + JSON.stringify(seenByPublic.keys));
  console.log('       admin  origin keys : ' + JSON.stringify(seenByAdmin.keys));
  check('DEMONSTRATED: the admin origin sees NOTHING (localStorage is per-origin)',
    !seenByAdmin.keys.includes('participant:UHF-CROSS1'));
  console.log('\n       ^ This is not a bug in the split. localStorage is scoped to');
  console.log('         scheme+host+port, so two deployments can never share it.');
  console.log('         A shared backend is required. See README, "Architecture".');

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((err) => {
  console.error('test harness failed:', err);
  console.error('are BOTH dev servers running?  npm run dev');
  process.exit(1);
});
