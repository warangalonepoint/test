// scripts/growthSuggestions.js
// Loads data/growth_chart.json (WHO/ICMR-like) and provides growthAdvice().
// Expected shape (example):
// {
//   "boys": {
//     "0":   {"weight":{"p3":2.5,"p50":3.3,"p97":4.4}, "height":{"p3":46,"p50":50,"p97":54}},
//     "1":   {"weight":{"p3":3.2,"p50":4.5,"p97":6.0}, "height":{"p3":50,"p50":54,"p97":58}},
//     "24":  {"weight":{"p3":9.0,"p50":12.2,"p97":15.7}, "height":{"p3":80,"p50":87,"p97":94}},
//     "120": {"weight":{"p3":18,"p50":20.8,"p97":33},   "height":{"p3":108,"p50":115,"p97":135}}
//   },
//   "girls": { ... same keys ... }
// }

let _chart=null, _loading=null;

async function loadChart(){
  if(_chart) return _chart;
  if(_loading) return _loading;
  _loading = fetch('/data/growth_chart.json', {cache:'no-store'})
    .then(r=>r.json())
    .then(j=>{ _chart=j; return j; })
    .catch(()=>{ _chart=null; return null; });
  return _loading;
}

function nearestKeys(obj, ageMonths){
  // returns [k1,k2, t] where t in [0,1] interpolation factor; if exact, k1=k2
  const keys = Object.keys(obj).map(k=>+k).sort((a,b)=>a-b);
  if(!keys.length) return [null,null,0];
  if(ageMonths<=keys[0]) return [keys[0], keys[0], 0];
  if(ageMonths>=keys[keys.length-1]) return [keys[keys.length-1], keys[keys.length-1], 0];
  for(let i=0;i<keys.length-1;i++){
    const a=keys[i], b=keys[i+1];
    if(ageMonths>=a && ageMonths<=b){
      const t = (ageMonths-a)/(b-a || 1);
      return [a,b,t];
    }
  }
  return [keys[0], keys[0], 0];
}

function lerp(a,b,t){ return a + (b-a)*t; }

function interpBand(aBand, bBand, t){
  // band = {p3,p50,p97}
  return {
    p3:  lerp(aBand.p3,  bBand.p3,  t),
    p50: lerp(aBand.p50, bBand.p50, t),
    p97: lerp(aBand.p97, bBand.p97, t),
  };
}

function classify(value, band){
  if(value < band.p3) return {status:'Below Average', basis:`<p3 (cutoff ${band.p3.toFixed(1)})`};
  if(value > band.p97) return {status:'Above Average', basis:`>p97 (cutoff ${band.p97.toFixed(1)})`};
  // near p50 vs mid-range doesn’t change status; stay Normal
  return {status:'Normal', basis:`within p3–p97 (p50≈${band.p50.toFixed(1)})`};
}

function tips(status, ageMonths){
  const years = Math.floor(ageMonths/12);
  if(status==='Below Average'){
    if(ageMonths<6) return 'Exclusive breastfeeding on demand; check latch; vitamin D drops if advised.';
    if(ageMonths<24) return 'Add energy-dense complementary feeds every 3–4h; track weight monthly.';
    if(years<5) return 'Ensure 3 meals + 2 snacks; deworm if due; assess for illness.';
    return 'High-protein diet; activity as tolerated; review in 4–6 weeks.';
  }
  if(status==='Above Average'){
    if(years<5) return 'Avoid sugary drinks; offer fruits/veggies; outdoor play daily.';
    return 'Portion control; cut ultra-processed snacks; 60 min activity/day.';
  }
  // Normal
  if(ageMonths<12) return 'Continue age-appropriate feeds; monitor monthly growth.';
  if(ageMonths<60) return 'Balanced diet; routine activity; growth check in 2–3 months.';
  return 'Maintain balanced diet + regular activity; annual growth check.';
}

/**
 * growthAdvice({ageMonths, sex, heightCm, weightKg}) -> {status, tip, basis}
 */
export async function growthAdvice({ageMonths, sex='M', heightCm, weightKg}){
  await loadChart();
  const s = (sex||'M').toUpperCase()==='F' ? 'girls' : 'boys';

  if(!_chart?.[s]){
    // graceful fallback using BMI-for-age coarse bands
    const bmi = (heightCm>0 && weightKg>0) ? (weightKg/Math.pow(heightCm/100,2)) : null;
    if(!bmi) return {status:'—', tip:'Enter height & weight', basis:'no chart'};
    let status='Normal';
    if(bmi<13) status='Below Average';
    else if(bmi>21) status='Above Average';
    return {status, tip:tips(status,ageMonths), basis:'fallback BMI bands'};
  }

  const node = _chart[s];
  const [k1,k2,t] = nearestKeys(node, ageMonths);
  const a = node[k1], b = node[k2];
  const wBand = interpBand(a.weight, b.weight, t);
  const hBand = interpBand(a.height, b.height, t);

  const wCls = classify(+weightKg||0, wBand);
  const hCls = classify(+heightCm||0, hBand);

  // Combine: prioritize "Below/Above" if either weight or height flags it.
  let status='Normal', basis='';
  if(wCls.status!=='Normal') { status=wCls.status; basis=`Weight ${wCls.basis}`; }
  if(hCls.status!=='Normal' && status==='Normal'){ status=hCls.status; basis=`Height ${hCls.basis}`; }
  if(!basis) basis='within p3–p97';

  return { status, tip: tips(status, ageMonths), basis };
}