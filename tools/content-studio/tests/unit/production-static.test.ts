import {it,expect} from 'vitest';
import {mkdtemp,mkdir,writeFile,symlink,rename} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {loadProductionRelease} from '../../server/production-runtime';
import {LEGACY_CHARACTERS} from '../../src/domain/legacy-characters';
import {STUDIO_RUNTIME_VERSION} from '../../src/domain/runtime-contract';

async function distribution(){
 const root=await mkdtemp(path.join(tmpdir(),'studio-release-test-'));
 const paths=new Map<string,string>([['/tools/content-studio/index.html','<meta name="studio-repository-mode" content="server"><script src="./assets/app-hash.js"></script>'],['/tools/content-studio/sw.js','/* fixture */'],['/tools/content-studio/manifest.webmanifest','{}'],['/tools/content-studio/assets/app-hash.js','/* fixture */']]);
 for(const c of LEGACY_CHARACTERS){paths.set(`/assets/characters/runtime/${c.asset}.webp`,'fixture');paths.set(`/assets/characters/master/${c.asset}.png`,'fixture');}
 const files=[];
 for(const [url,text] of paths){const target=path.join(root,'public'+url);await mkdir(path.dirname(target),{recursive:true});await writeFile(target,text);files.push({url,path:'public'+url,mime:url.endsWith('.png')?'image/png':url.endsWith('.webp')?'image/webp':url.endsWith('.html')?'text/html':url.endsWith('.webmanifest')?'application/manifest+json':'application/javascript',bytes:Buffer.byteLength(text),sha256:createHash('sha256').update(text).digest('hex')});}
 const manifest={schemaVersion:1,mode:'server',version:STUDIO_RUNTIME_VERSION,appPath:'/tools/content-studio/',sourceSha:'a'.repeat(40),files};
 const save=()=>writeFile(path.join(root,'release.json'),JSON.stringify(manifest));await save();return {root,manifest,save};
}
it('release is complete, strictly server/version pinned and hash checked before static requests',async()=>{
 const d=await distribution();expect((await loadProductionRelease(d.root)).files.size).toBe(40);
 d.manifest.mode='mock';await d.save();await expect(loadProductionRelease(d.root)).rejects.toThrow('RELEASE_MANIFEST');d.manifest.mode='server';
 d.manifest.version='old';await d.save();await expect(loadProductionRelease(d.root)).rejects.toThrow('RELEASE_MANIFEST');d.manifest.version=STUDIO_RUNTIME_VERSION;await d.save();
 await writeFile(path.join(d.root,d.manifest.files[0].path),'changed');await expect(loadProductionRelease(d.root)).rejects.toThrow('RELEASE_FILES');
});
it('release rejects traversal, backend sources, absent legacy files and symlink directories',async()=>{
 for(const url of ['/.env','/server/config.ts','/tools/content-studio/../.env','/tools/content-studio/assets/app.js.map']){
   const d=await distribution();d.manifest.files[0].url=url;d.manifest.files[0].path='public'+url;await d.save();await expect(loadProductionRelease(d.root)).rejects.toThrow();
 }
 const missing=await distribution();missing.manifest.files.pop();await missing.save();await expect(loadProductionRelease(missing.root)).rejects.toThrow('legacy');
 const d=await distribution(),assets=path.join(d.root,'public/tools/content-studio/assets'),target=assets+'-real';
 if(!assets.startsWith(d.root+path.sep)||!target.startsWith(d.root+path.sep))throw new Error('Fixture path outside temporary root');
 await rename(assets,target);await symlink(target,assets,process.platform==='win32'?'junction':'dir');
 await expect(loadProductionRelease(d.root)).rejects.toThrow('symbolic links');
});
