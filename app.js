import {createReports} from './report.js';
import {totals,debt,addEntry,closeMonth,cleanup,round,removeEntry,parseWorkDuration} from './ledger.js';
import {openStore,read,write,valid} from './storage.js';
import {translate} from './i18n.js';
const app=document.querySelector('#app'),dialog=document.querySelector('#dialog');
let state,page='calc',selected=null,installPrompt,reportContext=null,restoreDialogAfterPrint=false;
const uuid=()=>crypto.randomUUID();
const date=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`};
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const t=k=>translate(k,state.settings.lang),num=n=>new Intl.NumberFormat(state.settings.lang,{maximumFractionDigits:2}).format(n),amount=n=>`<span class="amount">${num(n)}</span>`;
const btn=(text,action,cls='')=>`<button type="button" class="${cls}" data-action="${action}">${text}</button>`;
const field=(key,type='text',value='',extra='')=>`<label for="${key}">${t(key)}</label><input id="${key}" name="${key}" type="${type}" value="${esc(value)}" ${extra}>`;
const reports=createReports({t:k=>t(k),num:n=>num(n),esc,amount:n=>amount(n),btn:(...args)=>btn(...args)});
function toast(msg){const e=document.querySelector('#toast');e.textContent=msg;e.style.display='block';setTimeout(()=>e.style.display='none',3500);}
async function persist(next,{refresh=true}={}){try{await write(next);}catch(e){if(e.message==='conflict'){state=await read();render();toast(t('conflict'));}throw e;}state=next;if(refresh)render();else appearance();}
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
function modal(title,body,onSubmit){dialog.className='';dialog.innerHTML=`<form><div class="row dialog-heading"><h2>${esc(title)}</h2><button type="button" data-action="dismiss" aria-label="${t('cancel')}">×</button></div>${body}<p class="error" id="form-error" role="alert"></p></form>`;dialog.querySelector('form').onsubmit=async e=>{e.preventDefault();try{await onSubmit?.(new FormData(e.target));}catch(err){dialog.querySelector('#form-error').textContent=t(err.message==='duration'?'durationError':['debt','funds'].includes(err.message)?'debtError':'invalid');}};dialog.showModal();}
function actions(){return `<div class="actions">${btn(t('cancel'),'dismiss')}<button class="primary" type="submit">${t('save')}</button></div>`;}
function render(){appearance();const pays=state.workers.reduce((a,w)=>a+totals(w,state.month).payable,0),debts=state.workers.reduce((a,w)=>a+debt(state,w.id),0);app.innerHTML=`<div class="shell"><header><div class="brand"><div class="logo">▦</div><div><h1>${t('app')}</h1><small>${t('tag')}</small></div></div><div class="row">${installPrompt?btn(t('install'),'install'):''}<span class="pill">${esc(state.month.key)}</span></div></header>${page==='calc'?`<div class="row"><div><h2>${t('month')}</h2><p>${t('choose')}</p></div>${state.workers.length?btn(t('close'),'close','primary'):''}</div><div class="grid dashboard-stats"><div class="card stat"><small>${t('workers')}</small><strong>${num(state.workers.length)}</strong></div><div class="card stat"><small>${t('payable')}</small><strong>${amount(pays)}</strong></div><div class="card stat"><small>${t('debts')}</small><strong>${amount(debts)}</strong></div></div>${state.workers.length?`<ul class="worker-list">${state.workers.map(w=>`<li><button type="button" class="worker-row" data-action="worker:${w.id}"><span class="worker-avatar" aria-hidden="true">${esc(w.name[0])}</span><span class="worker-info"><strong class="worker-name">${esc(w.name)}</strong><span class="worker-finances"><span>${t('payable')}: <strong>${amount(totals(w,state.month).payable)}</strong></span><span>${t('debts')}: <strong>${amount(debt(state,w.id))}</strong></span></span></span><span class="worker-chevron" aria-hidden="true"></span></button></li>`).join('')}</ul>`:`<div class="empty"><h2>${t('empty')}</h2>${btn(t('add'),'add','primary')}</div>`}`:page==='settings'?settings():archives()}</div><nav aria-label="${t('app')}">${['calc','archive','settings'].map(k=>btn(t(k),`page:${k}`,page===k?'active':'')).join('')}</nav>`;}
function settings(){return `<h2>${t('settings')}</h2><div class="card"><div class="row"><h3>${t('workers')}</h3>${btn('+ '+t('add'),'add','primary')}</div>${state.workers.map(w=>`<div class="row card"><div><strong>${esc(w.name)}</strong><p>${t('salary')}: ${amount(w.salary)} · ${t('debts')}: ${amount(debt(state,w.id))}</p></div>${btn(t('edit'),`edit:${w.id}`)}</div>`).join('')}<p>${t('nextSalary')}</p><p>${t('salaryInfo')}</p></div><form id="preferences" class="card"><h3>${t('language')} / ${t('theme')}</h3><label for="lang">${t('language')}</label><select id="lang" name="lang">${[['ar','العربية'],['tr','Türkçe'],['en','English']].map(([k,v])=>`<option value="${k}" ${state.settings.lang===k?'selected':''}>${v}</option>`).join('')}</select><label for="theme">${t('theme')}</label><select id="theme" name="theme">${['system','light','dark'].map(k=>`<option value="${k}" ${state.settings.theme===k?'selected':''}>${t(k)}</option>`).join('')}</select><p class="theme-hint">${t('themeInstant')}</p>${field('retention','number',state.settings.retention,'min="0" step="1" required')}<label class="row"><span>${t('auto')}</span><input type="checkbox" name="auto" ${state.settings.autoDelete?'checked':''}></label><div class="actions"><button class="primary">${t('save')}</button></div></form><div class="card"><p>${t('local')}</p><div class="actions">${btn(t('backup'),'backup')}${btn(t('restore'),'restore')}</div><input type="file" id="restore-file" accept="application/json" hidden></div>`;}
function table(entries,editable=false){return entries.length?`<div class="table"><table><thead><tr><th>${t('date')}</th><th>${t('activity')}</th><th>${t('value')}</th><th>${t('note')}</th></tr></thead><tbody>${entries.map(x=>`<tr><td>${esc(x.date)}</td><td>${t(x.type)}</td><td>${amount(x.value)}</td><td>${esc(x.note)}</td>${(editable===true||editable==='debt'&&x.type==='cash'&&x.month===state.month.key)?`<td>${btn(t('delete'),`remove:${x.id}`,'danger')}</td>`:''}</tr>`).join('')}</tbody></table></div>`:`<p>${t('none')}</p>`;}
function worker(id){
  selected=id;
  reportContext={type:'worker',id};
  const w=state.workers.find(w=>w.id===id),s=totals(w,state.month);
  const entries=state.month.entries.filter(x=>x.workerId===id);
  modal(w.name,`<div class="profile-month"><span class="pill">${esc(state.month.key)}</span>${btn(t('printStatement'),'print','no-print')}</div><div class="profile-balances"><div class="balance-primary"><span>${t('payable')}</span><strong>${amount(s.payable)}</strong></div><div><span>${t('debts')}</span><strong>${amount(debt(state,id))}</strong></div></div>${reports.attendanceCards(w,entries,s.salary)}<section class="profile-section"><h3>${t('recordActivity')}</h3><div class="quick-actions">${['absence','late','overtime','advance','convert','deduct','cash'].map(k=>btn(t(k),`entry:${k}`)).join('')}</div></section>${reports.salarySummary(s)}<section class="profile-section"><h3>${t('activity')}</h3>${reports.activityGroups(entries,s.salary,true)}</section><details class="profile-section debt-details"><summary>${t('debtHistory')}</summary>${table(state.debts.filter(x=>x.workerId===id),'debt')}</details>`);
  dialog.className='worker-dialog';
}
function entry(type){
  dialog.close();
  const isDuration=['late','overtime'].includes(type);
  const sources=state.month.entries.filter(x=>x.workerId===selected&&x.type==='advance').map(x=>({...x,remaining:round(x.value-state.month.entries.filter(c=>c.type==='convert'&&c.sourceId===x.id).reduce((a,c)=>a+c.value,0))})).filter(x=>x.remaining>0);
  const valueField=isDuration
    ? `<input id="value" name="value" type="text" required inputmode="decimal" dir="ltr" placeholder="0.30" aria-describedby="duration-help"><p id="duration-help" class="duration-help">${t('durationHelp')}</p>`
    : `<input id="value" name="value" type="number" required min="${type==='absence'?1:0.01}" step="${type==='absence'?1:'any'}" inputmode="decimal">`;
  modal(t(type),`${type==='convert'?`<label for="sourceId">${t('source')}</label><select required id="sourceId" name="sourceId">${sources.map(x=>`<option value="${x.id}">${esc(x.date)} · ${num(x.remaining)}</option>`).join('')}</select>`:''}<label for="value">${t(type==='absence'?'days':isDuration?'hours':'value')}</label>${valueField}${field('date','date',date().slice(0,7)===state.month.key?date():state.month.key+'-01','required')}${field('note')}${actions()}`,async f=>{
    if(String(f.get('date')).slice(0,7)!==state.month.key)throw Error('date');
    const value=isDuration?parseWorkDuration(f.get('value')):Number(f.get('value'));
    const next=structuredClone(state);
    addEntry(next,{id:uuid(),workerId:selected,type,value,date:f.get('date'),note:f.get('note'),...(type==='convert'?{sourceId:f.get('sourceId')}:{})});
    await persist(next);dialog.close();worker(selected);
  });
  dialog.querySelector('#value').focus();
}
function editWorker(id){const w=state.workers.find(x=>x.id===id);modal(t(w?'edit':'add'),`${field('name','text',w?.name??'','required maxlength="80"')}${field('salary','number',w?.salary??'','required min="0" step="0.01"')}${w?`<p>${t('nextSalary')}</p>`:field('opening','number',0,'min="0" step="0.01" required')}${actions()}`,async f=>{const next=structuredClone(state),name=String(f.get('name')).trim(),salary=Number(f.get('salary')),opening=Number(f.get('opening')??0);if(!name||!Number.isFinite(salary)||salary<0||!Number.isFinite(opening)||opening<0)throw Error('invalid');if(w){Object.assign(next.workers.find(x=>x.id===id),{name,salary});}else{const wid=uuid();next.workers.push({id:wid,name,salary});next.month.salaries[wid]=salary;if(opening)next.debts.push({id:uuid(),workerId:wid,type:'opening',value:opening,date:date(),note:''});}await persist(next);dialog.close();});}
function archives(){return `<h2>${t('archive')}</h2>${state.archives.length?state.archives.map((a,i)=>`<div class="card row"><div><h3>${esc(a.key)}</h3><small>${esc(a.closedAt.slice(0,10))} · ${t('paid')}: ${amount(a.workers.reduce((s,w)=>s+w.payable,0))}</small>${state.settings.retention>0&&Date.now()-Date.parse(a.closedAt)>=state.settings.retention*86400000?`<p>${t('expired')}</p>`:''}</div><div class="actions">${btn(t('archive'),`archive:${i}`)}${btn(t('delete'),`delete:${i}`,'danger')}</div></div>`).join(''):`<div class="empty">${t('none')}</div>`}`;}
function archive(i){
  const a=state.archives[i];reportContext={type:'archive',index:i};
  const entries=[...a.entries,...(a.debtEntries??[]).filter(e=>e.type==='cash')];
  modal(a.key,`<div class="archive-toolbar">${btn(t('printAll'),'print','primary')}</div>${a.workers.map(w=>reports.workerReport({worker:w,summary:w,entries,month:a.key,balance:w.debtAfter??w.debtBefore,paid:true})).join('')}`);
  dialog.className='archive-dialog';
}
function buildPrintReport(){
  const context=dialog.open?reportContext:null;
  let root=document.querySelector('#print-root');
  if(!root){root=document.createElement('div');root.id='print-root';document.body.append(root);}
  if(context?.type==='archive'){
    const a=state.archives[context.index];
    const entries=[...a.entries,...(a.debtEntries??[]).filter(e=>e.type==='cash')];
    root.innerHTML=a.workers.map(w=>reports.workerReport({worker:w,summary:w,entries,month:a.key,balance:w.debtAfter??w.debtBefore,paid:true})).join('');
  }else{
    const workers=context?.type==='worker'?state.workers.filter(w=>w.id===context.id):state.workers;
    root.innerHTML=workers.map(w=>reports.workerReport({worker:w,summary:totals(w,state.month),entries:[...state.month.entries,...state.debts.filter(e=>e.type==='cash'&&e.month===state.month.key)],month:state.month.key,balance:debt(state,w.id)})).join('');
  }
}
window.addEventListener('beforeprint',()=>{buildPrintReport();restoreDialogAfterPrint=dialog.open;if(dialog.open)dialog.close();});
window.addEventListener('afterprint',()=>{if(restoreDialogAfterPrint){dialog.showModal();restoreDialogAfterPrint=false;}});
function review(){if(!state.workers.length)return;modal(t('review'),`<p class="notice">${t('closeNote')}</p><div class="table"><table><thead><tr><th>${t('name')}</th><th>${t('payable')}</th><th>${t('deficit')}</th></tr></thead><tbody>${state.workers.map(w=>{const s=totals(w,state.month);return `<tr><td>${esc(w.name)}</td><td>${amount(s.payable)}</td><td>${amount(s.deficit)}</td></tr>`}).join('')}</tbody></table></div><div class="actions">${btn(t('cancel'),'dismiss')}<button class="primary" type="submit">${t('confirm')}</button></div>`,async()=>{await persist(closeMonth(structuredClone(state)));dialog.close();toast(t('saved'));});}
function download(){const blob=new Blob([JSON.stringify(state,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`workers-ledger-${date()}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
document.addEventListener('click',async e=>{const b=e.target.closest('[data-action]');if(!b)return;if(b.closest('form'))b.type='button';const [action,id]=b.dataset.action.split(':');try{if(action==='page'){page=id;reportContext=null;render();}else if(action==='dismiss')dialog.close();else if(action==='worker')worker(id);else if(action==='entry')entry(id);else if(action==='add')editWorker();else if(action==='edit')editWorker(id);else if(action==='close')review();else if(action==='archive')archive(Number(id));else if(action==='delete'&&confirm(t('deleteNote'))){const next=structuredClone(state);next.archives.splice(Number(id),1);await persist(next);}else if(action==='remove'&&confirm(t('deleteEntry'))){try{await persist(removeEntry(state,id));dialog.close();worker(selected);}catch{toast(t('linked'));}}else if(action==='backup')download();else if(action==='restore')document.querySelector('#restore-file').click();else if(action==='print'){buildPrintReport();window.print();}else if(action==='install'){await installPrompt.prompt();installPrompt=null;render();}}catch{toast(t('invalid'));}});
document.addEventListener('submit',async e=>{if(e.target.id!=='preferences')return;e.preventDefault();const f=new FormData(e.target),retention=Number(f.get('retention'));if(!Number.isInteger(retention)||retention<0)return;try{const next=structuredClone(state);next.settings={lang:f.get('lang'),theme:f.get('theme'),retention,autoDelete:f.has('auto')};await persist(cleanup(next));toast(t('saved'));}catch{toast(t('invalid'));}});
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
document.addEventListener('change',async e=>{if(e.target.id!=='restore-file'||!e.target.files[0])return;try{const next=JSON.parse(await e.target.files[0].text());if(!valid(next))throw Error();if(confirm(t('restoreNote'))){next.revision=state.revision;await persist(cleanup(next));}}catch{toast(t('restoreError'));}e.target.value='';});
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();installPrompt=e;if(state)render();});
matchMedia('(prefers-color-scheme:dark)').addEventListener('change',()=>state&&appearance());
try{await openStore();state=await read()??{version:1,workers:[],debts:[],archives:[],month:{key:date().slice(0,7),entries:[],salaries:{}},settings:{lang:'ar',theme:'system',retention:365,autoDelete:false}};if(!valid(state))throw Error();await persist(cleanup(state));navigator.storage?.persist?.();if('serviceWorker'in navigator)navigator.serviceWorker.register('./sw.js');}catch{app.textContent='تعذر فتح البيانات المحلية. يرجى السماح بالتخزين وإعادة المحاولة. / Local storage unavailable. Please enable storage and retry.';}
