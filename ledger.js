export const DEFAULT_MONTHLY_RULES=Object.freeze({days:30,hoursPerDay:10,overtimeMultiplier:1.5});
export const DEFAULT_WEEKLY_RULES=Object.freeze({days:6,hoursPerDay:10,overtimeMultiplier:1.5});
export function validRules(rules){
  return !!rules&&Number.isFinite(rules.days)&&rules.days>0&&rules.days<=366
    &&Number.isFinite(rules.hoursPerDay)&&rules.hoursPerDay>0&&rules.hoursPerDay<=24
    &&Number.isFinite(rules.overtimeMultiplier)&&rules.overtimeMultiplier>=0&&rules.overtimeMultiplier<=100;
}
export function periodRules(period){
  const rules=period?.rules??(period?.kind==='weekly'?DEFAULT_WEEKLY_RULES:DEFAULT_MONTHLY_RULES);
  if(!validRules(rules))throw Error('rules');
  return {...rules};
}
export function payRates(salary,rules=DEFAULT_MONTHLY_RULES){
  if(!validRules(rules))throw Error('rules');
  const daily=salary/rules.days,hourly=daily/rules.hoursPerDay;
  return {daily,hourly,overtime:hourly*rules.overtimeMultiplier};
}
export function setMonthlyRules(state,rules,applyCurrent=false){
  if(!validRules(rules)||!Number.isInteger(rules.days)||rules.days>31)throw Error('rules');
  const next=structuredClone(state);
  next.settings.monthlyRules={...rules};
  if(applyCurrent)next.month.rules={...rules};
  return next;
}
export const round=n=>Math.round((n+Number.EPSILON)*100)/100;
export function periodWorkers(state){return state.month.workerIds?state.workers.filter(w=>state.month.workerIds.includes(w.id)):state.workers;}
export function totals(worker,month){const tx=month.entries.filter(x=>x.workerId===worker.id);const sum=k=>tx.filter(x=>x.type===k).reduce((a,x)=>a+x.value,0);const salary=month.salaries[worker.id]??worker.salary;const rates=payRates(salary,periodRules(month));const absence=round(sum('absence')*rates.daily),late=round(sum('late')*rates.hourly),overtime=round(sum('overtime')*rates.overtime);const advances=round(sum('advance')-sum('convert'));const deduction=round(sum('deduct'));const net=round(salary+overtime-absence-late-advances-deduction);const unpaid=round(net-(month.paidTotals?.[worker.id]??0));return {salary,absence,late,overtime,advances,deduction,net,payable:Math.max(0,unpaid),deficit:Math.max(0,-unpaid),...(month.paidTotals?{previousPaid:month.paidTotals[worker.id]??0}:{})};}
export function debt(state,id){return round(state.debts.filter(x=>x.workerId===id).reduce((a,x)=>a+(x.type==='opening'||x.type==='convert'||x.type==='deficit'?x.value:-x.value),0));}
export function addEntry(state,entry){const worker=state.workers.find(x=>x.id===entry.workerId);if(!worker)throw Error('worker');if(!Number.isFinite(entry.value)||entry.value<=0)throw Error('positive');if(entry.type==='absence'&&state.month.kind!=='weekly'&&!Number.isInteger(entry.value))throw Error('integer');if(!['absence','late','overtime','advance','convert','deduct','cash'].includes(entry.type))throw Error('type');if((entry.type==='deduct'||entry.type==='cash')&&entry.value>debt(state,worker.id))throw Error('debt');if(entry.type==='deduct'&&entry.value>totals(worker,state.month).payable)throw Error('funds');if(entry.type==='convert'){const source=state.month.entries.find(x=>x.id===entry.sourceId&&x.type==='advance'&&x.workerId===entry.workerId);const converted=state.month.entries.filter(x=>x.sourceId===entry.sourceId&&x.type==='convert').reduce((a,x)=>a+x.value,0);if(!source||entry.value>round(source.value-converted))throw Error('advance');}if(entry.type!=='cash')state.month.entries.push(entry);if(['cash','deduct','convert'].includes(entry.type))state.debts.push({...entry,month:state.month.key});return state;}
export function addCalendarDays(iso,days){const d=new Date(iso+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);}
export function weekStart(iso){const d=new Date(iso+'T00:00:00Z');return addCalendarDays(iso,-((d.getUTCDay()+6)%7));}
export function createWeeklyLedger(iso,rules=DEFAULT_WEEKLY_RULES){return {workers:[],month:{kind:'weekly',key:weekStart(iso),rules:{...rules},entries:[],salaries:{}},debts:[],archives:[]};}
export function validIsoDate(iso){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(iso))return false;
  const d=new Date(iso+'T00:00:00Z');return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===iso;
}
export function calendarMonthBounds(key){
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(key))throw Error('date');
  const start=key+'-01';const d=new Date(start+'T00:00:00Z');d.setUTCMonth(d.getUTCMonth()+1);d.setUTCDate(0);
  return {start,end:d.toISOString().slice(0,10),days:d.getUTCDate()};
}
export function dateInPeriod(period,date){
  if(!validIsoDate(date))return false;
  if(period.kind==='weekly')return date>=period.key&&date<=addCalendarDays(period.key,6);
  const bounds=calendarMonthBounds(period.key);return date>=bounds.start&&date<=bounds.end;
}
export function setWeeklyRules(state,rules,applyCurrent=false){
  if(!validRules(rules)||rules.days>7)throw Error('rules');
  const next=structuredClone(state);next.settings.weeklyRules={...rules};
  if(applyCurrent)next.weekly.month.rules={...rules};return next;
}
function closePeriod(state,kind,now){
  const snapshot=structuredClone(state.month);snapshot.kind=kind;snapshot.id=crypto.randomUUID();snapshot.rules=periodRules(state.month);snapshot.closedAt=now;
  snapshot.debtEntries=structuredClone(state.debts.filter(x=>x.month===snapshot.key));
  snapshot.workers=periodWorkers(state).map(w=>({...w,...totals(w,state.month),debtBefore:debt(state,w.id),paidTotal:round((state.month.paidTotals?.[w.id]??0)+totals(w,state.month).payable)}));
  for(const w of snapshot.workers)if(w.deficit)state.debts.push({id:crypto.randomUUID(),workerId:w.id,type:'deficit',value:w.deficit,date:now.slice(0,10),month:snapshot.key,archiveId:snapshot.id,note:''});
  for(const w of snapshot.workers)w.debtAfter=debt(state,w.id);
  state.archives.unshift(snapshot);
  let key=nextPeriodKey(kind,snapshot.key);
  while(state.archives.some(a=>a.key===key))key=nextPeriodKey(kind,key);
  state.openPeriods??={};
  state.month=state.openPeriods[key]??newPeriod(state,key,kind);
  delete state.openPeriods[key];
  return state;
}
export function closeMonth(state,now=new Date().toISOString()){return closePeriod(state,'monthly',now);}
export function closeWeek(state,now=new Date().toISOString()){return closePeriod(state,'weekly',now);}
export function cleanup(state,now=Date.now()){if(state.settings.autoDelete&&state.settings.retention>0){state.archives=state.archives.filter(x=>now-Date.parse(x.closedAt)<state.settings.retention*86400000);if(state.weekly)state.weekly.archives=state.weekly.archives.filter(x=>now-Date.parse(x.closedAt)<state.settings.retention*86400000);}return state;}

