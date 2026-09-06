import {it,expect} from 'vitest';
import {deflateSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {validateCheckpointPng} from '../../server/validation';
import {serverTestConfig} from './server-fixtures';
function chunk(kind:string,bytes:Buffer){const out=Buffer.alloc(bytes.length+12);out.writeUInt32BE(bytes.length);out.write(kind,4);bytes.copy(out,8);let crc=0xffffffff;for(const byte of out.subarray(4,-4)){crc^=byte;for(let k=0;k<8;k++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}out.writeUInt32BE((crc^0xffffffff)>>>0,out.length-4);return out;}
function png(pixel:number[],extra?:[string,Buffer],headerSize=1){const header=Buffer.alloc(13);header.writeUInt32BE(headerSize);header.writeUInt32BE(1,4);header[8]=8;header[9]=6;return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),...(extra?[chunk(...extra)]:[]),chunk('IDAT',deflateSync(Buffer.from([0,...pixel]))),chunk('IEND',Buffer.alloc(0))]);}
const check=(bytes:Buffer,width=1,sha256=createHash('sha256').update(bytes).digest('hex'))=>validateCheckpointPng(bytes,{width,height:1,sha256},serverTestConfig());
it('checkpoint accepts sanitized opaque and erased pixels',()=>{expect(()=>check(png([2,3,4,255]))).not.toThrow();expect(()=>check(png([0,0,0,0]))).not.toThrow();});
it('checkpoint rejects invisible erased RGB',()=>{expect(()=>check(png([88,99,111,0]))).toThrow('透明領域');});
it.each(['eXIf','tEXt','iTXt'])('checkpoint refuses %s metadata (dummy GPS/local path)',kind=>{expect(()=>check(png([0,0,0,0],[kind,Buffer.from('dummy-only-GPS-C:/dummy/photo.jpg')]))).toThrow('metadata');});
it('checkpoint rejects hash mismatch and oversized dimensions before inflating',()=>{expect(()=>check(png([0,0,0,0]),1,'0'.repeat(64))).toThrow();expect(()=>check(png([0,0,0,0],undefined,4096),4096)).toThrow();});
it('checkpoint bounds decompression independently of compressed PNG size',()=>{const bytes=png(new Array(100000).fill(0));expect(()=>check(bytes)).toThrow('展開');});

it('checkpoint rejects hidden trailing bytes inside an otherwise valid IDAT',()=>{const clean=png([0,0,0,0]),length=clean.readUInt32BE(33),compressed=clean.subarray(41,41+length);const bytes=Buffer.concat([clean.subarray(0,33),chunk('IDAT',Buffer.concat([compressed,Buffer.from('dummy-private-data')])),chunk('IEND',Buffer.alloc(0))]);expect(()=>check(bytes)).toThrow('展開');});
