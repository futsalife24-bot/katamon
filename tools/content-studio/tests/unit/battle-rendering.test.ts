import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { generateIdleSpriteSheet } from '../../src/motion/generator';
import { motionClipParameters, MOTION_CLIP_IDS } from '../../src/motion/batch';
import { spriteMetadataSchema } from '../../src/domain/schemas';
import { sampleBundle } from '../integration/test-bundle';
import { buildArtifactBundle } from '../../src/generation/artifacts';
import { sampleCharacter } from './test-character';
const runtime = createRequire(import.meta.url)('../../../../shared/content-studio-motion.js');
const at = '2026-09-05T00:00:00.000Z';
export function artwork(hit=false) {
  const data = new Uint8ClampedArray(64*64*4);
  for(let y=12;y<58;y++)for(let x=18;x<(y<27?52:43);x++)data.set(hit?[40,110,245,255]:[240,135,25,255],(y*64+x)*4);
  return {width:64,height:64,data};
}
const presets = {'move-forward':'standard','move-backward':'heavy',fire:'mechanical',hit:'standard',land:'heavy'} as const;
describe('real generator → rendering contract',()=>{
  for(const outputSize of [128,256,384,512] as const)for(const sourceFacing of ['left','right'] as const)for(const strength of ['subtle','standard','strong'] as const) {
    it(`${outputSize}/${sourceFacing}/${strength}: all five clips, fixed body and planted land`,async()=>{
      for(const clipId of MOTION_CLIP_IDS){
        const generated=await generateIdleSpriteSheet({source:artwork(clipId==='hit'),sourceFacing,sourceImage:'assets/content-studio/sample-unit/aaaaaaaaaaaa/character.png',preset:presets[clipId],parameters:motionClipParameters(clipId,sourceFacing,outputSize,strength),action:clipId.startsWith('move')?'move':clipId as 'fire'|'hit'|'land',clipId,generatedAt:at,sourcePlacement:{padding:32,offsetX:0,offsetY:0,scale:1,flipHorizontal:sourceFacing==='left',referenceSize:512}});
        const m=generated.metadata;
        expect(spriteMetadataSchema.safeParse(m).success).toBe(true);
        expect(runtime.validateMetadata(m,clipId,'assets/content-studio/sample-unit/aaaaaaaaaaaa')).toBe(true);
        expect(m.rendering!.sourceFacing).toBe(sourceFacing);
        const body={x:-24,y:-70,width:48,height:60},p=runtime.placement(m,body),b=m.rendering!.restBounds;
        expect(b.width*p.scaleX).toBeCloseTo(body.width);
        expect(b.height*p.scaleY).toBeCloseTo(body.height);
        expect(p.y+m.rendering!.ground.y*p.scaleY).toBeCloseTo(-10);
        if(clipId==='land')for(let i=m.rendering!.contactFrame;i<m.frameCount;i++)expect(Math.abs(generated.frameBounds[i].y+generated.frameBounds[i].height-m.rendering!.ground.y)).toBeLessThanOrEqual(1);
        if(!m.loop){const last=generated.frameBounds[m.frameCount-1];expect(Math.abs(last.width-b.width)).toBeLessThanOrEqual(2);expect(Math.abs(last.height-b.height)).toBeLessThanOrEqual(2);expect(runtime.frameAt(m,10000)).toBeNull();expect(runtime.frameAt(m,0)).toBe(m.rendering!.contactFrame);}
        expect(runtime.validateMetadata({...m,rendering:undefined},clipId,'assets/content-studio/sample-unit/aaaaaaaaaaaa')).toBe(false);
      }
    },120000);
  }
  it('rendering changes immutable asset identity and rejects invalid ground',async()=>{
    const old=await sampleBundle(),imageFiles=old.files.filter(f=>f.blob);
    const png=imageFiles.find(f=>f.mimeType==='image/png')!.blob!,webp=imageFiles.find(f=>f.mimeType==='image/webp')!.blob!;
    const {metadata}=await generateIdleSpriteSheet({source:artwork(),sourceFacing:'right',sourceImage:'source.png',preset:'standard',clipId:'move-forward',action:'move',parameters:motionClipParameters('move-forward','right',128),generatedAt:at});
    const input={character:sampleCharacter(),spriteMetadata:metadata,createdAt:at,images:{normalizedPng:png,optimizedWebp:webp,iconPng:png,thumbnailWebp:webp,spriteSheetPng:png,previewPng:png}};
    const first=await buildArtifactBundle(input),again=await buildArtifactBundle(input);
    const changed=await buildArtifactBundle({...input,spriteMetadata:{...metadata,rendering:{...metadata.rendering!,sourceFacing:'left'}}});
    expect(first.bundleId).toBe(again.bundleId);expect(first.bundleId).not.toBe(changed.bundleId);
    expect(first.files.find(f=>f.path.endsWith('/character.png'))!.path).not.toBe(changed.files.find(f=>f.path.endsWith('/character.png'))!.path);
    expect(spriteMetadataSchema.safeParse({...metadata,rendering:{...metadata.rendering,ground:{x:0,y:0}}}).success).toBe(false);
  });
});
