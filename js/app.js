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
document.getElementById('langToggle').addEventListener('click',()=>{
  document.body.classList.toggle('lang-bn');
  document.body.classList.toggle('lang-en');
});

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
const QUESTIONS = {
  primary: [
    {q_bn:"রংপুর বিভাগ কয়টি জেলা নিয়ে গঠিত?", q_en:"How many districts make up Rangpur Division?",
     opts_bn:["৬টি","৭টি","৮টি","৯টি"], opts_en:["6","7","8","9"], correct:2},
    {q_bn:"রংপুর বিভাগ বাংলাদেশের কততম বিভাগ হিসেবে ঘোষিত হয়?", q_en:"Rangpur was declared as which division of Bangladesh (in order)?",
     opts_bn:["পঞ্চম","ষষ্ঠ","সপ্তম","অষ্টম"], opts_en:["5th","6th","7th","8th"], correct:2},
    {q_bn:"রংপুর বিভাগ কোন সালে ঘোষিত হয়?", q_en:"In which year was Rangpur Division declared?",
     opts_bn:["২০০৮","২০০৯","২০১০","২০১২"], opts_en:["2008","2009","2010","2012"], correct:2},
    {q_bn:"নিচের কোনটি রংপুর বিভাগের জেলা নয়?", q_en:"Which of the following is NOT a district of Rangpur Division?",
     opts_bn:["কুড়িগ্রাম","বগুড়া","গাইবান্ধা","পঞ্চগড়"], opts_en:["Kurigram","Bogura","Gaibandha","Panchagarh"], correct:1},
    {q_bn:"লালমনিরহাট জেলার সদর উপজেলার নাম কী?", q_en:"What is the name of Lalmonirhat district's sadar upazila?",
     opts_bn:["আদিতমারী","কালীগঞ্জ","লালমনিরহাট সদর","পাটগ্রাম"], opts_en:["Aditmari","Kaliganj","Lalmonirhat Sadar","Patgram"], correct:2},
    {q_bn:"পঞ্চগড় জেলা থেকে হিমালয়ের কোন চূড়া দেখা যায়?", q_en:"Which Himalayan peak can be seen from Panchagarh district?",
     opts_bn:["এভারেস্ট","কাঞ্চনজঙ্ঘা","অন্নপূর্ণা","মাকালু"], opts_en:["Everest","Kanchenjunga","Annapurna","Makalu"], correct:1},
    {q_bn:"দিনাজপুর জেলা কোন বিভাগে অবস্থিত?", q_en:"Dinajpur district is located in which division?",
     opts_bn:["রাজশাহী","রংপুর","খুলনা","ময়মনসিংহ"], opts_en:["Rajshahi","Rangpur","Khulna","Mymensingh"], correct:1},
    {q_bn:"আয়তনে রংপুর বিভাগের সবচেয়ে ছোট জেলা কোনটি?", q_en:"Which is the smallest district (by area) in Rangpur Division?",
     opts_bn:["পঞ্চগড়","লালমনিরহাট","নীলফামারী","ঠাকুরগাঁও"], opts_en:["Panchagarh","Lalmonirhat","Nilphamari","Thakurgaon"], correct:1},
    {q_bn:"আয়তনে রংপুর বিভাগের সবচেয়ে বড় জেলা কোনটি?", q_en:"Which is the largest district (by area) in Rangpur Division?",
     opts_bn:["রংপুর","কুড়িগ্রাম","দিনাজপুর","গাইবান্ধা"], opts_en:["Rangpur","Kurigram","Dinajpur","Gaibandha"], correct:2},
    {q_bn:"নীলফামারী শহরের পাশ দিয়ে কোন নদী প্রবাহিত?", q_en:"Which river flows beside Nilphamari town?",
     opts_bn:["তিস্তা","ব্রহ্মপুত্র","বামনডাঙ্গা","করতোয়া"], opts_en:["Teesta","Brahmaputra","Bamondanga","Karatoya"], correct:2},
    {q_bn:"রংপুরকে কোন নামে ডাকা হয়?", q_en:"By what name is Rangpur known?",
     opts_bn:["সবুজ দেশ","বাহের দেশ","নদীর দেশ","চায়ের দেশ"], opts_en:["Land of Green","Baher Desh","Land of Rivers","Land of Tea"], correct:1},
    {q_bn:"রংপুর জেলা কোন সালে প্রতিষ্ঠিত হয়?", q_en:"In which year was Rangpur district established?",
     opts_bn:["১৭৬৫","১৭৬৯","১৮৬৯","১৮৯০"], opts_en:["1765","1769","1869","1890"], correct:0},
    {q_bn:"ঠাকুরগাঁও জেলার আঞ্চলিক ভাষাকে কী বলা হয়?", q_en:"What is Thakurgaon district's regional dialect called?",
     opts_bn:["রংপুরিয়া ভাষা","ঠাকুরগাঁইয়া ভাষা","কোচ ভাষা","বোড়ো ভাষা"], opts_en:["Rangpuria","Thakurgaiya","Koch","Bodo"], correct:1},
    {q_bn:"কুড়িগ্রাম জেলা বাংলাদেশের কোন দিকে অবস্থিত?", q_en:"In which direction of Bangladesh is Kurigram district located?",
     opts_bn:["দক্ষিণ-পূর্ব","উত্তর-পশ্চিম","দক্ষিণ-পশ্চিম","উত্তর-পূর্ব"], opts_en:["South-east","North-west","South-west","North-east"], correct:1},
    {q_bn:"গাইবান্ধা জেলা কত সালে জেলা হিসেবে প্রতিষ্ঠিত হয়?", q_en:"In which year was Gaibandha established as a district?",
     opts_bn:["১৯৭৩","১৯৮০","১৯৮৪","১৯৯০"], opts_en:["1973","1980","1984","1990"], correct:2},
    {q_bn:"পঞ্চগড় জেলায় কয়টি ঐতিহাসিক 'গড়' রয়েছে বলে জানা যায়?", q_en:"How many historical 'garh' (forts) is Panchagarh district known to have?",
     opts_bn:["৩টি","৪টি","৫টি","৬টি"], opts_en:["3","4","5","6"], correct:2},
    {q_bn:"রংপুরের বিখ্যাত ঐতিহ্যবাহী হাতে বোনা কাপড়ের নাম কী?", q_en:"What is Rangpur's famous traditional handwoven cloth called?",
     opts_bn:["জামদানি","শতরঞ্জি","মসলিন","খাদি"], opts_en:["Jamdani","Shatranji","Muslin","Khadi"], correct:1},
    {q_bn:"রংপুরের কোন আম বিখ্যাত?", q_en:"Which mango variety is Rangpur famous for?",
     opts_bn:["ল্যাংড়া","হাড়িভাঙ্গা","ফজলি","আম্রপালি"], opts_en:["Langra","Haribhanga","Fazli","Amrapali"], correct:1},
    {q_bn:"বাংলাদেশের সর্বোত্তরের জেলা কোনটি?", q_en:"Which is Bangladesh's northernmost district?",
     opts_bn:["ঠাকুরগাঁও","পঞ্চগড়","নীলফামারী","লালমনিরহাট"], opts_en:["Thakurgaon","Panchagarh","Nilphamari","Lalmonirhat"], correct:1},
    {q_bn:"লালমনিরহাট জেলায় কয়টি উপজেলা আছে?", q_en:"How many upazilas does Lalmonirhat district have?",
     opts_bn:["৪টি","৫টি","৬টি","৭টি"], opts_en:["4","5","6","7"], correct:1},
    {q_bn:"কুড়িগ্রাম জেলায় কয়টি উপজেলা আছে?", q_en:"How many upazilas does Kurigram district have?",
     opts_bn:["৭টি","৮টি","৯টি","১০টি"], opts_en:["7","8","9","10"], correct:2},
    {q_bn:"দিনাজপুর শহরের নিকটবর্তী আন্তর্জাতিক বিমানবন্দরের নাম কী?", q_en:"What is the name of the airport near Dinajpur town?",
     opts_bn:["শাহ আমানত","হযরত শাহজালাল","ওসমানী","সৈয়দপুর"], opts_en:["Shah Amanat","Hazrat Shahjalal","Osmani","Saidpur"], correct:3},
    {q_bn:"বাংলাবান্ধা স্থলবন্দর কোন জেলায় অবস্থিত?", q_en:"In which district is Banglabandha Land Port located?",
     opts_bn:["ঠাকুরগাঁও","নীলফামারী","পঞ্চগড়","দিনাজপুর"], opts_en:["Thakurgaon","Nilphamari","Panchagarh","Dinajpur"], correct:2},
    {q_bn:"রংপুর বিভাগের একমাত্র পূর্ণাঙ্গ সরকারি বিশ্ববিদ্যালয়ের নাম কী?", q_en:"What is the name of Rangpur Division's only full-fledged public university?",
     opts_bn:["কারমাইকেল বিশ্ববিদ্যালয়","বেগম রোকেয়া বিশ্ববিদ্যালয়","হাজী মোহাম্মদ দানেশ বিশ্ববিদ্যালয়","রংপুর মেডিকেল বিশ্ববিদ্যালয়"], opts_en:["Carmichael University","Begum Rokeya University","Hajee Mohammad Danesh University","Rangpur Medical University"], correct:1},
    {q_bn:"নীলফামারী শহরের নিকটবর্তী বিমানবন্দরের নাম কী?", q_en:"What is the name of the airport near Nilphamari town?",
     opts_bn:["সৈয়দপুর বিমানবন্দর","শাহজালাল বিমানবন্দর","বরিশাল বিমানবন্দর","কক্সবাজার বিমানবন্দর"], opts_en:["Saidpur Airport","Shahjalal Airport","Barisal Airport","Cox's Bazar Airport"], correct:0},
    {q_bn:"উত্তরবঙ্গের অক্সফোর্ড নামে পরিচিত কলেজটির নাম কী?", q_en:"Which college is known as the 'Oxford of North Bengal'?",
     opts_bn:["রংপুর সরকারি কলেজ","কারমাইকেল কলেজ","দিনাজপুর সরকারি কলেজ","নীলফামারী কলেজ"], opts_en:["Rangpur Government College","Carmichael College","Dinajpur Government College","Nilphamari College"], correct:1},
    {q_bn:"বাংলাদেশে গম উৎপাদনে শীর্ষ জেলা কোনটি?", q_en:"Which district leads Bangladesh in wheat production?",
     opts_bn:["পঞ্চগড়","দিনাজপুর","ঠাকুরগাঁও","রংপুর"], opts_en:["Panchagarh","Dinajpur","Thakurgaon","Rangpur"], correct:2},
    {q_bn:"সমতল ভূমিতে বাণিজ্যিকভাবে চা চাষ হয় কোন জেলায়?", q_en:"In which district is tea commercially cultivated on flat land?",
     opts_bn:["পঞ্চগড়","নীলফামারী","ঠাকুরগাঁও","লালমনিরহাট"], opts_en:["Panchagarh","Nilphamari","Thakurgaon","Lalmonirhat"], correct:0},
    {q_bn:"'উত্তরবঙ্গের আদ্যোপান্ত' বইটি কোন প্রতিষ্ঠান সংকলন ও সম্পাদনা করেছে?", q_en:"Which organization compiled and edited the book 'Uttarbanga-r Adyopanto'?",
     opts_bn:["বাংলা একাডেমি","প্রজন্ম ফাউন্ডেশন","শিক্ষা মন্ত্রণালয়","জেলা প্রশাসন"], opts_en:["Bangla Academy","Projonmo Foundation","Ministry of Education","District Administration"], correct:1},
    {q_bn:"রংপুর জিলা স্কুল কত সালে স্থাপিত হয়?", q_en:"In which year was Rangpur Zilla School established?",
     opts_bn:["১৮৩২","১৮৬৯","১৮৯০","১৯০৬"], opts_en:["1832","1869","1890","1906"], correct:0}
  ],
  junior: [
    {q_bn:"রংপুরকে বিভাগ করার সিদ্ধান্ত মন্ত্রীসভার বৈঠকে কোন সালে গৃহীত হয়?", q_en:"In which year did the Cabinet decide to make Rangpur a division?",
     opts_bn:["২০০৮","২০০৯","২০১০","২০১১"], opts_en:["2008","2009","2010","2011"], correct:1},
    {q_bn:"রংপুর বিভাগ কে উদ্বোধন করেন এবং কীভাবে?", q_en:"Who inaugurated Rangpur Division, and how?",
     opts_bn:["শেখ হাসিনা, সশরীরে","শেখ হাসিনা, ভিডিও কনফারেন্সে","স্পিকার, সংসদে","রাষ্ট্রপতি, সশরীরে"], opts_en:["Sheikh Hasina, in person","Sheikh Hasina, via video conference","The Speaker, in Parliament","The President, in person"], correct:1},
    {q_bn:"সম্রাট আকবরের কোন সেনাপতি ১৫৭৫ সালে রংপুর অঞ্চল দখল করেন?", q_en:"Which of Emperor Akbar's generals captured the Rangpur region in 1575?",
     opts_bn:["মানসিং","ইসলাম খাঁ","শায়েস্তা খাঁ","মীরজুমলা"], opts_en:["Man Singh","Islam Khan","Shaista Khan","Mir Jumla"], correct:0},
    {q_bn:"\"কুড়ি\" হিসেবে গণনার পদ্ধতি বাংলায় এসেছে কোন ভাষা থেকে বলে মনে করা হয়?", q_en:"The base-20 ('kuri') counting system in Bengali is believed to have come from which language?",
     opts_bn:["সংস্কৃত","কোল ভাষা","ফারসি","আরবি"], opts_en:["Sanskrit","Kol language","Persian","Arabic"], correct:1},
    {q_bn:"কুড়িগ্রাম মহকুমা কত সালে গোড়াপত্তন হয়?", q_en:"In which year was Kurigram sub-division founded?",
     opts_bn:["১৮৫৮","১৮৭৫","১৮৮৪","১৮৯০"], opts_en:["1858","1875","1884","1890"], correct:1},
    {q_bn:"কুড়িগ্রামের রাজারহাট এলাকার চত্রা গ্রামে কোন রাজবংশের রাজধানী ছিল?", q_en:"Which royal dynasty had its capital in Chatra village, Rajarhat, Kurigram?",
     opts_bn:["পাল বংশ","সেন বংশ","মোগল বংশ","গুপ্ত বংশ"], opts_en:["The Pala dynasty","The Sena dynasty","The Mughal dynasty","The Gupta dynasty"], correct:1},
    {q_bn:"১৯৭১ সালের কত তারিখে পাকবাহিনী কোদালকাটির বিভিন্ন গ্রাম দখলে নেয়?", q_en:"On what date in 1971 did Pakistani forces occupy the villages of Kodalkati?",
     opts_bn:["৪ আগস্ট","৬ আগস্ট","৮ আগস্ট","১৩ আগস্ট"], opts_en:["August 4","August 6","August 8","August 13"], correct:0},
    {q_bn:"মুক্তিযুদ্ধকালে রৌমারী উপজেলাকে কী বলা হতো?", q_en:"What was Roumari upazila called during the Liberation War?",
     opts_bn:["মুক্তাঞ্চল","রণাঙ্গন","সীমান্তভূমি","শরণার্থী শিবির"], opts_en:["A liberated zone (Muktanchal)","A battlefield","Border land","A refugee camp"], correct:0},
    {q_bn:"বড়াইবাড়ি সীমান্ত সংঘর্ষ কত তারিখে সংঘটিত হয়?", q_en:"On what date did the Boraibari border clash take place?",
     opts_bn:["১৮ এপ্রিল","২০ এপ্রিল","২১ এপ্রিল","২৫ এপ্রিল"], opts_en:["April 18","April 20","April 21","April 25"], correct:0},
    {q_bn:"বড়াইবাড়ি সংঘর্ষে কতজন বাংলাদেশি সীমান্তরক্ষী নিহত হন?", q_en:"How many Bangladeshi border guards were killed in the Boraibari clash?",
     opts_bn:["১","২","৩","৪"], opts_en:["1","2","3","4"], correct:1},
    {q_bn:"লালমনিরহাট নামকরণের সাথে সম্পর্কিত মহিলা কৃষক নেত্রীর নাম কী?", q_en:"Which woman peasant leader is associated with the naming of Lalmonirhat?",
     opts_bn:["প্রীতিলতা","লালমনি","সুফিয়া কামাল","বেগম রোকেয়া"], opts_en:["Pritilata","Lalmoni","Sufia Kamal","Begum Rokeya"], correct:1},
    {q_bn:"লালমনিরহাটের কোন মসজিদটি বাংলাদেশ প্রত্নতত্ত্ব অধিদপ্তরের তালিকাভুক্ত?", q_en:"Which mosque in Lalmonirhat is listed by the Department of Archaeology, Bangladesh?",
     opts_bn:["নিদারিয়া মসজিদ","বায়তুল মোকাররম","তারা মসজিদ","শাহী মসজিদ"], opts_en:["Nidaria Mosque","Baitul Mukarram","Tara Mosque","Shahi Mosque"], correct:0},
    {q_bn:"দিনাজপুর নামকরণ কোন সম্রাটের নামের সাথে যুক্ত?", q_en:"The name Dinajpur is linked to which ruler's name?",
     opts_bn:["আকবর","যদুনারায়ণ খাঁ","হুমায়ুন","শাহজাহান"], opts_en:["Akbar","Jadunarayan Khan","Humayun","Shah Jahan"], correct:1},
    {q_bn:"দিনাজপুর পৌরসভা কত সালে গঠিত হয়?", q_en:"In which year was Dinajpur Municipality formed?",
     opts_bn:["১৮৬৯","১৮৭৫","১৮৯০","১৯০৬"], opts_en:["1869","1875","1890","1906"], correct:0},
    {q_bn:"\"নীলফামারী\" নামের উৎপত্তি কোন শব্দ থেকে?", q_en:"The name 'Nilphamari' originates from which word?",
     opts_bn:["নীলকুঠি","নীলখামারী","নীলাচল","নীলগঞ্জ"], opts_en:["Nilkuthi (indigo factory)","Nilkhamari","Nilachal","Nilganj"], correct:1},
    {q_bn:"ব্রিটিশ আমলে নীলফামারী কাদের রাজধানী ছিল?", q_en:"During British rule, Nilphamari was a headquarters for whom?",
     opts_bn:["জমিদারদের","নীলকরদের","সেনাবাহিনীর","মিশনারিদের"], opts_en:["Zamindars","Indigo planters","The army","Missionaries"], correct:1},
    {q_bn:"সাম্প্রতিক একটি মানচিত্র অনুযায়ী ঠাকুরগাঁওয়ের আদি নাম প্রমাণিত হয়েছে কী?", q_en:"According to a recent map, what has been shown to be Thakurgaon's original name?",
     opts_bn:["শালবাহান","নিশ্চিন্তপুর","ভিতরগড়","পুণ্ড্রনগরী"], opts_en:["Shalbahan","Nishchintapur","Bhitargarh","Pundranagari"], correct:1},
    {q_bn:"ঠাকুরগাঁও মহকুমা থেকে জেলায় উন্নীত হয় কত সালে?", q_en:"In which year was Thakurgaon upgraded from sub-division to district?",
     opts_bn:["১৯৭৩","১৯৮০","১৯৮৪","১৯৯০"], opts_en:["1973","1980","1984","1990"], correct:2},
    {q_bn:"ঠাকুরগাঁওকে \"বাংলাদেশের রুটির ভুড়ি\" বলা হয় কেন?", q_en:"Why is Thakurgaon called the 'bread basket of Bangladesh'?",
     opts_bn:["সবজি উৎপাদনের জন্য","গম উৎপাদনে শীর্ষস্থানের জন্য","ধান উৎপাদনের জন্য","আলু উৎপাদনের জন্য"], opts_en:["For vegetable production","For leading wheat production","For rice production","For potato production"], correct:1},
    {q_bn:"পঞ্চগড় জেলার পাঁচটি \"গড়\"-এর মধ্যে একটির নাম কী?", q_en:"What is the name of one of Panchagarh district's five 'garh' (forts)?",
     opts_bn:["ভিতরগড়","মহাস্থানগড়","লালবাগ কেল্লা","সোনারগাঁও"], opts_en:["Bhitargarh","Mahasthangarh","Lalbagh Fort","Sonargaon"], correct:0},
    {q_bn:"পঞ্চগড় মহকুমা থেকে জেলায় উন্নীত হয় কত সালে?", q_en:"In which year was Panchagarh upgraded from sub-division to district?",
     opts_bn:["১৯৮০","১৯৮৪","১৯৯০","২০০০"], opts_en:["1980","1984","1990","2000"], correct:1},
    {q_bn:"রংপুরের শ্যামাসুন্দরী খাল কার নামে নামকরণ করা হয়েছে?", q_en:"After whom is Rangpur's Shyamasundari Canal named?",
     opts_bn:["রাজা জানকীবল্লভ সেনের মায়ের নামে","স্ত্রীর নামে","কন্যার নামে","দাদির নামে"], opts_en:["After Raja Janakiballav Sen's mother","After his wife","After his daughter","After his grandmother"], correct:0},
    {q_bn:"রংপুরের জলবায়ু কীরূপ?", q_en:"What type of climate does Rangpur have?",
     opts_bn:["শুষ্ক মরু জলবায়ু","আর্দ্র উপক্রান্তীয় জলবায়ু","শীতল পার্বত্য জলবায়ু","সামুদ্রিক জলবায়ু"], opts_en:["Dry desert climate","Humid subtropical climate","Cool mountain climate","Maritime climate"], correct:1},
    {q_bn:"গাইবান্ধা জেলা প্রথমে কোন নামে মহকুমা হিসেবে গঠিত হয়?", q_en:"Under what name was Gaibandha district first formed as a sub-division?",
     opts_bn:["সুন্দরগঞ্জ","ভবানীগঞ্জ","পলাশবাড়ী","গোবিন্দগঞ্জ"], opts_en:["Sundarganj","Bhabaniganj","Palashbari","Gobindaganj"], correct:1},
    {q_bn:"গাইবান্ধা নামকরণের কিংবদন্তিতে কোন রাজার উল্লেখ আছে?", q_en:"Which king is mentioned in the legend behind Gaibandha's name?",
     opts_bn:["বিরাট রাজা","শালিবাহন","নীলধ্বজ সেন","পৃথু রাজা"], opts_en:["Raja Birat","Shalibahan","Nildhwaj Sen","Raja Prithu"], correct:0},
    {q_bn:"কুড়িগ্রাম জেলায় মসজিদের সংখ্যা কত?", q_en:"How many mosques are there in Kurigram district?",
     opts_bn:["২৪৯৩টি","৩৪৯৩টি","৪৪৯৩টি","৫৪৯৩টি"], opts_en:["2,493","3,493","4,493","5,493"], correct:1},
    {q_bn:"মুক্তিযুদ্ধের সময় জিয়াউর রহমান তিন মাসের বেশি সময় কোথায় অবস্থান করেছিলেন?", q_en:"During the Liberation War, where did Ziaur Rahman stay for more than three months?",
     opts_bn:["রৌমারী ডাক বাংলোতে","ঠাকুরগাঁও সদরে","পঞ্চগড় সেক্টরে","দিনাজপুর সীমান্তে"], opts_en:["At the Roumari dak bungalow","In Thakurgaon Sadar","In the Panchagarh sector","On the Dinajpur border"], correct:0},
    {q_bn:"কোম্পানি শাসনের শুরুতে রংপুরের কোথায় ফকির-সন্ন্যাসী বিদ্রোহ সংঘটিত হয়?", q_en:"Where in Rangpur did the Fakir-Sannyasi rebellion take place at the start of Company rule?",
     opts_bn:["মিঠাপুকুর, পীরগাছা, পীরগঞ্জ","কুড়িগ্রাম সদর","লালমনিরহাট সদর","গাইবান্ধা সদর"], opts_en:["Mithapukur, Pirgachha, Pirganj","Kurigram Sadar","Lalmonirhat Sadar","Gaibandha Sadar"], correct:0},
    {q_bn:"পঞ্চগড়ে চা নিলামের জন্য দেশের তৃতীয় নিলামকেন্দ্র কোন সালে প্রতিষ্ঠিত হয়?", q_en:"In which year was the country's third tea auction centre established in Panchagarh?",
     opts_bn:["২০১৯","২০২০","২০২২","২০২৪"], opts_en:["2019","2020","2022","2024"], correct:2},
    {q_bn:"২০১১ সালের আদমশুমারি অনুযায়ী দিনাজপুর শহরের স্বাক্ষরতার হার কত?", q_en:"According to the 2011 census, what was the literacy rate of Dinajpur town?",
     opts_bn:["৬৪.১%","৭০.২%","৭৬.৯৬%","৮০.৫%"], opts_en:["64.1%","70.2%","76.96%","80.5%"], correct:2}
  ],
  senior: [
    {q_bn:"আরব অস্ট্রিক ভাষায় \"কুর\" বা \"কোর\" ধাতুর অর্থ কী, যা থেকে \"কুড়ি\" গণনার প্রথা এসেছে বলে মনে করা হয়?", q_en:"In Austroasiatic languages, what does the root 'kur'/'kor' mean, believed to be the origin of the 'kuri' counting system?",
     opts_bn:["সংখ্যা","মানুষ","জমি","পশু"], opts_en:["Number","Human/person","Land","Animal"], correct:1},
    {q_bn:"কুড়িগ্রাম অঞ্চলে সেন রাজবংশের শাসনকাল আরম্ভ হয় আনুমানিক কোন শতাব্দীতে?", q_en:"The Sena dynasty's rule in the Kurigram region is estimated to have begun in which centuries?",
     opts_bn:["দশম-একাদশ","একাদশ-দ্বাদশ","দ্বাদশ-ত্রয়োদশ","ত্রয়োদশ-চতুর্দশ"], opts_en:["10th-11th century","11th-12th century","12th-13th century","13th-14th century"], correct:2},
    {q_bn:"১৯৭১ সালে শংকর মাধবপুরের ধনাঢ্য ব্যক্তি বাদশা দেওয়ানী কীভাবে পাকিস্তানি বাহিনীর সাথে সম্পর্কিত ছিলেন, এবং শেষ পরিণতি কী হয়?", q_en:"How was the wealthy Badsha Dewani of Shankar Madhabpur connected to Pakistani forces in 1971, and what was his ultimate fate?",
     opts_bn:["প্রতিরোধ যোদ্ধা ছিলেন, শহীদ হন","সহযোগী ছিলেন, শেষে নিজেও নিহত হন","নিরপেক্ষ ছিলেন, পালিয়ে যান","মুক্তিযোদ্ধাদের অস্ত্র সরবরাহ করতেন"], opts_en:["A resistance fighter, martyred","A collaborator, later killed himself","Neutral, fled the area","Supplied arms to freedom fighters"], correct:1},
    {q_bn:"বড়াইবাড়ি সংঘর্ষ ভারতীয় পক্ষ কোন পূর্ববর্তী ঘটনার প্রতিশোধ হিসেবে দাবি করে?", q_en:"The Indian side claimed the Boraibari clash was retaliation for which earlier incident?",
     opts_bn:["কুড়িগ্রাম আক্রমণ","পদুয়া/পিরদিওয়াহ ঘটনা","রৌমারী আক্রমণ","চিলমারী অবরোধ"], opts_en:["The Kurigram attack","The Pyrdiwah/Padua incident","The Roumari attack","The Chilmari blockade"], correct:1},
    {q_bn:"চর্যাপদের সাথে ঠাকুরগাঁওয়ের যোগসূত্র হিসেবে কোন পদকর্তার নাম বহুল সমর্থিত?", q_en:"Which Charyapada poet's name is most widely associated with Thakurgaon?",
     opts_bn:["লুইপা","কাহ্নপা","গোরক্ষনাথ","সরহপা"], opts_en:["Luipa","Kahnapa","Gorakshanath","Sarahapa"], correct:2},
    {q_bn:"বাংলাদেশের আদি-অস্ট্রেলীয় জনগোষ্ঠীর নামকরণ ('কোলিড') কোন নৃতত্ত্ববিদ করেন?", q_en:"Which anthropologist coined the term 'Proto-Australoid' ('Kolid') for Bangladesh's early population?",
     opts_bn:["ফন আইকস্টেড","জি.এ. গ্রীয়ার্সন","পিয়েরে বেসাইনেত","রমাপ্রসাদ চন্দ"], opts_en:["Von Eickstedt","G.A. Grierson","Pierre Bessaignet","Ramaprasad Chanda"], correct:0},
    {q_bn:"স্যার জি.এ. গ্রীয়ার্সন ১৯০৬ সালে মালদা জেলার সাঁওতালদের সম্পর্কে কী মন্তব্য করেন?", q_en:"In 1906, what did Sir G.A. Grierson remark about the Santals of Malda district?",
     opts_bn:["তারা আদি বাসিন্দা","তারা এসেছে বড়জোর ২০ বছর পূর্বে","তারা ৫০০ বছর আগে বসতি স্থাপন করে","তারা আর্যদের সাথে একযোগে আসে"], opts_en:["They were the original inhabitants","They had arrived at most 20 years earlier","They settled 500 years earlier","They arrived together with the Aryans"], correct:1},
    {q_bn:"ঠাকুরগাঁও জেলার জনধারায় ভারতীয় উপমহাদেশের কোন তিনটি প্রধান ভাষাগোষ্ঠীর উল্লেখযোগ্য উপস্থিতি লক্ষ করা যায়?", q_en:"Which three major South Asian language families show a notable presence in Thakurgaon's population?",
     opts_bn:["ইন্দো-ইউরোপীয়, দ্রাবিড়, মুণ্ডা","সেমেটিক, তুর্কি, মঙ্গোলীয়","অস্ট্রো-এশিয়াটিক, চীনা-তিব্বতি, দ্রাবিড়","সিনো-তিব্বতি, ইন্দো-আর্য, ফার্সি"], opts_en:["Indo-European, Dravidian, Munda","Semitic, Turkic, Mongolic","Austroasiatic, Sino-Tibetan, Dravidian","Sino-Tibetan, Indo-Aryan, Persian"], correct:0},
    {q_bn:"অ্যালপাইন নরগোষ্ঠীর মানুষ ঠাকুরগাঁও জেলায় মূলত কোন শতাব্দীর মধ্যে আগমন করে বলে ধারণা করা হয়?", q_en:"The Alpine racial group is believed to have arrived in Thakurgaon district mainly within which centuries?",
     opts_bn:["ষষ্ঠ-সপ্তম","অষ্টম-নবম থেকে সপ্তদশ শতক","অষ্টাদশ-ঊনবিংশ","বিংশ শতাব্দী"], opts_en:["6th-7th century","8th-9th to 17th century","18th-19th century","20th century"], correct:1},
    {q_bn:"সম্রাট অশোকের পুণ্ড্ররাজ্য অধিকারের প্রমাণ কোথায় প্রাপ্ত ব্রাহ্মিলিপিতে খোদিত আছে?", q_en:"Evidence of Emperor Ashoka's control over Pundra-rajya is inscribed on a Brahmi script found where?",
     opts_bn:["পাহাড়পুরে","মহাস্থানগড়ে","ময়নামতিতে","ওয়ারী-বটেশ্বরে"], opts_en:["Paharpur","Mahasthangarh","Mainamati","Wari-Bateshwar"], correct:1},
    {q_bn:"গুপ্ত আমলে পুণ্ড্ররাজ্যের একটি বিষয়ের সদর দপ্তর দিনাজপুরের কোথায় ছিল, আর কেন্দ্রস্থল ছিল কোন নগরী?", q_en:"In the Gupta era, where in Dinajpur was the headquarters of a 'vishaya' of Pundra-rajya, and what was its central city?",
     opts_bn:["কোটিবর্ষ, পুণ্ড্রনগরী","ঠাকুরগাঁও, নিশ্চিন্তপুর","বীরগঞ্জ, চত্রা","নেকমরদ, শালবাহান"], opts_en:["Kotivarsha, Pundranagari","Thakurgaon, Nishchintapur","Birganj, Chatra","Nekmarad, Shalbahan"], correct:0},
    {q_bn:"দিনাজপুরের ফুলবাড়ী থানার দামোদরপুরে প্রাপ্ত তাম্রলিপির সংখ্যা কত?", q_en:"How many copper-plate inscriptions were found at Damodarpur in Fulbari thana, Dinajpur?",
     opts_bn:["তিনখানা","চারখানা","পাঁচখানা","ছয়খানা"], opts_en:["Three","Four","Five","Six"], correct:2},
    {q_bn:"হিলির বৈগ্রামে প্রাপ্ত তাম্রলিপিটি কোন সম্রাটের শাসনামলের বলে চিহ্নিত?", q_en:"The copper-plate found at Baigram, Hili, is identified as belonging to which emperor's reign?",
     opts_bn:["সম্রাট অশোক","সম্রাট প্রথম চন্দ্রগুপ্ত","সম্রাট কুমার গুপ্ত","সম্রাট হর্ষবর্ধন"], opts_en:["Emperor Ashoka","Emperor Chandragupta I","Emperor Kumaragupta","Emperor Harshavardhana"], correct:2},
    {q_bn:"পঞ্চগড় নামকরণের একটি ভাষাগত ব্যাখ্যায় প্রাকৃত ভাষার বৈশিষ্ট্য অনুসারে শব্দ রূপান্তরের ধারাটি কী?", q_en:"According to one linguistic explanation, what is the Prakrit-based sound-change chain behind the name 'Panchagarh'?",
     opts_bn:["পঞ্চনগরী > পঞ্চগড়","পঞ্চগৌড় > পঞ্চগোড় > পঞ্চগড়","পঞ্চবন > পঞ্চগড়","পঞ্চতীর্থ > পঞ্চগড়"], opts_en:["Panchanagari > Panchagarh","Panchagaur > Panchagor > Panchagarh","Panchaban > Panchagarh","Panchatirtha > Panchagarh"], correct:1},
    {q_bn:"পঞ্চগড় জেলা মুক্তিযুদ্ধকালে কোন সেক্টরের অন্তর্ভুক্ত ছিল?", q_en:"Panchagarh district fell under which sector during the Liberation War?",
     opts_bn:["৫নং সেক্টর","৬নং সেক্টর","৭নং সেক্টর","৮নং সেক্টর"], opts_en:["Sector 5","Sector 6","Sector 7","Sector 8"], correct:1},
    {q_bn:"মুক্তিযুদ্ধের সময় পঞ্চগড়ে ৬নং সেক্টরের বেসামরিক উপদেষ্টা হিসেবে দায়িত্ব পালন করেন কে?", q_en:"Who served as the civilian advisor of Sector 6 in Panchagarh during the Liberation War?",
     opts_bn:["অ্যাড. সিরাজুল ইসলাম","অ্যাড. কমরউদ্দিন আহমেদ","নাজিম উদ্দীন আহমেদ","কাজী হাবিবর রহমান"], opts_en:["Advocate Sirajul Islam","Advocate Komoruddin Ahmed","Nazim Uddin Ahmed","Kazi Habibur Rahman"], correct:0},
    {q_bn:"মোগল আমলে \"ঘোড়াঘাটের সরকার\" ও \"পিঞ্জিরার সরকার\"-এর মূল নিয়ন্ত্রণকর্তা কে ছিলেন বলে উল্লেখ আছে?", q_en:"Who is recorded as the principal authority over the 'Sarkar Ghoraghat' and 'Sarkar Pinjira' during Mughal rule?",
     opts_bn:["রিয়াজ-আস-সালাতিন","রাজা মানসিং","মীরজুমলা","শায়েস্তা খাঁ"], opts_en:["Riyaz-us-Salatin (the chronicle)","Raja Man Singh","Mir Jumla","Shaista Khan"], correct:0},
    {q_bn:"রংপুর বিভাগীয় অফিসটি মোট কত একর জমিতে প্রতিষ্ঠিত?", q_en:"On how many acres of land was the Rangpur divisional office established?",
     opts_bn:["১০ একর","১৫ একর","২০ একর","২৫ একর"], opts_en:["10 acres","15 acres","20 acres","25 acres"], correct:1},
    {q_bn:"ঠাকুরগাঁওয়ের আদি নাম \"নিশ্চিন্তপুর\" ছিল—এই তথ্য কোন শতাব্দীর কোচবিহারের মানচিত্র থেকে প্রমাণিত হয়েছে?", q_en:"Thakurgaon's original name 'Nishchintapur' is confirmed by a map of Cooch Behar from which century?",
     opts_bn:["ষোড়শ শতাব্দী","সপ্তদশ শতাব্দী","অষ্টাদশ শতাব্দী","ঊনবিংশ শতাব্দী"], opts_en:["16th century","17th century","18th century","19th century"], correct:1},
    {q_bn:"সুলতানি আমলে গৌড় রাজ্যে উত্তর-ভারত ছাড়াও কোন কোন অঞ্চল থেকে সৈন্য ও কর্মচারী আগমন করে?", q_en:"During the Sultanate era, besides northern India, from which regions did soldiers and officials come to the Gauda kingdom?",
     opts_bn:["চীন ও তিব্বত","ইরান, আরব ও আফ্রিকা","মধ্য এশিয়া ও রাশিয়া","ইউরোপ"], opts_en:["China and Tibet","Iran, Arabia and Africa","Central Asia and Russia","Europe"], correct:1},
    {q_bn:"সম্রাট আকবরের সুবে বাংলার ১৯টি সরকারের মধ্যে ঠাকুরগাঁও জেলার সীমানাভুক্ত দুটি সরকারের নাম কী?", q_en:"Among Akbar's 19 'sarkars' of Suba Bangla, which two sarkars covered the area of Thakurgaon district?",
     opts_bn:["সরকার তাজপুর ও সরকার পাঁজরা","সরকার ঘোড়াঘাট ও সরকার পিঞ্জিরা","সরকার গৌড় ও সরকার তাণ্ডা","সরকার বরেন্দ্র ও সরকার পুণ্ড্র"], opts_en:["Sarkar Tajpur and Sarkar Panjra","Sarkar Ghoraghat and Sarkar Pinjira","Sarkar Gauda and Sarkar Tanda","Sarkar Barendra and Sarkar Pundra"], correct:0},
    {q_bn:"ঊনবিংশ শতাব্দীর শুরুতে নীলফামারী অঞ্চলের কোন কোন স্থানে নীলকুঠি স্থাপিত হয়?", q_en:"Where in the Nilphamari region were indigo factories (nilkuthi) set up in the early 19th century?",
     opts_bn:["দুরাকুটি, ডিমলা, কিশোরগঞ্জ, টেঙ্গনমারী","সৈয়দপুর, জলঢাকা","ডোমার, কিশোরগঞ্জ","কেবল ডিমলায়"], opts_en:["Durakuti, Dimla, Kishoreganj, Tengonmari","Saidpur, Jaldhaka","Domar, Kishoreganj","Only in Dimla"], correct:0},
    {q_bn:"গাইবান্ধা জেলার ভবানীগঞ্জ মহকুমা সদর দপ্তর কেন গাইবান্ধায় স্থানান্তরিত হয়?", q_en:"Why was the Bhabaniganj sub-division headquarters of Gaibandha district moved to Gaibandha town?",
     opts_bn:["জনসংখ্যা বৃদ্ধির কারণে","ভবানীগঞ্জ নদীগর্ভে বিলীন হওয়ায়","যোগাযোগ ব্যবস্থার উন্নয়নে","প্রশাসনিক পুনর্বিন্যাসে"], opts_en:["Due to population growth","Because Bhabaniganj was swallowed by the river","Due to improved communications","Due to administrative reorganization"], correct:1},
    {q_bn:"রংপুর সিটি কর্পোরেশনের তৎকালীন চেয়ারম্যান রাজা জানকীবল্লভ সেন কোন সমস্যা নিরসনে খাল খনন করেন?", q_en:"What problem was Raja Janakiballav Sen, then chairman of Rangpur, addressing by digging the canal?",
     opts_bn:["বন্যা নিয়ন্ত্রণ","জলাবদ্ধতা ও মশা-ম্যালেরিয়ার প্রাদুর্ভাব","খাবার পানির সংকট","কৃষি সেচ সমস্যা"], opts_en:["Flood control","Waterlogging and mosquito-borne malaria","Drinking water shortage","Agricultural irrigation problems"], correct:1},
    {q_bn:"বাংলাদেশের ভূ-প্রকৃতি অনুসারে নীলফামারী শহরটি কোন প্লাবনভূমিতে অবস্থিত?", q_en:"According to Bangladesh's physiography, Nilphamari town lies in which floodplain?",
     opts_bn:["গঙ্গা প্লাবনভূমি","তিস্তা প্লাবনভূমি","মেঘনা প্লাবনভূমি","যমুনা প্লাবনভূমি"], opts_en:["Ganges floodplain","Teesta floodplain","Meghna floodplain","Jamuna floodplain"], correct:1},
    {q_bn:"১৯৭১ সালের ২ অক্টোবর কোদালকাটি অবস্থান ছেড়ে পাকিস্তানিরা কোন উদ্দেশ্যে চিলমারীর দিকে যাত্রা করে, এবং তার আগে কী নৃশংসতা চালায়?", q_en:"On October 2, 1971, why did Pakistani forces leave Kodalkati for Chilmari, and what atrocity did they commit beforehand?",
     opts_bn:["আত্মসমর্পণের জন্য, কোনো নৃশংসতা করেনি","কৌশলগত পশ্চাদপসরণ, ৬৫ জন বেসামরিক মানুষকে হত্যা করে","পুনর্গঠনের জন্য, বন্দিদের মুক্তি দেয়","আলোচনার জন্য, অস্ত্র সমর্পণ করে"], opts_en:["To surrender, committed no atrocity","A strategic retreat, killed 65 civilians","To regroup, released prisoners","For negotiation, surrendered arms"], correct:1},
    {q_bn:"চর্যাপদের সাথে ঠাকুরগাঁওয়ের সম্পর্ক দৃঢ়ভাবে প্রতিষ্ঠিত না হওয়ার প্রধান কারণ কী বলে বইয়ে উল্লেখ আছে?", q_en:"What does the book cite as the main reason Thakurgaon's link to the Charyapada remains unconfirmed?",
     opts_bn:["ভাষাগত অমিল","তথ্য-প্রমাণের স্বল্পতা ও পর্যাপ্ত গবেষণার অভাব","ঐতিহাসিকদের মতানৈক্য","নথিপত্র ধ্বংস হওয়া"], opts_en:["Linguistic mismatch","Lack of evidence and insufficient research","Disagreement among historians","Destruction of records"], correct:1},
    {q_bn:"ঠাকুরগাঁওয়ের কোন থানা থেকে ১৯৮৪ সালে প্রাচীন মুদ্রা পাওয়া যায় এবং কতটি মুদ্রা স্থানীয় ট্রেজারিতে জমা করা হয়?", q_en:"From which thana in Thakurgaon were ancient coins found in 1984, and how many were deposited in the local treasury?",
     opts_bn:["রাজাগাঁও গ্রাম, ২১টি","নেকমরদ, ১৫টি","রাণীশংকৈল, ৩০টি","হরিপুর, ১০টি"], opts_en:["Rajagaon village, 21 coins","Nekmarad, 15 coins","Ranisankail, 30 coins","Haripur, 10 coins"], correct:0},
    {q_bn:"রংপুর অঞ্চলে ১৮৫৮ সাল পর্যন্ত শাসনকার্য পরিচালনা করত কোন প্রতিষ্ঠান, এবং তারপর ক্ষমতা কার হাতে যায়?", q_en:"Which institution governed the Rangpur region until 1858, and to whom did power then pass?",
     opts_bn:["মোগল দরবার, নবাবের হাতে","ইস্ট ইন্ডিয়া কোম্পানি, ব্রিটিশ সরকারের হাতে","নীলকর সংঘ, জমিদারদের হাতে","সুবেদার, সম্রাটের হাতে"], opts_en:["The Mughal court, to the Nawab","The East India Company, to the British Crown","The indigo planters' association, to zamindars","The Subedar, to the Emperor"], correct:1},
    {q_bn:"বিলু কবীরের লেখা কোন গ্রন্থ থেকে কুড়িগ্রাম নামকরণ সম্পর্কে তথ্য পাওয়া যায়?", q_en:"Information about the naming of Kurigram comes from which book written by Bilu Kabir?",
     opts_bn:["বাংলাদেশের ইতিহাস","বাংলাদেশের জেলা নামকরণের ইতিহাস","উত্তরবঙ্গের কথা","কুড়িগ্রামের ঐতিহ্য"], opts_en:["History of Bangladesh","History of the Naming of Bangladesh's Districts","Tales of North Bengal","Heritage of Kurigram"], correct:1}
  ]
};

