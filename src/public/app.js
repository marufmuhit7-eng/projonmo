/* ---------- Nav & language ---------- */
function switchTab(name){
  document.querySelectorAll('section').forEach(s=>s.classList.remove('active'));
  document.getElementById(name).classList.add('active');
  document.querySelectorAll('nav.topnav .tab-btn').forEach(b=>b.classList.toggle('active', b.dataset.tab===name));
  window.scrollTo({top:0,behavior:'smooth'});
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

/* ---------- Candidate info (collected on the exam page now) ---------- */
let latestControl = null;   // last settings/examControl we heard about

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
      'অনলাইন প্রিলিমিনারি পরীক্ষা / বাছাই পর্ব ' +
      window.examSettings.formatBnDateTime(s.examDate) +
      ' তারিখে অনুষ্ঠিত হবে। এই সময়ের আগে পরীক্ষায় অংশ নেওয়া যাবে না। নিচে কতক্ষণ বাকি তা দেখা যাচ্ছে:';
    lockedEn.textContent =
      'The online preliminary / selection round takes place on ' + startAt.toLocaleString('en-GB', { dateStyle: 'long', timeStyle: 'short' }) +
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
  const name = document.getElementById('c_name').value.trim();
  const category = document.getElementById('c_category').value;
  const phone = document.getElementById('c_phone').value.trim();
  const whatsapp = document.getElementById('c_whatsapp').value.trim();
  const email = document.getElementById('c_email').value.trim();
  if(!name || !category || !phone){
    msgBox.innerHTML = '<div class="msg err"><span class="bn">নাম, ক্যাটাগরি ও মোবাইল নম্বর অবশ্যই দাও।</span><span class="en">Name, category and mobile number are required.</span></div>';
    return;
  }
  if(!/^[0-9+\-\s]{6,15}$/.test(phone)){
    msgBox.innerHTML = '<div class="msg err"><span class="bn">মোবাইল নম্বরটি ঠিকভাবে দাও (যেমন 01XXXXXXXXX)।</span><span class="en">Please enter a valid mobile number.</span></div>';
    return;
  }
  // Soft duplicate guard: one attempt per mobile number.
  try{
    const already = await window.db.findSubmissionByPhone(phone);
    if(already){
      msgBox.innerHTML = '<div class="msg err"><span class="bn">এই মোবাইল নম্বর দিয়ে ইতিমধ্যে পরীক্ষা জমা হয়েছে। প্রতি নম্বরে একবারই অংশ নেওয়া যাবে।</span><span class="en">An exam has already been submitted with this mobile number.</span></div>';
      return;
    }
  }catch(e){ console.warn('[exam] duplicate check unavailable, continuing', e); }

  const catLabel = examCategoryLabel(category);
  currentParticipant = { name, category, phone, whatsapp, email };
  currentCategory = category;
  currentQuestions = await loadQuestionsForCategory(category);
  if(!Array.isArray(currentQuestions) || currentQuestions.length === 0){
    msgBox.innerHTML = '<div class="msg err"><span class="bn">এই ক্যাটাগরির জন্য এখনো কোনো প্রশ্ন যোগ করা হয়নি। শীঘ্রই আবার চেষ্টা করো।</span><span class="en">No questions have been added for this category yet.</span></div>';
    return;
  }
  userAnswers = new Array(currentQuestions.length).fill(null);
  document.getElementById('examLogin').classList.add('hidden');
  document.getElementById('examBody').classList.remove('hidden');
  document.getElementById('examParticipantName').textContent = name + ' — ' + catLabel.bn;
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
  try{
    await window.db.saveExamSubmission({
      name: currentParticipant.name,
      category: currentParticipant.category,
      phone: currentParticipant.phone,
      whatsapp: currentParticipant.whatsapp,
      email: currentParticipant.email,
      score: score,
      totalQuestions: currentQuestions.length
    });
  }catch(err){
    console.error('Failed to save exam submission', err);
    document.getElementById('examBody').classList.add('hidden');
    document.getElementById('examResult').classList.remove('hidden');
    document.getElementById('resultScoreBox').textContent = `${score} / ${maxScore}`;
    const note = document.getElementById('examResult').querySelector('p.bn');
    if(note) note.textContent = '⚠️ ফলাফল সেভ করা যায়নি (' + (err.message || 'নেটওয়ার্ক সমস্যা') + ') — অনুগ্রহ করে আয়োজকদের জানাও।';
    return;
  }
  document.getElementById('examBody').classList.add('hidden');
  document.getElementById('examResult').classList.remove('hidden');
  document.getElementById('resultScoreBox').textContent = `${score} / ${maxScore}`;
}

