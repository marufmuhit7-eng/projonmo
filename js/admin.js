/* =========================================================================
   Admin panel  ·  অ্যাডমিন প্যানেল
   ---------------------------------------------------------------------------
   Login gate:      window.adminAuth (local, hashed — keeps casual visitors out)
   Cloud data:      window.db (Supabase — questions, exam control, regs)
                    Privileged writes need the ☁️ organiser sign-in, because
   the RLS policies allow writes only to a signed-in organiser.
   ========================================================================= */

let adminLoggedIn = false;

/** Paint the header line and the default-password nag. */
function renderAdminIdentity(){
  const who = document.getElementById('adminWhoami');
  const warn = document.getElementById('adminDefaultPassWarning');
  const user = window.adminAuth.currentUser();
  who.textContent = user ? '👤 ' + user : '';
  warn.classList.toggle('hidden', !window.adminAuth.isUsingDefaultPassword());
}

/** Reveal the dashboard and load whichever sub-tab is active. */
function enterAdminDashboard(){
  adminLoggedIn = true;
  document.getElementById('adminLogin').classList.add('hidden');
  document.getElementById('adminPanel').classList.remove('hidden');
  document.getElementById('adminPassInput').value = '';
  document.getElementById('adminLoginMsg').innerHTML = '';
  renderAdminIdentity();
  renderCloudAuth();
  const active = document.querySelector('.admin-sub-btn.active');
  switchAdminSub(active ? active.dataset.sub : 'timer');
}

function showAdminLogin(){
  adminLoggedIn = false;
  document.getElementById('adminPanel').classList.add('hidden');
  document.getElementById('adminLogin').classList.remove('hidden');
}

/*
 * Every failed sign-in shows the same sentence, whether the username was wrong,
 * the password was wrong, or a field was left blank. That is deliberate: it
 * stops the form being used to work out which usernames exist.
 */
const LOGIN_ERROR_BN = 'ইউজারনেম বা পাসওয়ার্ড ভুল হয়েছে!';
const LOGIN_ERROR_EN = 'Incorrect username or password!';

async function adminLogin(){
  const msg = document.getElementById('adminLoginMsg');
  const username = document.getElementById('adminUserInput').value;
  const password = document.getElementById('adminPassInput').value;
  msg.innerHTML = '';
  try{
    await window.adminAuth.login(username, password);
    enterAdminDashboard();
  }catch(err){
    msg.innerHTML = '<div class="msg err"><span class="bn">' + LOGIN_ERROR_BN +
      '</span><span class="en">' + LOGIN_ERROR_EN + '</span></div>';
    document.getElementById('adminPassInput').value = '';
    document.getElementById('adminPassInput').focus();
  }
}

function adminLogout(){
  window.adminAuth.logout();
  showAdminLogin();
  document.getElementById('adminUserInput').value = '';
  document.getElementById('adminPassInput').value = '';
  document.getElementById('adminLoginMsg').innerHTML =
    '<div class="msg ok"><span class="bn">লগআউট হয়ে গেছে।</span><span class="en">You have been logged out.</span></div>';
}

function toggleAdminPassword(){
  const input = document.getElementById('adminPassInput');
  const btn = document.getElementById('adminPassToggle');
  const show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  btn.innerHTML = show
    ? '<span class="bn">লুকাও</span><span class="en">Hide</span>'
    : '<span class="bn">দেখাও</span><span class="en">Show</span>';
}

/* ---------- Change password (stored locally, as before) ---------- */

const CHANGE_ERRORS = {
  'empty':           { bn: 'তিনটি ঘরই পূরণ করো।',                     en: 'Fill in all three fields.' },
  'mismatch':        { bn: 'নতুন পাসওয়ার্ড দুটি মিলছে না।',            en: 'The two new passwords do not match.' },
  'too-short':       { bn: 'নতুন পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের হতে হবে।', en: 'The new password must be at least 6 characters.' },
  'same-as-current': { bn: 'নতুন পাসওয়ার্ড আগেরটির মতোই হয়ে গেছে।',   en: 'The new password is the same as the current one.' },
  'wrong-current':   { bn: 'বর্তমান পাসওয়ার্ড ভুল।',                   en: 'Current password is wrong.' }
};

async function changeAdminPassword(){
  if(!adminLoggedIn) return;
  const msg = document.getElementById('adminPassMsg');
  const btn = document.getElementById('changePassBtn');
  msg.innerHTML = '';
  btn.disabled = true;
  try{
    await window.adminAuth.changePassword(
      document.getElementById('curPassInput').value,
      document.getElementById('newPassInput').value,
      document.getElementById('confirmPassInput').value
    );
    ['curPassInput','newPassInput','confirmPassInput'].forEach(id => { document.getElementById(id).value = ''; });
    renderAdminIdentity();
    msg.innerHTML = '<div class="msg ok"><span class="bn">পাসওয়ার্ড বদলে গেছে। পরের বার নতুনটি দিয়ে লগইন করো।</span>' +
      '<span class="en">Password changed. Use the new one next time you log in.</span></div>';
  }catch(err){
    const e = CHANGE_ERRORS[err.code] || { bn: 'পাসওয়ার্ড বদলানো যায়নি।', en: 'Could not change the password.' };
    msg.innerHTML = '<div class="msg err"><span class="bn">' + e.bn + '</span><span class="en">' + e.en + '</span></div>';
  }finally{
    btn.disabled = false;
  }
}

/** Forgotten password escape hatch — back to the shipped default credentials. */
async function resetAdminPassword(){
  if(!adminLoggedIn) return;
  const u = window.adminAuth.DEFAULT_USERNAME, pw = window.adminAuth.DEFAULT_PASSWORD;
  const ok = window.confirm('পাসওয়ার্ড ডিফল্টে (' + u + ' / ' + pw + ') ফিরিয়ে নেবে?\n\nReset the password back to ' + u + ' / ' + pw + '?');
  if(!ok) return;
  await window.adminAuth.resetToDefaults();
  renderAdminIdentity();
  document.getElementById('adminPassMsg').innerHTML =
    '<div class="msg ok"><span class="bn">পাসওয়ার্ড ডিফল্টে ফিরে গেছে: ' + u + ' / ' + pw + '</span>' +
    '<span class="en">Password reset to the default: ' + u + ' / ' + pw + '</span></div>';
}

/* Wire the forms. Submit handlers (not click) so Enter works in every field. */
document.getElementById('adminLoginForm').addEventListener('submit', function(e){
  e.preventDefault();
  adminLogin();
});
document.getElementById('adminChangePassForm').addEventListener('submit', function(e){
  e.preventDefault();
  changeAdminPassword();
});

/* Restore an open session on load, so a reload does not log the organiser out.
   sessionStorage clears itself when the tab closes. */
window.adminAuth.ready().then(function(){
  if(window.adminAuth.isLoggedIn()) enterAdminDashboard();
  else renderAdminIdentity();
});

