const {defineConfig}=require('@playwright/test');
const path=require('node:path');
module.exports=defineConfig({
  testDir:'./e2e',testMatch:'content-studio-registration.spec.js',workers:1,retries:0,timeout:120000,
  outputDir:'../test-results/registration',reporter:[['list'],['json',{outputFile:path.resolve(__dirname,'../test-results/registration-results.json')}],['html',{open:'never',outputFolder:path.resolve(__dirname,'../playwright-report/registration')}]],
  use:{actionTimeout:15000,baseURL:'http://127.0.0.1:4183',browserName:'chromium',viewport:{width:390,height:844},isMobile:true,hasTouch:true,serviceWorkers:'block',trace:'retain-on-failure'},
  webServer:{command:'node node_modules/http-server/bin/http-server . -p 4183 -c-1 --silent',cwd:'..',url:'http://127.0.0.1:4183/index.html',reuseExistingServer:false},
});
