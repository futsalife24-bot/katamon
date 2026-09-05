import { describe, expect, it, vi } from 'vitest';
import { unzipSync } from 'fflate';
import { PUBLISH_LIMITS as limits, assertPublishSize, assertRequestSize } from '../../src/domain/publish-limits';
import { parseBoundedJson, readBoundedJson } from '../../src/domain/bounded-json';
import { characterFormSchema } from '../../src/domain/schemas';
import { serializeBundle } from '../../src/github/server-gateway';
import { createArtifactZip } from '../../src/generation/zip';
import { sampleBundle } from '../integration/test-bundle';
import { sampleCharacter } from './test-character';
import { canonicalRecordBytes, serverTestConfig, submittedFile } from './server-fixtures';
import { validateSubmission } from '../../server/validation';
import { loadPublishedContent } from '../../src/game/published-content';

describe('capacity, bounded parsing and secret exclusion', () => {
  it('shares server defaults and clamps unsafe environment increases', () => {
    const config=serverTestConfig({MAX_FILE_BYTES:'999999999',MAX_REQUEST_BYTES:'999999999'});
    for (const key of Object.keys(limits) as (keyof typeof limits)[]) expect(config[key]).toBe(limits[key]);
  });
  it('checks exact per-file, total and count boundaries before encoding', () => {
    const f={path:'test.png',byteLength:limits.maxFileBytes};
    expect(()=>assertPublishSize([f])).not.toThrow();
    expect(()=>assertPublishSize([{...f,byteLength:f.byteLength+1}])).toThrow();
    expect(()=>assertPublishSize([f,f,{...f,byteLength:4*1024*1024}])).not.toThrow();
    expect(()=>assertPublishSize([f,f,{...f,byteLength:4*1024*1024+1}])).toThrow();
    expect(()=>assertPublishSize(Array(32).fill({...f,byteLength:1}))).not.toThrow();
    expect(()=>assertPublishSize(Array(33).fill({...f,byteLength:1}))).toThrow();
  });
  it('counts UTF-8 and Base64 expansion, including the outer request wrapper', async () => {
    const bundle=await sampleBundle(); const serialized=await serializeBundle(bundle);
    expect(serialized.files.some(f=>f.path.startsWith('generated/'))).toBe(false);
    for(const f of serialized.files) expect(f.contentBase64.length).toBe(4*Math.ceil(f.byteLength/3));
    expect(()=>assertRequestSize('x'.repeat(limits.maxRequestBytes))).not.toThrow();
    expect(()=>assertRequestSize('x'.repeat(limits.maxRequestBytes)+'あ')).toThrow();
    expect(()=>assertRequestSize(JSON.stringify({preparationId:'a'.repeat(32),bundle:serialized}))).not.toThrow();
  });
  it('rejects oversize Base64 before decoding and deeply nested JSON without RangeError', () => {
    const file=submittedFile('content/characters/sample-unit.json','application/json',canonicalRecordBytes());
    const raw={bundleId:'test',generatorVersion:'0.1.0',character:sampleCharacter(),prBody:'test',files:[file]};
    expect(()=>validateSubmission({...raw,files:[{...file,contentBase64:'A'.repeat(4*Math.ceil(limits.maxFileBytes/3)+4)}]},serverTestConfig())).toThrow();
    const deep='['.repeat(10000)+'0'+']'.repeat(10000);
    expect(()=>parseBoundedJson(deep)).toThrow('階層');
    expect(()=>validateSubmission({...raw,files:[submittedFile(file.path,file.mimeType,Buffer.from(deep))]},serverTestConfig())).toThrow();
    expect(parseBoundedJson('{"quoted":"[[["}')).toEqual({quoted:'[[['});
  });
  it('bounds streaming responses even without content-length', async () => {
    await expect(readBoundedJson(new Response(' '.repeat(101)),100)).rejects.toThrow();
  });
  it('dummy secret cannot become character data, generated ZIP or PR text', async () => {
    const dummy='ghp_'+'DUMMY_SECRET_VALUE_FOR_TEST_ONLY_123456789';
    expect(characterFormSchema.safeParse(sampleCharacter({description:dummy})).success).toBe(false);
    const bundle=await sampleBundle(); const zip=unzipSync(new Uint8Array(await (await createArtifactZip(bundle.files)).arrayBuffer()));
    expect(bundle.prBody).not.toContain(dummy);
    expect(Object.values(zip).some(bytes=>new TextDecoder().decode(bytes).includes(dummy))).toBe(false);
    expect(JSON.stringify(await serializeBundle(bundle))).not.toContain('csrfToken');
  });
  it('retains successful records with a partial warning when one canonical fetch fails', async () => {
    vi.stubGlobal('location',{pathname:'/',origin:'https://studio.invalid'});
    try {
      const fetcher=vi.fn().mockResolvedValueOnce(Response.json({schemaVersion:1,characters:[{contentFile:'content/characters/sample-unit.json',id:'sample-unit',slug:'sample-unit',assetDirectory:'assets/content-studio/sample-unit/0123456789ab'},{contentFile:'content/characters/missing.json'}]})).mockResolvedValueOnce(Response.json(JSON.parse(canonicalRecordBytes().toString()))).mockRejectedValueOnce(new Error('offline'));
      const result=await loadPublishedContent(fetcher);
      expect(result.records).toHaveLength(1); expect(result.state).toBe('partial'); expect(result.warning).not.toBeNull();
      expect((await loadPublishedContent(vi.fn().mockResolvedValue(Response.json({schemaVersion:1,characters:[]})))).state).toBe('complete');
    } finally {vi.unstubAllGlobals();}
  });
});
