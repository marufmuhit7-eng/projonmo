const ADMIN_PASSWORD = "UHF2026Admin";
/* ---------- Admin ---------- */
let adminLoggedIn = false;

function adminLogin(){
  const pass = document.getElementById('adminPassInput').value;
  const msg = document.getElementById('adminLoginMsg');
  if(pass === ADMIN_PASSWORD){
    adminLoggedIn = true;
    document.getElementById('adminLogin').classList.add('hidden');
    document.getElementById('adminPanel').classList.remove('hidden');
    document.getElementById('adminPassInput').value = '';
    msg.innerHTML = '';
    loadAdminQuestions();
  }else{
    msg.innerHTML = '<div class="msg err"><span class="bn">পাসওয়ার্ড ভুল।</span><span class="en">Incorrect password.</span></div>';
  }
}

function adminLogout(){
  adminLoggedIn = false;
  document.getElementById('adminPanel').classList.add('hidden');
  document.getElementById('adminLogin').classList.remove('hidden');
}

function switchAdminSub(sub){
  document.querySelectorAll('.admin-sub-btn').forEach(b=>b.classList.toggle('active', b.dataset.sub===sub));
  document.getElementById('adminQuestions').classList.toggle('hidden', sub!=='questions');
  document.getElementById('adminTimer').classList.toggle('hidden', sub!=='timer');
  document.getElementById('adminRegs').classList.toggle('hidden', sub!=='regs');
  if(sub==='regs') loadAdminRegistrations();
  if(sub==='timer') loadTimerSettings();
}

/* =========================================================================
   Exam timer control  ·  পরীক্ষার টাইমার নিয়ন্ত্রণ
   Reads and writes through window.examSettings, so it works against either
   backend (Supabase when configured, localStorage otherwise) unchanged.
   ========================================================================= */

/** Paint the "which backend is live" banner. Honest about the local case. */
function renderTimerBackendNote(){
  const note = document.getElementById('timerBackendNote');
  if(window.examSettings.isRemote){
    note.innerHTML =
      '<span class="bn">✅ শেয়ার্ড ডেটাবেস (Supabase) চালু আছে — এখানে পরিবর্তন করলে <strong>সব ভিজিটরের</strong> পাতায় সঙ্গে সঙ্গে প্রতিফলিত হবে।</span>' +
      '<span class="en">✅ Shared database (Supabase) is active — changes here reach <strong>every visitor</strong> immediately.</span>';
    note.style.color = 'var(--sage)';
  }else{
    note.innerHTML =
      '<span class="bn">⚠️ এখন <strong>localStorage</strong> ব্যবহার হচ্ছে। এই সেটিং শুধু <strong>এই ব্রাউজারে, এই ডোমেইনে</strong> সেভ হবে — পাবলিক সাইট আলাদা ডোমেইনে থাকায় সেখানে এর কোনো প্রভাব পড়বে না। সব ভিজিটরের জন্য কাজ করাতে <code>src/shared/config.js</code>-এ Supabase সেট করো।</span>' +
      '<span class="en">⚠️ Running on <strong>localStorage</strong>. This setting is saved for <strong>this browser on this domain only</strong>; the public site is a different origin, so it will not see it. Configure Supabase in <code>src/shared/config.js</code> to make it work for everyone.</span>';
    note.style.color = 'var(--clay-dark)';
  }
}

/** Show/hide the custom-message fields to match the selected off-behaviour. */
function syncTimerMessageVisibility(){
  const behavior = document.getElementById('timerOffBehaviorInput').value;
  const enabled = document.getElementById('timerEnabledInput').checked;
  // The message only ever appears while the timer is OFF.
  document.getElementById('timerMessageWrap').classList.toggle('hidden', enabled || behavior !== 'message');
}

