import { readFile, lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import { createApiHandler, type ApiDependencies } from './app.js';
import { STUDIO_APP_PATH, STUDIO_RUNTIME_VERSION, STUDIO_RELEASE_SCHEMA } from '../src/domain/runtime-contract.js';
import { operationContext } from './operation-budget.js';
import { LEGACY_CHARACTERS } from '../src/domain/legacy-characters.js';

const fileSchema=z.object({url:z.string().max(240),path:z.string().max(240),sha256:z.string().regex(/^[a-f0-9]{64}$/),bytes:z.number().int().min(1).max(16*1024*1024),mime:z.enum(['text/html','application/javascript','text/css','application/manifest+json','image/png','image/webp','image/svg+xml'])}).strict();
const releaseSchema=z.object({schemaVersion:z.literal(STUDIO_RELEASE_SCHEMA),mode:z.literal('server'),version:z.literal(STUDIO_RUNTIME_VERSION),appPath:z.literal(STUDIO_APP_PATH),sourceSha:z.string().regex(/^[a-f0-9]{40}$/),files:z.array(fileSchema).min(5).max(128)}).strict();
export type ProductionRelease={manifest:z.infer<typeof releaseSchema>;files:Map<string,{bytes:Buffer;mime:string;hash:string}>};
const MIME:Record<string,string>={'.html':'text/html','.js':'application/javascript','.css':'text/css','.webmanifest':'application/manifest+json','.png':'image/png','.webp':'image/webp','.svg':'image/svg+xml'};

async function safeFile(root:string,relative:string,max:number):Promise<Buffer>{
  if(!/^[a-zA-Z0-9_./-]+$/.test(relative)||relative.startsWith('/')||relative.split('/').some(p=>p==='.'||p==='..'||!p))throw new Error('RELEASE_FILES: invalid path');
  let current=root;
  for(const component of relative.split('/')){current=path.join(current,component);if((await lstat(current)).isSymbolicLink())throw new Error('RELEASE_FILES: symbolic links are not allowed');}
  const resolved=await realpath(current),inside=path.relative(root,resolved);
  if(inside.startsWith('..')||path.isAbsolute(inside))throw new Error('RELEASE_FILES: outside distribution');
  const stat=await lstat(resolved);if(!stat.isFile()||stat.size>max)throw new Error('RELEASE_FILES: file exceeds limit');
  const bytes=await readFile(resolved);if(bytes.length>max)throw new Error('RELEASE_FILES: file changed');return bytes;
}

/** Preload only verified release files. Requests never reopen the filesystem or follow a late symlink. */
export async function loadProductionRelease(directory:string):Promise<ProductionRelease>{
  const root=await realpath(directory);
  let manifest:z.infer<typeof releaseSchema>;
  try{manifest=releaseSchema.parse(JSON.parse((await safeFile(root,'release.json',128*1024)).toString('utf8')));}
  catch{throw new Error('RELEASE_MANIFEST: expected a complete server build matching runtime '+STUDIO_RUNTIME_VERSION);}
  const files:ProductionRelease['files']=new Map();let total=0;
  for(const file of manifest.files){
    if(file.path!=='public'+file.url||file.mime!==MIME[path.extname(file.path)]||files.has(file.url))throw new Error('RELEASE_FILES: inconsistent path, MIME or duplicate');
    if(!/^\/tools\/content-studio\/(?:index\.html|offline\.html|sw\.js|manifest\.webmanifest|assets\/[A-Za-z0-9_.-]+\.(?:js|css)|icons\/[A-Za-z0-9_-]+\.(?:png|svg))$/.test(file.url)&&!LEGACY_CHARACTERS.some(c=>file.url===`/assets/characters/runtime/${c.asset}.webp`||file.url===`/assets/characters/master/${c.asset}.png`))throw new Error('RELEASE_FILES: non-public file');
    total+=file.bytes;if(total>32*1024*1024)throw new Error('RELEASE_FILES: distribution exceeds 32 MiB');
    const bytes=await safeFile(root,file.path,file.bytes);
    if(bytes.length!==file.bytes||createHash('sha256').update(bytes).digest('hex')!==file.sha256)throw new Error('RELEASE_FILES: content hash mismatch');
    files.set(file.url,{bytes,mime:file.mime,hash:file.sha256});
  }
  for(const required of ['index.html','sw.js','manifest.webmanifest'])if(!files.has(STUDIO_APP_PATH+required))throw new Error('RELEASE_FILES: required PWA file is missing');
  for(const character of LEGACY_CHARACTERS) if(!files.has(`/assets/characters/runtime/${character.asset}.webp`) || !files.has(`/assets/characters/master/${character.asset}.png`))throw new Error('RELEASE_FILES: required legacy image missing');
  const html=files.get(STUDIO_APP_PATH+'index.html')!.bytes.toString('utf8');
  for(const match of html.matchAll(/(?:src|href)="\.\/([^"?#]+)"/g))if(!files.has(STUDIO_APP_PATH+match[1]))throw new Error('RELEASE_FILES: HTML reference is missing');
  if(!html.includes('name="studio-repository-mode" content="server"'))throw new Error('RELEASE_MODE: server PWA required');
  return {manifest,files};
}

const PWA_CSP="default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; worker-src 'self' blob:; connect-src 'self'; manifest-src 'self'; font-src 'self'; media-src 'self' blob:; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self'";
function reject(response:ServerResponse,status:number){response.writeHead(status,{'Cache-Control':'no-store','Content-Type':'text/plain; charset=utf-8','X-Content-Type-Options':'nosniff'});response.end(status===404?'Not found':'Request rejected');}

export function createProductionHandler(dependencies:ApiDependencies,release:ProductionRelease){
  const api=createApiHandler(dependencies);
  let active = 0;
  return async(request:IncomingMessage,response:ServerResponse):Promise<void>=>{
    response.setHeader('Strict-Transport-Security','max-age=31536000');
    const raw=request.url||'/';const pathname=raw.split('?',1)[0];
    // Reject before WHATWG URL normalization; all distribution paths are ASCII and need no percent encoding.
    if(!pathname.startsWith('/')||pathname.startsWith('//')||/[%\\\x00-\x20#]/.test(pathname)||pathname.split('/').some(p=>p==='.'||p==='..'))return reject(response,400);
    if (request.headers.host !== dependencies.config.publicAppUrl.host) return reject(response,421);
    if(pathname==='/api'||pathname.startsWith('/api/')){
      if(active>=4)return reject(response,503);
      active++;
      const controller=new AbortController();
      const abort=()=>controller.abort();
      const timer=setTimeout(()=>{controller.abort();if(!response.writableEnded)reject(response,504);},90_000);
      response.once('close',abort);
      try {await operationContext.run(controller.signal,()=>api(request,response));}
      finally {active--;clearTimeout(timer);response.off('close',abort);}
      return;
    }
    if(request.method!=='GET'&&request.method!=='HEAD'){response.setHeader('Allow','GET, HEAD');return reject(response,405);}
    if(pathname==='/'||pathname===STUDIO_APP_PATH.slice(0,-1)){response.writeHead(308,{Location:STUDIO_APP_PATH,'Cache-Control':'no-store'});response.end();return;}
    const file=release.files.get(pathname===STUDIO_APP_PATH?STUDIO_APP_PATH+'index.html':pathname);
    if(!file)return reject(response,404);
    const immutable=pathname.startsWith(STUDIO_APP_PATH+'assets/');
    response.writeHead(200,{'Content-Type':file.mime+(file.mime.startsWith('text/')||file.mime==='application/javascript'?'; charset=utf-8':''),'Content-Length':file.bytes.length,'Cache-Control':immutable?'public, max-age=31536000, immutable':'no-cache','ETag':'"'+file.hash+'"','Content-Security-Policy':PWA_CSP,'Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Permissions-Policy':'camera=(), microphone=(), geolocation=(), payment=()','Service-Worker-Allowed':STUDIO_APP_PATH});
    response.end(request.method==='HEAD'?undefined:file.bytes);
  };
}
