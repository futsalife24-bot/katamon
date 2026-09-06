import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { preflight } from './preflight.js';
import { createProductionHandler } from './production-runtime.js';

try {
  const {config,release}=await preflight(fileURLToPath(new URL('.',import.meta.url)));
  const handler=createProductionHandler({config},release);
  const server=createServer({maxHeaderSize:16*1024},(request,response)=>{void handler(request,response).catch(()=>{if(!response.headersSent)response.writeHead(500,{'Cache-Control':'no-store'});response.end();});});
  server.requestTimeout=30_000;server.headersTimeout=15_000;server.keepAliveTimeout=5_000;server.maxRequestsPerSocket=100;
  server.maxConnections=64;
  server.listen(config.port,config.host,()=>process.stdout.write(JSON.stringify({event:'production.listening',version:release.manifest.version,sourceSha:release.manifest.sourceSha,mode:'server'})+'\n'));
}catch{process.stderr.write('Production startup refused. Validate production settings and release with preflight.mjs.\n');process.exitCode=1;}
