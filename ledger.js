export const round=n=>Math.round((n+Number.EPSILON)*100)/100;
export function totals(worker,month){const tx=month.entries.filter(x=>x.workerId===worker.id);const sum=k=>tx.filter(x=>x.type===k).reduce((a,x)=>a+x.value,0);const salary=month.salaries[worker.id]??worker.salary;const absence=round(sum('absence')*salary/30),late=round(sum('late')*salary/300),overtime=round(sum('overtime')*salary/300*1.5);const advances=round(sum('advance')-sum('convert'));const deduction=round(sum('deduct'));const net=round(salary+overtime-absence-late-advances-deduction);return {salary,absence,late,overtime,advances,deduction,net,payable:Math.max(0,net),deficit:Math.max(0,-net)};}
export function debt(state,id){return round(state.debts.filter(x=>x.workerId===id).reduce((a,x)=>a+(x.type==='opening'||x.type==='convert'||x.type==='deficit'?x.value:-x.value),0));}
export function addEntry(state,entry){const worker=state.workers.find(x=>x.id===entry.workerId);if(!worker)throw Error('worker');if(!Number.isFinite(entry.value)||entry.value<=0)throw Error('positive');if(entry.type==='absence'&&!Number.isInteger(entry.value))throw Error('integer');if(!['absence','late','overtime','advance','convert','deduct','cash'].includes(entry.type))throw Error('type');if((entry.type==='deduct'||entry.type==='cash')&&entry.value>debt(state,worker.id))throw Error('debt');if(entry.type==='deduct'&&entry.value>Math.max(0,totals(worker,state.month).net))throw Error('funds');if(entry.type==='convert'){const source=state.month.entries.find(x=>x.id===entry.sourceId&&x.type==='advance'&&x.workerId===entry.workerId);const converted=state.month.entries.filter(x=>x.sourceId===entry.sourceId&&x.type==='convert').reduce((a,x)=>a+x.value,0);if(!source||entry.value>round(source.value-converted))throw Error('advance');}if(entry.type!=='cash')state.month.entries.push(entry);if(['cash','deduct','convert'].includes(entry.type))state.debts.push({...entry,month:state.month.key});return state;}
export function closeMonth(state,now=new Date().toISOString()){const snapshot=structuredClone(state.month);snapshot.closedAt=now;snapshot.debtEntries=structuredClone(state.debts.filter(x=>x.month===snapshot.key));snapshot.workers=state.workers.map(w=>({...w,...totals(w,state.month),debtBefore:debt(state,w.id)}));for(const w of snapshot.workers)if(w.deficit)state.debts.push({id:crypto.randomUUID(),workerId:w.id,type:'deficit',value:w.deficit,date:now.slice(0,10),month:snapshot.key,note:''});for(const w of snapshot.workers)w.debtAfter=debt(state,w.id);state.archives.unshift(snapshot);const [y,m]=snapshot.key.split('-').map(Number);state.month={key:`${m===12?y+1:y}-${String(m===12?1:m+1).padStart(2,'0')}`,entries:[],salaries:Object.fromEntries(state.workers.map(w=>[w.id,w.salary]))};return state;}
export function cleanup(state,now=Date.now()){if(state.settings.autoDelete&&state.settings.retention>0)state.archives=state.archives.filter(x=>now-Date.parse(x.closedAt)<state.settings.retention*86400000);return state;}

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
  // Closed months are independent snapshots and must remain unchanged.
  return next;
}
