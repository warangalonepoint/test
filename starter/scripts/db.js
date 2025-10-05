// /scripts/db.js
// Dexie schema + upgrades (v3) for Clinic PWA
// - invoices: ensure `type` exists (sale|purchase|return|combined)
// - invoiceItems: ensure hsn, pack, discount, sgst, cgst, batch, expiry
// - inventory: include hsn, pack
// - provides seed(), nextToken(), ensurePatient()

import { uid } from './utils.js';

export const db = new Dexie('clinic_pwa_v1');

/**
 * v1 — original scaffold
 */
db.version(1).stores({
  settings: 'key',
  users: 'role',
  patients: 'id, name, phone',
  bookings: '++id, date, type, token, patientId, name, phone, status',
  OPD: '++id, patientId, date, doctor',
  // had `type` already for some users, but keep v3 upgrade to be safe
  invoices: '++id, type, number, date, patientId, total, tax, grand',
  invoiceItems: '++id, invoiceId, sku, name, qty, mrp, rate, sgst, cgst, taxRate, amount',
  inventory: 'sku, name, batch, expiry, mrp, rate, stock',
  pharmacyItems: '++id',
  rxQueue: '++id, patientId, status',
  labQueue: '++id, patientId, status',
  invoiceAudit: '++id, invoiceId, action, at'
});

/**
 * v2 — added fields:
 * invoiceItems: batch, expiry, hsn, pack, discount
 * inventory: hsn, pack
 */
db.version(2).stores({
  settings: 'key',
  users: 'role',
  patients: 'id, name, phone',
  bookings: '++id, date, type, token, patientId, name, phone, status',
  OPD: '++id, patientId, date, doctor',
  invoices: '++id, type, number, date, patientId, total, tax, grand',
  invoiceItems:
    '++id, invoiceId, sku, name, qty, mrp, rate, taxRate, sgst, cgst, discount, amount, batch, expiry, hsn, pack',
  inventory: 'sku, name, batch, expiry, mrp, rate, stock, hsn, pack',
  pharmacyItems: '++id',
  rxQueue: '++id, patientId, status',
  labQueue: '++id, patientId, status',
  invoiceAudit: '++id, invoiceId, action, at'
}).upgrade(async tx => {
  // backfill newly added fields on v2
  const items = await tx.table('invoiceItems').toArray();
  for (const it of items) {
    it.batch ??= '';
    it.expiry ??= '';
    it.hsn ??= '';
    it.pack ??= '';
    it.discount ??= 0;
    await tx.table('invoiceItems').put(it);
  }
  const inv = await tx.table('inventory').toArray();
  for (const r of inv) {
    r.hsn ??= '';
    r.pack ??= '';
    await tx.table('inventory').put(r);
  }
});

/**
 * v3 — normalize + auto-tag + recompute:
 * - Ensure invoice.type exists; default 'sale' for legacy
 * - Ensure invoiceItems.sgst/cgst exist (recompute from taxRate, rate, qty, discount)
 * - Recompute invoice totals (total, tax, grand)
 */
