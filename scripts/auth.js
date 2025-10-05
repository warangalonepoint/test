import { db } from './db.js';
export async function login(role,pin){
  const u=await db.users.get(role); if(!u) throw new Error('Role not found');
  if(u.pin!==pin) throw new Error('Invalid PIN');
  localStorage.setItem('sessionRole',role); return role;
}
export function currentRole(){return localStorage.getItem('sessionRole')||'';}
export function requireRole(roles=[]){const r=currentRole(); if(!roles.includes(r)){location.href='/login.html';}}
export async function setPin(role,pin){await db.users.put({role,pin});}
export function logout(){localStorage.removeItem('sessionRole'); location.href='/login.html';}
