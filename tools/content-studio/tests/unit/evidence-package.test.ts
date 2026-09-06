import {it,expect} from 'vitest';
import {mkdtemp,mkdir,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
const script=resolve('tests/e2e/package-evidence.mjs');
it('audit package preserves JSON independently of HTML report cleanup and verifies paths by hash',async()=>{
 const cwd=await mkdtemp(resolve(tmpdir(),'studio-audit-'));await mkdir(resolve(cwd,'tools/content-studio/test-results'),{recursive:true});await mkdir(resolve(cwd,'tools/content-studio/playwright-report/local-backend'),{recursive:true});
 const results={stats:{expected:2,unexpected:0,skipped:1},suites:[{title:'fixture packing only'}]};await writeFile(resolve(cwd,'tools/content-studio/test-results/local-backend-results.json'),JSON.stringify(results));await writeFile(resolve(cwd,'tools/content-studio/playwright-report/local-backend/index.html'),'fixture HTML');
 execFileSync(process.execPath,[script],{cwd});expect(JSON.parse(await readFile(resolve(cwd,'audit-evidence/summary/results.json'),'utf8'))).toEqual(results);
 const manifest=JSON.parse(await readFile(resolve(cwd,'audit-evidence/summary/manifest.json'),'utf8'));expect(manifest.files).toHaveLength(2);for(const f of manifest.files)expect((await readFile(resolve(cwd,'audit-evidence',f.location))).byteLength).toBe(f.bytes);
});
it('audit packaging fails when an executed HTML report loses its JSON instead of reporting success',async()=>{
 const cwd=await mkdtemp(resolve(tmpdir(),'studio-audit-missing-'));await mkdir(resolve(cwd,'tools/content-studio/playwright-report/local-backend'),{recursive:true});await writeFile(resolve(cwd,'tools/content-studio/playwright-report/local-backend/index.html'),'fixture HTML');
 expect(()=>execFileSync(process.execPath,[script],{cwd,stdio:'pipe'})).toThrow('result JSON is missing');
});