const ADMIN_PASSWORD = "UHF2026Admin";
const EXAM_START_DATE = new Date("2026-09-25T00:00:00+06:00");

let countdownInterval = null;

async function checkExamAvailability(){
  const now = new Date();
  const lockedBox = document.getElementById('examLocked');
  const loginBox = document.getElementById('examLogin');
  if(now < EXAM_START_DATE){
    lockedBox.classList.remove('hidden');
    loginBox.classList.add('hidden');
    document.getElementById('examLockedTextBn').textContent =
      '২৫ সেপ্টেম্বর, ২০২৬ তারিখ থেকে পরীক্ষা শুরু হবে। এই তারিখের আগে পরীক্ষায় অংশ নেওয়া যাবে না। নিচে কতক্ষণ বাকি তা দেখা যাচ্ছে:';
    document.getElementById('examLockedTextEn').textContent =
      'The exam opens on September 25, 2026. You cannot take the exam before this date. Time remaining is shown below:';
    if(countdownInterval) clearInterval(countdownInterval);
    tickCountdown();
    countdownInterval = setInterval(tickCountdown, 1000);
  }else{
    if(countdownInterval){ clearInterval(countdownInterval); countdownInterval = null; }
    lockedBox.classList.add('hidden');
    loginBox.classList.remove('hidden');
  }
}

