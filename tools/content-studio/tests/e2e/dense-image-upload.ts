import type {Page} from '@playwright/test';
/** Deterministic, real PNG with high pixel entropy for bounded-payload measurements. */
export async function attachDenseCharacter(page:Page){
 await page.getByTestId('image-input').waitFor({state:'attached'});
 await page.evaluate(async()=>{
   const canvas=document.createElement('canvas');canvas.width=canvas.height=256;
   const context=canvas.getContext('2d')!,pixels=context.createImageData(256,256);let seed=1729;
   for(let i=0;i<pixels.data.length;i+=4){seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;pixels.data[i]=seed&255;pixels.data[i+1]=(seed>>>8)&255;pixels.data[i+2]=(seed>>>16)&255;pixels.data[i+3]=255;}
   context.putImageData(pixels,0,0);const blob=await new Promise<Blob>(resolve=>canvas.toBlob(blob=>resolve(blob!),'image/png'));
   const transfer=new DataTransfer();transfer.items.add(new File([blob],'dense-fixture.png',{type:'image/png'}));
   const input=document.querySelector<HTMLInputElement>('[data-testid="image-input"]')!;input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));
 });
}