export function removeEntry(state,id){const entry=state.month.entries.find(x=>x.id===id)??state.debts.find(x=>x.id===id&&x.type==='cash'&&x.month===state.month.key);if(!entry)throw Error('entry');if(state.month.entries.some(x=>x.sourceId===id))throw Error('linked');const next=structuredClone(state);next.month.entries=next.month.entries.filter(x=>x.id!==id);next.debts=next.debts.filter(x=>x.id!==id);if(debt(next,entry.workerId)<0)throw Error('linked');const w=next.workers.find(x=>x.id===entry.workerId),s=totals(w,next.month);if(s.deduction>Math.max(0,round(s.net+s.deduction)))throw Error('funds');return next;}

// UI durations use H.MM (minutes), while saved values remain hours for compatibility.
export function parseWorkDuration(input) {
  let text=String(input).trim()
    .replace(/[٠-٩]/g,c=>String(c.charCodeAt(0)-0x660))
    .replace(/[۰-۹]/g,c=>String(c.charCodeAt(0)-0x6f0))
    .replace(/[٫،,]/g,'.');
  if (/^[.:]/.test(text)) text='0'+text;
  const match=/^(\d+)(?:[.:](\d{2}))?$/.exec(text);
  if (!match) throw Error('duration');
  const hours=Number(match[1]),minutes=Number(match[2]??0);
  const total=hours*60+minutes;
  if (minutes>=60||!Number.isSafeInteger(total)||total<=0) throw Error('duration');
  return total/60;
}
export function workDurationParts(hours) {
  const minutes=Math.round(hours*60);
  return {hours:Math.floor(minutes/60),minutes:minutes%60};
}

export function removeWorker(state,id){
  if(!state.workers.some(w=>w.id===id))throw Error('worker');
  const next=structuredClone(state);
  next.workers=next.workers.filter(w=>w.id!==id);
  next.month.entries=next.month.entries.filter(e=>e.workerId!==id);
  delete next.month.salaries[id];
  next.debts=next.debts.filter(e=>e.workerId!==id);
  if(next.month.workerIds)next.month.workerIds=next.month.workerIds.filter(value=>value!==id);
  if(next.month.paidTotals)delete next.month.paidTotals[id];
  for(const period of Object.values(next.openPeriods??{})){period.entries=period.entries.filter(e=>e.workerId!==id);delete period.salaries[id];if(period.workerIds)period.workerIds=period.workerIds.filter(value=>value!==id);if(period.paidTotals)delete period.paidTotals[id];}
  // Closed months are independent snapshots and must remain unchanged.
  return next;
}

