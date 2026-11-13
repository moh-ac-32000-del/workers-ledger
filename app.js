import {initializeLock,lockSettings} from './lock.js';
import {createPortableTransferCode,parsePortableTransferCode,transferSummary,prepareRestore} from './transfer.js';
import {createReports} from './report.js';
import {totals,debt,addEntry,closeMonth,cleanup,round,removeEntry,updateEntry,parseWorkDuration,removeWorker,setWorkerSalary,periodRules,DEFAULT_MONTHLY_RULES,setMonthlyRules,workDurationParts,DEFAULT_WEEKLY_RULES,setWeeklyRules,createWeeklyLedger,closeWeek,dateInPeriod,addCalendarDays,calendarMonthBounds,selectPeriod,periodWorkers,weekStart,validIsoDate} from './ledger.js';
import {openStore,read,write,valid} from './storage.js';
import {translate} from './i18n.js';
const APP_VERSION='15';
const app=document.querySelector('#app'),dialog=document.querySelector('#dialog');
let newerVersionAvailable=false;
let payrollKind='monthly';
let state,page='calc',selected=null,installPrompt,reportContext=null,restoreDialogAfterPrint=false;
const openSettingsGroups=new Set();
const uuid=()=>crypto.randomUUID();
const date=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`};
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const weeklyKeys={month:'weeklyPeriod',close:'closeWeek',review:'reviewWeek',closeNote:'closeWeekNote',confirm:'confirmWeek',activity:'weeklyActivity',nextSalary:'nextWeeklySalary',deleteWorkerNote:'deleteWeeklyWorkerNote',salary:'weeklySalary',monthlyStatement:'weeklyStatement',empty:'emptyWeekly',days:'weeklyAbsenceDays'};
const t=k=>translate(payrollKind==='weekly'?(weeklyKeys[k]??k):k,state.settings.lang),num=n=>new Intl.NumberFormat(state.settings.lang,{maximumFractionDigits:2}).format(n),amount=n=>`<span class="amount">${num(n)}</span>`;
const btn=(text,action,cls='')=>`<button type="button" class="${cls}" data-action="${action}">${text}</button>`;
const field=(key,type='text',value='',extra='')=>`<label for="${key}">${t(key)}</label><input id="${key}" name="${key}" type="${type}" value="${esc(value)}" ${extra}>`;
const reports=createReports({t:k=>t(k),num:n=>num(n),esc,amount:n=>amount(n),btn:(...args)=>btn(...args)});
function activeLedger(root=state,kind=payrollKind){return kind==='weekly'?{...root.weekly,settings:root.settings}:root;}
function replaceLedger(root,updated,kind=payrollKind){
  const next=structuredClone(root),target=kind==='weekly'?next.weekly:next;
  for(const key of ['workers','month','debts','archives','openPeriods'])target[key]=updated[key];
  return next;
}
function normalizeState(root){
  root.settings.monthlyRules??={...DEFAULT_MONTHLY_RULES};root.settings.weeklyRules??={...DEFAULT_WEEKLY_RULES};
  root.month.rules??={...DEFAULT_MONTHLY_RULES};root.month.kind='monthly';root.openPeriods??={};
  root.weekly??=createWeeklyLedger(date(),root.settings.weeklyRules);root.weekly.month.kind='weekly';root.weekly.month.rules??={...DEFAULT_WEEKLY_RULES};root.weekly.openPeriods??={};
  return root;
}
function periodLabel(period=activeLedger().month){return period.kind==='weekly'?`${period.key} — ${addCalendarDays(period.key,6)}`:period.key;}
function payrollWorkers(){return periodWorkers(activeLedger());}
function keyForDate(iso){return payrollKind==='weekly'?weekStart(iso):iso.slice(0,7);}
function confirmPeriodChange(ledger,key,undoPaid=false){
  const closed=ledger.archives.some(a=>a.key===key);
  const message=undoPaid&&(closed||ledger.month.paidTotals)?t('undoPaidWarning'):closed?t('reopenPeriodWarning'):t('switchPeriodWarning');
  return confirm(message.replace('{target}',key).replace('{current}',ledger.month.key));
}
function periodPicker(){
  const weekly=payrollKind==='weekly';
  const ledger=activeLedger();const saved=[...new Set([ledger.month.key,...Object.keys(ledger.openPeriods??{}),...ledger.archives.map(a=>a.key)])].sort().reverse();
  modal(t('selectPeriod'),`<p class="settings-help">${t('periodPickerHelp')}</p><label for="saved-period">${t('savedPeriods')}</label><select id="saved-period"><option value="">${t('choosePeriodOrNew')}</option>${saved.map(key=>`<option value="${key}">${key} · ${t(ledger.archives.some(a=>a.key===key)?'closedPeriod':'openPeriodStatus')}</option>`).join('')}</select><label for="period-key">${t(weekly?'selectWeekDate':'selectMonth')}</label><input id="period-key" name="key" type="${weekly?'date':'month'}" required value="${weekly?date():date().slice(0,7)}"><label class="row"><span>${t('undoAccidentalPayment')}</span><input type="checkbox" name="undoPaid"></label><p class="settings-help">${t('undoPaymentHelp')}</p><div class="actions">${btn(t('cancel'),'dismiss')}<button class="primary" type="submit">${t('openPeriod')}</button></div>`,async f=>{
    const raw=String(f.get('key')),key=weekly?weekStart(raw):raw;
    const ledger=activeLedger();
    if((key!==ledger.month.key||f.has('undoPaid')&&ledger.month.paidTotals)&&!confirmPeriodChange(ledger,key,f.has('undoPaid')))return;
    const next=selectPeriod(ledger,key,{reopen:ledger.archives.some(a=>a.key===key),undoPaid:f.has('undoPaid')});
    await persist(replaceLedger(state,next));reportContext=null;dialog.close();toast(t('periodChanged'));
  });
  dialog.querySelector('#saved-period').onchange=e=>{if(e.target.value)dialog.querySelector('#period-key').value=e.target.value;};
}
function calendarInfo(){
  const iso=date();
  const monthName=new Intl.DateTimeFormat(state.settings.lang,{month:'long',year:'numeric',calendar:'gregory',timeZone:'UTC'}).format(new Date(iso.slice(0,7)+'-01T12:00:00Z'));
  return `${t('calendarNow')}: ${esc(monthName)} · <bdi>${iso}</bdi>`;
}
function accountingPeriodNote(){
  const period=activeLedger().month;
  if(period.kind==='weekly')return '';
  const bounds=calendarMonthBounds(period.key);
  const difference=date().slice(0,7)!==period.key;
  return `<p class="calendar-period-note">${t('calendarPeriod')}: <bdi>${bounds.start} — ${bounds.end}</bdi> (${num(bounds.days)} ${t('dayUnit')}). ${t('calendarDivisorNote')}${difference?`<br><strong>${t('differentOpenMonth')}</strong>`:''}</p>`;
}
function scopeTabs(){return `<div class="payroll-tabs" role="group" aria-label="${t('payrollType')}">${['monthly','weekly'].map(kind=>`<button type="button" data-action="scope:${kind}" aria-pressed="${payrollKind===kind}" class="${payrollKind===kind?'active':''}">${t(kind==='weekly'?'weeklyPayroll':'monthlyPayroll')}</button>`).join('')}</div>`;}
function toast(msg){const e=document.querySelector('#toast');e.textContent=msg;e.style.display='block';setTimeout(()=>e.style.display='none',3500);}
async function persist(next,{refresh=true}={}){normalizeState(next);try{await write(next);}catch(e){if(e.message==='conflict'){state=await read();render();toast(t('conflict'));}throw e;}state=next;if(refresh)render();else appearance();}
function appearance(theme=state.settings.theme){
  const root=document.documentElement;
  const dark=theme==='dark'||theme==='system'&&matchMedia('(prefers-color-scheme:dark)').matches;
  root.lang=state.settings.lang;
  root.dir=state.settings.lang==='ar'?'rtl':'ltr';
  root.dataset.theme=dark?'dark':'light';
  root.style.colorScheme=dark?'dark':'light';
  document.body.classList.toggle('dark',dark);
  document.querySelector('meta[name="theme-color"]').content=dark?'#0c1220':'#f3f6fc';
}
function modal(title,body,onSubmit){dialog.className='';dialog.innerHTML=`<form><div class="row dialog-heading"><h2>${esc(title)}</h2><button type="button" data-action="dismiss" aria-label="${t('cancel')}">×</button></div>${body}<p class="error" id="form-error" role="alert"></p></form>`;dialog.querySelector('form').onsubmit=async e=>{e.preventDefault();try{await onSubmit?.(new FormData(e.target));}catch(err){dialog.querySelector('#form-error').textContent=t(err.message==='duration'?'durationError':err.message==='advance-period'?'advancePeriodError':err.message==='date'?'dateError':err.message==='missing-period-worker'?'missingPeriodWorker':err.message==='settled-period-debt'?'settledPeriodDebt':['debt','funds'].includes(err.message)?'debtError':'invalid');}};dialog.showModal();dialog.scrollTop=0;}
function actions(){return `<div class="actions">${btn(t('cancel'),'dismiss')}<button class="primary" type="submit">${t('save')}</button></div>`;}
function render(){appearance();const pays=payrollWorkers().reduce((a,w)=>a+totals(w,activeLedger().month).payable,0),debts=payrollWorkers().reduce((a,w)=>a+debt(activeLedger(),w.id),0);app.innerHTML=`<div class="shell"><header><div class="brand"><div class="logo">▦</div><div><h1>${t('app')}</h1><small>${t('tag')}</small></div></div><div class="row">${installPrompt?btn(t('install'),'install'):''}${btn(esc(periodLabel())+' · '+t('selectPeriod'),'period-picker','pill period-picker')}${newerVersionAvailable?btn(t('updateReady'),'update-app','primary'):''}</div></header><div class="calendar-info">${calendarInfo()}</div>${(page==='calc'||page==='weekly')?`<div class="row"><div><h2>${t('month')}</h2><p>${t('choose')}</p>${accountingPeriodNote()}</div>${payrollWorkers().length?btn(t('close'),'close','primary'):''}</div><div class="grid dashboard-stats"><div class="card stat"><small>${t('workers')}</small><strong>${num(payrollWorkers().length)}</strong></div><div class="card stat"><small>${t('payable')}</small><strong>${amount(pays)}</strong></div><div class="card stat"><small>${t('debts')}</small><strong>${amount(debts)}</strong></div></div>${payrollWorkers().length?`<ul class="worker-list">${payrollWorkers().map(w=>`<li><button type="button" class="worker-row" data-action="worker:${w.id}"><span class="worker-avatar" aria-hidden="true">${esc(w.name[0])}</span><span class="worker-info"><strong class="worker-name">${esc(w.name)}</strong><span class="worker-finances"><span>${t('payable')}: <strong>${amount(totals(w,activeLedger().month).payable)}</strong></span><span>${t('debts')}: <strong>${amount(debt(activeLedger(),w.id))}</strong></span></span></span><span class="worker-chevron" aria-hidden="true"></span></button></li>`).join('')}</ul>`:`<div class="empty"><h2>${t('empty')}</h2>${btn(t('add'),'add','primary')}</div>`}`:page==='settings'?settings():archives()}</div><nav aria-label="${t('app')}">${['calc','weekly','archive','settings'].map(k=>btn(t(k),`page:${k}`,page===k?'active':'')).join('')}</nav>`;}
function monthlyRulesForm(){
  const rules=state.settings.monthlyRules??DEFAULT_MONTHLY_RULES;
  const hours=workDurationParts(rules.hoursPerDay);
  return `<details class="rule-panel" data-section="monthly-calculation" ${openSettingsGroups.has('monthly-calculation')?'open':''}><summary>${t('monthlyRules')}</summary><form id="monthly-rules" class="rules-form"><p class="settings-help">${t('rulesFormula')}</p><label for="monthly-days">${t('monthlyDays')}</label><input id="monthly-days" name="days" type="number" min="1" max="31" step="1" required value="${rules.days}"><label for="monthly-hours">${t('dailyHours')}</label><input id="monthly-hours" name="hours" type="text" inputmode="decimal" required dir="ltr" value="${hours.hours}.${String(hours.minutes).padStart(2,'0')}"><p class="theme-hint">${t('durationHelp')}</p><label for="monthly-overtime">${t('overtimeFactor')}</label><input id="monthly-overtime" name="overtime" type="number" min="0" max="100" step="0.01" required value="${rules.overtimeMultiplier}"><p class="settings-help">${t('rulesNextPeriod')}</p><label class="row"><span>${t('applyCurrentRules')}</span><input type="checkbox" name="applyCurrent"></label><div class="actions">${btn(t('restoreDefaultRules'),'default-rules','compact-button')}<button class="primary" type="submit">${t('save')}</button></div><p id="rules-error" class="error" role="alert"></p><div class="current-rules"><small>${t('currentMonthRules')}</small>${reports.ruleSummary(periodRules(state.month))}</div></form></details>`;
}
function weeklyRulesForm(){
  const rules=state.settings.weeklyRules??DEFAULT_WEEKLY_RULES,hours=workDurationParts(rules.hoursPerDay);
  return `<details class="rule-panel" data-section="weekly-calculation" ${openSettingsGroups.has('weekly-calculation')?'open':''}><summary>${t('weeklyRules')}</summary><form id="weekly-rules" class="rules-form"><p class="settings-help">${t('weeklyRulesFormula')}</p><label for="weekly-days">${t('weeklyDays')}</label><input id="weekly-days" name="days" type="number" min="0.01" max="7" step="any" required value="${rules.days}"><label for="weekly-hours">${t('dailyHours')}</label><input id="weekly-hours" name="hours" type="text" inputmode="decimal" required dir="ltr" value="${hours.hours}.${String(hours.minutes).padStart(2,'0')}"><p class="theme-hint">${t('durationHelp')}</p><label for="weekly-overtime">${t('overtimeFactor')}</label><input id="weekly-overtime" name="overtime" type="number" min="0" max="100" step="0.01" required value="${rules.overtimeMultiplier}"><p class="settings-help">${t('weeklyRulesNextPeriod')}</p><label class="row"><span>${t('applyCurrentWeeklyRules')}</span><input type="checkbox" name="applyCurrent"></label><div class="actions">${btn(t('restoreWeeklyDefaults'),'default-rules:weekly','compact-button')}<button class="primary" type="submit">${t('save')}</button></div><p id="weekly-rules-error" class="error" role="alert"></p><div class="current-rules"><small>${t('currentWeeklyRules')}</small>${reports.ruleSummary(periodRules(state.weekly.month))}</div></form></details>`;
}
function settings(){
  const icons={workers:'<circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6M18 15a5 5 0 0 1 3 5"/>',preferences:'<path d="M4 7h7m6 0h3M4 17h3m6 0h7"/><circle cx="14" cy="7" r="3"/><circle cx="10" cy="17" r="3"/>',backup:'<path d="M7 15V3m-4 4 4-4 4 4M17 9v12m-4-4 4 4 4-4"/>'};
  const group=(id,title,icon,content,badge='')=>`<details class="settings-group" data-section="${id}" ${openSettingsGroups.has(id)?'open':''}><summary><span class="settings-symbol" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${icons[icon]}</svg></span><span class="settings-group-label">${t(title)}</span>${badge?`<span class="settings-count">${badge}</span>`:''}<span class="settings-chevron" aria-hidden="true"></span></summary><div class="settings-group-body">${content}</div></details>`;
  const workers=`${scopeTabs()}<div class="settings-tools">${btn('+ '+t('add'),'add','primary compact-button')}</div>${activeLedger().workers.length?`<ul class="worker-list settings-worker-list">${activeLedger().workers.map(w=>`<li><div class="worker-row settings-worker-row"><span class="worker-avatar" aria-hidden="true">${esc(w.name[0])}</span><span class="worker-info"><strong class="worker-name">${esc(w.name)}</strong><span class="worker-finances"><span>${t('salary')}: <strong>${amount(w.salary)}</strong></span><span>${t('debts')}: <strong>${amount(debt(activeLedger(),w.id))}</strong></span></span></span>${btn(t('edit'),`edit:${w.id}`,'compact-button')}</div></li>`).join('')}</ul>`:`<p class="muted">${t('none')}</p>`}<p class="settings-help">${t('nextSalary')}</p>${reports.ruleSummary(periodRules(activeLedger().month))}`;
  const preferences=`<form id="preferences"><label for="lang">${t('language')}</label><select id="lang" name="lang">${[['ar','العربية'],['tr','Türkçe'],['en','English']].map(([k,v])=>`<option value="${k}" ${state.settings.lang===k?'selected':''}>${v}</option>`).join('')}</select><label for="theme">${t('theme')}</label><select id="theme" name="theme">${['system','light','dark'].map(k=>`<option value="${k}" ${state.settings.theme===k?'selected':''}>${t(k)}</option>`).join('')}</select><p class="theme-hint">${t('themeInstant')}</p>${field('retention','number',state.settings.retention,'min="0" step="1" required')}<label class="row"><span>${t('auto')}</span><input type="checkbox" name="auto" ${state.settings.autoDelete?'checked':''}></label><div class="actions"><button class="primary" type="submit">${t('save')}</button></div></form>${lockSettings()}${monthlyRulesForm()}${weeklyRulesForm()}`;
  const backup=`<p class="settings-help">${t('copyAllDescription')}</p><div class="backup-actions">${btn(t('copyAllData'),'copy-all','primary')}${btn(t('pasteAllData'),'import-code')}</div><p class="settings-help">${t('local')}</p><div class="backup-actions">${btn(t('backup'),'backup')}${btn(t('restore'),'restore')}</div><input type="file" id="restore-file" accept="application/json" hidden>`;
  return `<h2>${t('settings')}</h2><div class="settings-groups">${group('workers','workers','workers',workers,num(state.workers.length+state.weekly.workers.length))}${group('preferences','preferences','preferences',preferences)}${group('backup','backupRestore','backup',backup)}</div><div class="app-update-row"><small>${t('version')} ${APP_VERSION}</small>${btn(t('updateApp'),'update-app','compact-button')}</div>`;
}
function table(entries,editable=false){return entries.length?`<div class="table"><table><thead><tr><th>${t('date')}</th><th>${t('activity')}</th><th>${t('value')}</th><th>${t('note')}</th></tr></thead><tbody>${entries.map(x=>`<tr><td>${esc(x.date)}</td><td>${t(x.type)}</td><td>${amount(x.value)}</td><td>${esc(x.note)}</td>${(editable===true||editable==='debt'&&x.type==='cash'&&x.month===activeLedger().month.key)?`<td>${btn(t('editEntryAction'),`edit-entry:${x.id}`)}${btn(t('delete'),`remove:${x.id}`,'danger')}</td>`:''}</tr>`).join('')}</tbody></table></div>`:`<p>${t('none')}</p>`;}
function worker(id){
  selected=id;
  reportContext={type:'worker',id};
  const w=activeLedger().workers.find(w=>w.id===id),s=totals(w,activeLedger().month);
  const entries=activeLedger().month.entries.filter(x=>x.workerId===id);
  modal(w.name,`<div class="profile-month">${btn(esc(periodLabel())+' · '+t('selectPeriod'),'period-picker','pill period-picker')}${btn(t('editSalary'),`salary:${id}`,'no-print')}${btn(t('printStatement'),'print','no-print')}</div><div class="profile-balances"><div class="balance-primary"><span>${t('payable')}</span><strong>${amount(s.payable)}</strong></div><div><span>${t('debts')}</span><strong>${amount(debt(activeLedger(),id))}</strong></div></div>${s.previousPaid?`<p class="notice">${t('previouslyPaid')}: ${amount(s.previousPaid)}. ${t('priorPaymentNote')}</p>`:''}${s.deficit?`<p class="pending-deficit">${t('pendingDeficit')}: ${amount(s.deficit)}</p>`:''}${reports.ruleSummary(periodRules(activeLedger().month))}${reports.attendanceCards(w,entries,s.salary,periodRules(activeLedger().month))}<section class="profile-section"><h3>${t('recordActivity')}</h3><div class="quick-actions">${['absence','late','overtime','extra','advance','convert','deduct','cash'].map(k=>btn(t(k),`entry:${k}`)).join('')}</div></section>${reports.salarySummary(s)}<section class="profile-section"><h3>${t('activity')}</h3>${reports.activityGroups(entries,s.salary,true,periodRules(activeLedger().month))}</section><details class="profile-section debt-details"><summary>${t('debtHistory')}</summary>${table(activeLedger().debts.filter(x=>x.workerId===id),'debt')}</details>`);
  dialog.className='worker-dialog';
}
function entry(type,editing=null){
  dialog.close();
  const isDuration=['late','overtime'].includes(type);
  const sources=activeLedger().month.entries.filter(x=>x.workerId===selected&&x.type==='advance').map(x=>({...x,remaining:round(x.value-activeLedger().month.entries.filter(c=>c.type==='convert'&&c.sourceId===x.id).reduce((a,c)=>a+c.value,0))})).filter(x=>x.remaining>0);
  const valueField=isDuration
    ? `<input id="value" name="value" type="text" required inputmode="decimal" dir="ltr" placeholder="0.30" aria-describedby="duration-help"><p id="duration-help" class="duration-help">${t('durationHelp')}</p>`
    : `<input id="value" name="value" type="number" required min="${type==='absence'&&payrollKind!=='weekly'?1:0.01}" step="${type==='absence'&&payrollKind!=='weekly'?1:'any'}" inputmode="decimal">`;
  modal(editing?t('editEntryAction')+' · '+t(type):t(type),`${type==='convert'&&!editing?`<label for="sourceId">${t('source')}</label><select required id="sourceId" name="sourceId">${sources.map(x=>`<option value="${x.id}">${esc(x.date)} · ${num(x.remaining)}</option>`).join('')}</select>`:''}<label for="value">${t(type==='absence'?'days':isDuration?'hours':'value')}</label>${valueField}${field('date','date',editing?.date??date(),'required')}<p class="settings-help">${t('entryDateHelp')}</p>${field('note','text',editing?.note??'')}${actions()}`,async f=>{
    const iso=String(f.get('date'));if(!validIsoDate(iso))throw Error('date');
    const value=isDuration?parseWorkDuration(f.get('value')):Number(f.get('value'));
    if(editing){if(!dateInPeriod(activeLedger().month,iso)){dialog.querySelector('#form-error').textContent=t('editDatePeriod');return;}try{await persist(replaceLedger(state,updateEntry(activeLedger(),editing.id,{value,date:iso,note:f.get('note')})));dialog.close();worker(selected);}catch{dialog.querySelector('#form-error').textContent=t('linked');}return;}
    const current=activeLedger(),key=dateInPeriod(current.month,iso)?current.month.key:keyForDate(iso);if(type==='convert'&&key!==current.month.key)throw Error('advance-period');
    if(key!==current.month.key&&!confirmPeriodChange(current,key))return;
    const ledger=selectPeriod(current,key,{reopen:current.archives.some(a=>a.key===key)});
    if(ledger.month.workerIds&&!ledger.month.workerIds.includes(selected)){ledger.month.workerIds.push(selected);ledger.month.salaries[selected]=ledger.workers.find(w=>w.id===selected).salary;}
    addEntry(ledger,{id:uuid(),workerId:selected,type,value,date:f.get('date'),note:f.get('note'),...(type==='convert'?{sourceId:f.get('sourceId')}:{})});
    await persist(replaceLedger(state,ledger));dialog.close();worker(selected);
  });
  if(editing){const parts=isDuration?workDurationParts(editing.value):null;dialog.querySelector('#value').value=isDuration?parts.hours+'.'+String(parts.minutes).padStart(2,'0'):editing.value;}
  dialog.querySelector('#value').focus();
}
function editWorker(id){const w=activeLedger().workers.find(x=>x.id===id);modal(t(w?'edit':'add'),`${field('name','text',w?.name??'','required maxlength="80"')}${w?'':field('salary','number','','required min="0" step="0.01"')}${w?'':field('opening','number',0,'min="0" step="0.01" required')}${actions()}${w?`<div class="worker-delete-area">${btn(t('deleteWorker'),`delete-worker:${w.id}`,'danger')}</div>`:''}`,async f=>{const next=structuredClone(state),ledger=activeLedger(next),name=String(f.get('name')).trim(),salary=Number(f.get('salary')),opening=Number(f.get('opening')??0);if(!name||(!w&&(!Number.isFinite(salary)||salary<0))||!Number.isFinite(opening)||opening<0)throw Error('invalid');if(w){ledger.workers.find(x=>x.id===id).name=name;}else{const wid=uuid();ledger.workers.push({id:wid,name,salary});ledger.month.salaries[wid]=salary;if(ledger.month.workerIds)ledger.month.workerIds.push(wid);if(opening)ledger.debts.push({id:uuid(),workerId:wid,type:'opening',value:opening,date:date(),note:''});}await persist(next);dialog.close();});}\nfunction editSalary(id){const worker=activeLedger().workers.find(w=>w.id===id);if(!worker)return;const current=activeLedger().month.salaries[id]??worker.salary;modal(t('editSalary'),`<p class="settings-help">${t('salaryCurrent')}: <strong>${amount(current)}</strong></p>${field('salary','number',current,'required min="0" step="0.01"')}<label for="salary-effective">${t('salaryEffective')}</label><select id="salary-effective" name="effective"><option value="current">${t('salaryCurrentPeriod')}</option><option value="next" selected>${t('salaryNextPeriod')}</option></select>${actions()}`,async f=>{const salary=Number(f.get('salary'));if(!Number.isFinite(salary)||salary<0)throw Error('invalid');const ledger=setWorkerSalary(activeLedger(),id,salary,String(f.get('effective')));await persist(replaceLedger(state,ledger));dialog.close();worker(id);toast(t(f.get('effective')==='current'?'salaryUpdatedCurrent':'salaryUpdatedNext'));});}
async function requestDeleteWorker(id){
  const w=activeLedger().workers.find(w=>w.id===id);
  if(!w)return;
  const count=[activeLedger().month,...Object.values(activeLedger().openPeriods??{})].reduce((n,period)=>n+period.entries.filter(e=>e.workerId===id).length,0);
  const message=`${t('deleteWorker')}: ${w.name}\n\n${t('payable')}: ${num(totals(w,activeLedger().month).payable)}\n${t('debts')}: ${num(debt(activeLedger(),id))}\n${t('openEntries')}: ${num(count)}\n\n${t('deleteWorkerNote')}`;
  if(!confirm(message))return;
  await persist(replaceLedger(state,removeWorker(activeLedger(),id)));
  if(selected===id){selected=null;reportContext=null;}
  dialog.close();toast(t('workerDeleted'));
}
function archives(){return `<h2>${t('archive')}</h2>${scopeTabs()}${activeLedger().archives.length?activeLedger().archives.map((a,i)=>`<div class="card row archive-item"><div><h3>${esc(periodLabel(a))}</h3><small>${esc(a.closedAt.slice(0,10))} · ${t('paid')}: ${amount(a.workers.reduce((s,w)=>s+w.payable,0))}</small>${state.settings.retention>0&&Date.now()-Date.parse(a.closedAt)>=state.settings.retention*86400000?`<p>${t('expired')}</p>`:''}</div><div class="actions">${btn(t('viewStatement'),`archive:${i}`)}${btn(t('delete'),`delete:${i}`,'danger')}</div></div>`).join(''):`<div class="empty">${t('none')}</div>`}`;}
function archive(i){
  const a=activeLedger().archives[i];reportContext={type:'archive',index:i};
  const entries=[...a.entries,...(a.debtEntries??[]).filter(e=>e.type==='cash')];
  modal(periodLabel(a),`<div class="archive-toolbar">${btn(t('printAll'),'print','primary')}</div>${a.workers.map(w=>`<details class="archive-worker"><summary><span class="archive-worker-name">${esc(w.name)}<small>${t('debts')}: ${amount(w.debtAfter??w.debtBefore)}</small></span><span class="archive-worker-paid"><small>${t(w.previousPaid?'paidInClosing':'paid')}</small><strong>${amount(w.payable)}</strong></span><span class="entry-chevron" aria-hidden="true"></span></summary>${reports.workerReport({worker:w,summary:w,entries,month:periodLabel(a),balance:w.debtAfter??w.debtBefore,paid:true,rules:periodRules(a)})}</details>`).join('')}`);
  dialog.className='archive-dialog';
}
function buildPrintReport(){
  const context=dialog.open?reportContext:null;
  let root=document.querySelector('#print-root');
  if(!root){root=document.createElement('div');root.id='print-root';document.body.append(root);}
  if(context?.type==='archive'){
    const a=activeLedger().archives[context.index];
    const entries=[...a.entries,...(a.debtEntries??[]).filter(e=>e.type==='cash')];
    root.innerHTML=a.workers.map(w=>reports.workerReport({worker:w,summary:w,entries,month:periodLabel(a),balance:w.debtAfter??w.debtBefore,paid:true,rules:periodRules(a)})).join('');
  }else{
    const workers=context?.type==='worker'?payrollWorkers().filter(w=>w.id===context.id):payrollWorkers();
    root.innerHTML=workers.map(w=>reports.workerReport({worker:w,summary:totals(w,activeLedger().month),entries:[...activeLedger().month.entries,...activeLedger().debts.filter(e=>e.type==='cash'&&e.month===activeLedger().month.key)],month:periodLabel(),balance:debt(activeLedger(),w.id),rules:periodRules(activeLedger().month)})).join('');
  }
}
window.addEventListener('beforeprint',()=>{buildPrintReport();restoreDialogAfterPrint=dialog.open;if(dialog.open)dialog.close();});
window.addEventListener('afterprint',()=>{if(restoreDialogAfterPrint){dialog.showModal();restoreDialogAfterPrint=false;}});
function review(){if(!payrollWorkers().length)return;modal(t('review'),`<p class="notice">${t('closeNote')}</p><div class="table"><table><thead><tr><th>${t('name')}</th><th>${t('payable')}</th><th>${t('deficit')}</th></tr></thead><tbody>${payrollWorkers().map(w=>{const s=totals(w,activeLedger().month);return `<tr><td>${esc(w.name)}</td><td>${amount(s.payable)}</td><td>${amount(s.deficit)}</td></tr>`}).join('')}</tbody></table></div><div class="actions">${btn(t('cancel'),'dismiss')}<button class="primary" type="submit">${t('confirm')}</button></div>`,async()=>{const ledger=structuredClone(activeLedger());(payrollKind==='weekly'?closeWeek:closeMonth)(ledger);await persist(replaceLedger(state,ledger));dialog.close();toast(t('saved'));});}
async function copyAllData(){
  // Read the latest stored snapshot so another window's saved records are included.
  const latest=await read();
  const code=await createPortableTransferCode(latest??state);
  try{
    if(!navigator.clipboard?.writeText)throw Error('clipboard');
    await navigator.clipboard.writeText(code);toast(t('allDataCopied')+' · '+num(code.length)+' '+t('codeCharacters'));
  }catch{
    modal(t('copyAllData'),`<p class="settings-help">${t('manualCopyHelp')} (${num(code.length)} ${t('codeCharacters')})</p><label for="manual-copy-text">${t('fullDataCode')}</label><textarea id="manual-copy-text" readonly dir="ltr" spellcheck="false">${esc(code)}</textarea><div class="actions"><button type="button" id="manual-copy-button" class="primary">${t('copyAllData')}</button>${btn(t('cancel'),'dismiss')}</div>`);
    const input=dialog.querySelector('#manual-copy-text');input.focus();input.select();
    dialog.querySelector('#manual-copy-button').onclick=()=>{
      input.focus();input.select();input.setSelectionRange(0,input.value.length);
      try{if(document.execCommand('copy'))toast(t('allDataCopied'));}catch{/* Native selection remains available. */}
    };
  }
}
function importCodeDialog(){
  modal(t('pasteAllData'),`<p class="settings-help">${t('pasteAllDescription')}</p><label for="transfer-input">${t('fullDataCode')}</label><textarea id="transfer-input" name="code" required dir="ltr" spellcheck="false" autocomplete="off" placeholder="WORKERS-LEDGER-…"></textarea><p id="code-length" class="settings-help" role="status"></p><p id="paste-help" class="settings-help" role="status"></p><div class="actions">${btn(t('pasteClipboard'),'paste-code')}<button class="primary" type="submit">${t('previewRestore')}</button>${btn(t('cancel'),'dismiss')}</div>`,async f=>{
    let candidate;
    try{candidate=await parsePortableTransferCode(f.get('code'));}catch(error){const key={'backup-empty':'backupEmpty','backup-incomplete':'backupIncomplete','backup-format':'backupFormat','backup-schema':'backupSchema','backup-version':'backupVersion'}[error.code]??'restoreError';dialog.querySelector('#form-error').textContent=t(key);return;}
    dialog.close();confirmCodeRestore(candidate);
  });
  const input=dialog.querySelector('#transfer-input');input.oninput=updateCodeLength;input.focus();
}
function updateCodeLength(){const input=dialog.querySelector('#transfer-input'),output=dialog.querySelector('#code-length');if(input&&output)output.textContent=t('codeLength')+': '+num(input.value.length)+' '+t('codeCharacters');}
async function pasteCode(){
  const input=dialog.querySelector('#transfer-input');if(!input)return;
  try{
    if(!navigator.clipboard?.readText)throw Error('clipboard');
    input.value=await navigator.clipboard.readText();updateCodeLength();input.focus();
  }catch{dialog.querySelector('#paste-help').textContent=t('manualPasteHelp');input.focus();}
}
function confirmCodeRestore(candidate){
  const summary=transferSummary(candidate);
  const labels={monthlyWorkers:'monthlyPayroll',weeklyWorkers:'weeklyPayroll',openEntries:'openEntries',debtRecords:'debtRecords',archivedPeriods:'archivedPeriods'};
  modal(t('previewRestore'),`<p class="notice">${t('replaceAllNotice')}</p><dl class="salary-breakdown">${Object.entries(summary).map(([key,value])=>`<div><dt>${t(labels[key])}</dt><dd>${num(value)}</dd></div>`).join('')}</dl><div class="actions">${btn(t('cancel'),'dismiss')}<button class="primary" type="submit">${t('restoreAllData')}</button></div>`,async()=>{
    candidate=prepareRestore(candidate,state);
    // Import every copied record; retention cleanup is not part of the restore operation.
    await persist(candidate);reportContext=null;selected=null;dialog.close();toast(t('allDataRestored'));
  });
}
function download(){const blob=new Blob([JSON.stringify(state,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`workers-ledger-${date()}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
document.addEventListener('click',async e=>{const b=e.target.closest('[data-action]');if(!b)return;if(b.closest('form'))b.type='button';const [action,id]=b.dataset.action.split(':');try{if(action==='page'){page=id;if(id==='calc')payrollKind='monthly';if(id==='weekly')payrollKind='weekly';reportContext=null;render();}else if(action==='scope'){payrollKind=id;reportContext=null;render();}else if(action==='period-picker'){if(dialog.open)dialog.close();periodPicker();}else if(action==='dismiss')dialog.close();else if(action==='worker')worker(id);else if(action==='edit-entry'){const existing=activeLedger().month.entries.find(e=>e.id===id)??activeLedger().debts.find(e=>e.id===id&&e.type==='cash'&&e.month===activeLedger().month.key);if(existing){selected=existing.workerId;entry(existing.type,existing);}}else if(action==='entry')entry(id);else if(action==='add')editWorker();else if(action==='edit')editWorker(id);else if(action==='salary')editSalary(id);else if(action==='delete-worker')await requestDeleteWorker(id);else if(action==='close')review();else if(action==='archive')archive(Number(id));else if(action==='delete'&&confirm(t('deleteNote'))){const ledger=structuredClone(activeLedger());ledger.archives.splice(Number(id),1);await persist(replaceLedger(state,ledger));}else if(action==='remove'&&confirm(t('deleteEntry'))){try{await persist(replaceLedger(state,removeEntry(activeLedger(),id)));dialog.close();worker(selected);}catch{toast(t('linked'));}}else if(action==='default-rules'){const prefix=id==='weekly'?'weekly':'monthly';document.querySelector('#'+prefix+'-days').value=prefix==='weekly'?6:30;document.querySelector('#'+prefix+'-hours').value='10.00';document.querySelector('#'+prefix+'-overtime').value=1.5;}else if(action==='update-app')location.assign('./update.html?v='+APP_VERSION);else if(action==='copy-all')await copyAllData();else if(action==='import-code')importCodeDialog();else if(action==='paste-code')await pasteCode();else if(action==='backup')download();else if(action==='restore')document.querySelector('#restore-file').click();else if(action==='print'){buildPrintReport();window.print();}else if(action==='install'){await installPrompt.prompt();installPrompt=null;render();}}catch{toast(t('invalid'));}});
document.addEventListener('toggle',e=>{
  if(!e.target.matches?.('.settings-group,.rule-panel')||!e.target.isConnected)return;
  const key=e.target.dataset.section;
  if(e.target.open)openSettingsGroups.add(key);else openSettingsGroups.delete(key);
},true);
document.addEventListener('submit',async e=>{
  if(!['monthly-rules','weekly-rules'].includes(e.target.id))return;
  const weekly=e.target.id==='weekly-rules';
  e.preventDefault();const f=new FormData(e.target);
  const error=document.querySelector(weekly?'#weekly-rules-error':'#rules-error');error.textContent='';
  try{
    const rules={days:Number(f.get('days')),hoursPerDay:parseWorkDuration(f.get('hours')),overtimeMultiplier:Number(f.get('overtime'))};
    const applyCurrent=f.has('applyCurrent');
    const next=(weekly?setWeeklyRules:setMonthlyRules)(state,rules,applyCurrent);
    if(applyCurrent&&(weekly?state.weekly.month:state.month).entries.length&&!confirm(t(weekly?'recalculateWeeklyConfirm':'recalculateRulesConfirm')))return;
    await persist(next);toast(t(weekly?(applyCurrent?'weeklyRulesApplied':'weeklyRulesSaved'):(applyCurrent?'rulesApplied':'rulesSaved')));
  }catch(err){error.textContent=t(err.message==='duration'?'durationError':weekly?'weeklyRulesError':'rulesError');}
});
document.addEventListener('submit',async e=>{if(e.target.id!=='preferences')return;e.preventDefault();const f=new FormData(e.target),retention=Number(f.get('retention'));if(!Number.isInteger(retention)||retention<0)return;try{const next=structuredClone(state);next.settings={...next.settings,lang:f.get('lang'),theme:f.get('theme'),retention,autoDelete:f.has('auto')};await persist(cleanup(next));toast(t('saved'));}catch{toast(t('invalid'));}});
document.addEventListener('change',async e=>{
  if(e.target.id!=='theme')return;
  const select=e.target,theme=select.value;
  if(!['system','light','dark'].includes(theme))return;
  select.disabled=true;
  try{
    const next=structuredClone(state);next.settings.theme=theme;
    // Apply immediately, and keep any unsaved settings inputs in place.
    appearance(theme);
    await persist(next,{refresh:false});
  }catch{
    select.value=state.settings.theme;appearance();toast(t('invalid'));
  }finally{select.disabled=false;}
});
document.addEventListener('change',async e=>{if(e.target.id!=='restore-file'||!e.target.files[0])return;try{const next=JSON.parse(await e.target.files[0].text());if(!valid(next))throw Error();if(confirm(t('restoreNote'))){await persist(prepareRestore(next,state));}}catch{toast(t('restoreError'));}e.target.value='';});
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();installPrompt=e;if(state)render();});
matchMedia('(prefers-color-scheme:dark)').addEventListener('change',()=>state&&appearance());
window.addEventListener('device-lock-change',()=>{if(state)render();});
await initializeLock();
try{await openStore();state=await read()??{version:1,workers:[],debts:[],archives:[],month:{key:date().slice(0,7),entries:[],salaries:{}},settings:{lang:'ar',theme:'system',retention:365,autoDelete:false}};if(!valid(state))throw Error();normalizeState(state);await persist(cleanup(state));navigator.storage?.persist?.();if('serviceWorker'in navigator)startUpdates();}catch{app.textContent='تعذر فتح البيانات المحلية. يرجى السماح بالتخزين وإعادة المحاولة. / Local storage unavailable. Please enable storage and retry.';}

async function startUpdates(){
  try{
    navigator.serviceWorker.addEventListener('message',event=>{
      if(event.data?.type==='UPDATE_READY'&&event.data.version!==APP_VERSION){
        newerVersionAvailable=true;
        // Keep unsaved form fields intact while offering an explicit refresh.
        const existing=document.querySelector('[data-action="update-app"]');
        if(existing)existing.textContent=t('updateReady');
        else{
          const button=document.createElement('button');button.type='button';button.dataset.action='update-app';button.className='update-notice';button.textContent=t('updateReady');document.body.append(button);
        }
      }
    });
    const registration=await navigator.serviceWorker.register('./sw.js',{updateViaCache:'none'});
    const check=()=>registration.update().catch(()=>{});
    document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')check();});
    window.addEventListener('online',check);
    check();
  }catch{/* The payroll remains available even if the update check fails offline. */}
}

function refreshCalendarInfo(){const node=document.querySelector('.calendar-info');if(node&&state){node.innerHTML=calendarInfo();const periodNote=document.querySelector('.calendar-period-note');if(periodNote)periodNote.outerHTML=accountingPeriodNote();}}
window.addEventListener('focus',refreshCalendarInfo);
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')refreshCalendarInfo();});
