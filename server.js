import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const root=import.meta.dirname;
const publicFiles=new Set(['index.html','style.css','app.js','ledger.js','storage.js','i18n.js','report.js','manifest.webmanifest','sw.js','icon.svg','icon-192.png','icon-512.png']);
http.createServer((req,res)=>{
  let pathname;
  try { pathname=decodeURIComponent(req.url.split('?')[0]); }
  catch {res.writeHead(400).end();return;}
  const file=pathname==='/'?'index.html':pathname.slice(1);
  if(!publicFiles.has(file)){res.writeHead(404).end();return;}
  fs.readFile(path.join(root,file),(error,body)=>{
    if(error){res.writeHead(404).end();return;}
    res.setHeader('Content-Type',({'html':'text/html; charset=utf-8','js':'text/javascript; charset=utf-8','css':'text/css; charset=utf-8','svg':'image/svg+xml','png':'image/png','webmanifest':'application/manifest+json'})[file.split('.').pop()]);
    res.setHeader('X-Content-Type-Options','nosniff');
    if(file==='sw.js')res.setHeader('Cache-Control','no-cache');
    res.end(body);
  });
}).listen(5173,'0.0.0.0',()=>console.log('Workers Ledger: http://localhost:5173'));
