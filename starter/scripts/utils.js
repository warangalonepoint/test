export const fmt={
  date(d=new Date()){const x=new Date(d);return x.toISOString().slice(0,10);},
  time(d=new Date()){return new Date(d).toTimeString().slice(0,5);},
  dt(d=new Date()){return `${fmt.date(d)} ${fmt.time(d)}`;}
}
export function uid(prefix='ID'){return `${prefix}-${Math.random().toString(36).slice(2,8)}-${Date.now().toString(36)}`;}
export function todayKey(){return new Date().toISOString().slice(0,10);}
export function sum(arr,k){return arr.reduce((a,b)=>a+(+b[k]||0),0);}
export function money(n){return (Number(n)||0).toFixed(2);}
