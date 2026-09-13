import {build as viteBuild} from 'vite';
import {build as bundle} from 'esbuild';
import {readFile,writeFile,mkdir,cp,readdir,lstat,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('..',import.meta.url));
const output=path.join(root,'production');
const version=JSON.parse(await readFile(path.join(root,'package.json'),'utf8')).version;
for(const key of Object.keys(process.env))if(key.startsWith('VITE_')&&!['VITE_APP_VERSION','VITE_REPOSITORY_MODE','VITE_API_BASE_URL'].includes(key))throw new Error('Unsupported public build setting: '+key);
Object.assign(process.env,{VITE_APP_VERSION:version,VITE_REPOSITORY_MODE:'server',VITE_API_BASE_URL:''});
let prior;
try { prior=await lstat(output); } catch(e) { if(e.code!=='ENOENT')throw e; }
if(prior){
 if(prior.isSymbolicLink()||path.dirname(output)!==path.resolve(root))throw new Error('Invalid output');
 const marker=JSON.parse(await readFile(path.join(output,'release.json'),'utf8'));
 if(marker.mode!=='server'||marker.schemaVersion!==1)throw new Error('Refusing to replace an unrecognized output');
 await rm(output,{recursive:true});
}
await mkdir(output,{recursive:true});
await viteBuild({root,envDir:false,mode:'production-server',build:{outDir:path.join(output,'public/tools/content-studio'),emptyOutDir:true}});
await bundle({entryPoints:{server:path.join(root,'server/production.ts'),preflight:path.join(root,'server/preflight-cli.ts'),runtime:path.join(root,'server/production-runtime.ts')},outdir:output,outExtension:{'.js':'.mjs'},splitting:true,bundle:true,platform:'node',target:'node22',format:'esm'});
// Compile only the trusted legacy list to discover the exact permitted static image names.
const legacyBuild=await bundle({entryPoints:[path.join(root,'src/domain/legacy-characters.ts')],bundle:true,platform:'node',format:'esm',write:false});
const {LEGACY_CHARACTERS}=await import('data:text/javascript;base64,'+Buffer.from(legacyBuild.outputFiles[0].contents).toString('base64'));
for(const record of LEGACY_CHARACTERS){let count=0;for(const dir of ['runtime','master'])for(const extension of ['webp','png']){
 const relative=`assets/characters/${dir}/${record.asset}.${extension}`,source=path.resolve(root,'../..',relative);
 try{if((await lstat(source)).isSymbolicLink())throw new Error('Legacy image must not be a link');const dest=path.join(output,'public',relative);await mkdir(path.dirname(dest),{recursive:true});await cp(source,dest);count++;}catch(e){if(e.code!=='ENOENT')throw e;}
}if(!count)throw new Error('Required legacy image missing: '+record.id);}
const files=[],mime={'.html':'text/html','.js':'application/javascript','.css':'text/css','.webmanifest':'application/manifest+json','.png':'image/png','.webp':'image/webp','.svg':'image/svg+xml'};
async function scan(dir){for(const entry of await readdir(dir,{withFileTypes:true})){const full=path.join(dir,entry.name);if(entry.isSymbolicLink())throw new Error('Release cannot contain symbolic links');if(entry.isDirectory()){await scan(full);continue;}const relative=path.relative(path.join(output,'public'),full).replaceAll('\\','/');const bytes=await readFile(full);files.push({url:'/'+relative,path:'public/'+relative,mime:mime[path.extname(relative)],bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});}}
await scan(path.join(output,'public'));
let sourceSha='';
try { sourceSha=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(); } catch {}
if(!/^[a-f0-9]{40}$/.test(sourceSha)) sourceSha=(process.env.SOURCE_SHA??'').trim();
if(!/^[a-f0-9]{40}$/.test(sourceSha)) throw new Error('SOURCE_SHA must be a 40-character commit SHA when git metadata is unavailable');
await writeFile(path.join(output,'release.json'),JSON.stringify({schemaVersion:1,mode:'server',version,appPath:'/tools/content-studio/',sourceSha,files:files.sort((a,b)=>a.url.localeCompare(b.url))},null,2));
console.log(JSON.stringify({mode:'server',version,sourceSha,files:files.length,staticBytes:files.reduce((sum,file)=>sum+file.bytes,0),output:'production'}));
