import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';

// Exercise the recovered Worker's real command handler and diary functions
// with SQLite. No Telegram request or production data is involved.
const bundle=readFileSync(new URL('../dist/worker.js',import.meta.url),'utf8');
const diary=await import('data:text/javascript;base64,'+Buffer.from(bundle+'\nexport {listHabits,checkIn,undoCheckIn,handleHabitCommand,habitsSummary};').toString('base64'));
const {handleHabitCommand,habitsSummary}=diary;

function fixture(){
  const sqlite=new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../migrations/0008_habits.sql',import.meta.url),'utf8'));
  sqlite.exec("DELETE FROM habit_entries; DELETE FROM habits; INSERT INTO habits(id,name,target_value,unit,started_on) VALUES('walk','Walk 10 km',10,'km','2026-01-01')");
  const env={DB:{prepare(sql){let values=[];const real=/\b(?:habits|habit_entries)\b/.test(sql);
    return {bind(...v){values=v;return this;},
      async first(){return real?sqlite.prepare(sql).get(...values)||null:sql.includes('FROM settings')?{timezone:'America/Buenos_Aires'}:null;},
      async all(){return {results:real?sqlite.prepare(sql).all(...values):[]};},
      async run(){return {success:true,meta:{changes:real?Number(sqlite.prepare(sql).run(...values).changes):0}};}};
  }}};
  return {sqlite,env,command:text=>handleHabitCommand(env,text),entry:()=>sqlite.prepare('SELECT value,source FROM habit_entries').get()};
}

test('Telegram records sub-8 km progress without claiming completion or streak credit',async()=>{
  const f=fixture();try {
    const reply=await f.command('/done walk 7');assert.match(reply,/progress saved — 7 km/);
    assert.match(reply,/Today's streak is not complete/);assert.equal(f.entry().value,7);
    const summary=await habitsSummary(f.env);assert.match(summary,/7 km · Progress saved — streak not complete/);
    assert.match(summary,/1 habit left today/);
  } finally {f.sqlite.close();}
});

test('bare Telegram completion upgrades existing progress to the full goal in one row',async()=>{
  const f=fixture();try {
    await f.command('/done walk 7');const reply=await f.command('/done walk');
    assert.equal(f.entry().value,10);assert.match(reply,/done — 10 km/);assert.doesNotMatch(reply,/Already logged/);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM habit_entries').get().n,1);
    assert.equal((await diary.listHabits(f.env))[0].doneToday,true);
  } finally {f.sqlite.close();}
});

test('near-goal replies and summaries retain the near-goal distance without rounding up to 10',async()=>{
  const f=fixture();try {
    const reply=await f.command('/done walk 9,999');assert.equal(f.entry().value,9.999);
    assert.match(reply,/9\.99 km · Almost there/);assert.match(reply,/Streak credit earned/);
    const summary=await habitsSummary(f.env);assert.match(summary,/9\.99 km · Almost there — streak counts/);
    assert.match(summary,/All clear for today/);
    await f.command('/done walk');assert.equal(f.entry().value,9.999);
  } finally {f.sqlite.close();}
});

test('repeating a bare completion preserves an existing measured distance above the target',async()=>{
  const f=fixture();try {
    await f.command('/done walk 12');const reply=await f.command('/done walk');
    assert.equal(f.entry().value,12);assert.match(reply,/Already logged for today — 12 km/);
  } finally {f.sqlite.close();}
});

test('lowering a completed Telegram day below 8 km gives truthful progress feedback',async()=>{
  const f=fixture();try {
    await f.command('/done walk 9');const reply=await f.command('/done walk 7');
    assert.match(reply,/Today's streak is not complete/);assert.doesNotMatch(reply,/streak intact/);
    assert.equal((await diary.listHabits(f.env))[0].doneToday,false);
  } finally {f.sqlite.close();}
});

test('ordinary yes/no habits retain bare completion behavior',async()=>{
  const f=fixture();try {
    f.sqlite.exec("UPDATE habits SET name='Read',unit='',target_value=NULL");
    const reply=await f.command('/done read');assert.equal(f.entry().value,null);
    assert.match(reply,/<b>Read<\/b> done/);assert.equal((await diary.listHabits(f.env))[0].doneToday,true);
  } finally {f.sqlite.close();}
});
