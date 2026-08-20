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

  // =====================================================================
  console.log('\nD. EXAM TIMER CONTROL\n');

  // ---- admin UI ------------------------------------------------------
  check('admin has a "টাইমার নিয়ন্ত্রণ" sub-tab', !!adoc.querySelector('[data-sub="timer"]'));
  check('admin timer panel exists and starts hidden',
    adoc.getElementById('adminTimer')?.classList.contains('hidden'));
  check('section is titled "পরীক্ষার টাইমার নিয়ন্ত্রণ" / "Exam Timer Control"',
    /পরীক্ষার টাইমার নিয়ন্ত্রণ/.test(adoc.getElementById('adminTimer').textContent) &&
    /Exam Timer Control/.test(adoc.getElementById('adminTimer').textContent));
  check('ON/OFF control is a real toggle SWITCH, not a bare checkbox',
    adoc.getElementById('timerEnabledInput')?.type === 'checkbox' &&
    !!adoc.querySelector('label.switch > #timerEnabledInput + .switch-track > .switch-thumb'));
  check('switch has styles shipped in both builds',
    text('admin-panel/css/styles.css').includes('.switch input:checked + .switch-track') &&
    text('public-site/css/styles.css').includes('.switch-track'));
  check('date & time picker present', adoc.getElementById('timerDateInput')?.type === 'datetime-local');
  check('off-behaviour select offers both live and message',
    [...(adoc.getElementById('timerOffBehaviorInput')?.options || [])].map((o) => o.value).join(',') === 'live,message');
  check('custom message fields present (bn + en)',
    !!adoc.getElementById('timerMessageBnInput') && !!adoc.getElementById('timerMessageEnInput'));
  check('Save button present', !!adoc.getElementById('timerSaveBtn'));
  check('status badge present', !!adoc.getElementById('timerStatusBadge'));
  check('Bengali labels used in the admin timer UI',
    /কাউন্টডাউন টাইমার দেখাও/.test(adoc.body.textContent) &&
    /পরীক্ষা শুরুর তারিখ ও সময়/.test(adoc.body.textContent));
  check('admin timer handlers are wired',
    typeof adm.window.loadTimerSettings === 'function' && typeof adm.window.saveTimerSettings === 'function');
  check('admin warns on screen that localStorage is not shared',
    (() => { adm.window.renderTimerBackendNote();
      return /localStorage/.test(adoc.getElementById('timerBackendNote').textContent); })());

  // ---- public exam gate: three states --------------------------------
  const pw = pub.window;
  const gate = (s) => pw.renderExamGate(pw.examSettings.normalise(s));
  const vis = (id) => !pdoc.getElementById(id).classList.contains('hidden');

  const FUTURE = '2099-01-01T00:00:00+06:00';
  const PAST = '2000-01-01T00:00:00+06:00';

  gate({ timerEnabled: true, examStartDate: FUTURE });
  check('timer ON, date in the future -> countdown box is VISIBLE', vis('countdownBox'));
  check('timer ON, future -> locked panel shown, login hidden', vis('examLocked') && !vis('examLogin'));
  check('timer ON, future -> countdown digits are actually counting',
    /^\d{2}$/.test(pdoc.getElementById('cdDays').textContent) &&
    pdoc.getElementById('cdDays').textContent !== '00');
  check('timer ON -> Bangla date is rendered in the locked message',
    /[০-৯]/.test(pdoc.getElementById('examLockedTextBn').textContent));

  gate({ timerEnabled: true, examStartDate: PAST });
  check('timer ON, date passed -> exam login shown, countdown hidden',
    vis('examLogin') && !vis('examLocked'));

  gate({ timerEnabled: false, offBehavior: 'live', examStartDate: FUTURE });
  check('timer OFF + live -> countdown box HIDDEN', !vis('countdownBox'));
  check('timer OFF + live -> exam is open even though the date is in the future',
    vis('examLogin') && !vis('examLocked'));

  gate({ timerEnabled: false, offBehavior: 'message', examStartDate: FUTURE,
    customMessage: 'পরীক্ষা সাময়িকভাবে বন্ধ আছে।', customMessageEn: 'The exam is paused.' });
  check('timer OFF + message -> countdown box HIDDEN', !vis('countdownBox'));
  check('timer OFF + message -> the organiser message is displayed',
    pdoc.getElementById('examLockedTextBn').textContent === 'পরীক্ষা সাময়িকভাবে বন্ধ আছে।');
  check('timer OFF + message -> exam login stays hidden', !vis('examLogin'));

  // ---- the Bengali design must be untouched ---------------------------
  const cdText = pdoc.getElementById('countdownBox').textContent;
  check('countdown still labelled দিন / ঘণ্টা / মিনিট / সেকেন্ড',
    ['দিন', 'ঘণ্টা', 'মিনিট', 'সেকেন্ড'].every((w) => cdText.includes(w)), cdText.replace(/\s+/g, ' ').trim());
  check('all four countdown cells still exist with their original ids',
    ['cdDays', 'cdHours', 'cdMinutes', 'cdSeconds'].every((id) => !!pdoc.getElementById(id)));
  check('the old hardcoded EXAM_START_DATE constant is gone',
    !text('public-site/js/app.js').includes('const EXAM_START_DATE'));

  // ---- existing behaviour not broken ----------------------------------
  check('registration, exam and leaderboard functions all still defined',
    ['startExam', 'submitExam', 'loadLeaderboard', 'selectAnswer'].every((f) => typeof pw[f] === 'function'));
  check('settings layer reports the local backend when Supabase is unconfigured',
    pw.examSettings.backend === 'local');
  check('no supabase CDN request is made while unconfigured',
    !text('public-site/index.html').includes('supabase-js'));

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((err) => {
  console.error('test harness failed:', err);
  console.error('are BOTH dev servers running?  npm run dev');
  process.exit(1);
});
