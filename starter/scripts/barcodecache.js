// scripts/barcodeCache.js
// Local-first barcode→item cache to accelerate scans on low-end devices.
// API:
//   await BarcodeCache.ensureFresh(db, maxAgeMs?)
//   BarcodeCache.lookup(barcode) -> item | null
//   await BarcodeCache.rebuild(db)
//   BarcodeCache.clear()

const KEY = 'barcodeCache:v1';

function _now(){ return Date.now(); }

function _read(){
  try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; }
}
function _write(payload){
  try { localStorage.setItem(KEY, JSON.stringify(payload)); } catch {}
}

export const BarcodeCache = {
  lookup(code){
    if(!code) return null;
    const cache = _read();
    if(!cache || !cache.map) return null;
    const hit = cache.map[code];
    return hit ? { ...hit } : null;
  },

  async ensureFresh(db, maxAgeMs = 1000 * 60 * 60 * 12){ // 12h default
    const cache = _read();
    if(!cache || !cache.ts || ( (_now() - cache.ts) > maxAgeMs )){
      await this.rebuild(db);
    }
  },

  async rebuild(db){
    const inv = await db.inventory.toArray().catch(()=>[]);
    // Build { barcode: { id, name, batch, expiry, mrp, rate, gstPct, qty } }
    const map = {};
    inv.forEach(r=>{
      const bc = (r.barcode || '').trim();
      if(!bc) return;
      map[bc] = {
        id: r.id,
        name: r.name || '',
        batch: r.batch || '',
        expiry: r.expiry || null,
        mrp: +r.mrp || 0,
        rate: +r.rate || 0,
        gstPct: +r.gstPct || 0,
        qty: +r.qty || 0
      };
    });
    _write({ ts: _now(), map });
    return Object.keys(map).length;
  },

  clear(){ localStorage.removeItem(KEY); }
};