import {valid} from './storage.js';

export const TRANSFER_PREFIX='WORKERS-LEDGER-1:';
export const COMPACT_PREFIX='WORKERS-LEDGER-2:';
const transportMarks=/[\s\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g;
function failure(code){const error=new Error(code);error.code=code;return error;}
function snapshotText(state,now){
  if(!valid(state))throw failure('backup-schema');
  const data=structuredClone(state);delete data.revision;
  return JSON.stringify({format:'workers-ledger',version:1,exportedAt:now,data});
}
function base64(bytes){const parts=[];for(let i=0;i<bytes.length;i+=8192)parts.push(String.fromCharCode(...bytes.subarray(i,i+8192)));return btoa(parts.join(''));}
function bytesFromBase64(input){
  let code=String(input).replace(transportMarks,'').replace(/-/g,'+').replace(/_/g,'/');
  if(!code||code.length%4===1)throw failure('backup-incomplete');
  if(!/^[A-Za-z0-9+/]*={0,2}$/.test(code))throw failure('backup-format');
  code=code.padEnd(Math.ceil(code.length/4)*4,'=');
  try{return Uint8Array.from(atob(code),c=>c.charCodeAt(0));}catch{throw failure('backup-format');}
}
function unwrap(input){
  let text=String(input).replace(/^[\s\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]+|[\s\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]+$/g,'');
  const fenced=/^```(?:json|text)?\s*\n?([\s\S]*?)\n?```$/i.exec(text);if(fenced)text=fenced[1].trim();
  if(!text)throw failure('backup-empty');return text;
}
function parsePayload(text,envelopeRequired){
  let payload;
  try{payload=JSON.parse(text);}catch{
    // A complete backup is always a JSON object, never a trailing string/number fragment.
    throw failure(text.trimEnd().endsWith('}')?'backup-format':'backup-incomplete');
  }
  if(payload?.format==='workers-ledger'){
    if(payload.version!==1)throw failure('backup-version');payload=payload.data;
  }else if(envelopeRequired)throw failure('backup-format');
  if(!valid(payload))throw failure('backup-schema');delete payload.revision;return payload;
}
export function createTransferCode(state,now=new Date().toISOString()){
  return TRANSFER_PREFIX+base64(new TextEncoder().encode(snapshotText(state,now)));
}
export async function createPortableTransferCode(state,now=new Date().toISOString()){
  const text=snapshotText(state,now),raw=new TextEncoder().encode(text);
  const legacy=TRANSFER_PREFIX+base64(raw);
  if(typeof CompressionStream==='undefined'||typeof DecompressionStream==='undefined')return legacy;
  try{
    const compressed=new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
    const compact=COMPACT_PREFIX+compressed.length+':'+raw.length+':'+base64(compressed);
    return compact.length<legacy.length?compact:legacy;
  }catch{return legacy;}
}
export function parseTransferCode(input){
  const text=unwrap(input),normalized=text.replace(transportMarks,'');
  if(normalized.toUpperCase().startsWith(COMPACT_PREFIX))throw failure('backup-version');
  if(text.startsWith('{')||text.startsWith('['))return parsePayload(text,false);
  const prefixed=normalized.toUpperCase().startsWith(TRANSFER_PREFIX);
  const encoded=prefixed?normalized.slice(TRANSFER_PREFIX.length):normalized;
  let decoded;try{decoded=new TextDecoder('utf-8',{fatal:true}).decode(bytesFromBase64(encoded));}catch(error){if(String(error.code??'').startsWith('backup-'))throw error;throw failure('backup-format');}
  // Accept a complete legacy envelope if only its display prefix was omitted in transit.
  return parsePayload(decoded,true);
}
export async function parsePortableTransferCode(input){
  const text=unwrap(input),normalized=text.replace(transportMarks,'');
  if(!normalized.toUpperCase().startsWith(COMPACT_PREFIX))return parseTransferCode(text);
  const match=/^WORKERS-LEDGER-2:(\d+):(\d+):([\s\S]*)$/i.exec(normalized);
  if(!match)throw failure('backup-incomplete');
  const compressed=bytesFromBase64(match[3]),expected=Number(match[1]),rawLength=Number(match[2]);
  if(!Number.isSafeInteger(expected)||!Number.isSafeInteger(rawLength)||expected<=0||rawLength<=0||rawLength>64*1024*1024)throw failure('backup-format');
  if(compressed.length!==expected)throw failure('backup-incomplete');
  if(typeof DecompressionStream==='undefined')throw failure('backup-version');
  let raw;
  try{
    const stream=new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'));
    const reader=stream.getReader(),chunks=[];let total=0;
    while(true){const {done,value}=await reader.read();if(done)break;total+=value.length;if(total>rawLength){await reader.cancel();throw failure('backup-format');}chunks.push(value);}
    if(total!==rawLength)throw failure('backup-incomplete');
    raw=new Uint8Array(total);let offset=0;for(const chunk of chunks){raw.set(chunk,offset);offset+=chunk.length;}
  }catch(error){if(String(error.code??'').startsWith('backup-'))throw error;throw failure('backup-format');}
  let decoded;try{decoded=new TextDecoder('utf-8',{fatal:true}).decode(raw);}catch{throw failure('backup-format');}
  return parsePayload(decoded,true);
}
export function transferSummary(state){
  const week=state.weekly;
  return {
    monthlyWorkers:state.workers.length,
    weeklyWorkers:week?.workers.length??0,
    openEntries:state.month.entries.length+(week?.month.entries.length??0)+Object.values(state.openPeriods??{}).reduce((n,p)=>n+p.entries.length,0)+Object.values(week?.openPeriods??{}).reduce((n,p)=>n+p.entries.length,0),
    debtRecords:state.debts.length+(week?.debts.length??0),
    archivedPeriods:state.archives.length+(week?.archives.length??0),
  };
}

// Device preferences are local; payroll rules belong to the transferred ledger.
export function prepareRestore(candidate,current){
  const next=structuredClone(candidate);
  for(const key of ['lang','theme','retention','autoDelete'])next.settings[key]=current.settings[key];
  next.revision=current.revision;
  return next;
}
