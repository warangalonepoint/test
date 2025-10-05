<!doctype html><html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>TestKit · Clinic PWA</title>
<link rel="stylesheet" href="./styles/styles.css"/>
<script defer src="https://cdn.jsdelivr.net/npm/dexie@4.0.8/dist/dexie.min.js"></script>
<style>
  .small{font-size:12px}.muted{opacity:.7}
  #log{background:#0b1020;color:#bfe1ff;padding:10px;border-radius:10px;max-height:320px;overflow:auto}
  .ok{color:#22c55e}.warn{color:#f59e0b}.bad{color:#ef4444}
</style>
<script type="module">
import { db, seed } from './scripts/db.js';
import { fmt } from './scripts/utils.js';
import { mountNav } from './scripts/ui.js';

const $ = s=>document.querySelector(s);
function log(line, cls=''){ const el=$('#log'); el.innerHTML += `<div class="${cls}">${line}</div>`; el.scrollTop=el.scrollHeight; }
function clearLog(){ $('#log').innerHTML=''; }

seed();
window.addEventListener('DOMContentLoaded', ()=>{
  mountNav('testkit');
  bind();
});

function bind(){
  $('#btn-seed').addEventListener('click', seedAll);
  $('#btn-check').addEventListener('click', runChecks);
  $('#btn-fix').addEventListener('click', fixAll);
  $('#btn-clear').addEventListener('click', clearLog);
}

/* ---------- SEED ---------- */
async function seedAll(){
  clearLog();
  log('Seeding demo patients & bookings…');
  // reuse bookings seeder style
  const demoNames=['Aarav','Vivaan','Aditya','Vihaan','Arjun','Anaya','Siya','Myra','Kiara','Sara','Riya'];
  function rint(a,b){return Math.floor(Math.random()*(b-a+1))+a;}
  function pick(a){return a[rint(0,a.length-1)];}
  function genPid(){return 'P'+Date.now().toString(36).toUpperCase()+rint(10,99);}

  const today=fmt.date();
  const pts=[];
  for(let i=0;i<12;i++){
    const ageM=rint(2,168);
    const dob=new Date(); dob.setMonth(dob.getMonth()-ageM);
    const sex=Math.random()<.48?'F':'M';
    const height=+(rint(55,160)+Math.random()).toFixed(1);
    const weight=+(rint(4,55)+Math.random()).toFixed(1);
    pts.push({id:genPid(), name:pick(demoNames), phone:'9'+rint(100000000,999999999), sex, dob:dob.toISOString().slice(0,10), ageMonths:ageM, height, weight});
  }
  try{ await db.patients.bulkPut(pts); }catch{ for(const p of pts){ try{ await db.patients.put(p);}catch{}} }

  // make bookings
  const types=['walkin','online','whatsapp'];
  for(let i=0;i<14;i++){
    const p=pick(pts), t=pick(types);
    // quick unique token per type today
    const exist=await db.bookings.where({date:today,type:t}).toArray();
    const n=exist.length+1, prefix=t==='online'?'O':t==='whatsapp'?'W':'';
    await db.bookings.add({
      date:today, ts:Date.now()+i, type:t, token:'#'+prefix+String(n).padStart(2,'0'),
      status:'booked', patientId:p.id, name:p.name, phone:p.phone, sex:p.sex,
      dob:p.dob, ageMonths:p.ageMonths, height:p.height, weight:p.weight, reason:'Test'
    });
  }
  log('Seeded ✓', 'ok');
}

/* ---------- CHECKS ---------- */
async function runChecks(){
  clearLog();
  let issues=0;

  // 1. Duplicate tokens
  const today=fmt.date();
  const rows=await db.bookings.where('date').equals(today).toArray();
  const seen=new Set();
  for(const r of rows){
    const key=r.type+'|'+r.token;
    if(seen.has(key)){ log(`Duplicate token: ${key}`, 'bad'); issues++; }
    seen.add(key);
  }

  // 2. Orphan bookings (missing patient)
  const pts=await db.patients.toArray();
  const has=new Set(pts.map(p=>p.id));
  for(const r of rows){
    if(!r.patientId || !has.has(r.patientId)){ log(`Orphan booking id=${r.id} token=${r.token}`, 'bad'); issues++; }
  }

  // 3. Bad dates / missing ts
  for(const r of rows){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(r.date||'')){ log(`Bad date on booking id=${r.id}`, 'bad'); issues++; }
    if(typeof r.ts!=='number'){ log(`Missing ts on booking id=${r.id}`, 'bad'); issues++; }
  }

  // 4. NaN vitals
  for(const r of rows){
    ['height','weight','ageMonths'].forEach(k=>{
      if(r[k]!=null && !Number.isFinite(+r[k])){ log(`NaN ${k} on booking id=${r.id}`, 'bad'); issues++; }
    });
  }

  log(issues?`Found ${issues} issues ⚠`:'All good ✓','ok');
}

/* ---------- FIXES ---------- */
async function fixAll(){
  let fixed=0;
  const today=fmt.date();

  // Ensure unique tokens per day+type by renumbering duplicates
  const byType={};
  for(const t of ['walkin','online','whatsapp']){
    byType[t]=await db.bookings.where({date:today,type:t}).sortBy('ts');
    const prefix=t==='online'?'O':t==='whatsapp'?'W':'';
    const used=new Set();
    let n=1;
    for(const r of byType[t]){
      let tok=r.token;
      if(!tok || used.has(tok)){
        tok='#'+prefix+String(n).padStart(2,'0'); n++;
        await db.bookings.update(r.id,{token:tok}); fixed++;
      }
      used.add(tok);
    }
  }

  // Bad date/ts
  const rows=await db.bookings.toArray();
  for(const r of rows){
    const patch={};
    if(!/^\d{4}-\d{2}-\d{2}$/.test(r.date||'')) patch.date=today;
    if(typeof r.ts!=='number') patch.ts=Date.now();
    if(Object.keys(patch).length){ await db.bookings.update(r.id,patch); fixed++; }
  }

  // Orphans → attach to any existing patient
  const pts=await db.patients.toArray();
  const fallback=pts[0]?.id||null;
  if(fallback){
    for(const r of rows){
      if(!r.patientId){ await db.bookings.update(r.id,{patientId:fallback}); fixed++; }
    }
  }

  // NaN vitals → null
  for(const r of rows){
    const patch={};
    ['height','weight','ageMonths'].forEach(k=>{
      if(r[k]!=null && !Number.isFinite(+r[k])) patch[k]=null;
    });
    if(Object.keys(patch).length){ await db.bookings.update(r.id,patch); fixed++; }
  }

  log(`Fixed ${fixed} field(s) ✓`, 'ok');
}
</script>
</head>
<body>
<div id="nav"></div>

<div class="wrap grid">
  <div class="card">
    <h2>TestKit</h2>
    <p class="small muted">Seeds demo data, runs integrity checks, and applies auto-fixes for common issues.</p>
    <div class="row" style="gap:8px;flex-wrap:wrap">
      <button id="btn-seed" class="btn">Seed Demo</button>
      <button id="btn-check" class="btn ghost">Run Checks</button>
      <button id="btn-fix" class="btn ghost">Fix All</button>
      <button id="btn-clear" class="btn danger ghost">Clear Log</button>
    </div>
  </div>

  <div class="card">
    <h3>Log</h3>
    <div id="log" class="small"></div>
  </div>
</div>
</body>
</html>