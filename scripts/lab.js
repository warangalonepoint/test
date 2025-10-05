// /scripts/lab.js

/*
  Lab core:
  - Load/search tests from data/lab_services.json
  - Create lab orders in db.labQueue
  - Bill & mark paid (printable)
*/
import { db } from './db.js';
import { uid, fmt } from './utils.js';

let _catalog = null;

export async function loadCatalog() {
  if (_catalog) return _catalog;
  // Use relative path so it works when not served at domain root
  const res = await fetch('./data/lab_services.json', { cache: 'no-store' });
  _catalog = await res.json();
  // normalize {code,name,price}
  return _catalog.map(x => ({
    code: String(x.code || '').trim() || String(x.name || '').trim(),
    name: x.name || String(x.code || '').trim(),
    price: +x.price || 0
  }));
}

export async function searchTests(q) {
  const list = await loadCatalog();
  if (!q) return list;
  const s = q.toLowerCase();
  return list.filter(t =>
    (t.code || '').toLowerCase().includes(s) ||
    (t.name || '').toLowerCase().includes(s)
  );
}

/** Create a new lab order */
export async function createLabOrder({ patientId, patientName, patientPhone, tests, doctor, date = null }) {
  if (!patientId) throw new Error('patientId required');
  if (!Array.isArray(tests) || tests.length === 0) throw new Error('at least one test required');

  const total = tests.reduce((a, b) => a + (+b.price || 0), 0);
  const order = {
    orderNo: uid('LAB'),
    date: date || fmt.date(),
    patientId,
    patientName: patientName || '',
    patientPhone: patientPhone || '',
    doctor: doctor || '',
    tests,
    total,
    paid: 0,
    due: total,
    status: 'pending' // pending -> billed
  };
  const id = await db.labQueue.add(order);
  return await db.labQueue.get(id);
}

export async function addPayment(orderId, amount) {
  const row = await db.labQueue.get(Number(orderId));
  if (!row) throw new Error('Order not found');
  const paid = (+row.paid || 0) + (+amount || 0);
  const due = Math.max(0, (+row.total || 0) - paid);
  const status = due <= 0 ? 'billed' : row.status;
  await db.labQueue.update(Number(orderId), { paid, due, status });
  return await db.labQueue.get(Number(orderId));
}

export async function loadOrder(orderId) {
  const order = await db.labQueue.get(Number(orderId));
  return order;
}

export async function listOrders({ q = '', status = '' } = {}) {
  // Reverse by id to get most-recent-first (Dexie pattern)
  const rows = await db.labQueue.orderBy('id').reverse().toArray().catch(() => []);
  let r = rows;
  if (status) r = r.filter(x => x.status === status);
  if (q) {
    const s = q.toLowerCase();
    r = r.filter(x =>
      (x.orderNo || '').toLowerCase().includes(s) ||
      (x.patientName || '').toLowerCase().includes(s) ||
      (x.patientPhone || '').toLowerCase().includes(s)
    );
  }
  return r;
}

export function printLabBill(id) {
  // Relative path so it works from subdirs
  location.href = `./print/lab-bill.html?id=${id}`;
}