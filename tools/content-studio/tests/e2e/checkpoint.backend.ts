import {test,expect} from '@playwright/test';
for(const size of [128,256,384,512])test(`P3A checkpoint ${size}: actual five-clip generator, three intensities, direction/placement/hit inputs`,async({page},info)=>{
  test.setTimeout(300000);await page.goto('/');
  const results=await page.evaluate(async(size)=>{
    const {createDraft}=await import('/src/domain/defaults.ts' as string),{generateMotionBatch,MOTION_CLIP_IDS}=await import('/src/motion/batch.ts' as string),{createEditingInput}=await import('/src/image/editing-input.ts' as string),{sha256Blob}=await import('/src/generation/hash.ts' as string);
    const canvas=document.createElement('canvas');canvas.width=96;canvas.height=112;const context=canvas.getContext('2d')!;context.fillStyle='#e18338';context.fillRect(24,20,45,78);context.fillStyle='#123456';context.fillRect(61,32,23,15);const raw=context.getImageData(0,0,96,112);raw.data.set([201,199,197,0],0);const source={width:96,height:112,data:raw.data};
    const decode=async(blob:Blob)=>{const bitmap=await createImageBitmap(blob);const c=document.createElement('canvas');c.width=bitmap.width;c.height=bitmap.height;const x=c.getContext('2d')!;x.drawImage(bitmap,0,0);bitmap.close();return {width:c.width,height:c.height,data:x.getImageData(0,0,c.width,c.height).data};};
    const output=[];
    for(const [i,level] of ['subtle','standard','strong'].entries()){
      const draft=createDraft();draft.landmarks={...draft.landmarks,facing:i===1?'left':'right',status:'ready',ground:{x:.43,y:.86},muzzle:{x:.77,y:.35}};draft.editor={...draft.editor,outputSize:512,padding:37,offsetX:11,offsetY:-7,scale:.83,flipHorizontal:i===2};draft.motion.outputSize=size;draft.motionIntensity=Object.fromEntries(MOTION_CLIP_IDS.map((id:string)=>[id,level]));
      const hit=i===1?{...source,data:new Uint8ClampedArray(source.data)}:undefined;if(hit)hit.data.set([77,155,199,255],(40*96+40)*4);
      const placement={padding:draft.editor.padding,offsetX:draft.editor.offsetX,offsetY:draft.editor.offsetY,scale:draft.editor.scale,flipHorizontal:draft.editor.flipHorizontal,referenceSize:512};
      const first=await generateMotionBatch({source,hitSource:hit,sourceImage:'normalized.png',landmarks:draft.landmarks,sourcePlacement:placement,outputSize:size,intensity:draft.motionIntensity,generatedAt:'2026-01-01T00:00:00.000Z'});
      const saved=await createEditingInput(draft,source,hit,first),restored=await decode(saved.source),restoredHit=saved.hitSource?await decode(saved.hitSource):undefined;
      if(restored.data[0]!==0||restored.data[1]!==0||restored.data[2]!==0)throw new Error('erased RGB leaked');
      const second=await generateMotionBatch({source:restored,hitSource:restoredHit,sourceImage:'normalized.png',landmarks:{...draft.landmarks,...saved.checkpoint.landmarks},sourcePlacement:saved.checkpoint.placement,outputSize:saved.checkpoint.outputSize,intensity:saved.checkpoint.intensity,generatedAt:'2026-01-01T00:00:00.000Z'});
      output.push({size,level,facing:draft.landmarks.facing,flip:placement.flipHorizontal,hit:!!hit,clips:await Promise.all(MOTION_CLIP_IDS.map(async(id:string)=>({id,before:await sha256Blob(first[id].spriteSheetPng.blob),after:await sha256Blob(second[id].spriteSheetPng.blob),renderingBefore:first[id].metadata.rendering,renderingAfter:second[id].metadata.rendering,parametersBefore:first[id].metadata.motionParameters,parametersAfter:second[id].metadata.motionParameters})))});
    }
    return output;
  },size);
  for(const row of results)for(const clip of row.clips){expect(clip.after).toBe(clip.before);expect(clip.renderingAfter).toEqual(clip.renderingBefore);expect(clip.parametersAfter).toEqual(clip.parametersBefore);}
  await info.attach('checkpoint-roundtrip',{body:JSON.stringify(results),contentType:'application/json'});
});
