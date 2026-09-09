/* ---------- Nav & language ---------- */
function switchTab(name){
  document.querySelectorAll('section').forEach(s=>s.classList.remove('active'));
  document.getElementById(name).classList.add('active');
  document.querySelectorAll('nav.topnav .tab-btn').forEach(b=>b.classList.toggle('active', b.dataset.tab===name));
  window.scrollTo({top:0,behavior:'smooth'});
  if(name==='leaderboard') loadLeaderboard();
  if(name==='exam') checkExamAvailability();
}
document.querySelectorAll('nav.topnav .tab-btn').forEach(b=>b.addEventListener('click',()=>switchTab(b.dataset.tab)));

/* ---------- Helpers ---------- */
function genId(){
  return 'UHF-' + Math.random().toString(36).substring(2,8).toUpperCase();
}
function bnDigits(n){
  const map={'0':'০','1':'১','2':'২','3':'৩','4':'৪','5':'৫','6':'৬','7':'৭','8':'৮','9':'৯'};
  return String(n).split('').map(c=>map[c]!==undefined?map[c]:c).join('');
}

/* ---------- Registration ---------- */
let latestControl = null;   // last settings/examControl we heard about

/** Badge above the form: is the registration window open right now? */
function renderRegWindowNote(){
  const note = document.getElementById('regWindowNote');
  if(!note) return;
  const s = latestControl || window.examSettings.current();
  if(window.examSettings.registrationOpen(s)){
    note.innerHTML = '<div class="msg ok"><span class="bn">✅ রেজিস্ট্রেশন চলছে — ' +
      window.examSettings.formatBnDateTime(s.registrationStart + 'T00:00:00+06:00').split(',')[0] +
      ' থেকে ' + window.examSettings.formatBnDateTime(s.registrationEnd + 'T00:00:00+06:00').split(',')[0] +
      ' পর্যন্ত।</span><span class="en">✅ Registration is open.</span></div>';
  }else{
    note.innerHTML = '<div class="msg err"><span class="bn">⛔ রেজিস্ট্রেশন এখন বন্ধ। নির্ধারিত সময়: ' +
      window.examSettings.formatBnDateTime(s.registrationStart + 'T00:00:00+06:00').split(',')[0] +
      ' – ' + window.examSettings.formatBnDateTime(s.registrationEnd + 'T00:00:00+06:00').split(',')[0] +
      '。</span><span class="en">⛔ Registration is closed right now.</span></div>';
  }
}

/**
 * Map a failed registration write to a plain Bangla sentence plus the likely
 * fix. Supabase errors arrive as { message, code, hint } and are always
 * logged to the console too.
 */
function registrationErrorTexts(err){
  const msg = String((err && err.message) || '').toLowerCase();
  const hint = String((err && err.hint) || '').toLowerCase();
  const all = msg + ' ' + hint;
  if(!window.db || !window.db.active){
    return { bn: 'রেজিস্ট্রেশন ব্যর্থ হয়েছে। আবার চেষ্টা করুন। (Supabase কনফিগার করা নেই)',
             en: 'Registration failed. Please try again. (Supabase is not configured)' };
  }
  if(all.indexOf('could not find the table') !== -1 || all.indexOf('does not exist') !== -1 ||
     all.indexOf('pgrst205') !== -1){
    return { bn: 'রেজিস্ট্রেশন ব্যর্থ হয়েছে। আবার চেষ্টা করুন। (কারণ: ডেটাবেস টেবিল তৈরি হয়নি — Supabase SQL Editor-এ supabase/schema.sql চালাও)',
             en: 'Registration failed. Please try again. (Cause: tables missing — run supabase/schema.sql in the Supabase SQL Editor)' };
  }
  if(all.indexOf('row-level security') !== -1 || all.indexOf('permission') !== -1){
    return { bn: 'রেজিস্ট্রেশন ব্যর্থ হয়েছে। আবার চেষ্টা করুন। (কারণ: RLS পলিসি ঠিক নেই — supabase/schema.sql আবার চালাও)',
             en: 'Registration failed. Please try again. (Cause: RLS policies missing — re-run supabase/schema.sql)' };
  }
  return { bn: 'রেজিস্ট্রেশন ব্যর্থ হয়েছে। আবার চেষ্টা করুন।',
           en: 'Registration failed. Please try again.' };
}