function switchAdminSub(sub){
  document.querySelectorAll('.admin-sub-btn').forEach(b=>b.classList.toggle('active', b.dataset.sub===sub));
  document.getElementById('adminQuestions').classList.toggle('hidden', sub!=='questions');
  document.getElementById('adminTimer').classList.toggle('hidden', sub!=='timer');
  document.getElementById('adminRegs').classList.toggle('hidden', sub!=='regs');
  document.getElementById('adminTeam').classList.toggle('hidden', sub!=='team');
  document.getElementById('adminPassword').classList.toggle('hidden', sub!=='password');
  if(sub==='timer') loadExamControl();
  if(sub==='questions') loadAdminQuestions();
  if(sub==='regs') loadAdminRegistrations();
  if(sub==='team') loadAdminTeam();
}

/* =========================================================================
   Exam control  ·  পরীক্ষা নিয়ন্ত্রণ  (Supabase table: settings, row id='exam')
   ========================================================================= */

/** Which backend is live — honest banner, no "this browser only" surprises. */
function renderBackendNote(){
  const note = document.getElementById('timerBackendNote');
  if(window.db.active){
    note.innerHTML =
      '<span class="bn">✅ <strong>Supabase</strong> চালু — এখানে পরিবর্তন করলে <strong>সব ভিজিটরের</strong> ব্রাউজারে সঙ্গে সঙ্গে প্রতিফলিত হবে।</span>' +
      '<span class="en">✅ <strong>Supabase</strong> is live — changes here reach <strong>every visitor\'s</strong> browser instantly.</span>';
    note.style.color = 'var(--sage)';
    if(window.db.windowSupported === false){
      note.innerHTML += '<div class="small-note" style="margin-top:6px;color:var(--clay-dark);"><span class="bn">ℹ️ রেজিস্ট্রেশন-উইন্ডোর তারিখ কলাম ডেটাবেসে নেই — আপাতত ডিফল্ট (২৫ আগস্ট – ২৯ সেপ্টেম্বর) চলছে। যোগ করতে <code>supabase/migrate-existing.sql</code> চালাও।</span><span class="en">ℹ️ The registration-window columns are missing — defaults (Aug 25 – Sep 29) are in use. Run <code>supabase/migrate-existing.sql</code> to add them.</span></div>';
    }
  }else{
    note.innerHTML =
      '<span class="bn">⚠️ Supabase কনফিগার করা নেই — পরিবর্তন গ্লোবালি যাবে না। <code>src/shared/supabase-config.js</code> পূরণ করো (নির্দেশিকা: <code>supabase/SETUP.md</code>)।</span>' +
      '<span class="en">⚠️ Supabase is not configured — nothing will go global. Fill in <code>src/shared/supabase-config.js</code> (guide: <code>supabase/SETUP.md</code>).</span>';
    note.style.color = 'var(--clay-dark)';
  }
}

/** Status badge: what a candidate sees right now. */
function renderExamStatus(s){
  const badge = document.getElementById('timerStatusBadge');
  const detail = document.getElementById('timerStatusDetail');
  const status = window.examSettings.examStatus(s);
  const view = {
    live:      { text: 'চালু · LIVE',     bg: 'var(--sage)', fg: 'var(--cream)',
                 bn: 'মাস্টার সুইচ চালু — সব ভিজিটর এখন পরীক্ষা দিতে পারছে।',
                 en: 'Master switch is on — every visitor can sit the exam right now.' },
    countdown: { text: 'লকড · LOCKED',   bg: 'var(--clay)', fg: 'var(--cream)',
                 bn: 'পরীক্ষা বন্ধ, সব ব্রাউজারে কাউন্টডাউন দেখাচ্ছে। তারিখ পেরোলেও নিজে থেকে খুলবে না — মাস্টার সুইচ দিয়ে খুলতে হবে।',
                 en: 'Locked; every browser shows the countdown. It will NOT open by itself when the date passes — use the master switch.' }
  }[status];
  badge.textContent = view.text;
  badge.style.background = view.bg;
  badge.style.color = view.fg;
  detail.innerHTML = '<span class="bn">' + view.bn + '</span><span class="en">' + view.en + '</span>';
  document.getElementById('timerCurrentDateBn').textContent = window.examSettings.formatBnDateTime(s.examDate);
  document.getElementById('timerCurrentDateEn').textContent =
    new Date(s.examDate).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
}

async function loadExamControl(){
  if(!adminLoggedIn) return;
  const msg = document.getElementById('timerMsg');
  msg.innerHTML = '';
  renderBackendNote();
  try{
    const s = await window.examSettings.load();
    document.getElementById('examUnlockedInput').checked = s.isUnlocked === true;
    document.getElementById('examDateInput').value = window.examSettings.toDhakaInput(s.examDate);
    document.getElementById('regStartInput').value = s.registrationStart;
    document.getElementById('regEndInput').value = s.registrationEnd;
    renderExamStatus(s);
  }catch(err){
    console.error(err);
    msg.innerHTML = '<div class="msg err"><span class="bn">সেটিং লোড করা যায়নি: ' + err.message +
      '</span><span class="en">Could not load settings: ' + err.message + '</span></div>';
  }
}

async function saveExamControl(){
  if(!adminLoggedIn) return;
  const msg = document.getElementById('timerMsg');
  const btn = document.getElementById('timerSaveBtn');
  msg.innerHTML = '';

  const examIso = window.examSettings.fromDhakaInput(document.getElementById('examDateInput').value);
  if(!examIso){
    msg.innerHTML = '<div class="msg err"><span class="bn">পরীক্ষার তারিখ ও সময় ঠিকভাবে দাও।</span>' +
      '<span class="en">Please enter a valid exam date and time.</span></div>';
    return;
  }
  const dayRe = /^\d{4}-\d{2}-\d{2}$/;
  const regStart = document.getElementById('regStartInput').value;
  const regEnd = document.getElementById('regEndInput').value;
  if(!dayRe.test(regStart) || !dayRe.test(regEnd) || regEnd < regStart){
    msg.innerHTML = '<div class="msg err"><span class="bn">রেজিস্ট্রেশনের তারিখ দুটি ঠিকভাবে দাও (শুরু ≤ শেষ)।</span>' +
      '<span class="en">Please check the registration dates (start ≤ end).</span></div>';
    return;
  }

  btn.disabled = true;
  try{
    const s = await window.examSettings.save({
      examDate: examIso,
      registrationStart: regStart,
      registrationEnd: regEnd
    });
    renderExamStatus(s);
    msg.innerHTML = '<div class="msg ok"><span class="bn">✅ গ্লোবাল সেটিং সংরক্ষণ হয়েছে! সব ভিজিটর সঙ্গে সঙ্গে দেখতে পাবে।</span>' +
      '<span class="en">✅ Global settings saved! Every visitor sees it immediately.</span></div>';
  }catch(err){
    console.error(err);
    msg.innerHTML = '<div class="msg err"><span class="bn">' + writeErrorBn(err) +
      '</span><span class="en">' + writeErrorEn(err) + '</span></div>';
  }finally{
    btn.disabled = false;
  }
}

/* Shared, honest write-failure messages. */
function writeErrorBn(err){
  if(!window.db.active) return '⚠️ Supabase কনফিগার করা নেই — <code>src/shared/supabase-config.js</code> পূরণ করো।';
  if(/row-level security|permission|jwt|unauthenticated/i.test(err.message||'')) return '🔒 ডেটাবেস লেখার অনুমতি নেই — উপরের <strong>☁️ আয়োজক সাইন-ইন</strong> বক্সে সাইন-ইন করো আর <code>supabase/schema.sql</code> চালানো আছে কি না দেখো।';
  return 'সংরক্ষণ ব্যর্থ: ' + err.message;
}
function writeErrorEn(err){
  if(!window.db.active) return '⚠️ Supabase is not configured — fill in <code>src/shared/supabase-config.js</code>.';
  if(/row-level security|permission|jwt|unauthenticated/i.test(err.message||'')) return '🔒 The database refused the write — sign in via the <strong>☁️ Organiser sign-in</strong> box above and check that <code>supabase/schema.sql</code> has been run.';
  return 'Save failed: ' + err.message;
}

