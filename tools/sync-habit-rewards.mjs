import fs from 'node:fs';
import assert from 'node:assert/strict';
import { stripTypeScriptTypes } from 'node:module';
const root=new URL('../',import.meta.url);
const path=new URL('dist/worker.js',root);
let bundle=fs.readFileSync(path,'utf8');
const code=['worker/habit-completion.js','worker/habit-rewards.js'].map(file=>fs.readFileSync(new URL(file,root),'utf8').replace(/^export /gm,'')).join('\n');
const start='// BEGIN HABIT REWARDS\n',end='// END HABIT REWARDS\n';
if(bundle.includes(start))bundle=bundle.slice(0,bundle.indexOf(start))+bundle.slice(bundle.indexOf(end)+end.length);
const insertion=bundle.indexOf('const SELECT_HABIT =');assert(insertion>=0);
bundle=bundle.slice(0,insertion)+start+code+'\n'+end+bundle.slice(insertion);
const habitsSource=fs.readFileSync(new URL('worker/habits.ts',root),'utf8');
const sourceStart=habitsSource.indexOf('export async function listHabits(');
const sourceEnd=habitsSource.indexOf('export async function getHabit(',sourceStart);
const listStart=bundle.indexOf('async function listHabits(');
const listEnd=bundle.indexOf('async function getHabit(',listStart);
assert(sourceStart>=0&&sourceEnd>sourceStart&&listStart>=0&&listEnd>listStart);
const listCode=stripTypeScriptTypes(habitsSource.slice(sourceStart,sourceEnd),{mode:'strip'}).replace(/^export /gm,'');
bundle=bundle.slice(0,listStart)+listCode+bundle.slice(listEnd);
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
const checkStart=bundle.search(/app\.post\(["']\/api\/habits\/:id\/check["'],/);
const checkEnd=bundle.indexOf('app.delete("/api/habits/:id/check",',checkStart);
assert(checkStart>=0&&checkEnd>checkStart);
bundle=bundle.slice(0,checkStart)+fs.readFileSync(new URL('worker/habits-check-route.js',root),'utf8').replaceAll('\r\n','\n')+'\n'+bundle.slice(checkEnd);
const reminders=fs.readFileSync(new URL('worker/habit-reminders.ts',root),'utf8');
for(const [sourceName,nextSource,bundleName,nextBundle] of [
 ['function statusLine(','export async function habitsSummary(','function statusLine(','async function habitsSummary('],
 ['export async function handleHabitCommand(','async function refresh(','async function handleHabitCommand(','async function refresh('],
]){
 const sourceFrom=reminders.indexOf(sourceName),sourceTo=reminders.indexOf(nextSource,sourceFrom);
 const bundleFrom=bundle.indexOf(bundleName),bundleTo=bundle.indexOf(nextBundle,bundleFrom);
 assert(sourceFrom>=0&&sourceTo>sourceFrom&&bundleFrom>=0&&bundleTo>bundleFrom);
 const compiled=stripTypeScriptTypes(reminders.slice(sourceFrom,sourceTo),{mode:'strip'}).replace(/^export /gm,'');
 bundle=bundle.slice(0,bundleFrom)+compiled+bundle.slice(bundleTo);
}
fs.writeFileSync(path,bundle);
console.log('Updated rewards calculation and the authenticated Habits read route.');
