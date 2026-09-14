import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {habitCompletion, summarizeHabitEntries} from '../worker/habit-completion.js';
import {habitRewards, journeyRewards} from '../worker/habit-rewards.js';

const movement={id:'movement',name:'Walk 10 km',unit:'km',targetValue:10,startedOn:'2026-01-01',archived:0};
const day='2026-09-14';
test('8 km is inclusive and 10 km marks the full goal without rounding at either boundary',()=>{
  for(const [value,status] of [[0,'progress'],[7.9999,'progress'],[8,'near'],[9,'near'],[9.9999,'near'],[10,'full'],[12,'full'],[null,'full']])
    assert.equal(habitCompletion(movement,value),status);
  assert.equal(habitCompletion({...movement,targetValue:5},4),'full');
  assert.equal(habitCompletion({...movement,unit:'pages'},8),'full');
});
test('near-goal days extend streaks and earn XP, while a short logged distance remains visible as progress',()=>{
  const entries=[{doneDate:'2026-09-12',value:10},{doneDate:'2026-09-13',value:8},{doneDate:day,value:7.9}];
  const state=summarizeHabitEntries(movement,entries,day);
  assert.equal(state.doneToday,false);assert.equal(state.todayHasEntry,true);assert.equal(state.todayCompletion,'progress');
  assert.equal(state.historyEntries[0].value,7.9);assert.equal(state.historyEntries[1].completion,'near');
  assert.equal(state.totalDone,2);assert.equal(habitRewards({...movement,...state},state.completedDates,day).xp,20);
  entries[2].value=9;
  const near=summarizeHabitEntries(movement,entries,day);
  const rewards=habitRewards({...movement,...near},near.completedDates,day);
  assert.equal(near.doneToday,true);assert.equal(rewards.current,3);assert.equal(rewards.xp,30);
  assert.equal(journeyRewards([{...movement,...near,rewards}],day).weekDone,1);
});
test('historical details retain real values, legacy bare check-ins and only valid local dates',()=>{
  const state=summarizeHabitEntries(movement,[{doneDate:day,value:null},{doneDate:'2026-09-13',value:9.42},
    {doneDate:'2026-09-13',value:9.42},{doneDate:'2026-09-15',value:11},{doneDate:'2026-02-30',value:10}],day);
  assert.equal(state.totalDone,2);assert.equal(state.totalValue,9.42);
  assert.equal(state.todayCompletion,'full');assert.equal(state.todayValue,null);
  assert.equal(state.historyEntries[1].value,9.42);
});

const code=readFileSync(new URL('../dist/worker.js',import.meta.url),'utf8');
const {default:worker}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
async function fixture(){
  const sqlite=new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../migrations/0008_habits.sql',import.meta.url),'utf8'));
  sqlite.exec("DELETE FROM habit_entries; DELETE FROM habits; INSERT INTO habits(id,name,target_value,unit,started_on) VALUES('movement','Walk 10 km',10,'km','2026-01-01')");
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Buenos_Aires'}).format(new Date());
  for(let i=1;i<=6;i++){
    const d=new Date(today+'T12:00:00Z');d.setUTCDate(d.getUTCDate()-i);
    sqlite.prepare('INSERT INTO habit_entries(id,habit_id,done_date,value,source,logged_at) VALUES(?,?,?,?,?,?)')
      .run('existing-'+i,'movement',d.toISOString().slice(0,10),10,'app','fixture');
  }
  const env={APP_PASSWORD:'local-fixture-password',DB:{prepare(sql){
    let values=[];
    const real=/\b(?:habits|habit_entries)\b/.test(sql);
    return {bind(...v){values=v;return this;},
      async first(){return real?sqlite.prepare(sql).get(...values)||null:sql.includes('FROM settings')?{timezone:'America/Buenos_Aires'}:null;},
      async all(){return {results:real?sqlite.prepare(sql).all(...values):[]};},
      async run(){return real?{success:true,meta:{changes:Number(sqlite.prepare(sql).run(...values).changes)}}:{success:true};}};
  }}};
  const request=(path,init)=>worker.fetch(new Request('https://fixture.example'+path,init),env,{waitUntil(){}});
  const login=await request('/api/auth/login',{method:'POST',body:new URLSearchParams({password:env.APP_PASSWORD})});
  const cookie=login.headers.get('set-cookie').split(';')[0];
  return {sqlite,today,async get(){return (await request('/api/habits',{headers:{cookie}})).json();},
    async check(value){return request('/api/habits/movement/check',{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify({value})});},
    async undo(){return request('/api/habits/movement/check',{method:'DELETE',headers:{cookie}});}};
}
test('real bundle manual save, reload, upgrade and undo keep one row and one reward per date',async()=>{
  const f=await fixture();
  try {
    let saved=await f.check(7.999);assert.equal(saved.status,200);
    let state=await f.get();assert.equal(state.habits[0].todayCompletion,'progress');assert.equal(state.rewards.xp,60);
    saved=await f.check(8);assert.equal(saved.status,200);state=await f.get();
    assert.equal(state.habits[0].todayCompletion,'near');assert.equal(state.habits[0].streak,7);
    assert.equal(state.habits[0].rewards.tier,'Super streak');assert.equal(state.rewards.xp,70);assert.equal(state.rewards.todayDone,1);
    await f.check(9.999);state=await f.get();assert.equal(state.habits[0].todayValue,9.999);assert.equal(state.rewards.xp,70);
    await f.check(10);state=await f.get();assert.equal(state.habits[0].todayCompletion,'full');assert.equal(state.rewards.xp,70);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM habit_entries').get().n,7);
    await f.undo();state=await f.get();assert.equal(state.habits[0].todayCompletion,'none');assert.equal(state.rewards.xp,60);
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM habit_entries WHERE id LIKE 'existing-%'").get().n,6);
  } finally {f.sqlite.close();}
});
test('invalid distance requests cannot fabricate a full completion',async()=>{
  const f=await fixture();
  try {for(const bad of [-9,'nonsense','',{},true])assert.equal((await f.check(bad)).status,400);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM habit_entries').get().n,6);
  } finally {f.sqlite.close();}
});