db.version(3).stores({
  settings: 'key',
  users: 'role',
  patients: 'id, name, phone',
  bookings: '++id, date, type, token, patientId, name, phone, status',
  OPD: '++id, patientId, date, doctor',
  // keep `type` indexed for easy filtering in GST page
  invoices: '++id, type, number, date, patientId, total, tax, grand',
  invoiceItems:
    '++id, invoiceId, sku, name, qty, mrp, rate, taxRate, sgst, cgst, discount, amount, batch, expiry, hsn, pack',
  inventory: 'sku, name, batch, expiry, mrp, rate, stock, hsn, pack',
  pharmacyItems: '++id',
  rxQueue: '++id, patientId, status',
  labQueue: '++id, patientId, status',
  invoiceAudit: '++id, invoiceId, action, at'
}).upgrade(async tx => {
  const invoicesTbl = tx.table('invoices');
  const itemsTbl = tx.table('invoiceItems');

  const invoices = await invoicesTbl.toArray();

  // Helper to recompute invoice totals
  async function recomputeInvoice(invId) {
    const its = await itemsTbl.where('invoiceId').equals(invId).toArray();
    const taxable = its.reduce((a, b) => {
      const rate = Number(b.rate) || 0;
      const qty = Number(b.qty) || 0;
      const disc = Number(b.discount) || 0;
      return a + rate * qty * (1 - disc / 100);
    }, 0);
    const tax = its.reduce((a, b) => a + (Number(b.sgst) || 0) + (Number(b.cgst) || 0), 0);
    const grand = its.reduce((a, b) => a + (Number(b.amount) || 0), 0);
    await invoicesTbl.update(invId, { total: taxable, tax, grand });
  }

  // Upgrade each invoice
  for (const inv of invoices) {
    // 1) Ensure type
    if (!inv.type) {
      inv.type = 'sale'; // default legacy invoices to 'sale'
      await invoicesTbl.put(inv);
    }

    // 2) Backfill/normalize items under this invoice
    const its = await itemsTbl.where('invoiceId').equals(inv.id).toArray();
    let changed = false;

    for (const it of its) {
      // Defaults
      it.discount = Number(it.discount ?? 0);
      it.taxRate = Number(it.taxRate ?? 0);
      it.rate = Number(it.rate ?? 0);
      it.qty = Number(it.qty ?? 0);
      it.sgst = Number(it.sgst ?? 0);
      it.cgst = Number(it.cgst ?? 0);
      it.mrp = Number(it.mrp ?? 0);
      it.batch ??= '';
      it.expiry ??= '';
      it.hsn ??= '';
      it.pack ??= '';

      // If sgst/cgst are zero but rate+qty available, recompute from taxRate & discount
      const taxable = it.rate * it.qty * (1 - it.discount / 100);
      if ((it.sgst === 0 && it.cgst === 0) && it.taxRate > 0 && taxable > 0) {
        const totalTax = (it.taxRate / 100) * taxable;
        it.sgst = totalTax / 2;
        it.cgst = totalTax / 2;
        it.amount = taxable + totalTax;
        changed = true;
      } else if (!it.amount || it.amount === 0) {
        // If amount missing, derive it
        it.amount = taxable + it.sgst + it.cgst;
        changed = true;
      }

      if (changed) {
        await itemsTbl.put(it);
        changed = false;
      }
    }

    // 3) Recompute invoice totals
    await recomputeInvoice(inv.id);
  }
});

// ---------- helpers / seeds ----------

export async function seed() {
  const hasUsers = await db.users.count();
  if (!hasUsers) {
    await db.users.bulkPut([
      { role: 'doctor', pin: '1111' },
      { role: 'supervisor', pin: '2222' },
      { role: 'front', pin: '3333' }
    ]);
  }
  const theme = await db.settings.get('theme');
  if (!theme) await db.settings.put({ key: 'theme', value: 'light' });
}

/**
 * Booking token generator
 * type: 'walkin' | 'online' | 'whatsapp'
 * Tokens: #01 (walkin), #O01 (online), #W01 (whatsapp)
 */
export async function nextToken(type = 'walkin', dateKey = null) {
  const dkey = dateKey || new Date().toISOString().slice(0, 10);
  const prefix = type === 'online' ? '#O' : type === 'whatsapp' ? '#W' : '#';
  const rows = await db.bookings.where('date').equals(dkey).toArray();
  const n = rows.filter(r => r.type === type).length + 1;
  return `${prefix}${String(n).padStart(2, '0')}`;
}

/**
 * Ensure a patient exists (returns patientId)
 */
export async function ensurePatient({ name, phone }) {
  if (!name) name = 'Unknown';
  let found = null;
  if (phone) {
    found = await db.patients.where({ phone }).first();
  }
  if (found) return found.id;
  const id = uid('PAT');
  await db.patients.put({ id, name, phone });
  return id;
}