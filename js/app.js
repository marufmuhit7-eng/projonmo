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
document.getElementById('regForm').addEventListener('submit', async function(e){
  e.preventDefault();
  const msgBox = document.getElementById('regMsg');
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
  const id = genId();
  const data = {id,name,school,cls,area,phone,email,examTaken:false,score:0,timeTakenSec:0,submittedAt:null,registeredAt:new Date().toISOString()};
  try{
    const res = await window.storage.set('participant:'+id, JSON.stringify(data), true);
    if(!res){ throw new Error('save failed'); }
    msgBox.innerHTML = `
      <div class="msg ok">
        <span class="bn">রেজিস্ট্রেশন সফল হয়েছে! তোমার আইডি সংরক্ষণ করে রাখো।</span>
        <span class="en">Registration successful! Save your ID below.</span>
      </div>
      <div class="pid-box">${id}</div>`;
    document.getElementById('regForm').reset();
    document.getElementById('examIdInput').value = id;
  }catch(err){
    console.error(err);
    msgBox.innerHTML = '<div class="msg err"><span class="bn">সংরক্ষণ ব্যর্থ হয়েছে, আবার চেষ্টা করো।</span><span class="en">Save failed, please try again.</span></div>';
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
  return new Date((examSettings || window.examSettings.current()).examStartDate);
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

  // Organiser chose a message instead of a countdown.
  if(!s.timerEnabled && s.offBehavior === 'message'){
    countdownEl.classList.add('hidden');
    if(heading[0]) heading[0].textContent = '📢 ঘোষণা';
    if(heading[1]) heading[1].textContent = '📢 Notice';
    lockedBn.textContent = s.customMessage || 'পরীক্ষা আপাতত বন্ধ আছে।';
    lockedEn.textContent = s.customMessageEn || s.customMessage || 'The exam is closed for now.';
    return;
  }

  // Default locked view: the Bengali countdown.
  countdownEl.classList.remove('hidden');
  if(heading[0]) heading[0].textContent = '⏳ পরীক্ষা এখনো শুরু হয়নি';
  if(heading[1]) heading[1].textContent = "⏳ The exam hasn't started yet";

  const startAt = new Date(s.examStartDate);
  if(new Date() < startAt){
    lockedBn.textContent =
      window.examSettings.formatBnDateTime(s.examStartDate) +
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
 * Push updates: on Supabase this is a realtime subscription, so an organiser
 * flipping the switch reaches everyone already sitting on the page. On the
 * localStorage fallback it is a same-origin storage event plus slow polling.
 */
unsubscribeExamSettings = window.examSettings.subscribe(function(s){
  examSettings = s;
  renderExamGate(s);
});
window.addEventListener('pagehide', function(){
  if(unsubscribeExamSettings) unsubscribeExamSettings();
  stopCountdown();
});

async function loadQuestionsForCategory(catKey){
  try{
    const res = await window.storage.get('questions:'+catKey, true);
    const parsed = JSON.parse(res.value);
    if(Array.isArray(parsed) && parsed.length>0) return parsed;
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
    const res = await window.storage.get('participant:'+id, true);
    record = JSON.parse(res.value);
  }catch(err){
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
  document.getElementById('examParticipantName').textContent = record.name + ' (' + record.id + ') — ' + CATEGORY_LABELS[catKey].bn;
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
    await window.storage.set('participant:'+currentParticipant.id, JSON.stringify(currentParticipant), true);
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
    const listRes = await window.storage.list('participant:', true);
    const keys = (listRes && listRes.keys) ? listRes.keys : [];
    const records = [];
    for(const k of keys){
      try{
        const r = await window.storage.get(k, true);
        const rec = JSON.parse(r.value);
        if(rec.examTaken) records.push(rec);
      }catch(e){ /* skip broken entries */ }
    }
    allLeaderboardRecords = records;
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
