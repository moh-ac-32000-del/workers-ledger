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
    return `<section class="profile-section"><h3>${t('salaryBreakdown')}</h3><dl class="salary-breakdown">${rows.map(([key, value]) => `<div><dt>${t(key)}</dt><dd>${amount(value)}</dd></div>`).join('')}</dl></section>`;
  }
  function activityGroups(entries, salary, editable = false, rules=DEFAULT_MONTHLY_RULES) {
    const types = [...attendanceTypes, 'advance', 'convert', 'deduct', 'cash'];
    return types.map(type => {
      const group = entries.filter(e => e.type === type).toSorted((a,b)=>a.date.localeCompare(b.date));
      if (!group.length && !attendanceTypes.includes(type)) return '';
      const isTime = attendanceTypes.includes(type);
      const sum = group.reduce((n,e)=>n+e.value,0);
      return `<section class="activity-group" data-group="${type}"><div class="group-title"><h4>${t(type)}</h4><span>${isTime ? quantity(type,sum) : amount(sum)}</span></div>${group.length ? `<div class="table"><table class="activity-table"><thead><tr><th>${t('date')}</th>${isTime ? `<th>${t(type === 'absence' ? 'dayCount' : 'hourCount')}</th>` : ''}<th>${t('financialAmount')}</th><th>${t('note')}</th>${editable ? `<th class="no-print">${t('actions')}</th>` : ''}</tr></thead><tbody>${group.map(e => `<tr><td data-label="${t('date')}">${esc(e.date)}</td>${isTime ? `<td data-label="${t(type === 'absence' ? 'dayCount' : 'hourCount')}">${quantity(type,e.value)}</td>` : ''}<td data-label="${t('financialAmount')}">${amount(entryAmount(e,salary,rules))}</td><td data-label="${t('note')}">${esc(e.note)||'—'}</td>${editable ? `<td class="no-print">${btn(t('delete'),`remove:${e.id}`,'danger')}</td>` : ''}</tr>`).join('')}</tbody></table></div>` : `<p class="empty-group">${t('none')}</p>`}</section>`;
    }).join('');
  }
  function ruleSummary(rules=DEFAULT_MONTHLY_RULES){return `<p class="calculation-note">${t('usedRules')}: ${t('dayDivisor')}: ${num(rules.days)} · ${quantity('late',rules.hoursPerDay)} / ${t('dayUnit')} · ${t('overtimeFactor')} × ${num(rules.overtimeMultiplier)}</p>`;}
  function workerReport({worker, summary, entries, month, balance, paid = false, rules=DEFAULT_MONTHLY_RULES}) {
    return `<article class="worker-report" data-report-worker="${esc(worker.id)}"><header class="report-header"><div><small>${t('app')} · ${t('monthlyStatement')}</small><h2>${esc(worker.name)}</h2></div><span class="pill">${esc(month)}</span></header><div class="profile-balances"><div class="balance-primary"><span>${t(paid?'paid':'payable')}</span><strong>${amount(summary.payable)}</strong></div><div><span>${t('debts')}</span><strong>${amount(balance)}</strong></div></div>${ruleSummary(rules)}${attendanceCards(worker,entries,summary.salary,rules)}${salarySummary(summary)}${summary.deficit ? `<p>${t('deficit')}: ${amount(summary.deficit)}</p>` : ''}<section class="profile-section"><h3>${t('activity')}</h3>${activityGroups(entries.filter(e=>e.workerId===worker.id),summary.salary,false,rules)}</section></article>`;
  }
  return {attendanceCards, salarySummary, activityGroups, workerReport,ruleSummary};
}
