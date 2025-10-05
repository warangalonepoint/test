// scripts/guards.js
// FEFO picking, stock validation/commit (atomic), and booking token helpers + auditor.

export const Guards = {
  /* ---------------- Inventory helpers ---------------- */
  async buildInventoryIndex(db){
    const inv = await db.inventory.toArray().catch(()=>[]);
    const byName = new Map(); // name -> [{...batch}, ...sorted by expiry asc]
    inv.forEach(r=>{
      const k=(r.name||'').toLowerCase();
      if(!byName.has(k)) byName.set(k,[]);
      byName.get(k).push({...r});
    });
    byName.forEach(arr=>{
      arr.sort((a,b)=> String(a.expiry||'9999-12-31').localeCompare(String(b.expiry||'9999-12-31')));
    });
    return byName;
  },

  pickFefoBatch(name, invIdx){
    const k=(name||'').toLowerCase();
    const arr = invIdx.get(k)||[];
    return arr.find(b=>(+b.qty||0)>0) || null; // first with stock
  },

  applyFefoToLines(lines, invIdx){
    // For any line missing batch/rate/expiry, inject FEFO batch details
    return lines.map(l=>{
      const out={...l};
      if(!out.name) return out;
      const fefo = this.pickFefoBatch(out.name, invIdx);
      if(fefo && !out.batch){
        out.batch = fefo.batch||'';
        out.expiry = String(fefo.expiry||'').slice(0,10);
        out.mrp = +fefo.mrp||0; out.rate=+fefo.rate||0; out.gstPct=+fefo.gstPct||0;
      }
      return out;
    });
  },

  validateStock(lines, invIdx, {isReturn=false}={}){
    const errs=[];
    for(const l of lines){
      if(!l.name) { errs.push(`Line missing product name.`); continue; }
      if(!l.qty || isNaN(+l.qty)) { errs.push(`Invalid qty for ${l.name}.`); continue; }
      if(isReturn) continue; // returns add back; no min check
      const k=(l.name||'').toLowerCase();
      const arr = invIdx.get(k)||[];
      const b = arr.find(x=>String(x.batch||'')===String(l.batch||'')) || this.pickFefoBatch(l.name, invIdx);
      if(!b){ errs.push(`No stock batch found for ${l.name}.`); continue; }
      if((+b.qty||0) < (+l.qty||0)){
        errs.push(`Insufficient stock: ${l.name} ${l.batch||b.batch} (have ${b.qty||0}, need ${l.qty}).`);
      }
    }
    return errs;
  },

  /* Commit inventory change + invoice atomically. Throws if would go <0. */
  async commitSaleOrReturn({db, invoice, items, isReturn}){
    // invoice = {date,ts,type,patientId,doctor,sourceRxId,returnOfInvoiceId,taxable,sgst,cgst,total,status,payment}
    // items = [{name,batch,expiry,qty,rate,mrp,gstPct,note}]
    const invId = await db.transaction('rw',
      db.invoices, db.invoiceItems, db.inventory, db.invoiceAudit, db.rxQueue,
      async ()=>{
        // 1) persist invoice shell
        const invoiceId = await db.invoices.add(invoice);

        // 2) persist items
        for(const it of items){
          await db.invoiceItems.add({
            invoiceId,
            name: it.name, batch: it.batch||null, expiry: it.expiry||null,
            qty: +it.qty, mrp:+it.mrp||0, rate:+it.rate||0, gstPct:+it.gstPct||0, note: it.note|| (isReturn?'RETURN':'')
          });
        }

        // 3) adjust inventory with strict non-negative guard
        for(const it of items){
          const nameKey=(it.name||'').toLowerCase();
          // find the exact batch
          const batchRec = await db.inventory.where({ name: it.name, batch: it.batch }).first()
            || await db.inventory.where('name').equals(it.name).first(); // fallback if batch-less
          if(batchRec){
            const delta = isReturn ? Math.abs(+it.qty||0) : -Math.abs(+it.qty||0);
            const nextQty = (+batchRec.qty||0) + delta;
            if(nextQty < 0) throw new Error(`Stock would go negative for ${it.name} (${it.batch||'-'}).`);
            await db.inventory.update(batchRec.id, { qty: nextQty });
          }
        }

        // 4) audit
        await db.invoiceAudit?.add?.({ ts: invoice.ts, kind: isReturn?'sale.return':'sale.create', invoiceId, meta:{sourceRxId: invoice.sourceRxId||null, returnOfInvoiceId: invoice.returnOfInvoiceId||null} }).catch(()=>{});

        return invoiceId;
      });

    return invId;
  },

  /* ---------------- Bookings: token helpers ---------------- */
  // channel: 'walkin'|'online'|'whatsapp'
  tokenPrefix(channel){ return channel==='online' ? '#O' : channel==='whatsapp' ? '#W' : '#'; },

  async nextToken(db, date, channel){
    const pref = this.tokenPrefix(channel);
    const list = await db.bookings
      .where('date').equals(date)
      .toArray().catch(()=>[]);
    const nums = list
      .filter(b=>(b.token||'').startsWith(pref))
      .map(b=> parseInt(String(b.token||'').replace(/[^\d]/g,''), 10) || 0);
    const max = nums.length ? Math.max(...nums) : 0;
    const next = (max+1).toString().padStart(2,'0');
    return `${pref}${next}`;
  },

  // Audit + fix duplicates for a given day (runs for all days if no date)
  async auditTokens(db, dateOpt=null){
    const all = await db.bookings.toArray().catch(()=>[]);
    const byDay = new Map();
    all.forEach(b=>{
      const day = b.date || (b.ts ? new Date(b.ts).toISOString().slice(0,10) : ''); // fallback
      if(!day) return;
      if(dateOpt && day!==dateOpt) return;
      if(!byDay.has(day)) byDay.set(day, []);
      byDay.get(day).push(b);
    });

    let fixed=0;
    for(const [day, arr] of byDay){
      // split by channel
      const groups = {
        '#': [], '#O': [], '#W': []
      };
      arr.forEach(b=>{
        const t = String(b.token||'');
        if(t.startsWith('#O')) groups['#O'].push(b);
        else if(t.startsWith('#W')) groups['#W'].push(b);
        else groups['#'].push(b);
      });
      // sort by ts (first-come-first-serve)
      Object.values(groups).forEach(g=>g.sort((a,b)=>(a.ts||0)-(b.ts||0)));

      // reassign sequential tokens
      for(const key of ['#','#O','#W']){
        const prefix = key;
        for(let i=0;i<groups[key].length;i++){
          const want = `${prefix}${String(i+1).padStart(2,'0')}`;
          if(groups[key][i].token !== want){
            await db.bookings.update(groups[key][i].id, { token: want });
            fixed++;
          }
        }
      }
    }
    return fixed;
  }
};