import { canonicalCharacterRecordSchema, type CanonicalCharacterRecord } from './catalog';
import { publishedRevisionSchema, type PublishedRevision } from '../domain/editing-checkpoint';
import { assertPublishSize, PUBLISH_LIMITS } from '../domain/publish-limits';
import { parseBoundedJson } from '../domain/bounded-json';
import type { ArtifactBundle, ArtifactFile, CharacterForm, DraftRecord } from '../domain/types';
import { inspectImageBlob } from '../image/header';
import { sha256Blob, sha256Text } from './hash';
import { stableJsonFile, stableStringify, utf8Length } from './stable';
import { buildPullRequestBody } from './pr-body';

export interface PublishedSnapshot { revision:PublishedRevision; record:CanonicalCharacterRecord; files:ArtifactFile[]; }
export function canonicalAssetPaths(record:CanonicalCharacterRecord):string[] {
  const paths=new Set<string>();for(const [key,value] of Object.entries(record.assets))if(key!=='directory'&&value){if(typeof value==='string')paths.add(value);else Object.values(value).forEach(p=>{if(typeof p==='string')paths.add(p);});}return [...paths];
}
export async function gitBlobHash(blob:Blob):Promise<string> {
  const header=new TextEncoder().encode(`blob ${blob.size}\0`),bytes=new Uint8Array(header.length+blob.size);bytes.set(header);bytes.set(new Uint8Array(await blob.arrayBuffer()),header.length);
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-1',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
}
export const artifactBlob=(file:ArtifactFile):Blob=>file.blob??new Blob([file.text??''],{type:file.mimeType});

