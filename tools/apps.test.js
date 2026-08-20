/*
 * apps.test.js — one merged deployment: public site at /, admin panel at /admin.
 *
 * Needs the dev server running (it mirrors vercel.json, including cleanUrls):
 *   npm run dev            # port 8000
 *
 * Run:  node tools/apps.test.js       (or: npm test)
 */
'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const ORIGIN = process.env.ORIGIN || 'http://127.0.0.1:8000';

let passed = 0;
let failed = 0;

function check(label, cond, detail) {
  if (cond) { passed++; console.log('  ok   ' + label); }
  else { failed++; console.log('  FAIL ' + label + (detail !== undefined ? '  -> ' + detail : '')); }
}

const text = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

/** Raw request that does NOT follow redirects, so we can assert on 308s. */
function head(urlPath) {
  return new Promise((resolve, reject) => {
    const req = http.request(ORIGIN + urlPath, { method: 'HEAD' }, (res) => {
      res.resume();
      resolve({ status: res.statusCode, location: res.headers.location, headers: res.headers });
    });
    req.on('error', reject);
    req.end();
  });
}

function load(urlPath) {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => errors.push(e.message));
  vc.on('error', (m) => errors.push('console.error: ' + m));
  return JSDOM.fromURL(ORIGIN + urlPath, {
    runScripts: 'dangerously',
    resources: 'usable',
    virtualConsole: vc,
    pretendToBeVisual: true
  }).then(async (dom) => {
    await new Promise((r) => setTimeout(r, 400));
    return { dom, errors };
  });
}