/** Repaint the status badge + current-date line from a settings object. */
function renderTimerStatus(s){
  const badge = document.getElementById('timerStatusBadge');
  if(s.timerEnabled){
    badge.textContent = 'টাইমার চালু · Timer ON';
    badge.style.background = 'var(--sage)';
    badge.style.color = 'var(--cream)';
  }else{
    badge.textContent = 'টাইমার বন্ধ · Timer OFF';
    badge.style.background = 'var(--stone)';
    badge.style.color = 'var(--cream)';
  }
  document.getElementById('timerCurrentDateBn').textContent = window.examSettings.formatBnDateTime(s.examStartDate);
  document.getElementById('timerCurrentDateEn').textContent =
    new Date(s.examStartDate).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
}

async function loadTimerSettings(){
  if(!adminLoggedIn) return;
  const msg = document.getElementById('timerMsg');
  msg.innerHTML = '';
  renderTimerBackendNote();
  try{
    const s = await window.examSettings.load();
    document.getElementById('timerEnabledInput').checked = s.timerEnabled;
    document.getElementById('timerDateInput').value = window.examSettings.toDhakaInput(s.examStartDate);
    document.getElementById('timerOffBehaviorInput').value = s.offBehavior;
    document.getElementById('timerMessageBnInput').value = s.customMessage;
    document.getElementById('timerMessageEnInput').value = s.customMessageEn;
    renderTimerStatus(s);
    syncTimerMessageVisibility();
  }catch(err){
    console.error(err);
    msg.innerHTML = '<div class="msg err"><span class="bn">সেটিং লোড করা যায়নি: ' + err.message +
      '</span><span class="en">Could not load settings: ' + err.message + '</span></div>';
  }
}

async function saveTimerSettings(){
  const msg = document.getElementById('timerMsg');
  const btn = document.getElementById('timerSaveBtn');
  msg.innerHTML = '';

  // Validate the date BEFORE touching the backend: an empty or impossible
  // date must never overwrite a good one.
  const iso = window.examSettings.fromDhakaInput(document.getElementById('timerDateInput').value);
  if(!iso){
    msg.innerHTML = '<div class="msg err"><span class="bn">তারিখ ও সময় ঠিকভাবে দাও।</span>' +
      '<span class="en">Please enter a valid date and time.</span></div>';
    return;
  }

  const behavior = document.getElementById('timerOffBehaviorInput').value;
  const bnText = document.getElementById('timerMessageBnInput').value.trim();
  if(!document.getElementById('timerEnabledInput').checked && behavior === 'message' && !bnText){
    msg.innerHTML = '<div class="msg err"><span class="bn">বার্তা দেখাতে চাইলে অন্তত বাংলা বার্তাটি লেখো।</span>' +
      '<span class="en">Write at least the Bangla message to display it.</span></div>';
    return;
  }

  btn.disabled = true;
  try{
    const s = await window.examSettings.save({
      timerEnabled: document.getElementById('timerEnabledInput').checked,
      examStartDate: iso,
      offBehavior: behavior,
      customMessage: bnText,
      customMessageEn: document.getElementById('timerMessageEnInput').value.trim()
    });
    renderTimerStatus(s);
    const reach = window.examSettings.isRemote
      ? { bn: 'সব ভিজিটর সঙ্গে সঙ্গে দেখতে পাবে।', en: 'Every visitor sees it immediately.' }
      : { bn: 'তবে এটি শুধু এই ব্রাউজারে সেভ হয়েছে।', en: 'But it was saved in this browser only.' };
    msg.innerHTML = '<div class="msg ok"><span class="bn">সেটিং সংরক্ষণ হয়েছে! ' + reach.bn +
      '</span><span class="en">Settings saved! ' + reach.en + '</span></div>';
  }catch(err){
    console.error(err);
    msg.innerHTML = '<div class="msg err"><span class="bn">সংরক্ষণ ব্যর্থ: ' + err.message +
      '</span><span class="en">Save failed: ' + err.message + '</span></div>';
  }finally{
    btn.disabled = false;
  }
}

