'use strict';
// Android USB転送用。外部host/upstream/LAN bindの設定は受け取らない。
const http=require('node:http'),https=require('node:https');
const {PORTS}=require('./core.cjs');
const USB_PORT=42885;
function createUsbEntry({cert}) {
  if(!cert)throw Error('上流HTTPSを検証する証明書が必要です');
  return http.createServer((req,res)=>{
    const hosts=[`localhost:${USB_PORT}`,`127.0.0.1:${USB_PORT}`];
    const deny=()=>{res.writeHead(403,{'Cache-Control':'no-store'}).end('USB localhost入口の許可範囲外です');};
    if(!hosts.includes(req.headers.host)||req.headers['sec-fetch-site']==='cross-site')return deny();
    if(req.headers.origin&&req.headers.origin!=='http://'+req.headers.host)return deny();
    if(!req.url.startsWith('/')||req.url.startsWith('//')||req.headers.authorization||req.headers['x-lab-stop'])return deny();
    let url;try{url=new URL(req.url,'http://'+req.headers.host);}catch{return deny();}
    if(url.pathname==='/__lab/stop')return deny();
    const headers={host:`localhost:${PORTS.web}`};
    for(const name of ['content-type','accept','if-match','x-firebase-etag','last-event-id','sec-fetch-site'])if(req.headers[name])headers[name]=req.headers[name];
    if(req.headers.origin)headers.origin=`https://localhost:${PORTS.web}`;
    const upstream=https.request({hostname:'127.0.0.1',port:PORTS.web,servername:'localhost',ca:cert,path:req.url,method:req.method,headers},remote=>{
      if(remote.statusCode>=300&&remote.statusCode<400){remote.resume();res.writeHead(502).end('redirect拒否');return;}
      res.writeHead(remote.statusCode,remote.headers);res.flushHeaders();remote.pipe(res);
    });
    upstream.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end('固定loopback HTTPSへ接続できません');});
    res.on('close',()=>upstream.destroy());req.pipe(upstream);
  });
}
module.exports={USB_PORT,createUsbEntry};
