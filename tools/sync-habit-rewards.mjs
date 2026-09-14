import fs from 'node:fs';
import assert from 'node:assert/strict';
const root=new URL('../',import.meta.url);
const path=new URL('dist/worker.js',root);
let bundle=fs.readFileSync(path,'utf8');
const code=fs.readFileSync(new URL('worker/habit-rewards.js',root),'utf8').replace(/^export /gm,'');
const start='// BEGIN HABIT REWARDS\n',end='// END HABIT REWARDS\n';
if(bundle.includes(start))bundle=bundle.slice(0,bundle.indexOf(start))+bundle.slice(bundle.indexOf(end)+end.length);
const insertion=bundle.indexOf('const SELECT_HABIT =');assert(insertion>=0);
bundle=bundle.slice(0,insertion)+start+code+'\n'+end+bundle.slice(insertion);
if(!bundle.includes('rewards: habitRewards(')){
 const old='totalValue: bucket.values.reduce((sum, value) => sum + value, 0)';
 assert.equal(bundle.split(old).length,2);
 bundle=bundle.replace(old,old+',\n      rewards: habitRewards({...habit,totalValue:bucket.values.reduce((sum,value)=>sum+value,0)},bucket.dates,today)');
}
const from=bundle.indexOf('app.get("/api/habits",');
const fallback=bundle.indexOf("app.get('/api/habits',");
const routeStart=from>=0?from:fallback;
const routeEnd=bundle.indexOf('app.post("/api/habits",',routeStart);
assert(routeStart>=0&&routeEnd>routeStart);
const route=fs.readFileSync(new URL('worker/habits-read-route.js',root),'utf8').replaceAll('\r\n','\n');
const preamble=route.slice(0,route.indexOf("app.get('/api/habits',"));
let prefix=bundle.slice(0,routeStart);
while(prefix.endsWith(preamble))prefix=prefix.slice(0,-preamble.length);
bundle=prefix+route+'\n'+bundle.slice(routeEnd);
fs.writeFileSync(path,bundle);
console.log('Updated rewards calculation and the authenticated Habits read route.');
