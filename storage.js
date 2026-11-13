import {validRules,validIsoDate} from './ledger.js';
let db;
export async function openStore(){db=await new Promise((resolve,reject)=>{const r=indexedDB.open('workers-ledger',1);r.onupgradeneeded=()=>r.result.createObjectStore('ledger');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
export async function read(){return new Promise((resolve,reject)=>{const r=db.transaction('ledger').objectStore('ledger').get('state');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
export async function write(state){return new Promise((resolve,reject)=>{const tx=db.transaction('ledger','readwrite'),store=tx.objectStore('ledger'),r=store.get('state');let conflict=false;r.onsuccess=()=>{if((r.result?.revision??0)!==(state.revision??0)){conflict=true;tx.abort();return;}store.put({...state,revision:(state.revision??0)+1},'state');};tx.oncomplete=()=>{state.revision=(state.revision??0)+1;resolve();};tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(conflict?Error('conflict'):tx.error);});}
export function valid(s){
  if(s?.version!==1||!validLedger(s,false))return false;
  const settings=s.settings;
  return !!settings&&['ar','tr','en'].includes(settings.lang)&&['light','dark','system'].includes(settings.theme)
    &&Number.isInteger(settings.retention)&&settings.retention>=0&&typeof settings.autoDelete==='boolean'
    &&(settings.monthlyRules===undefined||validRules(settings.monthlyRules)&&Number.isInteger(settings.monthlyRules.days)&&settings.monthlyRules.days<=31)
    &&(settings.weeklyRules===undefined||validRules(settings.weeklyRules)&&settings.weeklyRules.days<=7)
    &&(s.weekly===undefined||validLedger(s.weekly,true));
}
function validPeriod(period,weekly){
  const keyPattern=weekly?/^\d{4}-\d{2}-\d{2}$/:/^\d{4}-(0[1-9]|1[0-2])$/;
  return !!period&&keyPattern.test(period.key)&&(!weekly||validIsoDate(period.key))
    &&period.salaries&&typeof period.salaries==='object'&&!Array.isArray(period.salaries)&&Object.values(period.salaries).every(x=>Number.isFinite(x)&&x>=0)
    &&(period.rules===undefined||validRules(period.rules)&&(weekly?period.rules.days<=7:Number.isInteger(period.rules.days)&&period.rules.days<=31))
    &&Array.isArray(period.entries)&&period.entries.every(tx)
    &&(period.workerIds===undefined||Array.isArray(period.workerIds)&&period.workerIds.every(id=>typeof id==='string'))
    &&(period.paidTotals===undefined||period.paidTotals&&typeof period.paidTotals==='object'&&!Array.isArray(period.paidTotals)&&Object.values(period.paidTotals).every(x=>Number.isFinite(x)&&x>=0));
}
function validLedger(s,weekly){
  return !!s&&Array.isArray(s.workers)&&s.workers.every(w=>w&&typeof w.id==='string'&&typeof w.name==='string'&&Number.isFinite(w.salary)&&w.salary>=0)
    &&validPeriod(s.month,weekly)&&Array.isArray(s.debts)&&s.debts.every(tx)
    &&(s.openPeriods===undefined||s.openPeriods&&typeof s.openPeriods==='object'&&!Array.isArray(s.openPeriods)&&Object.entries(s.openPeriods).every(([key,period])=>key===period.key&&key!==s.month.key&&validPeriod(period,weekly)))
    &&Array.isArray(s.archives)&&s.archives.every(a=>a&&(a.rules===undefined||validRules(a.rules))&&typeof a.key==='string'&&Number.isFinite(Date.parse(a.closedAt))&&Array.isArray(a.workers)&&a.workers.every(w=>w&&typeof w.name==='string'&&Number.isFinite(w.payable))&&Array.isArray(a.entries)&&a.entries.every(tx));
}
function tx(x){return x&&typeof x.id==='string'&&typeof x.workerId==='string'&&['opening','absence','late','overtime','extra','advance','convert','deduct','cash','deficit'].includes(x.type)&&Number.isFinite(x.value)&&x.value>0&&typeof x.date==='string';}