/* Keep the message fields in step with the two controls that govern them. */
document.getElementById('timerOffBehaviorInput').addEventListener('change', syncTimerMessageVisibility);
document.getElementById('timerEnabledInput').addEventListener('change', function(){
  syncTimerMessageVisibility();
  renderTimerStatus(Object.assign({}, window.examSettings.current(), { timerEnabled: this.checked }));
});

async function loadAdminQuestions(){
  if(!adminLoggedIn) return;
  const cat = document.getElementById('adminCatSelect').value;
  const msg = document.getElementById('adminQMsg');
  msg.innerHTML = '';
  let questions;
  try{
    const res = await window.storage.get('questions:'+cat, true);
    questions = JSON.parse(res.value);
  }catch(err){
    questions = QUESTIONS[cat]; // fall back to the built-in default set
  }
  document.getElementById('adminQJson').value = JSON.stringify(questions, null, 2);
}

async function saveAdminQuestions(){
  const cat = document.getElementById('adminCatSelect').value;
  const msg = document.getElementById('adminQMsg');
  msg.innerHTML = '';
  let parsed;
  try{
    parsed = JSON.parse(document.getElementById('adminQJson').value);
    if(!Array.isArray(parsed) || parsed.length===0) throw new Error('empty');
    parsed.forEach(q=>{
      if(!q.q_bn || !q.q_en || !Array.isArray(q.opts_bn) || q.opts_bn.length!==4 || !Array.isArray(q.opts_en) || q.opts_en.length!==4 || typeof q.correct!=='number'){
        throw new Error('bad shape');
      }
    });
  }catch(err){
    msg.innerHTML = '<div class="msg err"><span class="bn">JSON ফরম্যাট ঠিক নেই, আবার দেখো।</span><span class="en">Invalid JSON format — please check.</span></div>';
    return;
  }
  try{
    await window.storage.set('questions:'+cat, JSON.stringify(parsed), true);
    msg.innerHTML = '<div class="msg ok"><span class="bn">প্রশ্ন সংরক্ষণ হয়েছে!</span><span class="en">Questions saved!</span></div>';
  }catch(err){
    msg.innerHTML = '<div class="msg err"><span class="bn">সংরক্ষণ ব্যর্থ হয়েছে।</span><span class="en">Save failed.</span></div>';
  }
}

async function loadAdminRegistrations(){
  const body = document.getElementById('adminRegsBody');
  body.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:30px;">…</td></tr>';
  try{
    const listRes = await window.storage.list('participant:', true);
    const keys = (listRes && listRes.keys) ? listRes.keys : [];
    const records = [];
    for(const k of keys){
      try{
        const r = await window.storage.get(k, true);
        records.push(JSON.parse(r.value));
      }catch(e){ /* skip broken entries */ }
    }
    records.sort((a,b)=> new Date(b.registeredAt||0) - new Date(a.registeredAt||0));
    if(records.length===0){
      body.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:30px;">এখনো কোনো রেজিস্ট্রেশন হয়নি।</td></tr>';
      return;
    }
    body.innerHTML = '';
    records.forEach(rec=>{
      const tr = document.createElement('tr');
      const catKey = rec.category || getCategoryKey(rec.cls);
      const catLabel = catKey && CATEGORY_LABELS[catKey] ? CATEGORY_LABELS[catKey].bn : (rec.cls||'');
      tr.innerHTML = `<td style="font-family:var(--f-mono);font-size:0.8rem;">${rec.id}</td>
        <td>${rec.name}</td><td>${rec.school}</td><td>${catLabel}</td><td>${rec.area||''}</td>
        <td>${rec.phone||''}</td><td>${rec.email||''}</td>
        <td>${rec.examTaken?'✅':'—'}</td>
        <td>${rec.examTaken? rec.score+(rec.maxScore?'/'+rec.maxScore:'') : '—'}</td>`;
      body.appendChild(tr);
    });
  }catch(err){
    console.error(err);
    body.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:30px;">তালিকা লোড করা যায়নি।</td></tr>';
  }
}