document.getElementById('regForm').addEventListener('submit', async function(e){
  e.preventDefault();   // never reload the page mid-submit
  const msgBox = document.getElementById('regMsg');
  const btn = document.getElementById('regSubmitBtn');
  const btnOriginal = btn.innerHTML;
  msgBox.innerHTML = '';
  const name=document.getElementById('r_name').value.trim();
  const school=document.getElementById('r_school').value.trim();
  const cls=document.getElementById('r_class').value;
  const area=document.getElementById('r_area').value.trim();
  const phone=document.getElementById('r_phone').value.trim();
  const email=document.getElementById('r_email').value.trim();
  if(!name||!school||!cls||!area||!phone){
    msgBox.innerHTML = '<div class="msg err"><span class="bn">সব বাধ্যতামূলক ঘর পূরণ করো।</span><span class="en">Please fill all required fields.</span></div>';
    return;
  }
  // The registration window is controlled globally from Supabase too.
  if(!window.examSettings.registrationOpen(latestControl)){
    msgBox.innerHTML = '<div class="msg err"><span class="bn">রেজিস্ট্রেশনের নির্ধারিত সময় শেষ হয়ে গেছে।</span><span class="en">The registration window has closed.</span></div>';
    return;
  }
  const id = genId();   // internal reference only — never shown to the visitor
  btn.disabled = true;
  btn.innerHTML = '<span class="bn">জমা হচ্ছে…</span><span class="en">Submitting…</span>';
  try{
    const saved = await window.db.addRegistration({
      pid:id, name, school, cls, area, phone, email,
      category: getCategoryKey(cls)
    });
    /*
     * 🔒 HARD RULE — the only thing a visitor may ever see as their code is
     * a database-minted reg_code matching ^UHF\d{4,6}$ (UHF000001…).
     * A uuid, a random token or anything else is REFUSED here, whatever the
     * backend returned. No data.id, no result.id, no crypto.randomUUID().
     */
    const code = (saved && saved.pid) || '';
    if(!/^UHF\d{4,6}$/.test(code)){
      console.error('[registration] refusing to display a non-reg_code id:', code || '(nothing returned)');
      msgBox.innerHTML = '<div class="msg err">' +
        '<span class="bn">রেজিস্ট্রেশন সেভ হয়েছে ✅ কিন্তু ছোট কোডটি এখনই দেখানো যাচ্ছে না (ডেটাবেস আপডেট বাকি)। অনুগ্রহ করে <strong>০১৪১০৭৮৫১৫৫</strong> নম্বরে নিজের নাম ও মোবাইল নম্বর জানিয়ে কোডটি সংগ্রহ করো।</span>' +
        '<span class="en">Your registration was saved ✅ but the short code cannot be shown yet (database update pending). Please contact the organisers to receive your code.</span>' +
        '</div>';
      return;   // finally{} below restores the button
    }
    // Cache our own code locally (a convenience copy, never the source of truth).
    try{ window.localStorage.setItem('uhf:myreg:'+code, JSON.stringify({pid:code,name})); }catch(e){ /* ignore */ }
    msgBox.innerHTML = `
      <div class="msg ok">
        <span class="bn">রেজিস্ট্রেশন সফল হয়েছে!<br>আপনার কোড: <strong>${code}</strong><br>এই কোডটি সংরক্ষণ করুন।</span>
        <span class="en">Registration successful!<br>Your code: <strong>${code}</strong><br>Please save this code.</span>
      </div>
      <div class="pid-box">${code}</div>`;
    document.getElementById('regForm').reset();
    document.getElementById('examIdInput').value = code;
  }catch(err){
    console.error('[registration] failed:', (err && err.code) || '', err);
    const t = registrationErrorTexts(err);
    msgBox.innerHTML = '<div class="msg err"><span class="bn">' + t.bn + '</span><span class="en">' + t.en + '</span></div>';
  }finally{
    btn.disabled = false;
    btn.innerHTML = btnOriginal;
  }
});

/* ---------- Exam ---------- */

/*
 * The exam gate. It FAILS CLOSED: locked is the default and the only way out
 * is a backend explicitly answering isUnlocked === true.
 *
 *   isUnlocked === true   -> exam is open
 *   anything else         -> locked; countdown to examStartDate, or the
 *                            organiser's message when offBehavior is 'message'
 *
 * "Anything else" is doing real work: it covers a fresh browser, a phone that
 * has never seen the admin panel, a failed fetch, an offline visitor, a
 * missing database row and a malformed value. Previously every one of
 * those showed an OPEN exam, because the lock lived only in the admin's own
 * localStorage. That was the bug.
 *
 * Note the page starts locked in the DOM too (examLocked is visible, the login
 * box is hidden), so there is no window between first paint and the first
 * backend answer where questions could leak.
 */