let reserved=0, slots=0;
/** Reservation remains until an unabortable decode settles, including after timeout. */
export async function acquirePublishedBitmap(blob:Blob,width:number,height:number):Promise<{bitmap:ImageBitmap;release:()=>void}> {
  if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1||width>8192||height>8192)throw new Error('画像寸法が不正です。');
  const bytes=width*height*4;
  if(slots>=2||reserved+bytes>64*1024*1024)throw new Error('画像の読込容量が不足しています。現在の生成物を保持して停止しました。');
  slots++;reserved+=bytes;let timeout:ReturnType<typeof setTimeout>|undefined, expired=false, released=false;
  const release=()=>{if(!released){released=true;slots--;reserved-=bytes;}};
  const task=Promise.resolve().then(()=>createImageBitmap(blob)).then(bitmap=>{
    if(expired){bitmap.close();release();throw new Error('画像読込が時間切れです。');}
    if(bitmap.width!==width||bitmap.height!==height){bitmap.close();release();throw new Error('画像とmetadataの寸法が一致しません。');}
    return {bitmap,release:()=>{if(!released){bitmap.close();release();}}};
  },error=>{release();throw error;});
  try{return await Promise.race([task,new Promise<never>((_,reject)=>{timeout=setTimeout(()=>{expired=true;reject(new Error('画像読込が時間切れです。下書きは保持しています。'));},10000);})]);}finally{clearTimeout(timeout);}
}
export async function validatePublishedSnapshot(snapshot:PublishedSnapshot,decode=true):Promise<PublishedSnapshot> {
  const revision=publishedRevisionSchema.parse(snapshot.revision),record=canonicalCharacterRecordSchema.parse(snapshot.record) as CanonicalCharacterRecord;
  if(record.character.slug!==revision.slug)throw new Error('公開元identityが一致しません。');
  const expected=new Set([`content/characters/${revision.slug}.json`,...canonicalAssetPaths(record)]);
  if(snapshot.files.length!==expected.size)throw new Error('公開生成物が不足または重複しています。');
  assertPublishSize(snapshot.files);
  const seen=new Set<string>();
  for(const f of snapshot.files){
    if(!expected.has(f.path)||seen.has(f.path)||(!f.path.startsWith('content/characters/')&&!f.path.startsWith(record.assets.directory+'/')))throw new Error('公開参照に許可外の場所があります。');seen.add(f.path);
    const blob=artifactBlob(f);if(blob.size!==f.byteLength||await sha256Blob(blob)!==f.sha256)throw new Error('公開生成物のhash/容量が一致しません。');
    const mime=f.path.endsWith('.json')?'application/json':f.path.endsWith('.webp')?'image/webp':f.path.endsWith('.jpg')?'image/jpeg':'image/png';
    if(f.mimeType!==mime||blob.type!==mime)throw new Error('公開生成物のMIMEが一致しません。');
    if(mime==='application/json'){
      const json=parseBoundedJson(await blob.text());
      if(f.path.startsWith('content/characters/')){if(stableStringify(json)!==stableStringify(record)||await gitBlobHash(blob)!==revision.canonicalBlobSha)throw new Error('公開canonicalと元revisionが一致しません。');}
      else{const id=Object.entries(record.assets.motionMetadataJson??{}).find(([,p])=>p===f.path)?.[0];const metadata=id?record.motionMetadata?.[id as keyof NonNullable<typeof record.motionMetadata>]:record.spriteMetadata;if(stableStringify(json)!==stableStringify(metadata))throw new Error('5動作JSONとcanonicalが一致しません。');}
    }else{
      const safety=await inspectImageBlob(blob,f.path.split('/').at(-1)!,{maxInputBytes:PUBLISH_LIMITS.maxFileBytes,maxWidth:8192,maxHeight:8192,maxPixels:16_777_216,maxDecodedBytes:64*1024*1024,decodeMaxDimension:8192});
      const id=Object.entries(record.assets.motionSpriteSheets??{}).find(([,p])=>p===f.path)?.[0];const metadata=id?record.motionMetadata?.[id as keyof NonNullable<typeof record.motionMetadata>]:f.path===record.assets.spriteSheetPng?record.spriteMetadata:null;
      if(metadata&&(safety.header.width!==metadata.frameWidth*metadata.frameCount||safety.header.height!==metadata.frameHeight))throw new Error('5動作PNGとmetadataの寸法が一致しません。');
      const source=f.path===record.assets.editSourcePng?record.editing?.source:f.path===record.assets.editHitPng?record.editing?.hitSource:undefined;
      if(source&&(source.sha256!==f.sha256||source.width!==safety.header.width||source.height!==safety.header.height))throw new Error('編集入力とcanonicalが一致しません。');
      if(decode){const lease=await acquirePublishedBitmap(blob,safety.header.width,safety.header.height);lease.release();}
    }
  }
  return {revision,record,files:snapshot.files};
}
export async function decodePublishedResponse(raw:unknown,decode=true):Promise<PublishedSnapshot> {
  const value=raw as {revision:PublishedRevision;record:CanonicalCharacterRecord;files:Array<{path:string;mimeType:string;byteLength:number;sha256:string;contentBase64:string}>};
  if(!value||!Array.isArray(value.files)||value.files.length>PUBLISH_LIMITS.maxFiles)throw new Error('公開読込応答が不正です。');
  const files:ArtifactFile[]=[];let total=0;
  for(const f of value.files){
    if(typeof f.path!=='string'||typeof f.mimeType!=='string'||typeof f.contentBase64!=='string'||!Number.isSafeInteger(f.byteLength)||f.byteLength<=0||f.byteLength>PUBLISH_LIMITS.maxFileBytes||f.contentBase64.length!==4*Math.ceil(f.byteLength/3)||!/^[A-Za-z0-9+/]*={0,2}$/.test(f.contentBase64))throw new Error('公開ファイルの転送形式・容量が不正です。');
    total+=f.byteLength;if(total>PUBLISH_LIMITS.maxTotalFileBytes)throw new Error('公開データの容量が上限を超えています。');
    const bytes=Uint8Array.from(atob(f.contentBase64),c=>c.charCodeAt(0)),blob=new Blob([bytes],{type:f.mimeType});
    files.push({path:f.path,mimeType:f.mimeType,byteLength:f.byteLength,sha256:f.sha256,kind:f.path.startsWith('content/characters/')?'character-data':f.mimeType==='application/json'?'metadata':'image',...(f.mimeType==='application/json'?{text:new TextDecoder('utf-8',{fatal:true}).decode(bytes)}:{blob})});
  }
  return validatePublishedSnapshot({revision:value.revision,record:value.record,files},decode);
}
/** Only these fields are information-only. Rendering, gameplay identity and skill settings cannot drift through this path. */
export const INFORMATION_FIELDS=['displayName','description','tags','classification'] as const;
export function visualEditKey(draft:DraftRecord):string {
  const {zoom,tool,brushSize,...editor}=draft.editor;
  return stableStringify({editor,operations:draft.processingOperations,landmarks:draft.landmarks,intensity:draft.motionIntensity,outputSize:draft.motion.outputSize,original:draft.originalSha256,hit:draft.hitOriginalSha256});
}
export async function buildInformationBundle(snapshot:PublishedSnapshot,character:CharacterForm):Promise<ArtifactBundle> {
  await validatePublishedSnapshot(snapshot,false);
  const before=snapshot.record, next=structuredClone(before);
  if(before.legacyTargetId&&stableStringify(character)!==stableStringify(before.character))throw new Error('既存キャラはモーションだけ更新できます。');
  const comparable={...character};for(const key of INFORMATION_FIELDS)Object.assign(comparable,{[key]:before.character[key]});
  if(stableStringify(comparable)!==stableStringify(before.character))throw new Error('画像・技・能力の変更は情報編集では公開できません。');
  next.character=structuredClone(character);canonicalCharacterRecordSchema.parse(next);
  const unchanged=stableStringify(next)===stableStringify(before),path=`content/characters/${character.slug}.json`;
  const files=[...snapshot.files];if(!unchanged){const text=stableJsonFile(next);files[files.findIndex(f=>f.path===path)]={path,text,kind:'character-data',mimeType:'application/json',byteLength:utf8Length(text),sha256:await sha256Text(text)};}
  const bundleId=await sha256Text(stableStringify(files.map(f=>[f.path,f.sha256])));
  const issues:ArtifactBundle['issues']=[{severity:'info',code:'published.reuse',message:'公開済み画像と5動作を再生成せず保持します。'}];
  return {bundleId,createdAt:before.spriteMetadata.generatedAt,generatorVersion:before.generatorVersion,character,spriteMetadata:before.spriteMetadata,files,issues,sourceRevision:snapshot.revision,noChanges:unchanged,prBody:buildPullRequestBody({character,spriteMetadata:before.spriteMetadata,files,issues,generatorVersion:before.generatorVersion,legacyTargetId:before.legacyTargetId})};
}

export function editingSourceKeys(draft:DraftRecord){return {normal:stableStringify([draft.originalSha256,draft.processingOperations]),hit:stableStringify(draft.hitOriginalSha256??null)};}
