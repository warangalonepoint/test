// scripts/rx.js
// Handles Pharmacy invoices: Sales, Purchases, Returns

import { db } from './db.js';

/**
 * Create a new invoice with type = sale | purchase | return
 * @param {string} type - 'sale' | 'purchase' | 'return'
 * @returns {Promise<Object>} invoice record
 */
export async function createInvoice(type = 'sale') {
  const prefix = type === 'sale' ? 'S'
                : type === 'purchase' ? 'P'
                : type === 'return' ? 'R'
                : 'X';

  const inv = {
    type, // important for GST report
    number: `${prefix}-${Date.now().toString(36)}`,
    date: new Date().toISOString().slice(0, 10),
    total: 0,
    tax: 0,
    grand: 0
  };

  const id = await db.invoices.add(inv);
  return await db.invoices.get(id);
}

/**
 * Add an item to invoice
 */
export async function addInvoiceItem(invoiceId, item) {
  // calculate line amount
  const rate = +item.rate || 0;
  const qty = +item.qty || 0;
  const discount = +item.discount || 0;
  const taxRate = +item.taxRate || 0;

  const taxable = rate * qty * (1 - discount / 100);
  const sgst = (taxRate / 2 / 100) * taxable;
  const cgst = (taxRate / 2 / 100) * taxable;
  const amount = taxable + sgst + cgst;

  const row = {
    invoiceId,
    sku: item.sku || '',
    name: item.name || '',
    pack: item.pack || '',
    batch: item.batch || '',
    expiry: item.expiry || '',
    hsn: item.hsn || '',
    qty,
    mrp: +item.mrp || 0,
    rate,
    discount,
    taxRate,
    sgst,
    cgst,
    amount
  };

  await db.invoiceItems.add(row);
  return row;
}

/**
 * Recompute invoice totals from its items
 */
export async function recomputeInvoice(invoiceId) {
  const items = await db.invoiceItems.where('invoiceId').equals(invoiceId).toArray();
  const taxable = items.reduce((a, b) => a + ((+b.rate || 0) * (+b.qty || 0) * (1 - (+b.discount || 0) / 100)), 0);
  const tax = items.reduce((a, b) => a + ((+b.sgst || 0) + (+b.cgst || 0)), 0);
  const grand = items.reduce((a, b) => a + (+b.amount || 0), 0);
  await db.invoices.update(invoiceId, { total: taxable, tax, grand });
  return await db.invoices.get(invoiceId);
}

/**
 * Load invoice + its items
 */
export async function loadInvoice(id) {
  const inv = await db.invoices.get(id);
  const items = await db.invoiceItems.where('invoiceId').equals(id).toArray();
  return { inv, items };
}

/**
 * Get list of invoices by type
 */
export async function listInvoices(type = 'sale') {
  if (type === 'all') return await db.invoices.toArray();
  return await db.invoices.where('type').equals(type).reverse().toArray();
}