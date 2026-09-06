import './content-motion';
import { buildRegistrationCandidate } from '../../tools/content-studio/src/generation/registration';
import { canonicalCharacterRecordSchema } from '../../tools/content-studio/src/generation/catalog';
(globalThis as any).makeRegistrationFixture = async (gameSource: string, id='registry-a') => {
  const bundle = await (globalThis as any).makeMotionFixture(128,'right',id);
  const files = new Map<string,any>(bundle.files.map((file:any)=>[file.path,file]));
  const record = canonicalCharacterRecordSchema.parse(JSON.parse(files.get(`content/characters/${id}.json`).text));
  const candidate = await buildRegistrationCandidate([record],gameSource,async path=>{
    const file=files.get(path);
    if(file) return file.text ? new TextEncoder().encode(file.text) : Uint8Array.from(atob(file.base64),c=>c.charCodeAt(0));
    const response=await fetch('/'+path); if(!response.ok) throw new Error('fixture asset absent');return new Uint8Array(await response.arrayBuffer());
  });
  return {candidate,files:bundle.files,record};
};
(globalThis as any).makeRegistrationSeries = async (gameSource:string) => {
  const a=await (globalThis as any).makeRegistrationFixture(gameSource,'registry-a');
  const b=await (globalThis as any).makeRegistrationFixture(gameSource,'registry-b');
  const files=new Map<string,any>([...a.files,...b.files].map(file=>[file.path,file]));
  const read=async(path:string)=>{
    const file=files.get(path);if(file)return file.text?new TextEncoder().encode(file.text):Uint8Array.from(atob(file.base64),c=>c.charCodeAt(0));
    const response=await fetch('/'+path);if(!response.ok)throw new Error('fixture asset absent');return new Uint8Array(await response.arrayBuffer());
  };
  const ab=await buildRegistrationCandidate([a.record,b.record],gameSource,read);
  const updated=canonicalCharacterRecordSchema.parse({...a.record,character:{...a.record.character,maxHp:a.record.character.maxHp+1}});
  const a2b=await buildRegistrationCandidate([updated,b.record],gameSource,read);
  return {...a,publicationFiles:a.files,files:[...a.files,...b.files],ab,a2b};
};
