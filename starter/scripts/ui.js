import { logout } from './auth.js';
export function mountNav(active=''){
  const el=document.querySelector('#nav'); if(!el) return;
  el.innerHTML=`
  <div class="nav"><div class="bar">
    <div><span class="badge">Clinic PWA</span></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <a class="btn ghost" href="/dashboard.html">Dashboard</a>
      <a class="btn ghost" href="/bookings.html">Bookings</a>
      <a class="btn ghost" href="/OPD.html">OPD</a>
      <a class="btn ghost" href="/pharmacy.html">Pharmacy</a>
      <a class="btn ghost" href="/lab.html">Lab</a>
      <a class="btn ghost" href="/backup.html">Backup</a>
      <button class="btn muted" id="logoutBtn">Logout</button>
    </div></div></div>`;
  setTimeout(()=>{ const out=document.getElementById('logoutBtn'); if(out) out.addEventListener('click',()=>logout()); },0);
}
export function registerSW(){ if('serviceWorker' in navigator){ navigator.serviceWorker.register('/public/service-worker.js'); } }
