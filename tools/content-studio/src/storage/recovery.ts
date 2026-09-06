import { recoveryPackageSchema, type RecoveryPackage } from '../domain/recovery-package';
import { parseBoundedJson } from '../domain/bounded-json';
import { publicationInputKey } from '../domain/publication-input';
import { hasUnappliedImage, UNAPPLIED_IMAGE_MESSAGE } from '../domain/generation-input';
import { stableStringify } from '../generation/stable';
import { canonicalCharacterRecordSchema } from '../generation/catalog';
import { PUBLISH_LIMITS, assertPublishSize } from '../domain/publish-limits';
import type { ArtifactBundle, ArtifactFile, DraftRecord } from '../domain/types';
import { serializeBundle } from '../github/server-gateway';
import { digestBlob, getDraft, type OutboxRecord } from './db';

export async function migrationContentHash(draft:DraftRecord):Promise<string>{
  return digestBlob(new Blob([publicationInputKey({...draft,id:'migration-content'})]));
}
function assertDraftMatchesBundle(draft:DraftRecord,bundle:Pick<ArtifactBundle,'character'>):void{
  if(draft.publishedEdit?.mode!=='information'&&hasUnappliedImage(draft))throw new Error(UNAPPLIED_IMAGE_MESSAGE);
  if(stableStringify(draft.character)!==stableStringify(bundle.character))throw new Error('選択した下書きと凍結した公開内容のキャラクター情報が一致しません。保存物は保持しています。');
}
export async function exportRecovery(item:OutboxRecord,repository:string):Promise<Blob>{
  const draft=await getDraft(item.draftId);
  if(!draft||!item.bundle.inputKey||item.bundle.inputKey!==publicationInputKey(draft)||!item.bundle.recoveryBranch||!item.prepared?.operationDigest||!item.actor)throw new Error('現行の実GitHub公開操作と下書きの対応を証明できません。旧形式・mock履歴は移行できません。保存物は保持しています。');
  assertDraftMatchesBundle(draft,item.bundle);
  const serialized=await serializeBundle(item.bundle);
  const value=recoveryPackageSchema.parse({format:'content-studio-recovery-v1',mode:'server',actor:item.actor,draftContentHash:await migrationContentHash(draft),hint:{repository,branch:item.bundle.recoveryBranch,baseSha:item.prepared.commitSha,operationDigest:item.prepared.operationDigest,headSha:item.result?.commitSha,pullRequestNumber:item.result?.number},
    bundle:{bundleId:serialized.bundleId,generatorVersion:serialized.generatorVersion,createdAt:item.bundle.createdAt,character:item.bundle.character,spriteMetadata:item.bundle.spriteMetadata,sourceRevision:serialized.sourceRevision,revalidation:serialized.revalidation,prBody:serialized.prBody,files:serialized.files}});
  const blob=new Blob([JSON.stringify(value)],{type:'application/json'});
  if(blob.size>PUBLISH_LIMITS.maxRequestBytes)throw new Error('復旧パッケージが24MiBを超えています。元の保存物は保持しています。');
  return blob;
}
export async function readRecovery(file:Blob,draft:DraftRecord):Promise<{value:RecoveryPackage;bundle:ArtifactBundle}>{
  if(file.size>PUBLISH_LIMITS.maxRequestBytes)throw new Error('復旧パッケージは24MiB以内です。');
  const value=recoveryPackageSchema.parse(parseBoundedJson(await file.text()));
  assertDraftMatchesBundle(draft,value.bundle);
  if(value.draftContentHash!==await migrationContentHash(draft))throw new Error('選択した下書きと復旧情報の内容が一致しません。先に元の下書きJSONを読み込んでください。');
  assertPublishSize(value.bundle.files);
  const files:ArtifactFile[]=[];
  for(const file of value.bundle.files){
    const bytes=Uint8Array.from(atob(file.contentBase64),c=>c.charCodeAt(0));
    const blob=new Blob([bytes],{type:file.mimeType});
    if(blob.size!==file.byteLength||await digestBlob(blob)!==file.sha256)throw new Error('復旧生成物のhash・容量が一致しません。');
    files.push({path:file.path,mimeType:file.mimeType,byteLength:file.byteLength,sha256:file.sha256,kind:'metadata' as const,...(file.mimeType.startsWith('image/')?{blob}:{text:await blob.text()})});
  }
  const canonicals=files.filter(file=>file.path.startsWith('content/characters/')&&file.path.endsWith('.json'));
  if(canonicals.length!==1||!canonicals[0].text)throw new Error('復旧情報の正規レコードを確認できません。');
  const canonical=canonicalCharacterRecordSchema.parse(parseBoundedJson(canonicals[0].text));
  if(stableStringify(canonical.character)!==stableStringify(value.bundle.character))throw new Error('復旧情報と正規レコードのキャラクター情報が一致しません。');
  return {value,bundle:{...value.bundle,files,inputKey:publicationInputKey(draft),recoveryBranch:value.hint.branch,issues:[]}};
}
