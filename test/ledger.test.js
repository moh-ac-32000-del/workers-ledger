import test from 'node:test';
import assert from 'node:assert/strict';
import {totals,debt,addEntry,closeMonth,cleanup} from '../ledger.js';
import {valid} from '../storage.js';
const fixture=()=>({version:1,workers:[{id:'w',name:'Ali',salary:900}],month:{key:'2026-10',salaries:{w:900},entries:[]},debts:[{id:'o',workerId:'w',type:'opening',value:500,date:'2026-10-01'}],archives:[],settings:{lang:'ar',theme:'system',retention:365,autoDelete:false}});
const tx=(s,type,value,extra={})=>addEntry(s,{id:crypto.randomUUID(),workerId:'w',type,value,date:'2026-10-02',note:'',...extra});
test('salary, full-day absence, fractional delay and overtime',()=>{const s=fixture();tx(s,'absence',2);tx(s,'late',1.5);tx(s,'overtime',2.5);assert.deepEqual(totals(s.workers[0],s.month),{salary:900,absence:60,late:4.5,overtime:11.25,advances:0,deduction:0,net:846.75,payable:846.75,deficit:0});assert.throws(()=>tx(s,'absence',0.5));});
test('manual deduction and cash repayment are separate',()=>{const s=fixture();tx(s,'advance',200);tx(s,'deduct',100);tx(s,'cash',50);assert.equal(totals(s.workers[0],s.month).payable,600);assert.equal(debt(s,'w'),350);assert.throws(()=>tx(s,'cash',351));});
test('partial conversion releases salary and creates debt once',()=>{const s=fixture();tx(s,'advance',1000);const sourceId=s.month.entries[0].id;tx(s,'convert',300,{sourceId});assert.equal(totals(s.workers[0],s.month).payable,200);assert.equal(debt(s,'w'),800);assert.throws(()=>tx(s,'convert',701,{sourceId}));assert.throws(()=>tx(s,'convert',1,{sourceId:'missing'}));});
test('closing pays positive balances, carries deficit and freezes salary',()=>{const s=fixture();tx(s,'advance',1100);s.workers[0].salary=1200;assert.equal(totals(s.workers[0],s.month).salary,900);closeMonth(s,'2026-11-01T00:00:00Z');assert.equal(s.archives[0].workers[0].deficit,200);assert.equal(debt(s,'w'),700);assert.equal(s.month.key,'2026-11');assert.equal(totals(s.workers[0],s.month).salary,1200);assert.equal(s.month.entries.length,0);assert.equal(s.archives[0].workers[0].salary,900);});
test('debt cannot be repaid using nonexistent pay',()=>{const s=fixture();tx(s,'advance',1000);assert.throws(()=>tx(s,'deduct',1));assert.equal(debt(s,'w'),500);});
test('archive deletion never deletes debt and manual mode keeps expired months',()=>{const s=fixture();tx(s,'advance',1000);closeMonth(s,'2026-10-31T00:00:00Z');s.settings.retention=1;cleanup(s,Date.parse('2027-01-01'));assert.equal(s.archives.length,1);s.settings.autoDelete=true;cleanup(s,Date.parse('2027-01-01'));assert.equal(s.archives.length,0);assert.equal(debt(s,'w'),600);});
test('December rolls over to January',()=>{const s=fixture();s.month.key='2026-12';closeMonth(s);assert.equal(s.month.key,'2027-01');});
test('backup validates numeric values and schema',()=>{const s=fixture();assert.equal(valid(s),true);s.workers[0].salary=-1;assert.equal(valid(s),false);assert.equal(Boolean(valid({})),false);});
test('removing current entries corrects debt and rejects linked conversion',async()=>{const {removeEntry}=await import('../ledger.js');const s=fixture();tx(s,'advance',200);const id=s.month.entries[0].id;tx(s,'convert',100,{sourceId:id});assert.throws(()=>removeEntry(s,id));const convertedId=s.month.entries[1].id;const next=removeEntry(s,convertedId);assert.equal(debt(next,'w'),500);assert.equal(totals(next.workers[0],next.month).payable,700);assert.equal(s.month.entries.length,2);});
test('archived debt contains cash repayments and final debt snapshot',()=>{const s=fixture();tx(s,'cash',50);closeMonth(s);assert.equal(s.archives[0].debtEntries[0].type,'cash');assert.equal(s.archives[0].workers[0].debtAfter,450);});
test('current cash repayment can be corrected before month closing',async()=>{const {removeEntry}=await import('../ledger.js');const s=fixture();tx(s,'cash',50);const next=removeEntry(s,s.debts[1].id);assert.equal(debt(next,'w'),500);});
test('attendance quantities stay separate from their financial values',async()=>{
  const {attendance,entryAmount}=await import('../report.js');const s=fixture();
  tx(s,'absence',2);tx(s,'overtime',1.5);tx(s,'overtime',0.5);tx(s,'late',2.5);
  assert.deepEqual(attendance(s.month.entries,'w'),{absence:2,overtime:2,late:2.5});
  assert.equal(entryAmount({type:'absence',value:2},900),60);
  assert.equal(entryAmount({type:'overtime',value:1.5},900),6.75);
  assert.equal(entryAmount({type:'late',value:2.5},900),7.5);
});
test('old archive entries recover quantities using frozen salary after salary change',async()=>{
  const {attendance,entryAmount}=await import('../report.js');const s=fixture();tx(s,'overtime',1.5);closeMonth(s);
  s.workers[0].salary=1200;const old=s.archives[0];
  assert.equal(attendance(old.entries,'w').overtime,1.5);
  assert.equal(entryAmount(old.entries[0],old.workers[0].salary),6.75);
});
test('report renders grouped day/hour records and escapes names and notes',async()=>{
  const {createReports}=await import('../report.js');const {translate}=await import('../i18n.js');
  const esc=s=>String(s??'').replaceAll('<','&lt;').replaceAll('>','&gt;');
  for(const lang of ['ar','tr','en']){
    const r=createReports({t:k=>translate(k,lang),num:String,esc,amount:String,btn:()=>''});
    const s=fixture();tx(s,'absence',1);s.month.entries[0].note='<script>';s.workers[0].name='<img>';
    const html=r.workerReport({worker:s.workers[0],summary:totals(s.workers[0],s.month),entries:s.month.entries,month:s.month.key,balance:500});
    assert.match(html,/data-group="absence"/);assert.match(html,/data-group="overtime"/);assert.match(html,/data-group="late"/);
    assert.match(html,/&lt;script&gt;/);assert.match(html,/&lt;img&gt;/);assert.ok(html.includes(translate('dayCount',lang)));assert.ok(html.includes('30'));
  }
});
test('duration input interprets H.MM as minutes, with strict two-digit minute parts',async()=>{
  const {parseWorkDuration}=await import('../ledger.js');
  for(const [text,hours] of [['0.30',0.5],['1.30',1.5],['1.05',1+5/60],['0.01',1/60],['0.59',59/60],['2',2],['2.00',2],['1:45',1.75],['0,30',0.5],['.30',0.5],['٠٫٣٠',0.5],['۱.۰۵',1+5/60]])assert.equal(parseWorkDuration(text),hours,text);
  for(const text of ['0.60','1.99','0','0.00','-1.30','0.3','1.5','0.300','1e2','','text','1.30.20','9007199254740992'])assert.throws(()=>parseWorkDuration(text),/duration/,text);
});
test('minute input calculates overtime and lateness at the correct rates',async()=>{
  const {parseWorkDuration}=await import('../ledger.js');const s=fixture();tx(s,'overtime',parseWorkDuration('0.30'));tx(s,'late',parseWorkDuration('0.30'));
  const result=totals(s.workers[0],s.month);assert.equal(result.overtime,2.25);assert.equal(result.late,1.5);assert.equal(result.net,900.75);
});
test('attendance totals keep minute precision before calculating money',async()=>{
  const {parseWorkDuration}=await import('../ledger.js');const {attendance,entryAmount}=await import('../report.js');const s=fixture();tx(s,'late',parseWorkDuration('0.20'));
  const counts=attendance(s.month.entries,'w');assert.equal(entryAmount({type:'late',value:counts.late},900),1);assert.equal(totals(s.workers[0],s.month).late,1);
});
test('duration display carries minutes into hours without changing old saved hours',async()=>{
  const {workDurationParts,parseWorkDuration}=await import('../ledger.js');assert.deepEqual(workDurationParts(parseWorkDuration('0.45')+parseWorkDuration('0.30')),{hours:1,minutes:15});assert.deepEqual(workDurationParts(1.5),{hours:1,minutes:30});assert.deepEqual(workDurationParts(0.3),{hours:0,minutes:18});
  const s=fixture();tx(s,'overtime',1.5);closeMonth(s);assert.equal(s.archives[0].entries[0].value,1.5);assert.equal(s.archives[0].workers[0].overtime,6.75);
});
test('reports show minute quantities for each entry and hour/minute group totals',async()=>{
  const {parseWorkDuration}=await import('../ledger.js');const {createReports}=await import('../report.js');const {translate}=await import('../i18n.js');
  const reports=createReports({t:k=>translate(k,'en'),num:String,esc:String,amount:String,btn:()=>''});const s=fixture();tx(s,'overtime',parseWorkDuration('0.45'));tx(s,'overtime',parseWorkDuration('0.30'));
  const html=reports.activityGroups(s.month.entries,900);assert.match(html,/1 hours 15 minutes/);assert.match(html,/45 minutes/);assert.match(html,/30 minutes/);assert.doesNotMatch(html,/0\.75 hours/);
});
test('deleting a worker removes current entries and debt but preserves archived statements',async()=>{
  const {removeWorker}=await import('../ledger.js');const s=fixture();
  s.workers.push({id:'other',name:'Other',salary:1200});s.month.salaries.other=1200;
  tx(s,'advance',100);closeMonth(s);tx(s,'advance',50);
  const archive=structuredClone(s.archives),next=removeWorker(s,'w');
  assert.equal(next.workers.length,1);assert.equal(next.workers[0].id,'other');
  assert.equal(next.month.entries.filter(e=>e.workerId==='w').length,0);
  assert.equal(next.debts.filter(e=>e.workerId==='w').length,0);
  assert.equal('w' in next.month.salaries,false);assert.equal(next.month.salaries.other,1200);
  assert.deepEqual(next.archives,archive);assert.equal(valid(next),true);
  assert.equal(s.workers.length,2);assert.equal(debt(s,'w'),500);
});
test('deleting an unknown worker leaves the ledger intact',async()=>{
  const {removeWorker}=await import('../ledger.js');const s=fixture(),before=structuredClone(s);
  assert.throws(()=>removeWorker(s,'missing'),/worker/);assert.deepEqual(s,before);
});
