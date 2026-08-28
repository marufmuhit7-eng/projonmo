/* =========================================================================
   Admin panel  ·  অ্যাডমিন প্যানেল
   ---------------------------------------------------------------------------
   Login gate:      window.adminAuth (local, hashed — keeps casual visitors out)
   Cloud data:      window.db (Firestore — questions, exam control, regs)
                    Privileged writes need the ☁️ organiser sign-in, because
                    the published Firestore rules demand request.auth != null.
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
  document.getElementById('adminPassword').classList.toggle('hidden', sub!=='password');
  if(sub==='timer') loadExamControl();
  if(sub==='questions') loadAdminQuestions();
  if(sub==='regs') loadAdminRegistrations();
}

/* =========================================================================
   Exam control  ·  পরীক্ষা নিয়ন্ত্রণ  (Firestore: settings/examControl)
   ========================================================================= */

/** Which backend is live — honest banner, no "this browser only" surprises. */
function renderBackendNote(){
  const note = document.getElementById('timerBackendNote');
  if(window.db.active){
    note.innerHTML =
      '<span class="bn">✅ <strong>Firebase Firestore</strong> চালু — এখানে পরিবর্তন করলে <strong>সব ভিজিটরের</strong> ব্রাউজারে সঙ্গে সঙ্গে প্রতিফলিত হবে।</span>' +
      '<span class="en">✅ <strong>Firebase Firestore</strong> is live — changes here reach <strong>every visitor\'s</strong> browser instantly.</span>';
    note.style.color = 'var(--sage)';
  }else{
    note.innerHTML =
      '<span class="bn">⚠️ Firebase কনফিগার করা নেই — পরিবর্তন গ্লোবালি যাবে না। <code>src/shared/firebase-config.js</code>-এ ৬টা মান বসিয়ে <code>npm run build</code> চালাও (নির্দেশিকা: <code>firebase/SETUP.md</code>)।</span>' +
      '<span class="en">⚠️ Firebase is not configured — nothing will go global. Paste your config into <code>src/shared/firebase-config.js</code> and run <code>npm run build</code> (guide: <code>firebase/SETUP.md</code>).</span>';
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
  if(!window.db.active) return '⚠️ Firebase কনফিগার করা নেই — <code>src/shared/firebase-config.js</code> পূরণ করো।';
  if(/permission|unauthenticated|insufficient/i.test(err.message||'')) return '🔒 Firestore লেখার অনুমতি নেই — উপরের <strong>☁️ আয়োজক সাইন-ইন</strong> বক্সে সাইন-ইন করো ও <code>firebase/firestore.rules</code> পাবলিশ আছে কি না দেখো।';
  return 'সংরক্ষণ ব্যর্থ: ' + err.message;
}
function writeErrorEn(err){
  if(!window.db.active) return '⚠️ Firebase is not configured — fill in <code>src/shared/firebase-config.js</code>.';
  if(/permission|unauthenticated|insufficient/i.test(err.message||'')) return '🔒 Firestore refused the write — sign in via the <strong>☁️ Organiser sign-in</strong> box above and check that <code>firebase/firestore.rules</code> is published.';
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
   ☁️ Organiser sign-in (Firebase Auth) — the key that lets this panel WRITE.
   The Firestore rules accept writes only from a signed-in user. Create the
   one organiser account in Firebase Console → Authentication → Users.
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
   Questions  ·  প্রশ্ন ম্যানেজমেন্ট  (Firestore collection: questions)
   Add / edit / delete one question at a time — no more JSON textarea.
   ========================================================================= */
let adminQuestionsCache = [];

function escapeHtml(s){
  return String(s == null ? '' : s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

async function loadAdminQuestions(){
  if(!adminLoggedIn) return;
  const cat = document.getElementById('adminCatSelect').value;
  const body = document.getElementById('adminQListBody');
  body.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:24px;">… লোড হচ্ছে</td></tr>';
  try{
    adminQuestionsCache = await window.db.listQuestions(cat);
    renderAdminQList();
  }catch(err){
    console.error(err);
    body.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:24px;">লোড করা যায়নি — ' + escapeHtml(err.message) + '</td></tr>';
  }
}

function renderAdminQList(){
  const body = document.getElementById('adminQListBody');
  if(!window.db.active){
    body.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:24px;">⚠️ Firebase কনফিগার করা নেই — প্রশ্ন ডেটাবেসে সেভ হবে না। <code>firebase/SETUP.md</code> দেখো।</td></tr>';
    return;
  }
  if(adminQuestionsCache.length === 0){
    body.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:24px;">এই ক্যাটাগরিতে এখনো কোনো প্রশ্ন নেই — উপরের ফর্ম থেকে যোগ করো। (পরীক্ষায় ততক্ষণ বিল্ট-ইন নমুনা প্রশ্নই দেখাবে।)</td></tr>';
    return;
  }
  body.innerHTML = '';
  adminQuestionsCache.forEach(function(q, i){
    const tr = document.createElement('tr');
    tr.innerHTML = '<td>' + (i+1) + '</td>' +
      '<td style="max-width:420px;"><span class="bn">' + escapeHtml(q.q_bn) + '</span><span class="en" style="color:rgba(36,28,21,0.6);">' + escapeHtml(q.q_en) + '</span></td>' +
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
  document.getElementById('adminQMsg').innerHTML = '';
  window.scrollTo({top: document.getElementById('adminQuestions').offsetTop - 80, behavior:'smooth'});
}

async function saveQuestionForm(){
  if(!adminLoggedIn) return;
  const msg = document.getElementById('adminQMsg');
  const cat = document.getElementById('adminCatSelect').value;
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
    await loadAdminQuestions();
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
    await loadAdminQuestions();
  }catch(err){
    console.error(err);
    document.getElementById('adminQMsg').innerHTML = '<div class="msg err"><span class="bn">' + writeErrorBn(err) + '</span><span class="en">' + writeErrorEn(err) + '</span></div>';
  }
}

/* =========================================================================
   Registrations  ·  রেজিস্ট্রেশন তালিকা  (Firestore collection: registrations)
   ========================================================================= */
let adminRegsCache = [];

async function loadAdminRegistrations(){
  if(!adminLoggedIn) return;
  const body = document.getElementById('adminRegsBody');
  const note = document.getElementById('regsSourceNote');
  if(note){
    if(window.db.active){
      note.innerHTML = '<span class="bn">✅ Firebase Firestore — যেকোনো ডিভাইস থেকে করা রেজিস্ট্রেশন এখানে আসছে।</span><span class="en">✅ Firebase Firestore — registrations from every device land here.</span>';
      note.style.color = 'var(--sage)';
    }else{
      note.innerHTML = '<span class="bn">⚠️ Firebase কনফিগার করা নেই — রেজিস্ট্রেশন কোথাও সেভ হচ্ছে না। <code>src/shared/firebase-config.js</code> পূরণ করো।</span><span class="en">⚠️ Firebase is not configured — registrations are not being saved anywhere. Fill in <code>src/shared/firebase-config.js</code>.</span>';
      note.style.color = 'var(--clay-dark)';
    }
  }
  body.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:30px;">… লোড হচ্ছে</td></tr>';
  try{
    adminRegsCache = await window.db.listRegistrations();
    renderAdminRegsTable();
  }catch(err){
    console.error(err);
    body.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:30px;">তালিকা লোড করা যায়নি — ' + escapeHtml(err.message) + '</td></tr>';
  }
}

/** Render with the live search filter (name / phone / email). */
function renderAdminRegsTable(){
  const body = document.getElementById('adminRegsBody');
  const term = (document.getElementById('regsSearchInput').value || '').trim().toLowerCase();
  const records = adminRegsCache.filter(function(rec){
    if(!term) return true;
    return [rec.name, rec.phone, rec.email, rec.pid, rec.school]
      .some(function(v){ return v && String(v).toLowerCase().indexOf(term) !== -1; });
  });
  if(records.length === 0){
    body.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:30px;">' +
      (adminRegsCache.length === 0 ? 'এখনো কোনো রেজিস্ট্রেশন হয়নি।' : 'কিছু পাওয়া যায়নি।') + '</td></tr>';
    return;
  }
  body.innerHTML = '';
  records.forEach(function(rec){
    const tr = document.createElement('tr');
    const catKey = rec.category || getCategoryKey(rec.cls);
    const catLabel = catKey && CATEGORY_LABELS[catKey] ? CATEGORY_LABELS[catKey].bn : (rec.cls || '');
    const when = rec.createdAt && rec.createdAt.toDate
      ? rec.createdAt.toDate().toLocaleDateString('en-GB') : '';
    tr.innerHTML = '<td style="font-family:var(--f-mono);font-size:0.8rem;">' + escapeHtml(rec.pid) + '</td>' +
      '<td>' + escapeHtml(rec.name) + '</td><td>' + escapeHtml(rec.school) + '</td><td>' + escapeHtml(catLabel) + '</td>' +
      '<td>' + escapeHtml(rec.area) + '</td><td>' + escapeHtml(rec.phone) + '</td><td>' + escapeHtml(rec.email) + '</td>' +
      '<td>' + (rec.examTaken ? '✅ ' + escapeHtml(when) : '—') + '</td>' +
      '<td>' + (rec.examTaken ? rec.score + (rec.maxScore ? '/' + rec.maxScore : '') : '—') + '</td>';
    body.appendChild(tr);
  });
}
