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
  document.getElementById('adminRegs').classList.toggle('hidden', sub!=='regs');
  if(sub==='regs') loadAdminRegistrations();
}

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
