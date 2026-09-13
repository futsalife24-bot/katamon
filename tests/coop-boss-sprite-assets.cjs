const sharp=require('sharp'), assert=require('node:assert/strict'), crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..'),sheets=require('../shared/coop-boss-sprite-data.js');
(async()=>{const results=[];for(const [id,s] of Object.entries(sheets)){
const {data,info}=await sharp(path.join(root,s.path)).ensureAlpha().raw().toBuffer({resolveWithObject:true});
assert.equal(info.width,2560);assert.equal(info.height,1280);const hashes=[];
for(let n=0;n<8;n++){const x=n%4*640,y=Math.floor(n/4)*640;
for(let i=0;i<640;i++)for(const [px,py]of [[x+i,y],[x+i,y+639],[x,y+i],[x+639,y+i]])assert.equal(data[(py*info.width+px)*4+3],0,id+' cell edge '+n);
const frame=await sharp(path.join(root,s.path)).extract({left:x,top:y,width:640,height:640}).raw().toBuffer();hashes.push(crypto.createHash('sha256').update(frame).digest('hex'));
for(const p of Object.values(s.frames[n].points))assert.ok(p.every(v=>v>=0&&v<640));
}assert.equal(new Set(hashes).size,8);results.push({id,width:info.width,height:info.height,distinctFrames:8,allCellEdgesTransparent:true,hashes});}
fs.writeFileSync(path.join(root,'docs/tasks/2026-09-13-boss-sprites-evidence/asset-qa.json'),JSON.stringify(results,null,2));console.log('PASS 3 atlases: 24 distinct frames, transparent cell edges, valid markers');})().catch(e=>{console.error(e);process.exitCode=1});
