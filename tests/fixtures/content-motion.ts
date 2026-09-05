// Test-only browser entry. Uses production generation, codec, canonical and catalog builders.
import { generateIdleSpriteSheet } from '../../tools/content-studio/src/motion/generator';
import { motionClipParameters, MOTION_CLIP_IDS } from '../../tools/content-studio/src/motion/batch';
import { encodePixelBuffer } from '../../tools/content-studio/src/image/canvas-codec';
import { normalizeImage } from '../../tools/content-studio/src/image/processing';
import { buildArtifactBundle } from '../../tools/content-studio/src/generation/artifacts';
import { sampleCharacter } from '../../tools/content-studio/tests/unit/test-character';
const date='2026-09-05T00:00:00.000Z';
(globalThis as any).makeMotionFixture=async (outputSize:128|512, facing:'left'|'right')=>{
  const data=new Uint8ClampedArray(64*64*4);
  for(let y=12;y<58;y++)for(let x=18;x<(y<27?52:43);x++)data.set([240,135,25,255],(y*64+x)*4);
  const source={width:64,height:64,data};
  const normal=normalizeImage(source,{outputSize:512,padding:32,offsetX:0,offsetY:0,scale:1,flipHorizontal:facing==='left'}).pixels;
  const png=(await encodePixelBuffer(normal,'image/png')).blob, webp=(await encodePixelBuffer(normal,'image/webp')).blob;
  const motions:any={},metadata:any={};
  for(const clipId of MOTION_CLIP_IDS){
    const alternate={...source,data:new Uint8ClampedArray(data)};
    if(clipId==='hit')for(let i=0;i<alternate.data.length;i+=4){alternate.data[i]=30;alternate.data[i+1]=100;alternate.data[i+2]=240;}
    const preset=clipId==='fire'?'mechanical':clipId==='land'||clipId==='move-backward'?'heavy':'standard';
    const generated=await generateIdleSpriteSheet({source:alternate,sourceFacing:facing,sourceImage:'temporary.png',preset,clipId,action:clipId.startsWith('move')?'move':clipId as any,actionPreset:clipId.startsWith('move')?'move-steady':clipId==='fire'?'fire-recoil':clipId==='hit'?'hit-light':undefined,parameters:motionClipParameters(clipId,facing,outputSize),generatedAt:date,sourcePlacement:{padding:32,offsetX:0,offsetY:0,scale:1,flipHorizontal:facing==='left',referenceSize:512}});
    motions[clipId]=(await encodePixelBuffer(generated.sheet,'image/png')).blob;metadata[clipId]=generated.metadata;
  }
  const bundle=await buildArtifactBundle({legacyTargetId:'hamulton',character:sampleCharacter({id:'hamulton',slug:'hamulton',sourceFacesLeft:facing==='left',specialEnabled:false}),createdAt:date,spriteMetadata:metadata['move-forward'],motionMetadata:metadata,images:{normalizedPng:png,optimizedWebp:webp,iconPng:png,thumbnailWebp:webp,spriteSheetPng:motions['move-forward'],motionSpriteSheets:motions,previewPng:png}});
  const files=[];
  for(const f of bundle.files){let base64='';if(f.blob){const bytes=new Uint8Array(await f.blob.arrayBuffer());for(let i=0;i<bytes.length;i+=8192)base64+=String.fromCharCode(...bytes.subarray(i,i+8192));base64=btoa(base64);}files.push({path:f.path,mimeType:f.mimeType,text:f.text,base64,sha256:f.sha256});}
  return {files,bundleId:bundle.bundleId};
};
