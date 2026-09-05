import {mkdir,readdir,readFile,writeFile,copyFile,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
// Fixed, already-uploaded CI result directories only. No .env, workspace backup, or external path scan.
const output='audit-evidence',limit=160*1024*1024,files=[];
await mkdir(output); // Refuse to mix a previous run's evidence with this run.
await mkdir(`${output}/summary`);
async function scan(directory){try{for(const entry of await readdir(directory,{withFileTypes:true})){const p=path.join(directory,entry.name);if(entry.isDirectory())await scan(p);else if(entry.isFile())files.push(p);}}catch(e){if(e.code!=='ENOENT')throw e;}}
for(const dir of ['tools/content-studio/playwright-report','tools/content-studio/test-results','playwright-report','test-results/playwright'])await scan(dir);
const manifest=[],unique=new Map(),pictures=[];let part=1,used=0;
for(const file of files.sort()){
 const data=await readFile(file),sha256=createHash('sha256').update(data).digest('hex');
 if(data.length>limit)throw new Error(`Individual evidence file exceeds 160 MiB: ${file}`);
 let location=unique.get(sha256);
 if(!location){if(used+data.length>limit){part++;used=0;}if(part>8)throw new Error('Evidence exceeds eight parts; nothing discarded.');location=`details-${part}/${file.replaceAll('\\','/')}`;await mkdir(path.dirname(`${output}/${location}`),{recursive:true});await copyFile(file,`${output}/${location}`);used+=data.length;unique.set(sha256,location);}
 manifest.push({path:file.replaceAll('\\','/'),bytes:data.length,sha256,location});
 if(/\.(png|json)$/.test(file)){const name=`${sha256}${path.extname(file)}`;await copyFile(file,`${output}/summary/${name}`);if(file.endsWith('.png')&&!pictures.some(p=>p.name===name))pictures.push({name,label:file.replaceAll('\\','/')});}
}
let results;try{results=JSON.parse(await readFile('tools/content-studio/test-results/local-backend-results.json','utf8'));}catch(e){if(files.some(file=>file.replaceAll('\\','/')==='tools/content-studio/playwright-report/local-backend/index.html'))throw new Error('Local-backend HTML exists but result JSON is missing or invalid; audit evidence is incomplete.',{cause:e});results={unavailable:'Local-backend tests did not produce a report; inspect workflow/test failures.'};}
await writeFile(`${output}/summary/results.json`,JSON.stringify(results,null,2));
await writeFile(`${output}/summary/manifest.json`,JSON.stringify({executionSha:process.env.GITHUB_SHA??null,runId:process.env.GITHUB_RUN_ID??null,attempt:process.env.GITHUB_RUN_ATTEMPT??null,parts:part,limitBytes:limit,files:manifest},null,2));
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
await writeFile(`${output}/summary/index.html`,`<!doctype html><meta charset="utf-8"><title>Content Studio audit</title><style>body{font:16px system-ui;margin:2rem;max-width:1000px}img{max-width:100%;max-height:720px}pre{white-space:pre-wrap}</style><h1>Content Studio audit evidence</h1><p>Real frontend/backend; GitHub boundary fixtures. Chromium emulation, not real Android. No production publication. All outcomes, including failures/skips, are retained. Complete report/trace paths and SHA-256 are in manifest.json. Download the indicated details part to inspect a trace; combine indexed paths to open the original full report.</p><p><a href="results.json">Complete test results</a> · <a href="manifest.json">Evidence manifest</a></p><pre>${escape(JSON.stringify(results.stats??results,null,2).slice(0,6000))}</pre>${pictures.map(p=>`<figure><figcaption>${escape(p.label)}</figcaption><a href="${p.name}"><img loading="lazy" src="${p.name}"></a></figure>`).join('')}`);
let summaryBytes=0;for(const entry of await readdir(`${output}/summary`))summaryBytes+=(await stat(`${output}/summary/${entry}`)).size;
if(summaryBytes>limit)throw new Error('Core exceeds 160 MiB; do not upload oversized evidence.');
console.log(JSON.stringify({parts:part,summaryBytes,uniqueFiles:unique.size,originalFiles:files.length,limitBytes:limit}));
