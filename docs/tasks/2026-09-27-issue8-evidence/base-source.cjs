const fs=require('fs'),path=require('path');const read=fs.readFileSync;
fs.readFileSync=function(p,...args){if(typeof p==='string'&&path.resolve(p)===path.resolve('index.html'))return read.call(this,path.resolve('output/issue8/base-index.html'),...args);return read.call(this,p,...args);};