export function nextPeriodKey(kind,key){
  if(kind==='weekly')return addCalendarDays(key,7);
  const [y,m]=key.split('-').map(Number);return `${m===12?y+1:y}-${String(m===12?1:m+1).padStart(2,'0')}`;
}
export function newPeriod(state,key,kind){
  return {kind,key,rules:{...(kind==='weekly'?(state.settings.weeklyRules??DEFAULT_WEEKLY_RULES):(state.settings.monthlyRules??DEFAULT_MONTHLY_RULES))},entries:[],workerIds:state.workers.map(w=>w.id),salaries:Object.fromEntries(state.workers.map(w=>[w.id,w.salary]))};
}
export function selectPeriod(state,key,{reopen=false,undoPaid=false}={}){
  const kind=state.month.kind==='weekly'?'weekly':'monthly';
  if(kind==='weekly'?!validIsoDate(key):!/^\d{4}-(0[1-9]|1[0-2])$/.test(key))throw Error('date');
  if(key===state.month.key){const same=structuredClone(state);if(undoPaid&&same.month.paidTotals){same.month.paidTotals=Object.fromEntries(Object.keys(same.month.paidTotals).map(id=>[id,0]));same.month.paymentCorrection={reason:'accidental-close-no-payment',at:new Date().toISOString()};}return same;}
  const next=structuredClone(state);next.openPeriods??={};
  const index=next.archives.findIndex(a=>a.key===key);
  let target;
  if(index>=0){
    if(!reopen)throw Error('closed-period');
    const snapshot=next.archives[index];
    if(snapshot.workers.some(w=>!next.workers.some(current=>current.id===w.id)))throw Error('missing-period-worker');
    const reversals=next.debts.filter(e=>e.type==='deficit'&&(snapshot.id?e.archiveId===snapshot.id:e.month===key&&snapshot.workers.some(w=>w.id===e.workerId&&w.deficit===e.value)));
    for(const worker of snapshot.workers){const reversed=round(reversals.filter(e=>e.workerId===worker.id).reduce((sum,e)=>sum+e.value,0));if(reversed>debt(next,worker.id))throw Error('settled-period-debt');}
    const ids=new Set(reversals.map(e=>e.id));next.debts=next.debts.filter(e=>!ids.has(e.id));
    target={kind,key,rules:periodRules(snapshot),entries:structuredClone(snapshot.entries),salaries:{...snapshot.salaries},workerIds:snapshot.workers.map(w=>w.id),paidTotals:Object.fromEntries(snapshot.workers.map(w=>[w.id,undoPaid?0:(w.paidTotal??w.payable)]))};
    for(const w of snapshot.workers)target.salaries[w.id]??=w.salary;
    if(undoPaid)target.paymentCorrection={reason:'accidental-close-no-payment',at:new Date().toISOString()};
    const historical=structuredClone(snapshot);historical.closingDebtEntries=structuredClone(reversals);delete historical.settlementHistory;target.settlementHistory=[...(snapshot.settlementHistory??[]),historical];
    next.archives.splice(index,1);
  }else target=next.openPeriods[key]??newPeriod(next,key,kind);
  next.openPeriods[next.month.key]=next.month;
  next.month=target;delete next.openPeriods[key];return next;
}

export function updateEntry(state,id,changes){
 const original=state.month.entries.find(e=>e.id===id)??state.debts.find(e=>e.id===id&&e.type==='cash'&&e.month===state.month.key);
 if(!original)throw Error('entry');
 const entry={...original,value:changes.value,date:changes.date,note:String(changes.note??'')};
 if(!validIsoDate(entry.date)||!dateInPeriod(state.month,entry.date))throw Error('date-period');
 const next=structuredClone(state),index=next.month.entries.findIndex(e=>e.id===id),debtIndex=next.debts.findIndex(e=>e.id===id);
 next.month.entries=next.month.entries.filter(e=>e.id!==id);next.debts=next.debts.filter(e=>e.id!==id);
 const converted=next.month.entries.filter(e=>e.type==='convert'&&e.sourceId===id).reduce((sum,e)=>sum+e.value,0);
 if(entry.type==='advance'&&entry.value<round(converted))throw Error('linked');
 addEntry(next,entry);
 if(debt(next,entry.workerId)<0)throw Error('linked');
 const summary=totals(next.workers.find(w=>w.id===entry.workerId),next.month);
 if(summary.deduction>Math.max(0,round(summary.net+summary.deduction)))throw Error('funds');
 if(index>=0){const saved=next.month.entries.pop();next.month.entries.splice(index,0,saved);}
 if(debtIndex>=0){const saved=next.debts.pop();next.debts.splice(debtIndex,0,saved);}
 return next;
}
