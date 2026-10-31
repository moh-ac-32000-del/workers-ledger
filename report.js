import {round,workDurationParts,payRates,DEFAULT_MONTHLY_RULES} from './ledger.js';

export const attendanceTypes = ['absence', 'overtime', 'late'];
export function attendance(entries, workerId) {
  return Object.fromEntries(attendanceTypes.map(type => [type,
    entries.filter(e => e.workerId === workerId && e.type === type).reduce((sum, e) => sum + e.value, 0)]));
}
export function entryAmount(entry, salary, rules=DEFAULT_MONTHLY_RULES) {
  const rates=payRates(salary,rules);
  if (entry.type === 'absence') return round(entry.value * rates.daily);
  if (entry.type === 'late') return round(entry.value * rates.hourly);
  if (entry.type === 'overtime') return round(entry.value * rates.overtime);
  return entry.value;
}

export function createReports({t, num, esc, amount, btn}) {
  const quantity = (type, value) => {
    if(type==='absence')return `${num(value)} ${t('dayUnit')}`;
    const parts=workDurationParts(value);
    if(!parts.minutes)return `${num(parts.hours)} ${t('hourUnit')}`;
    if(!parts.hours)return `${num(parts.minutes)} ${t('minuteUnit')}`;
    return `${num(parts.hours)} ${t('hourUnit')} ${num(parts.minutes)} ${t('minuteUnit')}`;
  };
  function attendanceCards(worker, entries, salary, rules=DEFAULT_MONTHLY_RULES) {
    const counts = attendance(entries, worker.id);
    return `<div class="attendance-grid">${attendanceTypes.map(type => `<div class="attendance-card" data-attendance="${type}"><span>${t(type)}</span><strong>${quantity(type, counts[type])}</strong><small>${t(type === 'overtime' ? 'addition' : 'deductionAmount')}: ${amount(entryAmount({type, value: counts[type]}, salary, rules))}</small></div>`).join('')}</div>`;
  }
  function salarySummary(s) {
    const rows = [['salary', s.salary], ['overtime', s.overtime], ['absence', s.absence], ['late', s.late], ['advance', s.advances], ['deduct', s.deduction]];
    const body=`<dl class="salary-breakdown">${rows.map(([key,value])=>`<div><dt>${t(key)}</dt><dd>${amount(value)}</dd></div>`).join('')}</dl>`;
    return `<details class="profile-section salary-details screen-only"><summary><span>${t('salaryBreakdown')}</span><strong>${amount(s.salary)}</strong></summary>${body}</details><section class="profile-section print-only"><h3>${t('salaryBreakdown')}</h3>${body}</section>`;
  }
  function activityGroups(entries, salary, editable = false, rules=DEFAULT_MONTHLY_RULES) {
    const types = [...attendanceTypes, 'advance', 'convert', 'deduct', 'cash'];
    return types.map(type => {
      const group = entries.filter(e => e.type === type).toSorted((a,b)=>a.date.localeCompare(b.date));
      if (!group.length && !attendanceTypes.includes(type)) return '';
      const isTime = attendanceTypes.includes(type);
      const sum = group.reduce((n,e)=>n+e.value,0);
      const totalAmount=entryAmount({type,value:sum},salary,rules);
      const title=`<span class="group-name">${t(type)}</span><span class="group-metrics">${isTime?`<span class="quantity-badge">${quantity(type,sum)}</span>`:''}<strong title="${t('financialAmount')}">${amount(totalAmount)}</strong></span>`;
      const records=group.map(e=>`<li><details class="activity-entry" data-entry-id="${esc(e.id)}"><summary class="entry-summary ${isTime?'':'money-entry'}"><time datetime="${esc(e.date)}"><bdi>${esc(e.date)}</bdi></time>${isTime?`<span class="entry-quantity">${quantity(type,e.value)}</span>`:''}<strong class="entry-amount">${amount(entryAmount(e,salary,rules))}</strong><span class="entry-chevron" aria-hidden="true"></span></summary><div class="entry-details"><dl><div><dt>${t('date')}</dt><dd><bdi>${esc(e.date)}</bdi></dd></div>${isTime?`<div><dt>${t(type==='absence'?'dayCount':'hourCount')}</dt><dd>${quantity(type,e.value)}</dd></div>`:''}<div><dt>${t('financialAmount')}</dt><dd>${amount(entryAmount(e,salary,rules))}</dd></div><div class="entry-note"><dt>${t('note')}</dt><dd>${esc(e.note)||'—'}</dd></div></dl>${editable?`<div class="actions">${btn(t('editEntryAction'),`edit-entry:${e.id}`)}${btn(t('deleteEntryAction'),`remove:${e.id}`,'danger')}</div>`:''}</div></details></li>`).join('');
      const screen=`<details class="activity-category screen-only" ${group.length?'open':''}><summary class="group-title">${title}<span class="entry-chevron" aria-hidden="true"></span></summary>${group.length?`<div class="entry-list-heading ${isTime?'':'money-entry'}" aria-hidden="true"><span>${t('date')}</span>${isTime?`<span>${t(type==='absence'?'dayCount':'hourCount')}</span>`:''}<span>${t('financialAmount')}</span><span></span></div><ul class="activity-entries">${records}</ul>`:`<p class="empty-group">${t('none')}</p>`}</details>`;
      // Print content is outside collapsed screen details so every note and record is printed.
      const print=`<div class="print-only"><div class="group-title">${title}</div>${group.length?`<table class="activity-table"><thead><tr><th>${t('date')}</th>${isTime?`<th>${t(type==='absence'?'dayCount':'hourCount')}</th>`:''}<th>${t('financialAmount')}</th><th>${t('note')}</th></tr></thead><tbody>${group.map(e=>`<tr><td>${esc(e.date)}</td>${isTime?`<td>${quantity(type,e.value)}</td>`:''}<td>${amount(entryAmount(e,salary,rules))}</td><td>${esc(e.note)||'—'}</td></tr>`).join('')}</tbody></table>`:`<p class="empty-group">${t('none')}</p>`}</div>`;
      return `<section class="activity-group" data-group="${type}">${screen}${print}</section>`;
    }).join('');
  }
  function ruleSummary(rules=DEFAULT_MONTHLY_RULES){return `<p class="calculation-note">${t('usedRules')}: ${t('dayDivisor')}: ${num(rules.days)} · ${quantity('late',rules.hoursPerDay)} / ${t('dayUnit')} · ${t('overtimeFactor')} × ${num(rules.overtimeMultiplier)}</p>`;}
  function workerReport({worker, summary, entries, month, balance, paid = false, rules=DEFAULT_MONTHLY_RULES}) {
    return `<article class="worker-report" data-report-worker="${esc(worker.id)}"><header class="report-header"><div><small>${t('app')} · ${t('monthlyStatement')}</small><h2>${esc(worker.name)}</h2></div><span class="pill">${esc(month)}</span></header><div class="profile-balances"><div class="balance-primary"><span>${t(paid?(summary.previousPaid?'paidInClosing':'paid'):'payable')}</span><strong>${amount(summary.payable)}</strong></div><div><span>${t('debts')}</span><strong>${amount(balance)}</strong></div></div>${summary.previousPaid?`<p class="calculation-note">${t('previouslyPaid')}: ${amount(summary.previousPaid)}. ${t('priorPaymentNote')}</p>`:''}${ruleSummary(rules)}${attendanceCards(worker,entries,summary.salary,rules)}${salarySummary(summary)}${summary.deficit ? `<p>${t('deficit')}: ${amount(summary.deficit)}</p>` : ''}<section class="profile-section"><h3>${t('activity')}</h3>${activityGroups(entries.filter(e=>e.workerId===worker.id),summary.salary,false,rules)}</section></article>`;
  }
  return {attendanceCards, salarySummary, activityGroups, workerReport,ruleSummary};
}
