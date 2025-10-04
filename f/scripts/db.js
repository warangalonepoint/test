// /scripts/db.js
// Clean, single data layer: PouchDB local (IndexedDB) + optional CouchDB/Sheets.
// Exposes the Dexie-like API your pages expect.

export const CONFIG = {
  profile: { Name: "Dr. Charan Child Clinic", City: "Warangal", Phone: "08340840340" },
  couch: { remote: "" },                // e.g. "https://user:pass@host:5984/clinic_"
  sheets: { readUrl: "", writeUrl: "" } // optional
};

// --- PouchDB ---
let PouchDBLib;
try { PouchDBLib = (await import('https://cdn.jsdelivr.net/npm/pouchdb@8.0.1/dist/pouchdb.min.js')).default; }
catch { PouchDBLib = self.PouchDB; }
const PouchDB = PouchDBLib;

export const tokensDB   = new PouchDB("clinic_tokens");   // Booking + Token docs
export const opdDB      = new PouchDB("clinic_opd");
export const patientsDB = new PouchDB("clinic_patients");
export const vitalsDB   = new PouchDB("clinic_vitals");
export const vaccinesDB = new PouchDB("clinic_vaccines");
export const configDB   = new PouchDB("clinic_config");

export const pouch = { tokensDB, opdDB, patientsDB, vitalsDB, vaccinesDB, configDB };

export const todayISO = () => new Date().toISOString().slice(0,10);
export const ageMonths = (dob) => {
  if(!dob) return 0;
  const d = new Date(dob), n = new Date();
  return (n.getFullYear()-d.getFullYear())*12 + (n.getMonth()-d.getMonth()) - (n.getDate()<d.getDate()?1:0);
};
export const ageText = (dob) => {
  if(!dob) return "-";
  const months = ageMonths(dob); const y = Math.floor(months/12), m = months%12;
  if (y <= 0) return `${months} m`;
  if (m === 0) return `${y} y`;
  return `${y} y ${m} m`;
};

// --- CouchDB live sync (optional) ---
function remote(name){ const base = CONFIG.couch.remote; if(!base) return null; return new PouchDB(base + name); }
export async function startSync(){
  const pairs = [[tokensDB,"tokens"],[opdDB,"opd"],[patientsDB,"patients"],[vitalsDB,"vitals"],[vaccinesDB,"vaccines"],[configDB,"config"]];
  for (const [db,name] of pairs){
    const r = remote(name); if(!r) continue;
    PouchDB.sync(db, r, { live:true, retry:true }).on('error', e=>console.warn('sync error',name,e));
  }
}

async function getAllDocs(db){
  const res = await db.allDocs({ include_docs:true });
  return res.rows.map(r=>r.doc).filter(Boolean);
}
function normalizeBookingDoc(d){
  return {
    _id: d._id,
    date: d.date || d.Date,
    token: d.token || d.Token,
    status: d.status || d.Status || 'booked',
    name: d.name || d.PatientName || '',
    phone: d.phone || d.Phone || '',
    pid: d.pid || d.PID || '',
    dob: d.dob || d.DOB || '',
    sex: d.sex || d.Sex || '',
    height: d.height ?? d.Height ?? d.HeightCm ?? '',
    weight: d.weight ?? d.Weight ?? d.WeightKg ?? '',
    reason: d.reason || d.Reason || '',
    source: d.source || d.Source || (d.Mode ? (d.Mode.toLowerCase()) : '')
  };
}
function srcToMode(src){
  if(!src) return 'WALKIN';
  const s = String(src).toLowerCase();
  if (s === 'online') return 'ONLINE';
  if (s === 'whatsapp') return 'WHATSAPP';
  return 'WALKIN';
}

// --- Dexie-like facade used by bookings.html ---
export const db = {
  bookings: {
    where(field){
      return {
        equals(value){
          return {
            async toArray(){
              const docs = await getAllDocs(tokensDB);
              const onlyBookings = docs.filter(d => (d.Type==='Booking') || (d._id||'').startsWith('booking:'));
              const mapped = onlyBookings.map(normalizeBookingDoc).filter(d => d[field] === value);
              return mapped.sort((a,b)=> (a.token||'').localeCompare(b.token||''));
            }
          };
        }
      };
    }
  },
  patient: {
    async get(pid){
      try {
        const doc = await patientsDB.get(pid);
        return { pid: doc._id, name: doc.Name || '', phone: doc.Phone || '', dob: doc.DOB || '', sex: doc.Sex || '' };
      } catch { return null; }
    },
    where(field){
      return {
        equals(value){
          return {
            async first(){
              const docs = await getAllDocs(patientsDB);
              const match = docs.find(d => (d[field] || d[field?.toUpperCase?.()]) === value);
              if(!match) return null;
              return { pid: match._id, name: match.Name||'', phone: match.Phone||'', dob: match.DOB||'', sex: match.Sex||'' };
            }
          };
        }
      };
    }
  },
  vitals: {
    async add(doc){
      const id = doc._id || `vitals:${Date.now()}`;
      await vitalsDB.put({ _id: id, ...doc });
      return id;
    }
  }
};

// --- Patient helpers ---
export async function nextPID(){
  // simple increment; replace with your policy later
  const docs = await getAllDocs(patientsDB);
  let max = 0;
  for (const d of docs){
    const m = String(d._id||'').match(/PID(\d+)/i);
    if(m) max = Math.max(max, parseInt(m[1],10));
  }
  return `PID${String(max+1).padStart(4,'0')}`;
}
export async function upsertPatient(p){
  const id = (p.pid || '').toUpperCase();
  if(!id) throw new Error('PID required');
  const existing = await patientsDB.get(id).catch(()=>null);
  const doc = { _id: id, Type:'Patient', Name: p.name, Phone: p.phone, DOB: p.dob, Sex: p.sex, UpdatedAt: new Date().toISOString() };
  if(existing) doc._rev = existing._rev;
  await patientsDB.put(doc);
  return id;
}