/*
 * MASTER SWITCH — writes isUnlocked to settings/examControl the moment it is
 * flipped. onSnapshot then pushes it to every open browser in about a second.
 * On failure the checkbox is put back: the panel must never lie about state.
 */
async function onExamUnlockedToggled(){
  const box = document.getElementById('examUnlockedInput');
  const msg = document.getElementById('examUnlockedMsg');
  const wanted = box.checked;
  box.disabled = true;
  msg.innerHTML = '<div class="small-note"><span class="bn">সংরক্ষণ হচ্ছে…</span><span class="en">Saving…</span></div>';
  try{
    const s = await window.examSettings.save({ isUnlocked: wanted });
    renderExamStatus(s);
    if(wanted){
      msg.innerHTML = '<div class="msg ok"><span class="bn">✅ পরীক্ষা এখন <strong>সবার জন্য চালু</strong>। সব খোলা ব্রাউজারে সঙ্গে সঙ্গে পৌঁছে গেছে।</span>' +
        '<span class="en">✅ The exam is now <strong>open to everyone</strong>. It reached every open browser instantly.</span></div>';
    }else{
      msg.innerHTML = '<div class="msg ok"><span class="bn">🔒 পরীক্ষা <strong>লক</strong> করা হয়েছে। সবাই আবার কাউন্টডাউন দেখছে।</span>' +
        '<span class="en">🔒 The exam is <strong>locked</strong>. Everyone is back on the countdown.</span></div>';
    }
  }catch(err){
    console.error(err);
    box.checked = !wanted;
    msg.innerHTML = '<div class="msg err"><span class="bn">' + writeErrorBn(err) +
      '</span><span class="en">' + writeErrorEn(err) + '</span></div>';
  }finally{
    box.disabled = false;
  }
}
document.getElementById('examUnlockedInput').addEventListener('change', onExamUnlockedToggled);

/* =========================================================================
   ☁️ Organiser sign-in (Supabase Auth) — the key that lets this panel WRITE.
   The RLS policies accept writes only from a signed-in user. Create the
   one organiser account in Supabase → Authentication → Users.
   ========================================================================= */
function renderCloudAuth(){
  const box = document.getElementById('cloudAuthBox');
  if(!box) return;
  if(!window.db.active || !window.db.auth.available()){
    box.classList.add('hidden');
    return;
  }
  box.classList.remove('hidden');
  window.db.auth.currentUser().then(function(user){
    const out = document.getElementById('cloudAuthSignedOut');
    const email = document.getElementById('cloudAuthEmail');
    const outBtn = document.getElementById('cloudAuthSignOutBtn');
    if(user){
      out.style.display = 'none';
      email.textContent = '✅ ' + (user.email || user.uid);
      outBtn.hidden = false;
    }else{
      out.style.display = 'flex';
      email.textContent = '';
      outBtn.hidden = true;
    }
  }).catch(function(){ /* stay signed-out */ });
}

async function cloudSignIn(){
  const msg = document.getElementById('cloudAuthMsg');
  const email = document.getElementById('cloudAuthEmailInput').value.trim();
  const pass = document.getElementById('cloudAuthPassInput').value;
  if(!email || !pass){
    msg.innerHTML = '<div class="msg err"><span class="bn">ইমেইল ও পাসওয়ার্ড দাও।</span><span class="en">Enter the email and password.</span></div>';
    return;
  }
  msg.innerHTML = '<div class="small-note"><span class="bn">সাইন-ইন হচ্ছে…</span><span class="en">Signing in…</span></div>';
  try{
    await window.db.auth.signIn(email, pass);
    document.getElementById('cloudAuthPassInput').value = '';
    msg.innerHTML = '<div class="msg ok"><span class="bn">✅ সাইন-ইন সম্পন্ন — প্রশ্ন ও পরীক্ষা নিয়ন্ত্রণের পরিবর্তন এখন সবার জন্য সেভ হবে।</span><span class="en">✅ Signed in — question and exam-control changes now save for everyone.</span></div>';
    renderCloudAuth();
  }catch(err){
    console.error(err);
    msg.innerHTML = '<div class="msg err"><span class="bn">সাইন-ইন ব্যর্থ: ' + err.message +
      '</span><span class="en">Sign-in failed: ' + err.message + '</span></div>';
  }
}

async function cloudSignOut(){
  await window.db.auth.signOut().catch(function(){});
  document.getElementById('cloudAuthMsg').innerHTML = '';
  renderCloudAuth();
}

/* =========================================================================
   Questions  ·  প্রশ্ন ম্যানেজমেন্ট  (Supabase table: questions)
   Sub-tabs: 📝 list/edit · 📄 Google Sheet sync · 🗂 by category
   ========================================================================= */
let adminQuestionsCache = [];

/* ---------- sub-tab switching ---------- */
function showQSub(sub){
  document.querySelectorAll('.q-sub-btn').forEach(b=>b.classList.remove('active'));
  const map = { list:'qsubList', sync:'qsubSync', cats:'qsubCats' };
  Object.keys(map).forEach(k=>document.getElementById(map[k]).classList.toggle('hidden', k!==sub));
  const btns = document.querySelectorAll('.q-sub-btn');
  if(sub==='list' && btns[0]) btns[0].classList.add('active');
  if(sub==='sync' && btns[1]) btns[1].classList.add('active');
  if(sub==='cats' && btns[2]) btns[2].classList.add('active');
  if(sub==='cats') renderQCategories();
}

