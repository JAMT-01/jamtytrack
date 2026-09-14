import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {habitRewards,journeyRewards,rewardCelebration} from '../worker/habit-rewards.js';
const today='2026-09-13';
const add=(day,n)=>{const d=new Date(day+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);};
function habit(id,dates,extra={}){
 const h={id,name:id,startedOn:'2025-01-01',unit:'km',totalValue:dates.length*10,archived:0,...extra};
 h.rewards=habitRewards(h,dates,today);h.doneToday=dates.includes(today);h.history=dates.filter(date=>date>=add(today,-69));return h;
}
test('a seven-day super streak lasts through the morning grace period, then resets truthfully',()=>{
 const days=Array.from({length:7},(_,i)=>add(today,-i-1));const h=habit('walk',days);
 assert.equal(h.rewards.current,7);assert.equal(h.rewards.tier,'Super streak');assert.equal(h.rewards.next,14);
 const later=habitRewards(h,days,add(today,1));assert.equal(later.current,0);assert.equal(later.xp,70);assert(later.comeback);
 assert(later.badges.find(b=>b.id==='streak-7').earned);
});
test('legendary streaks and lifetime rewards use full history beyond the 70-day calendar',()=>{
 const dates=Array.from({length:365},(_,i)=>add(today,-i));const h=habit('walk',dates);
 assert.equal(h.history.length,70);assert.equal(h.rewards.current,365);assert.equal(h.rewards.tier,'Legendary streak');
 assert.equal(h.rewards.xp,3650);assert(h.rewards.badges.find(b=>b.id==='streak-365').earned);
});
test('duplicate, invalid, future and pre-habit dates cannot create points or streaks',()=>{
 const h=habit('walk',[today,today,add(today,1),'2026-02-30','2024-12-31']);
 assert.equal(h.rewards.xp,10);assert.equal(h.rewards.current,1);
 assert.equal(habitRewards(h,[today],today).xp,10);
 assert.equal(habitRewards(h,[],today).xp,0);
});
test('weekly progress counts days once across habits and resets on Monday in the supplied local date',()=>{
 const a=habit('walk',['2026-09-08','2026-09-10']);const b=habit('read',['2026-09-10']);
 const current=journeyRewards([a,b],today);assert.equal(current.weekStart,'2026-09-07');assert.equal(current.weekDone,2);assert.equal(current.weekTarget,5);
 const monday=journeyRewards([a,b],'2026-09-14');assert.equal(monday.weekDone,0);assert.equal(monday.xp,30);
});
test('new habits get an attainable partial-week goal; no habits cannot earn a perfect day',()=>{
 const h=habit('read',[today],{startedOn:today});const j=journeyRewards([h],today);
 assert.equal(j.weekTarget,1);assert(j.weekComplete);assert(j.perfectDay);
 const empty=journeyRewards([],today);assert.equal(empty.weekTarget,0);assert(!empty.weekComplete);assert(!empty.perfectDay);
});
test('archiving keeps earned XP but removes the habit from daily and weekly targets',()=>{
 const a=habit('walk',[today],{archived:1});const b=habit('read',[]);
 const j=journeyRewards([a,b],today);assert.equal(j.xp,10);assert.equal(j.todayTotal,1);assert.equal(j.todayDone,0);assert.equal(j.weekDone,0);
});
test('levels, celebrations and badges respond to saved progress, not repeated clicks or undo',()=>{
 const dates=Array.from({length:9},(_,i)=>add(today,-i-1));
 const before=journeyRewards([habit('walk',dates)],today);const after=journeyRewards([habit('walk',[...dates,today])],today);
 assert.equal(after.level,2);assert.equal(after.levelProgress,0);assert.equal(after.toNextLevel,100);
 assert.equal(rewardCelebration(before,after).title,'Level 2 unlocked');
 assert.equal(rewardCelebration(after,after),null);assert.equal(rewardCelebration(after,before),null);
});
test('the actual authenticated Habits route includes rewards without changing archived-card filtering',async()=>{
 const code=readFileSync(new URL('../dist/worker.js',import.meta.url),'utf8');
 const {default:worker}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
 const current=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Buenos_Aires'}).format(new Date());
 const rows=[{id:'walk',name:'Walk',unit:'km',targetValue:10,startedOn:'2025-01-01',archived:0},{id:'old',name:'Old habit',unit:'',startedOn:'2025-01-01',archived:1}];
 const entries=[{habitId:'walk',doneDate:current,value:10},{habitId:'old',doneDate:current,value:null}];
 const env={APP_PASSWORD:'local-test-only',DB:{prepare(sql){
  return {
   bind(){return this},
   async run(){return {success:true}},
   async first(){return sql.includes('FROM settings')?{timezone:'America/Buenos_Aires'}:null},
   async all(){return {results:sql.includes('FROM habit_entries')?entries:rows}},
  };
 }}};
 const request=(path,init)=>worker.fetch(new Request('https://local.example'+path,init),env,{waitUntil(){}});
 assert.equal((await request('/api/habits')).status,401);
 const auth=await request('/api/auth/login',{method:'POST',body:new URLSearchParams({password:env.APP_PASSWORD})});
 const cookie=auth.headers.get('set-cookie').split(';')[0];
 const result=await (await request('/api/habits',{headers:{cookie}})).json();
 assert.equal(result.habits.length,1);assert.equal(result.habits[0].rewards.xp,10);assert.equal(result.rewards.xp,20);assert.equal(result.rewards.todayTotal,1);
 assert.equal((await (await request('/api/habits?archived=1',{headers:{cookie}})).json()).habits.length,2);
});