let countdownInterval = null;
let examSettings = null;          // last settings we rendered
let unsubscribeExamSettings = null;

/** The moment the exam opens, as a Date. Falls back to the built-in default. */
function examStartAt(){
  return new Date((examSettings || window.examSettings.current()).examDate);
}

function stopCountdown(){
  if(countdownInterval){ clearInterval(countdownInterval); countdownInterval = null; }
}

async function checkExamAvailability(){
  try{
    examSettings = await window.examSettings.load();
  }catch(err){
    // A failed fetch must never open the exam. current() defaults to LOCKED.
    console.error('exam settings unavailable — staying locked', err);
    examSettings = window.examSettings.current();
  }
  renderExamGate(examSettings);
}

/** Pure render step: given settings, put the exam section in the right state. */
function renderExamGate(s){
  const lockedBox   = document.getElementById('examLocked');
  const loginBox    = document.getElementById('examLogin');
  const examBody    = document.getElementById('examBody');
  const countdownEl = document.getElementById('countdownBox');
  const lockedBn    = document.getElementById('examLockedTextBn');
  const lockedEn    = document.getElementById('examLockedTextEn');
  const heading     = lockedBox.querySelectorAll('h3');

  stopCountdown();

  // ---- UNLOCKED: the one and only open path -------------------------------
  if(s.isUnlocked === true){
    countdownEl.classList.add('hidden');
    lockedBox.classList.add('hidden');
    // Don't yank a candidate out of an exam they are already sitting.
    if(examBody.classList.contains('hidden')) loginBox.classList.remove('hidden');
    return;
  }

  // ---- LOCKED (everything else) -------------------------------------------
  // An in-progress attempt is torn down: if the organiser locks mid-exam, the
  // questions must disappear from every screen, not just new visitors'.
  loginBox.classList.add('hidden');
  examBody.classList.add('hidden');
  lockedBox.classList.remove('hidden');

  // Locked view: the Bengali countdown to examDate.
  countdownEl.classList.remove('hidden');
  if(heading[0]) heading[0].textContent = '⏳ পরীক্ষা এখনো শুরু হয়নি';
  if(heading[1]) heading[1].textContent = "⏳ The exam hasn't started yet";

  const startAt = new Date(s.examDate);
  if(new Date() < startAt){
    lockedBn.textContent =
      window.examSettings.formatBnDateTime(s.examDate) +
      ' তারিখ থেকে পরীক্ষা শুরু হবে। এই সময়ের আগে পরীক্ষায় অংশ নেওয়া যাবে না। নিচে কতক্ষণ বাকি তা দেখা যাচ্ছে:';
    lockedEn.textContent =
      'The exam opens on ' + startAt.toLocaleString('en-GB', { dateStyle: 'long', timeStyle: 'short' }) +
      '. You cannot take the exam before this time. Time remaining is shown below:';
    tickCountdown();
    countdownInterval = setInterval(tickCountdown, 1000);
  }else{
    // The date has passed but the organiser has not unlocked. The countdown is
    // spent, so show zeros and say plainly that it opens shortly — do NOT let
    // a passing timestamp unlock the exam by itself.
    countdownEl.classList.add('hidden');
    lockedBn.textContent = 'পরীক্ষা শীঘ্রই শুরু হবে। আয়োজকরা পরীক্ষা চালু করলেই এই পাতা নিজে থেকে আপডেট হয়ে যাবে — পাতা রিফ্রেশ করার দরকার নেই।';
    lockedEn.textContent = 'The exam will begin shortly. This page updates by itself the moment the organisers open it — no need to refresh.';
  }
}