function escapeHtml(s){
  return String(s == null ? '' : s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

/** Known categories = the three built-ins + whatever exists in the table. */
function knownCategories(){
  const found = new Set(['primary','junior','senior']);
  adminQuestionsCache.forEach(q=>{ if(q.cat) found.add(q.cat); });
  return Array.from(found);
}

/** The category a cached row belongs to (rows carry it as q.cat). */
function rowCategory(q){
  return q.cat || (document.getElementById('adminCatSelect') ? document.getElementById('adminCatSelect').value : 'primary');
}

async function loadAdminQuestions(){
  if(!adminLoggedIn) return;
  const body = document.getElementById('adminQListBody');
  body.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:24px;">… লোড হচ্ছে</td></tr>';
  try{
    // Load EVERYTHING once; the dropdown filters client-side.
    adminQuestionsCache = await window.db.listAllQuestions();
    buildFilterOptions();
    renderAdminQList();
  }catch(err){
    console.error(err);
    body.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:24px;">লোড করা যায়নি — ' + escapeHtml(err.message) + '</td></tr>';
  }
}

/** Alias used across the panel after mutations. */
const loadAdminQuestionsRaw = loadAdminQuestions;

function buildFilterOptions(){
  const sel = document.getElementById('qFilterCat');
  if(!sel) return;
  const current = sel.value || 'all';
  const counts = {};
  adminQuestionsCache.forEach(q=>{ const c = q.cat || '(নেই)'; counts[c] = (counts[c]||0)+1; });
  sel.innerHTML = '<option value="all">সব / all (' + adminQuestionsCache.length + ')</option>';
  Object.keys(counts).sort().forEach(c=>{
    const o = document.createElement('option');
    o.value = c; o.textContent = c + ' (' + counts[c] + ')';
    sel.appendChild(o);
  });
  if(Array.from(sel.options).some(o=>o.value===current)) sel.value = current;
  const note = document.getElementById('qCountNote');
  if(note) note.textContent = '';
  // keep the datalist for the forms in sync too
  const dl = document.getElementById('qCategoryList');
  if(dl) dl.innerHTML = knownCategories().map(c=>'<option value="'+escapeHtml(c)+'"></option>').join('');
}

function renderAdminQList(){
  const body = document.getElementById('adminQListBody');
  const sel = document.getElementById('qFilterCat');
  const filter = sel ? sel.value : 'all';
  if(!window.db.active){
    body.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:24px;">⚠️ Supabase কনফিগার করা নেই — প্রশ্ন ডেটাবেসে সেভ হবে না। <code>supabase/SETUP.md</code> দেখো।</td></tr>';
    return;
  }
  const rows = adminQuestionsCache.filter(q => filter==='all' || (q.cat||'(নেই)')===filter);
  if(rows.length === 0){
    body.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:24px;">এই ফিল্টারে কোনো প্রশ্ন নেই। (পরীক্ষায় ক্যাটাগরির প্রশ্ন না থাকলে বিল্ট-ইন নমুনা প্রশ্নই দেখাবে; 📄 Sheet সিঙ্ক ট্যাব থেকে আমদানি করো।)</td></tr>';
    return;
  }
  body.innerHTML = '';
  rows.forEach(function(q, i){
    const tr = document.createElement('tr');
    tr.innerHTML = '<td>' + (i+1) + '</td>' +
      '<td style="max-width:420px;"><span class="bn">' + escapeHtml(q.q_bn) + '</span><span class="en" style="color:rgba(36,28,21,0.6);">' + escapeHtml(q.q_en) + '</span></td>' +
      '<td style="font-family:var(--f-mono);font-size:0.8rem;">' + escapeHtml(q.cat || '(নেই)') + '</td>' +
      '<td>' + 'কখগঘ'[q.correct] + ' (' + 'ABCD'[q.correct] + ')</td>' +
      '<td style="white-space:nowrap;">' +
        '<button class="btn btn-ghost" style="padding:4px 10px;font-size:0.8rem;" onclick="editQuestion(\'' + q.id + '\')"><span class="bn">✏️ সম্পাদনা</span><span class="en">Edit</span></button> ' +
        '<button class="btn btn-ghost" style="padding:4px 10px;font-size:0.8rem;color:var(--clay-dark);" onclick="deleteQuestionConfirm(\'' + q.id + '\')"><span class="bn">🗑 মুছো</span><span class="en">Delete</span></button>' +
      '</td>';
    body.appendChild(tr);
  });
}

function resetQuestionForm(){
  document.getElementById('qEditId').value = '';
  ['qBnInput','qEnInput','qOptBn0','qOptBn1','qOptBn2','qOptBn3','qOptEn0','qOptEn1','qOptEn2','qOptEn3'].forEach(function(id){
    document.getElementById(id).value = '';
  });
  document.getElementById('qCorrectInput').value = 'A';
  const catInput = document.getElementById('qCategoryInput');
  if(catInput && !catInput.value) catInput.value = document.getElementById('adminCatSelect').value;
  const nextOrder = adminQuestionsCache.length + 1;
  document.getElementById('qOrderInput').value = nextOrder;
}

function editQuestion(id){
  const q = adminQuestionsCache.find(function(x){ return x.id === id; });
  if(!q) return;
  document.getElementById('qEditId').value = q.id;
  document.getElementById('qBnInput').value = q.q_bn || '';
  document.getElementById('qEnInput').value = (q.q_en === q.q_bn) ? '' : (q.q_en || '');
  for(let i=0;i<4;i++){
    document.getElementById('qOptBn'+i).value = q.opts_bn[i] || '';
    document.getElementById('qOptEn'+i).value = (q.opts_en[i] === q.opts_bn[i]) ? '' : (q.opts_en[i] || '');
  }
  document.getElementById('qCorrectInput').value = 'ABCD'[q.correct];
  document.getElementById('qOrderInput').value = q.order || 1;
  const catInput = document.getElementById('qCategoryInput');
  if(catInput) catInput.value = q.cat || document.getElementById('adminCatSelect').value;
  document.getElementById('adminQMsg').innerHTML = '';
  showQSub('list');
  window.scrollTo({top: document.getElementById('adminQuestions').offsetTop - 80, behavior:'smooth'});
}

async function saveQuestionForm(){
  if(!adminLoggedIn) return;
  const msg = document.getElementById('adminQMsg');
  const catInput = document.getElementById('qCategoryInput');
  const cat = (catInput && catInput.value.trim()) || document.getElementById('adminCatSelect').value;
  msg.innerHTML = '';
  const q = {
    question: document.getElementById('qBnInput').value.trim(),
    questionEn: document.getElementById('qEnInput').value.trim(),
    optionA: document.getElementById('qOptBn0').value.trim(),
    optionB: document.getElementById('qOptBn1').value.trim(),
    optionC: document.getElementById('qOptBn2').value.trim(),
    optionD: document.getElementById('qOptBn3').value.trim(),
    optionAEn: document.getElementById('qOptEn0').value.trim(),
    optionBEn: document.getElementById('qOptEn1').value.trim(),
    optionCEn: document.getElementById('qOptEn2').value.trim(),
    optionDEn: document.getElementById('qOptEn3').value.trim(),
    correctAnswer: document.getElementById('qCorrectInput').value,
    order: parseInt(document.getElementById('qOrderInput').value, 10) || (adminQuestionsCache.length + 1)
  };
  if(!q.question || !q.optionA || !q.optionB || !q.optionC || !q.optionD){
    msg.innerHTML = '<div class="msg err"><span class="bn">প্রশ্ন ও ৪টি অপশন (বাংলা) অবশ্যই দাও।</span><span class="en">The question and all four Bangla options are required.</span></div>';
    return;
  }
  try{
    const editId = document.getElementById('qEditId').value;
    await window.db.saveQuestion(cat, q, editId || null);
    msg.innerHTML = '<div class="msg ok"><span class="bn">✅ প্রশ্ন সংরক্ষণ হয়েছে!</span><span class="en">✅ Question saved!</span></div>';
    resetQuestionForm();
    catInput.value = cat;
    await loadAdminQuestionsRaw();
  }catch(err){
    console.error(err);
    msg.innerHTML = '<div class="msg err"><span class="bn">' + writeErrorBn(err) + '</span><span class="en">' + writeErrorEn(err) + '</span></div>';
  }
}

async function deleteQuestionConfirm(id){
  const q = adminQuestionsCache.find(function(x){ return x.id === id; });
  const ok = window.confirm('প্রশ্নটি মুছে ফেলবে?\n\nDelete this question?\n\n“' + ((q && q.q_bn) || '') + '”');
  if(!ok) return;
  try{
    await window.db.deleteQuestion(id);
    document.getElementById('adminQMsg').innerHTML = '<div class="msg ok"><span class="bn">প্রশ্ন মুছে গেছে।</span><span class="en">Question deleted.</span></div>';
    await loadAdminQuestionsRaw();
  }catch(err){
    console.error(err);
    document.getElementById('adminQMsg').innerHTML = '<div class="msg err"><span class="bn">' + writeErrorBn(err) + '</span><span class="en">' + writeErrorEn(err) + '</span></div>';
  }
}

/*
 * One-time migration: push the bundled Bangla question set of the selected
 * category into Supabase — but only while that category has zero rows, so
 * clicking twice can never duplicate anything.
 */
async function importOldQuestions(){
  if(!adminLoggedIn) return;
  const msg = document.getElementById('adminQMsg');
  const cat = document.getElementById('adminCatSelect').value;
  const bundled = QUESTIONS[cat] || [];
  if(bundled.length === 0){ msg.innerHTML = ''; return; }
  msg.innerHTML = '<div class="small-note"><span class="bn">আনা হচ্ছে…</span><span class="en">Importing…</span></div>';
  try{
    const res = await window.db.importBundledQuestions(cat, bundled);
    if(res.inserted > 0){
      msg.innerHTML = '<div class="msg ok"><span class="bn">✅ ' + res.inserted + 'টি প্রশ্ন যোগ হয়েছে।</span><span class="en">✅ ' + res.inserted + ' questions imported.</span></div>';
    }else{
      msg.innerHTML = '<div class="msg ok"><span class="bn">এই ক্যাটাগরিতে ইতিমধ্যে ' + res.total + 'টি প্রশ্ন আছে — ডুপ্লিকেট এড়াতে কিছু যোগ করা হয়নি।</span><span class="en">This category already has ' + res.total + ' questions — nothing duplicated.</span></div>';
    }
    await loadAdminQuestionsRaw();
  }catch(err){
    console.error(err);
    msg.innerHTML = '<div class="msg err"><span class="bn">' + writeErrorBn(err) + '</span><span class="en">' + writeErrorEn(err) + '</span></div>';
  }
}

/* ---------- 🗂 by-category management ---------- */
async function renderQCategories(){
  const body = document.getElementById('qCatsBody');
  if(!body) return;
  body.innerHTML = '… লোড হচ্ছে';
  try{
    if(adminQuestionsCache.length === 0) await loadAdminQuestionsRaw();
    const counts = {};
    adminQuestionsCache.forEach(q=>{ const c = q.cat || '(নেই)'; counts[c] = (counts[c]||0)+1; });
    const cats = Object.keys(counts).sort();
    if(cats.length === 0){
      body.innerHTML = '<p class="small-note" style="margin:0;">এখনো কোনো প্রশ্ন নেই — 📄 Sheet সিঙ্ক ট্যাব থেকে আমদানি করো।</p>';
      return;
    }
    let html = '<div style="overflow-x:auto;"><table class="lb"><thead><tr>' +
      '<th><span class="bn">ক্যাটাগরি</span><span class="en">Category</span></th>' +
      '<th><span class="bn">প্রশ্ন</span><span class="en">Questions</span></th><th></th></tr></thead><tbody>';
    cats.forEach(c=>{
      html += '<tr><td style="font-family:var(--f-mono);">' + escapeHtml(c) + '</td><td>' + counts[c] + '</td>' +
        '<td style="white-space:nowrap;">' +
        '<button class="btn btn-ghost" style="padding:4px 10px;font-size:0.8rem;" onclick="filterToCategory(\'' + escapeHtml(c) + '\')"><span class="bn">দেখো</span><span class="en">View</span></button> ' +
        '<button class="btn btn-ghost" style="padding:4px 10px;font-size:0.8rem;color:var(--clay-dark);" onclick="deleteCategoryConfirm(\'' + escapeHtml(c) + '\',' + counts[c] + ')"><span class="bn">🗑 মুছো</span><span class="en">Delete</span></button>' +
        '</td></tr>';
    });
    html += '</tbody></table></div>';
    body.innerHTML = html;
  }catch(err){
    console.error(err);
    body.innerHTML = '<p class="small-note" style="margin:0;color:var(--clay-dark);">লোড করা যায়নি — ' + escapeHtml(err.message) + '</p>';
  }
}

function filterToCategory(cat){
  showQSub('list');
  const sel = document.getElementById('qFilterCat');
  if(sel) sel.value = cat;
  renderAdminQList();
}

async function deleteCategoryConfirm(cat, count){
  const ok = window.confirm('“' + cat + '” ক্যাটাগরির ' + count + 'টি প্রশ্ন মুছে ফেলবে? ফিরিয়ে আনা যাবে না!\n\nDelete all ' + count + ' questions in “' + cat + '”?');
  if(!ok) return;
  try{
    await window.db.deleteQuestionsByCategory(cat);
    await loadAdminQuestionsRaw();
    renderQCategories();
  }catch(err){
    console.error(err);
    window.alert(writeErrorBn(err));
  }
}

async function deleteAllQuestionsConfirm(){
  const total = adminQuestionsCache.length;
  const ok = window.confirm('⚠️ সব প্রশ্ন (' + total + 'টি) মুছে ফেলবে? ফিরিয়ে আনা যাবে না!\n\nDelete ALL ' + total + ' questions?');
  if(!ok) return;
  try{
    await window.db.deleteAllQuestions();
    await loadAdminQuestionsRaw();
    renderQCategories();
  }catch(err){
    console.error(err);
    window.alert(writeErrorBn(err));
  }
}

/* =========================================================================
   📄 Google Sheet Sync  ·  প্রশ্ন আপলোড
   Two steps: loadSheetPreview() fetches+parses+validates and paints a
   preview; applySheetImport() performs the chosen import mode.
   ========================================================================= */
let sheetPreviewData = null;   // { items, errors, csvUrl }

function syncSheetCatModeChanged(){
  const mode = document.getElementById('sheetCatMode').value;
  document.getElementById('sheetFixedCatWrap').hidden = (mode !== 'fixed');
}

function setSheetStatus(html, tone){
  const el = document.getElementById('sheetStatus');
  el.innerHTML = html ? '<div class="' + (tone === 'err' ? 'msg err' : tone === 'ok' ? 'msg ok' : 'small-note') + '">' + html + '</div>' : '';
}

async function fetchCsvText(url){
  const res = await fetch(url, { redirect: 'follow' });
  if(!res.ok) throw new Error('HTTP ' + res.status);
  const text = await res.text();
  if(/^\s*<!DOCTYPE html|^\s*<html/i.test(text)) throw new Error('HTML returned — শিটটি শেয়ার করা নেই');
  return text;
}

async function loadSheetPreview(){
  if(!adminLoggedIn) return;
  const msg = document.getElementById('sheetStatus');
  const btn = document.getElementById('sheetLoadBtn');
  const syncBtn = document.getElementById('sheetSyncBtn');
  const resultEl = document.getElementById('sheetResult');
  const previewWrap = document.getElementById('sheetPreviewWrap');
  resultEl.innerHTML = '';
  previewWrap.classList.add('hidden');
  sheetPreviewData = null;
  syncBtn.disabled = true;

  const SI = window.sheetImport;
  if(!SI){ setSheetStatus('<span class="bn">sheet-import.js লোড হয়নি — পেজ রিফ্রেশ করো।</span>','err'); return; }

  const url = document.getElementById('sheetUrlInput').value.trim();
  const mapped = SI.sheetUrlToCsv(url);
  if(mapped.error === 'docs'){
    setSheetStatus('<span class="bn">Google Docs সরাসরি সাপোর্ট নয়। প্রশ্ন Google Sheet ফরম্যাটে দিন (নিচের নমুনা হেডার দেখো)।</span><span class="en">Google Docs is not supported — paste a Google Sheets link.</span>','err');
    return;
  }
  if(mapped.error === 'invalid' || !mapped.csvUrl){
    setSheetStatus('<span class="bn">এটি Google Sheet লিংক নয়। যেমন: https://docs.google.com/spreadsheets/d/…/edit</span><span class="en">That is not a Google Sheets link.</span>','err');
    return;
  }

  const catMode = document.getElementById('sheetCatMode').value;
  const fixedCat = document.getElementById('sheetFixedCatInput').value.trim();
  if(catMode === 'fixed' && !fixedCat){
    setSheetStatus('<span class="bn">ক্যাটাগরির নাম লিখো।</span><span class="en">Enter the category name.</span>','err');
    return;
  }

  btn.disabled = true;
  const original = btn.innerHTML;
  btn.innerHTML = '<span class="bn">লিংক থেকে প্রশ্ন লোড হচ্ছে…</span><span class="en">Loading…</span>';
  setSheetStatus('<span class="bn">লিংক থেকে প্রশ্ন লোড হচ্ছে...</span><span class="en">Loading questions from the link…</span>');
  try{
    let text;
    try{
      text = await fetchCsvText(mapped.csvUrl);
    }catch(e1){
      console.error('[sheet-sync] export endpoint failed, trying gviz', e1);
      text = await fetchCsvText(mapped.fallbackUrl);
    }
    const rows = SI.parseCsv(text);
    if(rows.length < 2){
      setSheetStatus('<span class="bn">শিটে কোনো সারি পাওয়া যায়নি।</span><span class="en">No data rows found in the sheet.</span>','err');
      return;
    }
    const hmap = SI.mapHeaders(rows[0]);
    const validated = SI.validateRows(rows, hmap, {
      categoryMode: catMode,
      fixedCategory: fixedCat
    });

    sheetPreviewData = {
      items: validated.items,
      errors: validated.errors,
      csvUrl: mapped.csvUrl
    };
    renderSheetPreview(validated);
    if(validated.items.length > 0){
      syncBtn.disabled = false;
      setSheetStatus('<span class="bn">প্রিভিউ তৈরি হয়েছে — বৈধ ' + validated.items.length + 'টি' +
        (validated.errors.length ? ', ভুল ' + validated.errors.length + 'টি। ভুল সারিগুলো বাদেই সিঙ্ক হবে।' : '।') +
        '</span><span class="en">Preview ready — ' + validated.items.length + ' valid' +
        (validated.errors.length ? ', ' + validated.errors.length + ' with errors (they will be skipped).' : '.') + '</span>','ok');
    }else{
      setSheetStatus('<span class="bn">কিছু সারিতে ভুল আছে, আবার চেক করুন — একটি বৈধ সারিও পাওয়া যায়নি।</span><span class="en">Every row has errors — please check again.</span>','err');
    }
  }catch(err){
    console.error('[sheet-sync] fetch failed', err);
    setSheetStatus('<span class="bn">শিট আনা যায়নি: ' + escapeHtml(err.message) + '। শিটটি “Anyone with the link → Viewer” করে শেয়ার করা আছে কি না দেখো।</span><span class="en">Could not fetch the sheet: ' + escapeHtml(err.message) + '. Check that it is shared as “Anyone with the link → Viewer”.</span>','err');
  }finally{
    btn.disabled = false;
    btn.innerHTML = original;
  }
}

function renderSheetPreview(validated){
  const wrap = document.getElementById('sheetPreviewWrap');
  const body = document.getElementById('sheetPreviewBody');
  const MAX_SHOW = 20;
  const errorRows = {};
  validated.errors.forEach(e=>{ errorRows[e.row] = e.reason; });
  const itemRows = {};
  validated.items.forEach(it=>{ itemRows[it._row] = it; });

  // rebuild: walk sheet rows in order, marking valid/invalid
  let html = '';
  let shown = 0;
  validated.items.forEach(function(it){
    if(shown >= MAX_SHOW) return;
    shown++;
    html += '<tr><td style="font-family:var(--f-mono);">' + it._row + '</td>' +
      '<td style="font-family:var(--f-mono);font-size:0.8rem;">' + escapeHtml(it.category) + '</td>' +
      '<td style="max-width:360px;">' + escapeHtml(it.question) + '</td>' +
      '<td>' + it.correct_answer + '</td><td style="font-family:var(--f-mono);">' + it.order_no + '</td>' +
      '<td>✅</td></tr>';
  });
  Object.keys(errorRows).forEach(function(rowNo){
    if(shown >= MAX_SHOW) return;
    shown++;
    html += '<tr style="background:rgba(166,70,30,0.06);"><td style="font-family:var(--f-mono);">' + rowNo + '</td>' +
      '<td colspan="4"><span class="bn">সারি ' + rowNo + ': ' + escapeHtml(errorRows[rowNo]) + '</span></td>' +
      '<td>❌</td></tr>';
  });
  if(validated.items.length + validated.errors.length > MAX_SHOW){
    html += '<tr><td colspan="6" style="text-align:center;">… আরো ' + (validated.items.length + validated.errors.length - MAX_SHOW) + 'টি সারি</td></tr>';
  }
  body.innerHTML = html || '<tr><td colspan="6" style="text-align:center;padding:18px;">কিছু নেই</td></tr>';
  wrap.classList.remove('hidden');
}

async function applySheetImport(){
  if(!adminLoggedIn || !sheetPreviewData) return;
  const syncBtn = document.getElementById('sheetSyncBtn');
  const resultEl = document.getElementById('sheetResult');
  const mode = document.getElementById('sheetImportMode').value;
  const catMode = document.getElementById('sheetCatMode').value;
  const fixedCat = document.getElementById('sheetFixedCatInput').value.trim();
  const sourceUrl = document.getElementById('sheetUrlInput').value.trim();

  if(sheetPreviewData.items.length === 0){
    setSheetStatus('<span class="bn">কিছু সারিতে ভুল আছে, আবার চেক করুন — আমদানি করার মতো বৈধ সারি নেই।</span>','err');
    return;
  }

  const rows = sheetPreviewData.items.map(it => Object.assign({}, it, {
    source: 'google_sheet',
    source_url: sourceUrl
  }));

  // Confirmations for destructive modes
  if(mode === 'replace_cat'){
    const cats = Array.from(new Set(rows.map(r=>r.category)));
    const catText = catMode === 'fixed' ? fixedCat : cats.join(', ');
    const ok = window.confirm('নিচের ক্যাটাগরির সব পুরনো প্রশ্ন মুছে যাবে, তারপর নতুন ' + rows.length + 'টি বসবে:\n' + catText + '\n\nচালিয়ে যাবে?');
    if(!ok) return;
  }
  if(mode === 'replace_all'){
    let total = 0;
    try{ total = (await window.db.listAllQuestions()).length; }catch(e){ /* unknown count */ }
    const ok = window.confirm('⚠️ ডেটাবেসের সব প্রশ্ন (' + total + 'টি) মুছে পুরো শিটের ' + rows.length + 'টি প্রশ্ন বসানো হবে। ফিরিয়ে আনা যাবে না!\n\nReplace ALL questions?');
    if(!ok) return;
  }

  syncBtn.disabled = true;
  const original = syncBtn.innerHTML;
  syncBtn.innerHTML = '<span class="bn">সিঙ্ক হচ্ছে…</span><span class="en">Syncing…</span>';
  try{
    // 1) delete per mode
    if(mode === 'replace_cat'){
      const cats = Array.from(new Set(rows.map(r=>r.category)));
      for(const c of cats) await window.db.deleteQuestionsByCategory(c);
    }else if(mode === 'replace_all'){
      await window.db.deleteAllQuestions();
    }

    // 2) duplicate guard in append mode: skip (category, question) already present
    let duplicates = 0;
    let toInsert = rows;
    if(mode === 'append'){
      let existing = [];
      try{ existing = await window.db.listAllQuestions(); }catch(e){ console.error(e); }
      const seen = new Set(existing.map(q => (q.cat || '') + '::' + q.q_bn));
      toInsert = rows.filter(r => {
        const key = r.category + '::' + r.question;
        if(seen.has(key)){ duplicates++; return false; }
        return true;
      });
    }

    // 3) insert
    const inserted = await window.db.bulkInsertQuestions(toInsert);

    const failed = sheetPreviewData.errors.length;
    resultEl.innerHTML = '<div class="msg ok"><span class="bn">✅ সফলভাবে সিঙ্ক হয়েছে! যোগ হয়েছে ' + inserted + 'টি' +
      (duplicates ? ', ডুপ্লিকেট স্কিপ ' + duplicates + 'টি' : '') +
      (failed ? ', ভুল সারি (স্কিপ) ' + failed + 'টি' : '') + '।</span>' +
      '<span class="en">✅ Sync complete! Inserted ' + inserted +
      (duplicates ? ', skipped ' + duplicates + ' duplicates' : '') +
      (failed ? ', skipped ' + failed + ' invalid rows' : '') + '.</span></div>';
    await loadAdminQuestionsRaw();
    renderQCategories();
  }catch(err){
    console.error('[sheet-sync] import failed', err);
    resultEl.innerHTML = '<div class="msg err"><span class="bn">' + writeErrorBn(err) + '</span><span class="en">' + writeErrorEn(err) + '</span></div>';
  }finally{
    syncBtn.disabled = false;
    syncBtn.innerHTML = original;
  }
}

/* =========================================================================
   Registrations  ·  রেজিস্ট্রেশন তালিকা  (Supabase table: registrations)
   ========================================================================= */
let adminRegsCache = [];

async function loadAdminRegistrations(){
  if(!adminLoggedIn) return;
  const body = document.getElementById('adminRegsBody');
  const note = document.getElementById('regsSourceNote');
  if(note){
    if(window.db.active){
      note.innerHTML = '<span class="bn">✅ Supabase — যেকোনো ডিভাইস থেকে করা রেজিস্ট্রেশন এখানে আসছে। তালিকা খালি মনে হলে আগে ☁️ সাইন-ইন করো।</span><span class="en">✅ Supabase — registrations from every device land here.</span>';
      note.style.color = 'var(--sage)';
    }else{
      note.innerHTML = '<span class="bn">⚠️ Supabase কনফিগার করা নেই — রেজিস্ট্রেশন কোথাও সেভ হচ্ছে না। <code>src/shared/supabase-config.js</code> পূরণ করো।</span><span class="en">⚠️ Supabase is not configured — registrations are not being saved anywhere.</span>';
      note.style.color = 'var(--clay-dark)';
    }
  }
  body.innerHTML = '<tr><td colspan="10" style="text-align:center;padding:30px;">… লোড হচ্ছে</td></tr>';
  try{
    adminRegsCache = await window.db.listRegistrations();
    renderAdminRegsTable();
  }catch(err){
    console.error('Error fetching registrations:', err);
    const denied = /row-level security|permission|jwt|401|403/i.test(String(err.message||''));
    body.innerHTML = '<tr><td colspan="10" style="text-align:center;padding:30px;">' +
      (denied
        ? '<span class="bn">🔒 তালিকা পড়ার অনুমতি নেই — উপরের <strong>☁️ আয়োয়ক সাইন-ইন</strong> বক্সে সাইন-ইন করো (রেজিস্ট্রেশনের ফোন/ইমেইল শুধু আয়োয়কই দেখতে পারে)।</span><span class="en">🔒 Read denied — sign in via the ☁️ box above.</span>'
        : '<span class="bn">তালিকা লোড করা যায়নি: ' + escapeHtml(err.message) + '</span>') +
      '</td></tr>';
    return;
  }
  // An empty list is trustworthy only when the organiser is signed in —
  // otherwise RLS hides every row and it looks like "no data".
  if(adminRegsCache.length === 0 && window.db.active){
    try{
      const who = await window.db.auth.currentUser();
      if(!who){
        body.innerHTML = '<tr><td colspan="10" style="text-align:center;padding:30px;"><span class="bn">☁️ আয়োয়ক <strong>সাইন-ইন করা নেই</strong> — রেজিস্ট্রেশন তালিকা শুধু সাইন-ইন করা আয়োয়ক দেখতে পারে। উপরের ☁️ বক্সে সাইন-ইন করো (অ্যাকাউন্ট বানাও: Supabase → Authentication → Users → Add user)।</span><span class="en">☁️ Not signed in — the list is visible to signed-in organisers only.</span></td></tr>';
      }
    }catch(e){ /* ignore */ }
  }
}


/** Render with the live search filter (name / phone / email). */
function renderAdminRegsTable(){
  const body = document.getElementById('adminRegsBody');
  const term = (document.getElementById('regsSearchInput').value || '').trim().toLowerCase();
  const records = adminRegsCache.filter(function(rec){
    if(!term) return true;
    return [rec.name, rec.phone, rec.email, rec.pid, rec.school, rec.category]
      .some(function(v){ return v && String(v).toLowerCase().indexOf(term) !== -1; });
  });
  if(records.length === 0){
    body.innerHTML = '<tr><td colspan="10" style="text-align:center;padding:30px;">' +
      (adminRegsCache.length === 0 ? 'এখনো কোনো রেজিস্ট্রেশন হয়নি।' : 'কিছু পাওয়া যায়নি।') + '</td></tr>';
    return;
  }
  body.innerHTML = '';
  records.forEach(function(rec){
    const tr = document.createElement('tr');
    const whenRaw = rec.createdAt;
    const when = typeof whenRaw === 'string' ? whenRaw.slice(0,10)
      : (whenRaw && whenRaw.toDate ? whenRaw.toDate().toLocaleDateString('en-GB') : '');
    const catKey = rec.category || getCategoryKey(rec.cls);
    const catLabel = catKey
      ? (CATEGORY_LABELS[catKey] ? CATEGORY_LABELS[catKey].bn : catKey)
      : (rec.cls || '—');
    tr.innerHTML = '<td style="font-family:var(--f-mono);font-size:0.8rem;">' + (rec.pid ? escapeHtml(rec.pid) : '—') + '</td>' +
      '<td>' + escapeHtml(rec.name) + '</td>' +
      '<td style="font-family:var(--f-mono);font-size:0.8rem;">' + escapeHtml(rec.phone) + '</td>' +
      '<td>' + escapeHtml(rec.email) + '</td>' +
      '<td>' + escapeHtml(rec.school) + '</td>' +
      '<td>' + escapeHtml(rec.area) + '</td>' +
      '<td>' + escapeHtml(catLabel) + '</td>' +
      '<td style="font-family:var(--f-mono);font-size:0.8rem;">' + escapeHtml(when) + '</td>' +
      '<td>' + (rec.examTaken ? '✅' : '—') + '</td>' +
      '<td>' + (rec.examTaken ? rec.score + (rec.maxScore ? '/' + rec.maxScore : '') : '—') + '</td>';
    body.appendChild(tr);
  });
}

/* =========================================================================
   👥 Team management  ·  টিম ম্যানেজমেন্ট  (Supabase table: team_members)
   Drives the public Team section: members, convenors, volunteers, sponsors.
   ========================================================================= */
let adminTeamCache = [];

async function loadAdminTeam(){
  if(!adminLoggedIn) return;
  const body = document.getElementById('tListBody');
  body.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:24px;">… লোড হচ্ছে</td></tr>';
  try{
    adminTeamCache = await window.db.listTeamMembers();
    renderTeamTable();
  }catch(err){
    console.error('Error fetching team members:', err);
    body.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:24px;">লোড করা যায়নি — ' + escapeHtml(err.message) + '</td></tr>';
  }
}

function renderTeamTable(){
  const body = document.getElementById('tListBody');
  if(!window.db.active){
    body.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:24px;">⚠️ Supabase কনফিগার করা নেই — <code>supabase/SETUP.md</code> দেখো।</td></tr>';
    return;
  }
  if(adminTeamCache.length === 0){
    body.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:24px;">তালিকা খালি — উপরের ফর্ম থেকে সদস্য যোগ করো। (SQL-এর বীজ-রোগুলো দেখতে <code>supabase/quick-fixes.sql</code> চালাও।)</td></tr>';
    return;
  }
  body.innerHTML = '';
  adminTeamCache.forEach(function(m, i){
    const tr = document.createElement('tr');
    const label = teamCategoryLabel(m.category);
    tr.innerHTML = '<td>' + (i+1) + '</td>' +
      '<td>' + escapeHtml(m.name) + (m.imageUrl ? ' <img src="' + escapeHtml(m.imageUrl) + '" alt="" width="28" height="28" style="object-fit:cover;border-radius:50%;vertical-align:middle;margin-left:6px;">' : '') + '</td>' +
      '<td>' + escapeHtml(m.role || '—') + '</td>' +
      '<td>' + escapeHtml(label.bn) + '</td>' +
      '<td style="font-family:var(--f-mono);">' + (m.order || 0) + '</td>' +
      '<td style="white-space:nowrap;">' +
        '<button class="btn btn-ghost" style="padding:4px 10px;font-size:0.8rem;" onclick="editTeamMember(\'' + m.id + '\')"><span class="bn">✏️ সম্পাদনা</span><span class="en">Edit</span></button> ' +
        '<button class="btn btn-ghost" style="padding:4px 10px;font-size:0.8rem;color:var(--clay-dark);" onclick="deleteTeamMemberConfirm(\'' + m.id + '\')"><span class="bn">🗑 মুছো</span><span class="en">Delete</span></button>' +
      '</td>';
    body.appendChild(tr);
  });
}

function resetTeamForm(){
  document.getElementById('tEditId').value = '';
  ['tNameInput','tRoleInput','tImageUrlInput','tDistrictInput','tFacebookInput'].forEach(function(id){
    document.getElementById(id).value = '';
  });
  document.getElementById('tCategoryInput').value = 'organizer';
  document.getElementById('tOrderInput').value = (adminTeamCache.length + 1);
}

function editTeamMember(id){
  const m = adminTeamCache.find(function(x){ return x.id === id; });
  if(!m) return;
  document.getElementById('tEditId').value = m.id;
  document.getElementById('tNameInput').value = m.name;
  document.getElementById('tRoleInput').value = m.role;
  document.getElementById('tCategoryInput').value = TEAM_CATEGORIES[m.category] ? m.category : 'organizer';
  document.getElementById('tImageUrlInput').value = m.imageUrl;
  document.getElementById('tDistrictInput').value = m.districtInstitute;
  document.getElementById('tFacebookInput').value = m.facebookUrl;
  document.getElementById('tOrderInput').value = m.order || 0;
  document.getElementById('tMsg').innerHTML = '';
  window.scrollTo({top: document.getElementById('adminTeam').offsetTop - 80, behavior:'smooth'});
}

async function saveTeamMemberForm(){
  if(!adminLoggedIn) return;
  const msg = document.getElementById('tMsg');
  msg.innerHTML = '';
  const m = {
    name: document.getElementById('tNameInput').value.trim(),
    role: document.getElementById('tRoleInput').value.trim(),
    category: document.getElementById('tCategoryInput').value,
    imageUrl: document.getElementById('tImageUrlInput').value.trim(),
    districtInstitute: document.getElementById('tDistrictInput').value.trim(),
    facebookUrl: document.getElementById('tFacebookInput').value.trim(),
    order: parseInt(document.getElementById('tOrderInput').value, 10) || 0
  };
  if(!m.name){
    msg.innerHTML = '<div class="msg err"><span class="bn">নাম অবশ্যই দাও।</span><span class="en">The name is required.</span></div>';
    return;
  }
  try{
    const editId = document.getElementById('tEditId').value;
    await window.db.saveTeamMember(m, editId || null);
    msg.innerHTML = '<div class="msg ok"><span class="bn">✅ সংরক্ষণ হয়েছে! সাইটের টিম অংশে এখনই দেখা যাবে।</span><span class="en">✅ Saved! It is on the public Team section right away.</span></div>';
    resetTeamForm();
    await loadAdminTeam();
  }catch(err){
    console.error('Error saving team member:', err);
    msg.innerHTML = '<div class="msg err"><span class="bn">' + writeErrorBn(err) + '</span><span class="en">' + writeErrorEn(err) + '</span></div>';
  }
}

async function deleteTeamMemberConfirm(id){
  const m = adminTeamCache.find(function(x){ return x.id === id; });
  const ok = window.confirm('তালিকা থেকে সরিয়ে দেবে?\n\nRemove from the team section?\n\n“' + ((m && m.name) || '') + '”');
  if(!ok) return;
  try{
    await window.db.deleteTeamMember(id);
    document.getElementById('tMsg').innerHTML = '<div class="msg ok"><span class="bn">মুছে গেছে।</span><span class="en">Deleted.</span></div>';
    await loadAdminTeam();
  }catch(err){
    console.error('Error deleting team member:', err);
    document.getElementById('tMsg').innerHTML = '<div class="msg err"><span class="bn">' + writeErrorBn(err) + '</span><span class="en">' + writeErrorEn(err) + '</span></div>';
  }
}