// --- Booking save + OPD stub ---
export async function saveBooking(b, opts={ createOpdStub: true }){
  const doc = {
    _id: b._id || `booking:${b.date}:${b.token}`,
    Type: 'Booking',
    Date: b.date,
    Token: b.token,
    Status: b.status || 'booked',
    PatientName: b.name, Phone: b.phone, PID: b.pid,
    DOB: b.dob, Sex: b.sex,
    Height: b.height, Weight: b.weight,
    Reason: b.reason, Mode: srcToMode(b.source),
    Source: b.source,
    CreatedAt: new Date().toISOString()
  };
  const ex = await tokensDB.get(doc._id).catch(()=>null);
  if(ex) doc._rev = ex._rev;
  await tokensDB.put(doc);

  if (opts.createOpdStub){
    const oid = `OPD::${b.date}::${b.token}`;
    const opd = {
      _id: oid, Type:'OPD', Date: b.date, Token: b.token, PID: b.pid,
      PatientName: b.name, Phone: b.phone, Reason: b.reason || '', Status:'Open',
      CreatedAt: new Date().toISOString()
    };
    const exo = await opdDB.get(oid).catch(()=>null);
    if(exo) opd._rev = exo._rev;
    await opdDB.put(opd);
  }
  return { ok:true, id: doc._id };
}

// --- Vitals helpers used by OPD ---
export async function getLatestVitals(pid='', token=''){
  let candidates = [];
  const all = await getAllDocs(vitalsDB);
  if(token){
    candidates = candidates.concat(all.filter(d => (d.Token===token || d.token===token)));
  }
  if(pid){
    candidates = candidates.concat(all.filter(d => (d.PID===pid || d.pid===pid || d.PatientId===pid)));
  }
  if(!candidates.length) return null;
  candidates.sort((a,b)=> (b.CreatedAt||b.createdAt||'').localeCompare(a.CreatedAt||a.createdAt||''));
  return candidates[0];
}
export async function getBookingByToken(token, date=todayISO()){
  const id = `booking:${date}:${token}`;
  let doc = await tokensDB.get(id).catch(()=>null);
  if(!doc){
    // fallback: scan
    const all = await getAllDocs(tokensDB);
    doc = all.find(d => (d.Type==='Booking') && (d.Token===token || d.token===token));
  }
  return doc ? normalizeBookingDoc(doc) : null;
}

// --- Sheets bridge (optional, off by default) ---
export async function sheetsRead(){
  if(!CONFIG.sheets.readUrl) return [];
  const r=await fetch(CONFIG.sheets.readUrl,{cache:'no-store'}); const t=await r.text();
  try{return JSON.parse(t);}catch{
    const rows=t.trim().split(/\r?\n/).map(r=>r.split(',')); const head=rows.shift()||[];
    return rows.map(r=>Object.fromEntries(head.map((h,i)=>[h.trim(),(r[i]||'').trim()])));
  }
}
export async function sheetsWrite(table, rows){
  if(!CONFIG.sheets.writeUrl) return {ok:false,reason:'writeUrl not set'};
  const r=await fetch(CONFIG.sheets.writeUrl,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({table,rows})});
  try{return await r.json();}catch{return {ok:r.ok}};
}

// --- Seeds & purge ---
export async function seedDemo(){
  const base = todayISO();
  const pts = [
    { _id:'PID0001', Type:'Patient', Name:'Ayaan', Phone:'987650001', DOB:'2021-05-10', Sex:'M' },
    { _id:'PID0002', Type:'Patient', Name:'Sana',  Phone:'987650002', DOB:'2020-07-02', Sex:'F' },
    { _id:'PID0003', Type:'Patient', Name:'Ria',   Phone:'987650003', DOB:'2019-11-23', Sex:'F' }
  ];
  for (const p of pts){ try{ const ex=await patientsDB.get(p._id).catch(()=>null); if(!ex) await patientsDB.put(p);}catch{} }

  const seed = [
    { _id:`booking:${base}:#01`, Type:'Booking', Date:base, Token:'#01', Status:'booked', PatientName:'Ayaan', Phone:'987650001', PID:'PID0001', Reason:'Fever', Mode:'WALKIN', CreatedAt:new Date().toISOString() },
    { _id:`booking:${base}:O01`, Type:'Booking', Date:base, Token:'O01', Status:'booked', PatientName:'Sana', Phone:'987650002', PID:'PID0002', Reason:'Cough', Mode:'ONLINE', CreatedAt:new Date().toISOString() },
    { _id:`booking:${base}:W01`, Type:'Booking', Date:base, Token:'W01', Status:'booked', PatientName:'Ria',  Phone:'987650003', PID:'PID0003', Reason:'Vaccination', Mode:'WHATSAPP', CreatedAt:new Date().toISOString() }
  ];
  for (const d of seed){ try{ const ex=await tokensDB.get(d._id).catch(()=>null); if(!ex) await tokensDB.put(d);}catch{} }
}
export async function purgeAll(){
  for (const db of [tokensDB, opdDB, patientsDB, vitalsDB, vaccinesDB, configDB]){
    const all = await db.allDocs(); await Promise.all(all.rows.map(r=>db.remove(r.id, r.value.rev)));
  }
}