function tickCountdown(){
  const diffMs = examStartAt() - new Date();
  if(diffMs <= 0){
    stopCountdown();
    checkExamAvailability();
    return;
  }
  const totalSec = Math.floor(diffMs/1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  document.getElementById('cdDays').textContent = String(days).padStart(2,'0');
  document.getElementById('cdHours').textContent = String(hours).padStart(2,'0');
  document.getElementById('cdMinutes').textContent = String(minutes).padStart(2,'0');
  document.getElementById('cdSeconds').textContent = String(seconds).padStart(2,'0');
}

/*
 * Push updates: Supabase Realtime, so an organiser flipping the switch
 * reaches everyone already sitting on the page — no refresh, no polling.
 */
unsubscribeExamSettings = window.examSettings.subscribe(function(s){
  examSettings = s;
  latestControl = s;
  renderRegWindowNote();
  renderExamGate(s);
});
window.addEventListener('pagehide', function(){
  if(unsubscribeExamSettings) unsubscribeExamSettings();
  stopCountdown();
});

async function loadQuestionsForCategory(catKey){
  // Supabase first: the participant's own category, then (if that category
  // has no rows yet — e.g. imported sheet categories) every question mixed,
  // ordered by category + order_no. The bundled set is the last fallback.
  try{
    const remote = await window.db.listQuestions(catKey);
    if(Array.isArray(remote) && remote.length>0) return remote;
    const all = await window.db.listAllQuestions();
    if(Array.isArray(all) && all.length>0) return all;
  }catch(err){ /* fall back below */ }
  return QUESTIONS[catKey];
}



let currentParticipant = null;
let currentCategory = null;
let currentQuestions = [];
let userAnswers = [];
let timerInterval = null;
let timeLeft = 600;
let examStartTime = null;

async function startExam(){
  const msgBox = document.getElementById('examLoginMsg');
  msgBox.innerHTML = '';
  // Re-check the live setting: the organiser may have opened or closed the exam
  // since this page was loaded.
  const gate = examSettings || window.examSettings.current();
  if(gate.isUnlocked !== true){
    checkExamAvailability();
    return;
  }
  const id = document.getElementById('examIdInput').value.trim().toUpperCase();
  if(!id){
    msgBox.innerHTML = '<div class="msg err"><span class="bn">আইডি লেখো।</span><span class="en">Please enter your ID.</span></div>';
    return;
  }
  let record;
  try{
    record = await window.db.findRegistration(id);
  }catch(err){
    record = null;
  }
  if(!record){
    msgBox.innerHTML = '<div class="msg err"><span class="bn">এই আইডি খুঁজে পাওয়া যায়নি।</span><span class="en">This ID was not found.</span></div>';
    return;
  }
  if(record.examTaken){
    msgBox.innerHTML = '<div class="msg err"><span class="bn">তুমি ইতিমধ্যে পরীক্ষা দিয়েছ।</span><span class="en">You have already taken this exam.</span></div>';
    return;
  }
  const catKey = getCategoryKey(record.cls);
  if(!catKey){
    msgBox.innerHTML = '<div class="msg err"><span class="bn">তোমার ক্যাটাগরি শনাক্ত করা যায়নি, রেজিস্ট্রেশন তথ্য যাচাই করো।</span><span class="en">Could not determine your category, please check your registration.</span></div>';
    return;
  }
  currentParticipant = record;
  currentCategory = catKey;
  currentQuestions = await loadQuestionsForCategory(catKey);
  userAnswers = new Array(currentQuestions.length).fill(null);
  document.getElementById('examLogin').classList.add('hidden');
  document.getElementById('examBody').classList.remove('hidden');
  document.getElementById('examParticipantName').textContent = record.name + ' (' + (record.pid || record.rowId) + ') — ' + CATEGORY_LABELS[catKey].bn;
  renderQuestions();
  timeLeft = 600;
  examStartTime = Date.now();
  timerInterval = setInterval(tickTimer, 1000);
}

function renderQuestions(){
  const c = document.getElementById('questionsContainer');
  c.innerHTML = '';
  currentQuestions.forEach((q,i)=>{
    const card = document.createElement('div');
    card.className='q-card';
    card.id = 'qcard-'+i;
    let optsHtml = '';
    q.opts_bn.forEach((o,j)=>{
      optsHtml += `<label class="opt" data-qi="${i}" data-oi="${j}">
        <input type="radio" name="q${i}" value="${j}" onchange="selectAnswer(${i},${j})">
        <span class="bn">${o}</span><span class="en">${q.opts_en[j]}</span>
      </label>`;
    });
    card.innerHTML = `<div class="qnum">${bnDigits(i+1)} / ${bnDigits(currentQuestions.length)} <span id="qfeedback-${i}"></span></div>
      <p class="qtext"><span class="bn">${q.q_bn}</span><span class="en">${q.q_en}</span></p>
      ${optsHtml}`;
    c.appendChild(card);
  });
}

function selectAnswer(qi, oi){
  if(userAnswers[qi]!==null) return; // already answered, locked
  userAnswers[qi] = oi;
  const q = currentQuestions[qi];
  const isCorrect = oi===q.correct;
  document.querySelectorAll(`.opt[data-qi="${qi}"]`).forEach(el=>{
    const optIndex = parseInt(el.dataset.oi);
    el.classList.add('locked');
    if(optIndex===oi){
      el.classList.add(isCorrect ? 'correct' : 'incorrect');
    }else if(optIndex===q.correct){
      el.classList.add('correct');
    }
  });
  const fb = document.getElementById('qfeedback-'+qi);
  if(fb){
    fb.innerHTML = isCorrect
      ? '<span class="feedback-tag ok bn">✓ সঠিক</span><span class="feedback-tag ok en">✓ Correct</span>'
      : '<span class="feedback-tag no bn">✗ ভুল</span><span class="feedback-tag no en">✗ Wrong</span>';
  }
}

function tickTimer(){
  timeLeft--;
  const m = Math.floor(timeLeft/60), s = timeLeft%60;
  document.getElementById('timerDisplay').textContent = `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  if(timeLeft<=0){
    clearInterval(timerInterval);
    submitExam();
  }
}

async function submitExam(){
  clearInterval(timerInterval);
  let score = 0;
  currentQuestions.forEach((q,i)=>{ if(userAnswers[i]===q.correct) score += 10; });
  const maxScore = currentQuestions.length*10;
  const timeTakenSec = Math.round((Date.now()-examStartTime)/1000);
  currentParticipant.examTaken = true;
  currentParticipant.category = currentCategory;
  currentParticipant.score = score;
  currentParticipant.maxScore = maxScore;
  currentParticipant.timeTakenSec = timeTakenSec;
  currentParticipant.submittedAt = new Date().toISOString();
  try{
    await window.db.saveExamResult(currentParticipant.pid || currentParticipant.rowId, {
      name: currentParticipant.name,
      school: currentParticipant.school || '',
      area: currentParticipant.area || '',
      examTaken: true, score, maxScore, timeTakenSec,
      category: currentCategory,
      submittedAt: currentParticipant.submittedAt
    });
  }catch(err){ console.error('Failed to save exam result', err); }

  document.getElementById('examBody').classList.add('hidden');
  document.getElementById('examResult').classList.remove('hidden');
  document.getElementById('resultScoreBox').textContent = `${score} / ${maxScore}`;
}

/* ---------- Leaderboard ---------- */
let allLeaderboardRecords = [];
let currentLbCategory = 'primary';

async function loadLeaderboard(){
  const body = document.getElementById('lbBody');
  body.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:30px;">…</td></tr>';
  try{
    const records = await window.db.listLeaderboard();
    allLeaderboardRecords = records.filter(r => r && r.examTaken);
    renderLeaderboardTable(currentLbCategory);
  }catch(err){
    console.error(err);
    body.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:30px;">
      <span class="bn">লিডারবোর্ড লোড করা যায়নি।</span><span class="en">Could not load the leaderboard.</span>
    </td></tr>`;
  }
}

