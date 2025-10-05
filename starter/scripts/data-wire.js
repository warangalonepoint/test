// /scripts/data-wire.js
// Export / Import (merge) for Dexie DB
// - exportDB(): Blob(JSON) with all stores
// - importDBMerge(json): merge rows (add, update if newer, skip otherwise)
// - dbSummary(): count per store

import { db } from './db.js';

// List of stores to handle
const STORES = [
  'settings','users','patients','bookings','OPD',
  'invoices','invoiceItems','inventory','pharmacyItems',
  'rxQueue','labQueue','invoiceAudit'
];

function nowISO(){ return new Date().toISOString(); }

// ensure each row carries a soft timestamp for conflict resolution
function stamp(row){
  if (!row._updatedAt) row._updatedAt = nowISO();
  return row;
}

export async function dbSummary(){
  const out = {};
  for(const s of STORES){
    try{ out[s] = await db[s].count(); }catch{ out[s] = 0; }
  }
  return out;
}

export async function exportDB(){
  const payload = {_meta: { exportedAt: nowISO(), dbName: db.name, version: db.verno }};
  for(const s of STORES){
    const rows = await db[s].toArray();
    // stamp outgoing to have _updatedAt at least once
    payload[s] = rows.map(r=>({ ...r, _updatedAt: r._updatedAt || nowISO() }));
  }
  const text = JSON.stringify(payload, null, 2);
  return new Blob([text], {type:'application/json'});
}

/**
 * Merge strategy:
 * - If destination missing -> add
 * - If both exist:
 *    - If either has _updatedAt and incoming is newer -> update
 *    - Else skip (keep local)
 * - If no primary key known, fallback to put() (Dexie will upsert)
 *
 * Returns per-store report: {added, updated, skipped}
 */
export async function importDBMerge(json){
  const source = typeof json==='string' ? JSON.parse(json) : json;
  const report = {};
  const now = nowISO();

  for(const s of STORES){
    const arr = source[s]; if(!Array.isArray(arr)) continue;
    report[s] = { added:0, updated:0, skipped:0 };
    const table = db[s];

    // Determine primary key for the table by schema (rough heuristic)
    // We prefer fields we know: 'id' or 'key' or compound primary in schema start
    const pk = guessPrimaryKey(s);

    for(const row of arr){
      const incoming = { ...row };
      incoming._updatedAt = incoming._updatedAt || source?._meta?.exportedAt || now;

      if(!pk){
        // fallback: put (upsert) — counts as updated if existed
        const before = await table.get(row.id ?? row.key ?? undefined);
        await table.put(stamp(incoming));
        if(before) report[s].updated++; else report[s].added++;
        continue;
      }

      const key = incoming[pk];
      if(key===undefined){
        // cannot reconcile properly; just add a new row
        await table.add(stamp(incoming)).then(()=>report[s].added++).catch(()=>report[s].skipped++);
        continue;
      }

      const existing = await table.get(key);
      if(!existing){
        await table.put(stamp(incoming));
        report[s].added++;
      }else{
        const a = new Date(incoming._updatedAt||0).getTime();
        const b = new Date(existing._updatedAt||0).getTime();
        if(!b || a > b){
          // incoming is newer
          await table.put(stamp(incoming));
          report[s].updated++;
        }else{
          report[s].skipped++;
        }
      }
    }
  }
  return report;
}

function guessPrimaryKey(store){
  switch(store){
    case 'settings': return 'key';
    case 'users': return 'role';
    case 'patients': return 'id';
    case 'bookings': return 'id';
    case 'OPD': return 'id';
    case 'invoices': return 'id';
    case 'invoiceItems': return 'id';
    case 'inventory': return 'sku';
    case 'pharmacyItems': return 'id';
    case 'rxQueue': return 'id';
    case 'labQueue': return 'id';
    case 'invoiceAudit': return 'id';
    default: return 'id';
  }
}