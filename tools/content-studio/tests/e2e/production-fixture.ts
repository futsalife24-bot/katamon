import {createServer,request as httpsRequest,type Server} from 'node:https';
import {readFile,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {generateKeyPairSync,createHash,randomUUID,X509Certificate} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {loadConfig} from '../../server/config';
import {GitHubClient} from '../../server/github-api';
import {RepositoryService} from '../../server/repository-service';
import {AuditLogger} from '../../server/security';
import {FixtureRepository} from '../unit/repository-fake';

/** Only this test module owns TLS/GitHub/OAuth fixtures. No test HTTP routes in the application. */
export async function productionFixture(){
 const output=await mkdtemp(path.join(tmpdir(),'studio-local-tls-'));
 const openssl=process.platform==='win32'?'C:/Program Files/Git/usr/bin/openssl.exe':'openssl';
 execFileSync(openssl,['req','-x509','-newkey','rsa:2048','-nodes','-keyout',path.join(output,'local-test-key.pem'),'-out',path.join(output,'local-test-cert.pem'),'-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost,IP:127.0.0.1'],{stdio:'ignore'});
 const tls={key:await readFile(path.join(output,'local-test-key.pem')),cert:await readFile(path.join(output,'local-test-cert.pem'))};
 const {privateKey}=generateKeyPairSync('rsa',{modulusLength:2048,privateKeyEncoding:{type:'pkcs8',format:'pem'},publicKeyEncoding:{type:'spki',format:'pem'}});
 const baseEnv={NODE_ENV:'production',GITHUB_OWNER:'target-owner',GITHUB_REPO:'target-repository',GITHUB_BASE_BRANCH:'master',GITHUB_OAUTH_CLIENT_ID:'fixture-client',GITHUB_OAUTH_CLIENT_SECRET:'fixture-oauth-secret',GITHUB_APP_ID:'123456',GITHUB_INSTALLATION_ID:'654321',GITHUB_PRIVATE_KEY:privateKey,ALLOWED_GITHUB_USERS:'allowed-user',SESSION_SECRET:'fixture-stable-secret-only-for-isolated-tests',RATE_LIMIT_MAX:'1000'};
 const runtime=await import(pathToFileURL(path.resolve('production/runtime.mjs')).href);
 const release=await runtime.loadProductionRelease(path.resolve('production'));
 const repo=new FixtureRepository();repo.checks='success';
 const codes=new Map<string,{challenge:string;redirect:string}>();
 const audit:unknown[]=[];
 let cancelled=false,login='allowed-user',permission=true,badPkce=false;
 const listen=async(server:Server,port=0)=>{await new Promise<void>(resolve=>server.listen(port,'127.0.0.1',resolve));return `https://127.0.0.1:${(server.address() as {port:number}).port}`;};
 const oauth=createServer(tls,(req,res)=>{
   const url=new URL(req.url!,'https://fixture.invalid');
   if(url.pathname!=='/login/oauth/authorize'||url.searchParams.get('code_challenge_method')!=='S256'){res.writeHead(400);res.end();return;}
   const redirect=url.searchParams.get('redirect_uri')!;
   if(!/^https:\/\/127\.0\.0\.1:\d+\/api\/auth\/callback$/.test(redirect)){res.writeHead(400);res.end();return;}
   const code=randomUUID();codes.set(code,{challenge:url.searchParams.get('code_challenge')!,redirect});
   const target=new URL(redirect);target.searchParams.set('state',url.searchParams.get('state')!);
   if(cancelled){target.searchParams.set('error','access_denied');cancelled=false;}else target.searchParams.set('code',code);
   res.writeHead(302,{Location:target.href,'Cache-Control':'no-store'});res.end();
 });
 const oauthOrigin=await listen(oauth);
 const fetchBoundary:typeof fetch=async(input,init)=>{
   const url=new URL(String(input));
   if(url.origin===oauthOrigin&&url.pathname==='/login/oauth/access_token'){
     const body=JSON.parse(String(init?.body));const found=codes.get(body.code);codes.delete(body.code);
     if(badPkce||!found||found.redirect!==body.redirect_uri||createHash('sha256').update(body.code_verifier||'').digest('base64url')!==found.challenge){badPkce=false;return Response.json({error:'bad_verifier'},{status:400});}
     return Response.json({access_token:'fixture-ephemeral-oauth-token'});
   }
   if(url.href==='https://api.github.com/user')return Response.json({id:123,login});
   if(url.pathname==='/repos/target-owner/target-repository/installation')return permission?Response.json({id:654321,app_id:123456,suspended_at:null,permissions:{actions:'read',contents:'write',pull_requests:'write',checks:'read',statuses:'read',deployments:'read',administration:'read',metadata:'read'}}):Response.json({},{status:403});
   throw new Error('Unexpected external request in production fixture');
 };
 const instances:Array<{server:Server;origin:string;restart:()=>Promise<void>}>=[];
 for(let i=0;i<2;i++){
   let handler:(req:any,res:any)=>Promise<void>=async(_req,res)=>{res.writeHead(503);res.end();};
   const makeServer=()=>createServer(tls,(req,res)=>{void handler(req,res).catch(()=>{if(!res.headersSent)res.writeHead(500);res.end();});});
   let server=makeServer();
   const origin=await listen(server);
   const initialize=()=>{
     const config=loadConfig({...baseEnv,PUBLIC_APP_URL:origin});if(!config.configured)throw new Error('Fixture configuration invalid');
     config.githubWebUrl=oauthOrigin; // External OAuth transport boundary only, never production env override.
     const github=new GitHubClient(config,fetchBoundary);
     github.getChecks=repo.getChecks.bind(repo);github.getDeployment=repo.getDeployment.bind(repo);github.getMergeProtection=repo.getMergeProtection.bind(repo);
     handler=runtime.createProductionHandler({config,github,repository:new RepositoryService(config,repo),audit:new AuditLogger(config.sessionSecret,event=>audit.push(event))},release);
   };
   initialize();
   const instance={server,origin,restart:async()=>{
     const port=(server.address() as {port:number}).port;server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));
     initialize();server=makeServer();await listen(server,port);instance.server=server;
   }};
   instances.push(instance);
 }
 const spki=createHash('sha256').update(new X509Certificate(tls.cert).publicKey.export({type:'spki',format:'der'})).digest('base64');
 return {instances,repo,release,baseEnv,audit,oauthOrigin,spki,pkceMismatch:()=>{badPkce=true;},cancel:()=>{cancelled=true;},user:(value:string)=>{login=value;},permissions:(value:boolean)=>{permission=value;},
   request:async(origin:string,url:string,method='GET',headers:Record<string,string>={})=>new Promise<{status:number;headers:Record<string,unknown>;body:Buffer}>((resolve,reject)=>{const req=httpsRequest(origin+url,{method,headers,ca:tls.cert},res=>{const chunks:Buffer[]=[];res.on('data',c=>chunks.push(c));res.on('end',()=>resolve({status:res.statusCode!,headers:res.headers,body:Buffer.concat(chunks)}));});req.on('error',reject);req.end();}),
   close:async()=>{for(const server of [oauth,...instances.map(i=>i.server)]){server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}},
 };
}
