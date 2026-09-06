import {createServer,request} from 'node:http';
import {spawn} from 'node:child_process';

/** Start the actual shipped CLI in a separate process; health never contacts GitHub. */
export async function productionStartSmoke(env:Record<string,string>):Promise<void>{
 const probe=createServer();await new Promise<void>(r=>probe.listen(0,'127.0.0.1',r));const port=(probe.address() as {port:number}).port;await new Promise<void>(r=>probe.close(()=>r()));
 const child=spawn(process.execPath,['production/server.mjs'],{env:{...process.env,...env,PORT:String(port),PUBLIC_APP_URL:'https://production-smoke.invalid'},stdio:['ignore','pipe','pipe'],windowsHide:true});
 let output='';const ready=new Promise<void>((resolve,reject)=>{
   const timer=setTimeout(()=>reject(new Error('Production process did not start')),15000);
   child.once('error',error=>{clearTimeout(timer);reject(error);});child.once('exit',code=>{clearTimeout(timer);reject(new Error('Production startup exited: '+code));});
   child.stdout.on('data',chunk=>{output+=chunk.toString();if(output.includes('production.listening')){clearTimeout(timer);resolve();}});
 });
 try{
   await ready;
   await new Promise<void>((resolve,reject)=>{const req=request({hostname:'127.0.0.1',port,path:'/api/health',headers:{Host:'production-smoke.invalid'}},res=>{let body='';res.on('data',data=>body+=data);res.on('end',()=>{try{const value=JSON.parse(body);if(res.statusCode!==200||value.mode!=='server'||!value.configured)throw new Error('Health identity mismatch');resolve();}catch(error){reject(error);}});});req.once('error',reject);req.end();});
 }finally{child.kill();await new Promise<void>(resolve=>{if(child.exitCode!==null||child.signalCode!==null)resolve();else child.once('exit',()=>resolve());});}
}