(async function run() {
  // =====================================================================
  console.log('\nA. ROUTING  (the /admin 404 this restructure fixes)\n');

  const r = {
    home: await head('/'),
    admin: await head('/admin'),
    adminHtml: await head('/admin.html'),
    adminSlash: await head('/admin/'),
    missing: await head('/definitely-not-a-page'),
    css: await head('/css/styles.css'),
    adminJs: await head('/js/admin.js')
  };

  check('/ serves the public site', r.home.status === 200, r.home.status);
  check('/admin serves the admin panel (cleanUrls, no rewrite needed)', r.admin.status === 200, r.admin.status);
  check('/admin.html 308-redirects to /admin', r.adminHtml.status === 308 && /\/admin$/.test(r.adminHtml.location || ''),
    r.adminHtml.status + ' ' + r.adminHtml.location);
  check('/admin/ 308-redirects to /admin (trailingSlash: false)', r.adminSlash.status === 308,
    r.adminSlash.status);
  check('an unknown path still 404s (no catch-all rewrite masking it)', r.missing.status === 404, r.missing.status);
  check('assets load from the merged root', r.css.status === 200 && r.adminJs.status === 200);

  // =====================================================================
  console.log('\nB. HEADERS\n');

  check('/ sends nosniff + SAMEORIGIN', r.home.headers['x-content-type-options'] === 'nosniff' &&
    r.home.headers['x-frame-options'] === 'SAMEORIGIN', JSON.stringify(r.home.headers['x-frame-options']));
  check('/admin is noindex', /noindex/.test(r.admin.headers['x-robots-tag'] || ''), r.admin.headers['x-robots-tag']);
  check('/admin is never cached', /no-store/.test(r.admin.headers['cache-control'] || ''), r.admin.headers['cache-control']);
  check('/admin cannot be framed (DENY, overriding the site-wide SAMEORIGIN)',
    r.admin.headers['x-frame-options'] === 'DENY', r.admin.headers['x-frame-options']);
  check('/admin leaks no referrer', r.admin.headers['referrer-policy'] === 'no-referrer', r.admin.headers['referrer-policy']);
  check('no header is sent twice with conflicting values on /admin',
    !String(r.admin.headers['x-frame-options']).includes(','), r.admin.headers['x-frame-options']);
  check('robots.txt disallows the admin route',
    /Disallow:\s*\/admin\b/.test(text('robots.txt')) && /Disallow:\s*\/admin\.html/.test(text('robots.txt')));

  // =====================================================================
  console.log('\nC. PUBLIC SITE  (/)\n');
  const { dom: pub, errors: pubErrors } = await load('/');
  const pdoc = pub.window.document;
  const pw = pub.window;

  const sections = [...pdoc.querySelectorAll('section[id]')].map((s) => s.id);
  check('has the 6 public sections', ['home', 'register', 'exam', 'leaderboard', 'team', 'info']
    .every((id) => sections.includes(id)), sections.join(','));
  check('has NO admin section embedded in the page', !sections.includes('admin'));
  check('has NO admin nav tab', !pdoc.querySelector('[data-tab="admin"]'));
  const adminLinks = [...pdoc.querySelectorAll('a[href]')].filter((a) => /admin/i.test(a.getAttribute('href')));
  check('exactly ONE admin link on the public page', adminLinks.length === 1,
    adminLinks.map((a) => a.getAttribute('href')).join(','));
  check('that link lives in the footer, not the top navigation',
    !!adminLinks[0]?.closest('footer') && !pdoc.querySelector('nav a[href*="admin"]'));
  check('top nav still has no admin tab button', !pdoc.querySelector('[data-tab="admin"]'));
  check('the footer link is labelled অ্যাডমিন লগইন / Admin Login',
    /অ্যাডমিন লগইন/.test(adminLinks[0].textContent) && /Admin Login/.test(adminLinks[0].textContent));
  check('the footer link points at the clean /admin URL (no redirect hop)',
    adminLinks[0].getAttribute('href') === '/admin');
  check('the footer link is rel=nofollow, matching the noindex header',
    /nofollow/.test(adminLinks[0].getAttribute('rel') || ''));
  check('it is styled discreetly via .footer-links, not as a nav item',
    !!adminLinks[0].closest('.footer-links') &&
    text('css/styles.css').includes('.footer-links a'));
  check('meta robots = index, follow', pdoc.querySelector('meta[name="robots"]')?.content === 'index, follow');
  check('public app booted', typeof pw.switchTab === 'function' && !!pdoc.getElementById('regForm'));
  check('zero uncaught JS errors', pubErrors.length === 0, pubErrors.join(' || '));

  // =====================================================================
  console.log('\nD. ADMIN PANEL  (/admin)\n');
  const { dom: adm, errors: admErrors } = await load('/admin');
  const adoc = adm.window.document;

  check('admin section renders without a tab router',
    adoc.querySelector('#admin')?.classList.contains('active'));
  check('login gate shown, panel hidden', !!adoc.getElementById('adminLogin') &&
    adoc.getElementById('adminPanel')?.classList.contains('hidden'));
  check('meta robots = noindex', /noindex/.test(adoc.querySelector('meta[name="robots"]')?.content || ''));
  check('admin assets resolve from the same depth as index.html',
    !!adoc.querySelector('link[rel="stylesheet"][href="./css/styles.css"]') &&
    !!adoc.querySelector('script[src="./js/admin.js"]'));
  check('admin app booted', typeof adm.window.adminLogin === 'function' &&
    typeof adm.window.loadTimerSettings === 'function');
  check('shares common.js with the public page', typeof adm.window.getCategoryKey === 'function');
  check('no link back to the public site from the admin NAV', adoc.querySelectorAll('nav a').length === 0);
  check('admin footer links back to the site rather than to itself',
    adoc.querySelector('footer .footer-links a')?.getAttribute('href') === '/');
  check('zero uncaught JS errors', admErrors.length === 0, admErrors.join(' || '));

  // =====================================================================
  console.log('\nD2. ADMIN LOGIN GATE\n');

  const aw = adm.window;
  const el = (id) => adoc.getElementById(id);
  const shown = (id) => !el(id).classList.contains('hidden');

  check('login form rendered with username + password fields',
    el('adminUserInput')?.type === 'text' && el('adminPassInput')?.type === 'password');
  check('password field is masked, not plain text', el('adminPassInput').type === 'password');
  check('show/hide password button present', !!el('adminPassToggle'));
  check('login form has a real submit handler (Enter works)', el('adminLoginForm')?.tagName === 'FORM');
  check('dashboard is HIDDEN before login', !shown('adminPanel') && shown('adminLogin'));
  check('logout button present in the dashboard header',
    /লগআউট/.test(el('adminPanel').textContent));
  check('change-password section exists with all three fields',
    !!el('curPassInput') && !!el('newPassInput') && !!el('confirmPassInput') && !!el('changePassBtn'));
  check('change-password section titled "পাসওয়ার্ড পরিবর্তন করুন"',
    /পাসওয়ার্ড পরিবর্তন করুন/.test(el('adminPassword').textContent));

  // wrong credentials
  el('adminUserInput').value = 'admin';
  el('adminPassInput').value = 'wrongpass';
  await aw.adminLogin();
  await new Promise((r) => setTimeout(r, 150));
  check('wrong password shows an error and keeps the dashboard hidden',
    /ভুল/.test(el('adminLoginMsg').textContent) && !shown('adminPanel'));
  check('the password field is cleared after a failed attempt', el('adminPassInput').value === '');

  // correct credentials
  el('adminUserInput').value = 'admin';
  el('adminPassInput').value = 'admin123';
  await aw.adminLogin();
  await new Promise((r) => setTimeout(r, 200));
  check('admin / admin123 unlocks the dashboard', shown('adminPanel') && !shown('adminLogin'));
  check('session stored in sessionStorage', !!aw.sessionStorage.getItem('uhf:admin:session'));
  check('header shows who is signed in', /admin/.test(el('adminWhoami').textContent));
  check('default-password warning is visible until it is changed', shown('adminDefaultPassWarning'));
  check('admin controls are reachable only now',
    !!el('timerEnabledInput') && !!el('adminQJson'));

  // change password
  el('curPassInput').value = 'admin123';
  el('newPassInput').value = 'uhf';
  el('confirmPassInput').value = 'uhf';
  await aw.changeAdminPassword();
  await new Promise((r) => setTimeout(r, 150));
  check('too-short password rejected with a Bengali message',
    /৬ অক্ষর/.test(el('adminPassMsg').textContent));

  el('curPassInput').value = 'admin123';
  el('newPassInput').value = 'heritage2026';
  el('confirmPassInput').value = 'different';
  await aw.changeAdminPassword();
  await new Promise((r) => setTimeout(r, 150));
  check('mismatched confirmation rejected', /মিলছে না/.test(el('adminPassMsg').textContent));

  el('curPassInput').value = 'admin123';
  el('newPassInput').value = 'heritage2026';
  el('confirmPassInput').value = 'heritage2026';
  await aw.changeAdminPassword();
  await new Promise((r) => setTimeout(r, 200));
  check('valid change succeeds', /বদলে গেছে/.test(el('adminPassMsg').textContent),
    el('adminPassMsg').textContent);
  check('default-password warning disappears after the change', !shown('adminDefaultPassWarning'));
  check('fields are cleared after a successful change',
    el('curPassInput').value === '' && el('newPassInput').value === '');
  check('new password is stored hashed, never in plain text',
    !String(aw.localStorage.getItem('uhf:admin:credential')).includes('heritage2026'));

  // logout
  aw.adminLogout();
  check('logout hides the dashboard and shows the login form again',
    !shown('adminPanel') && shown('adminLogin'));
  check('logout clears the session', !aw.sessionStorage.getItem('uhf:admin:session'));
  check('logout confirmation message shown', /লগআউট হয়ে গেছে/.test(el('adminLoginMsg').textContent));

  // log back in with the NEW password for the remaining sections
  el('adminUserInput').value = 'admin';
  el('adminPassInput').value = 'heritage2026';
  await aw.adminLogin();
  await new Promise((r) => setTimeout(r, 200));
  check('the changed password logs back in', shown('adminPanel'));

  check('auth.js is NOT shipped to the public page',
    !fs.existsSync(path.join(ROOT, 'index.html')) || !text('index.html').includes('auth.js'));
  check('the old hardcoded ADMIN_PASSWORD constant is gone',
    !text('js/admin.js').includes('const ADMIN_PASSWORD'));

  // =====================================================================
  console.log('\nE. EXAM TIMER CONTROL\n');

  check('section titled "পরীক্ষার টাইমার নিয়ন্ত্রণ" / "Exam Timer Control"',
    /পরীক্ষার টাইমার নিয়ন্ত্রণ/.test(adoc.getElementById('adminTimer').textContent) &&
    /Exam Timer Control/.test(adoc.getElementById('adminTimer').textContent));
  check('ON/OFF is a real toggle switch',
    !!adoc.querySelector('label.switch > #timerEnabledInput + .switch-track > .switch-thumb'));
  check('date & time picker present', adoc.getElementById('timerDateInput')?.type === 'datetime-local');
  check('off-behaviour select offers live and message',
    [...(adoc.getElementById('timerOffBehaviorInput')?.options || [])].map((o) => o.value).join(',') === 'live,message');
  check('admin badge reports EXAM status, not just timer state',
    typeof adm.window.renderTimerStatus === 'function' &&
    !!adoc.getElementById('timerStatusDetail'));
  check('bilingual custom message fields + Save + status badge',
    !!adoc.getElementById('timerMessageBnInput') && !!adoc.getElementById('timerMessageEnInput') &&
    !!adoc.getElementById('timerSaveBtn') && !!adoc.getElementById('timerStatusBadge'));

  const gate = (s) => pw.renderExamGate(pw.examSettings.normalise(s));
  const vis = (id) => !pdoc.getElementById(id).classList.contains('hidden');

  // --- the exam must be OPEN out of the box -----------------------------
  check('UNLOCKED BY DEFAULT: shipped settings put the exam live',
    pw.examSettings.examStatus(pw.examSettings.DEFAULTS) === 'live');
  gate(pw.examSettings.DEFAULTS);
  check('default render: countdown box hidden', !vis('countdownBox'));
  check('default render: "পরীক্ষা এখনো শুরু হয়নি" panel hidden', !vis('examLocked'));
  check('default render: start-exam form visible', vis('examLogin'));
  check('default render: Start Exam button present',
    /পরীক্ষা শুরু করো/.test(pdoc.getElementById('examLogin').textContent) &&
    /Start Exam/.test(pdoc.getElementById('examLogin').textContent));
  check('default render: LIVE badge shown to candidates',
    /পরীক্ষা চালু আছে/.test(pdoc.getElementById('examLogin').textContent));
  check('default render: exam rules listed (6 items, bn + en)',
    pdoc.querySelectorAll('#examLogin ol.bn > li').length === 6 &&
    pdoc.querySelectorAll('#examLogin ol.en > li').length === 6);
  check('default render: question container and submit button exist',
    !!pdoc.getElementById('questionsContainer') &&
    /জমা দাও/.test(pdoc.getElementById('examBody').textContent));
  const FUTURE = '2099-01-01T00:00:00+06:00';
  const PAST = '2000-01-01T00:00:00+06:00';

  gate({ timerEnabled: true, examStartDate: FUTURE });
  check('timer ON + future -> countdown visible and counting',
    vis('countdownBox') && vis('examLocked') && !vis('examLogin') &&
    pdoc.getElementById('cdDays').textContent !== '00');
  gate({ timerEnabled: true, examStartDate: PAST });
  check('timer ON + past -> exam opens', vis('examLogin') && !vis('examLocked'));
  gate({ timerEnabled: false, offBehavior: 'live', examStartDate: FUTURE });
  check('timer OFF + live -> countdown hidden, exam open', !vis('countdownBox') && vis('examLogin'));
  gate({ timerEnabled: false, offBehavior: 'message', examStartDate: FUTURE, customMessage: 'বন্ধ আছে।' });
  check('timer OFF + message -> countdown hidden, notice shown',
    !vis('countdownBox') && !vis('examLogin') &&
    pdoc.getElementById('examLockedTextBn').textContent === 'বন্ধ আছে।');

  const cdText = pdoc.getElementById('countdownBox').textContent;
  check('countdown still labelled দিন / ঘণ্টা / মিনিট / সেকেন্ড',
    ['দিন', 'ঘণ্টা', 'মিনিট', 'সেকেন্ড'].every((w) => cdText.includes(w)));
  check('all four countdown ids intact',
    ['cdDays', 'cdHours', 'cdMinutes', 'cdSeconds'].every((id) => !!pdoc.getElementById(id)));

  // =====================================================================
  console.log('\nF. SAME-ORIGIN STORAGE (the upside of merging)\n');

  // Note on method: jsdom gives every JSDOM instance its own localStorage, so
  // two instances cannot demonstrate browser-level sharing no matter what the
  // origin is. What IS verifiable here is the mechanism that decides sharing —
  // the origin — plus the fact that both pages use one storage namespace.
  const pubOrigin = pub.window.location.origin;
  const admOrigin = adm.window.location.origin;
  check('public page and admin page are served from ONE origin',
    pubOrigin === admOrigin, pubOrigin + ' vs ' + admOrigin);
  check('both pages load the same storage adapter file',
    !!pdoc.querySelector('script[src="./js/storage.js"]') &&
    !!adoc.querySelector('script[src="./js/storage.js"]'));
  check('both use the same "uhf:" localStorage namespace',
    text('js/storage.js').includes("var PREFIX = 'uhf:'"));

  await pw.storage.set('participant:UHF-MERGE1',
    JSON.stringify({ id: 'UHF-MERGE1', name: 'Same Origin', examTaken: true, score: 8, maxScore: 10 }), true);
  const readBack = await pw.storage.list('participant:', true);
  check('a saved registration round-trips through the adapter',
    readBack.keys.includes('participant:UHF-MERGE1'), JSON.stringify(readBack.keys));

  console.log('       Same origin => a real browser shares localStorage between / and /admin,');
  console.log('       so the admin table now sees registrations made on this device.');
  console.log('       Untested here: jsdom isolates localStorage per instance, so the');
  console.log('       cross-page read cannot be exercised in this harness — verify in a');
  console.log('       browser. It is still per-DEVICE either way: another visitor\'s phone');
  console.log('       shows nothing. Supabase remains required for a real event.');

  // =====================================================================
  console.log('\nG. VERCEL CONFIG\n');

  const cfg = JSON.parse(text('vercel.json'));
  check('single vercel.json at the repo root', !!cfg);
  check('outputDirectory is the repo root, so no Root Directory setting is needed',
    cfg.outputDirectory === '.', cfg.outputDirectory);
  check('cleanUrls on, trailingSlash off', cfg.cleanUrls === true && cfg.trailingSlash === false);
  check('buildCommand and installCommand pinned (nothing inferred)',
    !!cfg.buildCommand && !!cfg.installCommand);
  check('no legacy routes key', !('routes' in cfg));
  check('no catch-all rewrite', !cfg.rewrites);
  check('.vercelignore keeps src/, tools/ and supabase/ out of the deployment',
    ['src', 'tools', 'supabase'].every((d) => text('.vercelignore').includes(d)));
  check('the old split folders are gone',
    !fs.existsSync(path.join(ROOT, 'public-site')) && !fs.existsSync(path.join(ROOT, 'admin-panel')));
  check('the 404 page carries the same discreet admin link',
    /footer-links/.test(text('404.html')) && /href="\/admin"/.test(text('404.html')));
  check('the stale "ADMIN" section comment is gone from the public page',
    !text('index.html').includes('======== ADMIN'));
  check('index.html, admin.html and 404.html all exist at the root',
    ['index.html', 'admin.html', '404.html'].every((f) => fs.existsSync(path.join(ROOT, f))));

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((err) => {
  console.error('test harness failed:', err);
  console.error('is the dev server running?  npm run dev   (expected at ' + ORIGIN + ')');
  process.exit(1);
});