function switchLbCategory(cat){
  currentLbCategory = cat;
  document.querySelectorAll('.lb-cat-btn').forEach(b=>b.classList.toggle('active', b.dataset.cat===cat));
  renderLeaderboardTable(cat);
}

function renderLeaderboardTable(cat){
  const body = document.getElementById('lbBody');
  const catKey = cat || 'primary';
  const records = allLeaderboardRecords
    .filter(rec => (rec.category || getCategoryKey(rec.cls)) === catKey)
    .sort((a,b)=> b.score - a.score || a.timeTakenSec - b.timeTakenSec);
  if(records.length===0){
    body.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:30px;">
      <span class="bn">এই ক্যাটাগরিতে এখনো কেউ পরীক্ষা দেয়নি।</span><span class="en">No one in this category has taken the exam yet.</span>
    </td></tr>`;
    return;
  }
  body.innerHTML = '';
  records.forEach((rec,i)=>{
    const rank = i+1;
    const badgeClass = rank===1?'r1':rank===2?'r2':rank===3?'r3':'';
    const mins = Math.floor(rec.timeTakenSec/60), secs = rec.timeTakenSec%60;
    const tr = document.createElement('tr');
    tr.innerHTML = `<td><span class="rank-badge ${badgeClass}">${rank}</span></td>
      <td>${rec.name}</td><td>${rec.school}</td><td>${rec.area||''}</td>
      <td><strong>${rec.score}</strong>${rec.maxScore?` / ${rec.maxScore}`:''}</td>
      <td>${String(mins).padStart(2,'0')}:${String(secs).padStart(2,'0')}</td>`;
    body.appendChild(tr);
  });
}
