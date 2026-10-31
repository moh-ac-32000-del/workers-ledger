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
test('custom rules drive payroll and statement entries through the same rates',async()=>{
  const {payRates,setMonthlyRules}=await import('../ledger.js');const {entryAmount}=await import('../report.js');
  let s=fixture();s.workers[0].salary=1040;s.month.salaries.w=1040;
  s=setMonthlyRules(s,{days:26,hoursPerDay:8,overtimeMultiplier:2},true);
  tx(s,'absence',2);tx(s,'late',.5);tx(s,'overtime',1.5);
  assert.deepEqual(payRates(1040,s.month.rules),{daily:40,hourly:5,overtime:10});
  const result=totals(s.workers[0],s.month);assert.equal(result.absence,80);assert.equal(result.late,2.5);assert.equal(result.overtime,15);assert.equal(result.net,972.5);
  assert.equal(entryAmount(s.month.entries[2],1040,s.month.rules),15);
});
test('rules scheduled for the next month do not reprice current or archived entries',async()=>{
  const {DEFAULT_MONTHLY_RULES,setMonthlyRules,periodRules}=await import('../ledger.js');let s=fixture();tx(s,'overtime',1);
  const rules={days:25,hoursPerDay:8,overtimeMultiplier:2};s=setMonthlyRules(s,rules);
  assert.equal(totals(s.workers[0],s.month).overtime,4.5);closeMonth(s);
  assert.deepEqual(s.archives[0].rules,DEFAULT_MONTHLY_RULES);assert.deepEqual(s.month.rules,rules);
  const archive=structuredClone(s.archives[0]);s=setMonthlyRules(s,{days:20,hoursPerDay:6,overtimeMultiplier:3},true);
  assert.deepEqual(s.archives[0],archive);assert.deepEqual(periodRules({entries:[]}),DEFAULT_MONTHLY_RULES);
});
test('rules validation accepts old backups and rejects invalid optional rules',async()=>{
  const {setMonthlyRules,validRules}=await import('../ledger.js');const s=fixture();assert.equal(valid(s),true);
  for(const rules of [{days:0,hoursPerDay:10,overtimeMultiplier:1.5},{days:30,hoursPerDay:0,overtimeMultiplier:1.5},{days:30,hoursPerDay:25,overtimeMultiplier:1.5},{days:30,hoursPerDay:10,overtimeMultiplier:-1}]){assert.equal(validRules(rules),false);assert.throws(()=>setMonthlyRules(s,rules));s.settings.monthlyRules=rules;assert.equal(valid(s),false);}
});
test('shared rule engine supports shorter periods without altering monthly defaults',async()=>{
  const {payRates,DEFAULT_MONTHLY_RULES}=await import('../ledger.js');
  assert.deepEqual(payRates(600,{days:6,hoursPerDay:10,overtimeMultiplier:1.5}),{daily:100,hourly:10,overtime:15});
  assert.deepEqual(DEFAULT_MONTHLY_RULES,{days:30,hoursPerDay:10,overtimeMultiplier:1.5});
});
test('weekly fractional days calculate rates and permit fractional absence independently',async()=>{
  const {createWeeklyLedger,setWeeklyRules}=await import('../ledger.js');let root=fixture();root.weekly=createWeeklyLedger('2026-10-30');
  root=setWeeklyRules(root,{days:5.5,hoursPerDay:10,overtimeMultiplier:1.5},true);
  const week={...root.weekly,settings:root.settings};week.workers.push({id:'weekly',name:'Weekly',salary:550});week.month.salaries.weekly=550;
  addEntry(week,{id:'absence',workerId:'weekly',type:'absence',value:.5,date:'2026-10-30'});addEntry(week,{id:'late',workerId:'weekly',type:'late',value:.5,date:'2026-10-30'});addEntry(week,{id:'overtime',workerId:'weekly',type:'overtime',value:1.5,date:'2026-10-30'});
  const result=totals(week.workers[0],week.month);assert.equal(result.absence,50);assert.equal(result.late,5);assert.equal(result.overtime,22.5);assert.equal(result.net,517.5);
  assert.equal(root.month.entries.length,0);assert.equal(valid(root),true);assert.throws(()=>setWeeklyRules(root,{days:7.5,hoursPerDay:10,overtimeMultiplier:1.5}));
});
test('closing weekly carries debt and freezes rules while advancing seven calendar days',async()=>{
  const {createWeeklyLedger,closeWeek}=await import('../ledger.js');const root=fixture();const monthly=structuredClone(root);
  const week={...createWeeklyLedger('2026-12-31'),settings:{weeklyRules:{days:5.5,hoursPerDay:8,overtimeMultiplier:2}}};week.workers=[{id:'w',name:'Week',salary:600}];week.month.salaries.w=600;
  addEntry(week,{id:'advance',workerId:'w',type:'advance',value:700,date:'2026-12-31'});closeWeek(week);
  assert.equal(week.archives[0].workers[0].deficit,100);assert.equal(debt(week,'w'),100);assert.equal(week.month.key,'2027-01-04');assert.equal(week.month.rules.days,5.5);assert.equal(week.archives[0].rules.days,6);assert.deepEqual(root,monthly);
});
test('weekly dates use a calendar week independently of fractional workday divisor',async()=>{
  const {createWeeklyLedger,dateInPeriod,weekStart}=await import('../ledger.js');const week=createWeeklyLedger('2026-10-30',{days:5.5,hoursPerDay:10,overtimeMultiplier:1.5});
  assert.equal(weekStart('2026-10-30'),'2026-10-26');assert.equal(dateInPeriod(week.month,'2026-11-01'),true);assert.equal(dateInPeriod(week.month,'2026-11-02'),false);assert.equal(dateInPeriod(week.month,'2026-10-25'),false);
});
test('weekly backup data and retention remain separate from monthly records and debts',async()=>{
  const {createWeeklyLedger,closeWeek}=await import('../ledger.js');const root=fixture();root.weekly=createWeeklyLedger('2026-10-30');root.weekly.workers=[{id:'weekly',name:'Week',salary:600}];root.weekly.month.salaries.weekly=600;
  const week={...root.weekly,settings:root.settings};closeWeek(week,'2026-11-01T00:00:00Z');root.weekly={workers:week.workers,month:week.month,debts:week.debts,archives:week.archives};assert.equal(valid(root),true);root.settings.retention=1;root.settings.autoDelete=true;cleanup(root,Date.parse('2027-01-01'));assert.equal(root.weekly.archives.length,0);assert.equal(debt(root,'w'),500);
  root.weekly.month.rules.days=0;assert.equal(valid(root),false);
});
test('calendar months have their real lengths independently of the 30-day payroll divisor',async()=>{
  const {calendarMonthBounds,dateInPeriod}=await import('../ledger.js');
  for(const [key,days] of [['2026-02',28],['2024-02',29],['2026-04',30],['2026-01',31]]){
    const bounds=calendarMonthBounds(key);assert.equal(bounds.days,days);assert.equal(bounds.end,key+'-'+days);
    const s=fixture();s.month.key=key;tx(s,'absence',1);assert.equal(totals(s.workers[0],s.month).absence,30);
  }
  assert.equal(dateInPeriod({key:'2026-02'},'2026-02-29'),false);
  assert.equal(dateInPeriod({key:'2024-02'},'2024-02-29'),true);
  assert.equal(dateInPeriod({key:'2026-04'},'2026-04-31'),false);
  assert.equal(dateInPeriod({key:'2026-01'},'2026-01-31'),true);
});
test('manual month closure advances the calendar month rather than a thirty-day timer',()=>{
  for(const [key,next] of [['2026-01','2026-02'],['2026-02','2026-03'],['2024-02','2024-03'],['2026-12','2027-01']]){
    const s=fixture();s.month.key=key;closeMonth(s);assert.equal(s.month.key,next);
  }
});
test('full clipboard code round-trips both ledgers, all entries, debts, archives, rules and Arabic text',async()=>{
  const {createTransferCode,parseTransferCode,transferSummary}=await import('../transfer.js');const {createWeeklyLedger,closeWeek}=await import('../ledger.js');
  const s=fixture();s.revision=42;s.workers[0].name='محمد — العامل';tx(s,'absence',1);tx(s,'late',.5);tx(s,'overtime',1.75);tx(s,'advance',100);tx(s,'deduct',50);tx(s,'cash',20);closeMonth(s);tx(s,'late',.5);
  s.settings.monthlyRules={days:26,hoursPerDay:8,overtimeMultiplier:2};s.settings.weeklyRules={days:5.5,hoursPerDay:10,overtimeMultiplier:1.5};s.weekly=createWeeklyLedger('2026-10-30',s.settings.weeklyRules);s.weekly.workers=[{id:'weekly',name:'عامل أسبوعي',salary:550}];s.weekly.month.salaries.weekly=550;s.weekly.debts=[{id:'weekly-opening',workerId:'weekly',type:'opening',value:200,date:'2026-10-30'}];
  const week={...s.weekly,settings:s.settings};addEntry(week,{id:'week-late',workerId:'weekly',type:'late',value:.5,date:'2026-10-30',note:'تأخير بالدقائق'});closeWeek(week);s.weekly={workers:week.workers,month:week.month,debts:week.debts,archives:week.archives};
  const original=structuredClone(s),code=createTransferCode(s),restored=parseTransferCode(code);delete original.revision;
  assert.deepEqual(restored,original);assert.equal(s.revision,42);assert.deepEqual(transferSummary(restored),{monthlyWorkers:1,weeklyWorkers:1,openEntries:1,debtRecords:4,archivedPeriods:2});
});
test('transfer codes tolerate wrapped lines and preserve long multi-byte notes',async()=>{
  const {createTransferCode,parseTransferCode,TRANSFER_PREFIX}=await import('../transfer.js');const s=fixture();tx(s,'late',.5);s.month.entries[0].note='تأخير — مسائي — ديون 🌙 '.repeat(3000);const code=createTransferCode(s);const wrapped=TRANSFER_PREFIX+code.slice(TRANSFER_PREFIX.length).match(/.{1,80}/g).join('\n');assert.deepEqual(parseTransferCode(wrapped),s);
});
test('paste accepts existing JSON backups and rejects malformed or other-app codes',async()=>{
  const {parseTransferCode,TRANSFER_PREFIX}=await import('../transfer.js');const s=fixture();assert.deepEqual(parseTransferCode(JSON.stringify(s)),s);
  for(const code of ['',TRANSFER_PREFIX+'???',TRANSFER_PREFIX+btoa(JSON.stringify({format:'other-app',version:1,data:s})),TRANSFER_PREFIX+btoa(JSON.stringify({format:'workers-ledger',version:2,data:s})),JSON.stringify({...s,workers:[{id:'w',name:'bad',salary:-1}]})])assert.throws(()=>parseTransferCode(code));
});
test('selecting October preserves the open December period and records October 31',async()=>{
  const {selectPeriod}=await import('../ledger.js');const s=fixture();s.month.key='2026-12';s.month.entries=[{id:'dec',workerId:'w',type:'advance',value:100,date:'2026-12-01'}];const original=structuredClone(s.month);
  let next=selectPeriod(s,'2026-10');addEntry(next,{id:'oct',workerId:'w',type:'late',value:3,date:'2026-10-31'});assert.equal(next.month.key,'2026-10');assert.equal(totals(next.workers[0],next.month).late,9);assert.deepEqual(next.openPeriods['2026-12'],original);assert.deepEqual(s.month,original);assert.equal(valid(next),true);
  next=selectPeriod(next,'2026-12');assert.deepEqual(next.month,original);assert.equal(next.openPeriods['2026-10'].entries[0].date,'2026-10-31');
});
test('reopening a paid month preserves prior pay and never pays the full salary twice',async()=>{
  const {selectPeriod}=await import('../ledger.js');let s=fixture();closeMonth(s);closeMonth(s);const december=structuredClone(s.month);
  s=selectPeriod(s,'2026-10',{reopen:true});assert.equal(totals(s.workers[0],s.month).payable,0);addEntry(s,{id:'late',workerId:'w',type:'late',value:3,date:'2026-10-31'});assert.equal(totals(s.workers[0],s.month).deficit,9);assert.equal(s.month.settlementHistory[0].workers[0].paidTotal,900);closeMonth(s);
  assert.equal(s.month.key,'2026-12');assert.deepEqual(s.month,december);assert.equal(debt(s,'w'),509);const october=s.archives.find(a=>a.key==='2026-10');assert.equal(october.workers[0].payable,0);assert.equal(october.workers[0].paidTotal,900);
  s=selectPeriod(s,'2026-10',{reopen:true});assert.equal(debt(s,'w'),500);assert.equal(s.month.settlementHistory.length,2);assert.equal(valid(s),true);
});
test('accidental closing can be explicitly corrected without discarding its history',async()=>{
  const {selectPeriod}=await import('../ledger.js');let s=fixture();closeMonth(s);assert.throws(()=>selectPeriod(s,'2026-10'),/closed-period/);s=selectPeriod(s,'2026-10',{reopen:true,undoPaid:true});assert.equal(totals(s.workers[0],s.month).payable,900);assert.equal(s.month.settlementHistory.length,1);assert.equal(s.month.paymentCorrection.reason,'accidental-close-no-payment');
});
test('reopening cannot erase a carried debt which has already been repaid',async()=>{
  const {selectPeriod}=await import('../ledger.js');const s=fixture();tx(s,'advance',1000);closeMonth(s);tx(s,'cash',600);const before=structuredClone(s);assert.throws(()=>selectPeriod(s,'2026-10',{reopen:true}),/settled-period-debt/);assert.deepEqual(s,before);
});
test('parked periods and prior payment metadata survive full clipboard backup',async()=>{
  const {selectPeriod}=await import('../ledger.js');const {createTransferCode,parseTransferCode,transferSummary}=await import('../transfer.js');let s=fixture();tx(s,'late',.5);s=selectPeriod(s,'2026-12');tx(s,'overtime',1.5);assert.deepEqual(parseTransferCode(createTransferCode(s)),s);assert.equal(transferSummary(s).openEntries,2);assert.equal(valid(s),true);
});
test('legacy clipboard import tolerates direction marks, missing display prefix and code fences',async()=>{
  const {createTransferCode,parseTransferCode,TRANSFER_PREFIX}=await import('../transfer.js');const s=fixture(),code=createTransferCode(s);
  assert.deepEqual(parseTransferCode('\u200f'+code+'\u200e'),s);
  assert.deepEqual(parseTransferCode(code.slice(TRANSFER_PREFIX.length)),s);
  assert.deepEqual(parseTransferCode('```text\n'+code.match(/.{1,60}/g).join('\n')+'\n```'),s);
});
test('compressed backup round-trips all saved information and is shorter for long records',async()=>{
  const {createTransferCode,createPortableTransferCode,parsePortableTransferCode,COMPACT_PREFIX}=await import('../transfer.js');const s=fixture();tx(s,'late',.5);s.month.entries[0].note='ملاحظات العامل والتأخير والمسائي والديون '.repeat(3000);
  const compact=await createPortableTransferCode(s);assert.ok(compact.startsWith(COMPACT_PREFIX));assert.ok(compact.length<createTransferCode(s).length/4);assert.deepEqual(await parsePortableTransferCode(compact),s);assert.deepEqual(await parsePortableTransferCode('\u200f'+compact.match(/.{1,77}/g).join('\n')+'\u200e'),s);
});
test('incomplete backup has an explicit diagnostic and never yields a partial ledger',async()=>{
  const {createTransferCode,createPortableTransferCode,parsePortableTransferCode,parseTransferCode}=await import('../transfer.js');const s=fixture();const compact=await createPortableTransferCode(s),legacy=createTransferCode(s);
  await assert.rejects(parsePortableTransferCode(compact.slice(0,-16)),error=>error.code==='backup-incomplete');
  assert.throws(()=>parseTransferCode(legacy.slice(0,-16)),error=>error.code==='backup-incomplete');
  await assert.rejects(parsePortableTransferCode(''),error=>error.code==='backup-empty');
});
test('compressed backup corruption is rejected and legacy JSON files remain supported',async()=>{
  const {createPortableTransferCode,parsePortableTransferCode}=await import('../transfer.js');const s=fixture(),code=await createPortableTransferCode(s);const index=code.lastIndexOf(':')+20;const corrupted=code.slice(0,index)+(code[index]==='A'?'B':'A')+code.slice(index+1);
  await assert.rejects(parsePortableTransferCode(corrupted));assert.deepEqual(await parsePortableTransferCode(JSON.stringify(s)),s);
});

test('clipboard truncation at 20000 characters rejects partial data and compact backup restores all',async()=>{
  const {createTransferCode,createPortableTransferCode,parsePortableTransferCode}=await import('../transfer.js');const s=fixture();tx(s,'late',.5);s.month.entries[0].note='long-transport-record-'.repeat(2000);const old=createTransferCode(s);assert.ok(old.length>20000);await assert.rejects(parsePortableTransferCode(old.slice(0,20000)),error=>error.code==='backup-incomplete');const compact=await createPortableTransferCode(s);assert.ok(compact.length<20000);assert.deepEqual(await parsePortableTransferCode(compact),s);
});