function tickCountdown(){
  const diffMs = EXAM_START_DATE - new Date();
  if(diffMs <= 0){
    clearInterval(countdownInterval);
    countdownInterval = null;
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

async function loadQuestionsForCategory(catKey){
  try{
    const res = await window.storage.get('questions:'+catKey, true);
    const parsed = JSON.parse(res.value);
    if(Array.isArray(parsed) && parsed.length>0) return parsed;
  }catch(err){ /* fall back below */ }
  return QUESTIONS[catKey];
}

const CATEGORY_LABELS = {
  primary:{bn:"প্রাইমারি (৩য়-৫ম শ্রেণী)", en:"Primary (Class 3-5)"},
  junior:{bn:"জুনিয়র (৬ষ্ঠ-৮ম শ্রেণী)", en:"Junior (Class 6-8)"},
  senior:{bn:"সিনিয়র (৯ম-১০ম শ্রেণী)", en:"Senior (Class 9-10)"}
};

function getCategoryKey(clsValue){
  if(!clsValue) return null;
  if(clsValue.indexOf('প্রাইমারি')===0) return 'primary';
  if(clsValue.indexOf('জুনিয়র')===0) return 'junior';
  if(clsValue.indexOf('সিনিয়র')===0) return 'senior';
  return null;
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
  if(new Date() < EXAM_START_DATE){
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
