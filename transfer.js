import {valid} from './storage.js';

export const TRANSFER_PREFIX='WORKERS-LEDGER-1:';
export function createTransferCode(state,now=new Date().toISOString()){
  if(!valid(state))throw Error('backup');
  const data=structuredClone(state);
  // The revision belongs to this browser's write lock, not to the user's records.
  delete data.revision;
  const bytes=new TextEncoder().encode(JSON.stringify({format:'workers-ledger',version:1,exportedAt:now,data}));
  const parts=[];
  for(let start=0;start<bytes.length;start+=8192)parts.push(String.fromCharCode(...bytes.subarray(start,start+8192)));
  return TRANSFER_PREFIX+btoa(parts.join(''));
}
export function parseTransferCode(input){
  const text=String(input).trim();
  let payload;
  if(text.startsWith(TRANSFER_PREFIX)){
    const binary=atob(text.slice(TRANSFER_PREFIX.length).replace(/\s/g,''));
    payload=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(binary,c=>c.charCodeAt(0))));
    if(payload?.format!=='workers-ledger'||payload.version!==1)throw Error('backup');
    payload=payload.data;
  }else payload=JSON.parse(text);
  if(!valid(payload))throw Error('backup');
  delete payload.revision;
  return payload;
}
export function transferSummary(state){
  const week=state.weekly;
  return {
    monthlyWorkers:state.workers.length,
    weeklyWorkers:week?.workers.length??0,
    openEntries:state.month.entries.length+(week?.month.entries.length??0),
    debtRecords:state.debts.length+(week?.debts.length??0),
    archivedPeriods:state.archives.length+(week?.archives.length??0),
  };
}
