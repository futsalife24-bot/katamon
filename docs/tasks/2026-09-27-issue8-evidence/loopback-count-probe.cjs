const fs=require('fs'),path=require('path'),Module=require('module');
const file=path.resolve('tests/loopbacktest.js');let source=fs.readFileSync(file,'utf8');
source=source.slice(0,source.lastIndexOf('(async () => {'));
source=source.replace('sent++;',"sent++; console.log('RELAY',label,round,from.role,msg.t);");
source+=`(async()=>{for(let i=0;i<12;i++){const r=await runSession({delayRounds:3,autoSpecial:true,label:'probe-'+i});console.log('PROBE',i,JSON.stringify(r));}console.log('ASSERTIONS',pass,fail);process.exit(fail?1:0)})();`;
const m=new Module(file,module);m.filename=file;m.paths=Module._nodeModulePaths(path.dirname(file));m._compile(source,file);