/* ---------- Team (dynamic from Supabase, falls back to the shipped markup) ---------- */

/*
 * If the team_members table has rows, the hardcoded team section is rebuilt
 * from the database (same design, same classes). Zero rows, a missing table
 * or a fetch error keeps the shipped markup — the section never goes blank.
 */
async function loadTeamSection(){
  const section = document.getElementById('team');
  if(!section || !window.db || !window.db.active) return;
  let members = [];
  try{
    members = await window.db.listTeamMembers();
  }catch(err){
    console.error('[team] load failed — keeping the shipped markup', err);
    return;
  }
  if(!Array.isArray(members) || members.length === 0) return;

  const ORDER = ['title_sponsor', 'co_organizer', 'advisor', 'organizer', 'volunteer', 'sponsor'];
  const groups = {};
  members.forEach(function(m){
    const cat = m.category || 'core';
    (groups[cat] = groups[cat] || []).push(m);
  });

  function imgTag(m, size){
    if(!m.imageUrl) return '';
    return '<img src="' + escapeHtml(m.imageUrl) + '" alt="' + escapeHtml(m.name) +
      '" width="' + size + '" height="' + size + '" loading="lazy" decoding="async">';
  }
  function fbLink(m){
    if(!m.facebookUrl) return '';
    return '<a href="' + escapeHtml(m.facebookUrl) + '" target="_blank" rel="noopener noreferrer" ' +
      'style="display:inline-flex;align-items:center;gap:5px;margin-top:6px;font-size:0.8rem;color:var(--maroon);">' +
      '<img src="./images/facebook-logo.png" alt="" width="14" height="14" style="object-fit:contain;">' +
      '<span>ফেসবুক</span></a>';
  }

  let html = '';
  Object.keys(groups)
    .sort(function(a, b){ return ORDER.indexOf(a) - ORDER.indexOf(b); })
    .forEach(function(cat){
      const label = teamCategoryLabel(cat);
      const block = label.block;
      let inner = '';
      if(block === 'tier-title'){
        groups[cat].forEach(function(m){
          inner += '<div class="tier-title">' + imgTag(m, 150) +
            '<p class="credit-name">' + escapeHtml(m.name) + '</p>' +
            (m.role ? '<span class="credit-tag">' + escapeHtml(m.role) + '</span>' : '') + '</div>';
        });
      }else if(block === 'tier-co'){
        groups[cat].forEach(function(m){
          inner += '<div class="tier-co">' + imgTag(m, 104) +
            '<p class="credit-name">' + escapeHtml(m.name) + '</p>' +
            (m.role ? '<span class="credit-tag">' + escapeHtml(m.role) + '</span>' : '') + '</div>';
        });
      }else if(block === 'sponsor'){
        inner += '<div class="sponsor-grid">';
        groups[cat].forEach(function(m){
          inner += '<div class="sponsor">' + imgTag(m, 96) +
            '<span>' + escapeHtml(m.name) + '</span></div>';
        });
        inner += '</div>';
      }else{   // people: organizer / volunteer / custom categories
        inner += '<div class="people-grid">';
        groups[cat].forEach(function(m){
          inner += '<div class="person">' + imgTag(m, 120) +
            '<p class="credit-name">' + escapeHtml(m.name) + '</p>' +
            (m.role ? '<span class="credit-tag">' + escapeHtml(m.role) + '</span>' : '') +
            (m.districtInstitute ? '<p class="small-note" style="margin:6px 0 0;">' + escapeHtml(m.districtInstitute) + '</p>' : '') +
            fbLink(m) + '</div>';
        });
        inner += '</div>';
      }
      html += '<div class="credit-block"><div class="credit-head"><h3><span class="bn">' +
        escapeHtml(label.bn) + '</span><span class="en">' + escapeHtml(label.en) + '</span></h3></div>' +
        inner + '</div>';
    });

  const wrap = section.querySelector('.wrap');
  const eyebrow = wrap.querySelector('.eyebrow');
  const h2 = wrap.querySelector('h2');
  const head = (eyebrow ? eyebrow.outerHTML : '') + (h2 ? h2.outerHTML : '');
  wrap.innerHTML = head + html;
}
loadTeamSection();
