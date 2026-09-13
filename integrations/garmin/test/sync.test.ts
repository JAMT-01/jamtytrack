import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {Script} from 'node:vm';
import {GarminClient, normalizeWalks} from '../src/garmin.ts';
import {reconcile, locked} from '../src/store.ts';
import {seal, unseal, authorized} from '../src/secrets.ts';
import {CLIENT} from '../src/page.ts';

const day='2026-09-13';const timezone='America/Buenos_Aires';
function activity(id:number,meters:number,time='2026-09-13 15:00:00',type='walking'){
 return {activityId:id,distance:meters,startTimeGMT:time,activityType:{typeKey:type}};
}
function fixture(){
 const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON');
 sqlite.exec(`CREATE TABLE habits(id TEXT PRIMARY KEY);INSERT INTO habits VALUES('walk');
 CREATE TABLE habit_entries(id TEXT PRIMARY KEY,habit_id TEXT REFERENCES habits(id),done_date TEXT,value REAL,note TEXT,source TEXT,logged_at TEXT,UNIQUE(habit_id,done_date));`);
 sqlite.exec(readFileSync(new URL('../schema.sql',import.meta.url),'utf8'));
 function prepare(sql:string){let values:unknown[]=[];return {bind(...v:unknown[]){values=v;return this;},async first(){return sqlite.prepare(sql).get(...values)||null;},async all(){return {results:sqlite.prepare(sql).all(...values)};},async run(){const r=sqlite.prepare(sql).run(...values);return {meta:{changes:Number(r.changes)},success:true};}};}
 const db={prepare,async batch(statements:ReturnType<typeof prepare>[]){sqlite.exec('BEGIN');try{const r=[];for(const s of statements)r.push(await s.run());sqlite.exec('COMMIT');return r;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
 return {db,sqlite,entries:()=>sqlite.prepare('SELECT * FROM habit_entries ORDER BY done_date').all(),sync:(rows:unknown[])=>reconcile(db,'walk',normalizeWalks(rows,timezone,day,day),day,day,10)};
}
test('only recorded walks count, deduplicated and assigned to the Buenos Aires date',()=>{
 const rows=normalizeWalks([activity(1,3000,'2026-09-14 01:00:00'),activity(1,3000,'2026-09-14 01:00:00'),activity(2,9000,undefined,'running'),activity(3,9000,undefined,'hiking')],timezone,day,day);
 assert.equal(rows.length,1);assert.equal(rows[0].day,day);assert.equal(rows[0].distanceMeters,3000);
 assert.throws(()=>normalizeWalks([activity(4,NaN)],timezone,day,day),/missing a valid/);
});
test('partial walks never complete the habit; 6+4 km complete once, even after repeated syncs',async()=>{
 const f=fixture();await f.sync([activity(1,6000)]);assert.equal(f.entries().length,0);
 await f.sync([activity(1,6000),activity(2,4000)]);await f.sync([activity(1,6000),activity(2,4000)]);
 assert.equal(f.entries().length,1);assert.equal(f.entries()[0].value,10);assert.equal(f.entries()[0].source,'garmin');
});
test('edited and deleted walks recompute only the automatically managed completion',async()=>{
 const f=fixture();await f.sync([activity(1,11000)]);assert.equal(f.entries()[0].value,11);
 await f.sync([activity(1,9000)]);assert.equal(f.entries().length,0);
 await f.sync([activity(1,12000)]);assert.equal(f.entries()[0].value,12);
 await f.sync([]);assert.equal(f.entries().length,0);
});
test('manual check-ins are never overwritten or deleted',async()=>{
 const f=fixture();f.sqlite.prepare("INSERT INTO habit_entries VALUES('manual','walk',?,15,'My own distance','telegram','now')").run(day);
 await f.sync([activity(1,12000)]);await f.sync([]);
 assert.equal(f.entries()[0].value,15);assert.equal(f.entries()[0].note,'My own distance');
});
test('manual removal of an automatic check-in remains an override',async()=>{
 const f=fixture();await f.sync([activity(1,12000)]);f.sqlite.exec('DELETE FROM habit_entries');
 await f.sync([activity(1,12000)]);await f.sync([activity(1,13000)]);assert.equal(f.entries().length,0);
});
test('manual edits of automatic entries transfer ownership to the app',async()=>{
 const f=fixture();await f.sync([activity(1,12000)]);f.sqlite.exec("UPDATE habit_entries SET source='app',value=14,note='manual override'");
 await f.sync([]);assert.equal(f.entries()[0].value,14);
});
test('failed snapshot writes roll back and preserve the existing diary',async()=>{
 const f=fixture();await f.sync([activity(1,12000)]);
 await assert.rejects(()=>reconcile(f.db,'walk',[{id:'2',day,startedAt:'now',distanceMeters:-1}],day,day,10));
 assert.equal(f.entries()[0].value,12);assert.equal(f.sqlite.prepare('SELECT distance_meters FROM garmin_activities').get().distance_meters,12000);
});
test('concurrent refresh/sync is locked and the lock is released after failure',async()=>{
 const f=fixture();await locked(f.db,async()=>{await assert.rejects(()=>locked(f.db,async()=>{}),/already running/);});
 await assert.rejects(()=>locked(f.db,async()=>{throw new Error('test')}));await locked(f.db,async()=>{});
});
test('encrypted session roundtrip rejects tampering and wrong service credentials',async()=>{
 const key='a'.repeat(64);const encrypted=await seal({accessToken:'fake-token'},key);
 assert(!encrypted.includes('fake-token'));assert.deepEqual(await unseal(encrypted,key),{accessToken:'fake-token'});
 await assert.rejects(()=>unseal(encrypted,'b'.repeat(64)));
 assert(await authorized(new Request('https://local',{headers:{Authorization:'Bearer '+key}}),key));
 assert(!await authorized(new Request('https://local',{headers:{Authorization:'Bearer wrong'}}),key));
});
test('Garmin rejection stops immediately without exposing credentials',async()=>{
 let calls=0;const client=new GarminClient(async()=>{calls++;return new Response('sensitive upstream content',{status:429});});
 await assert.rejects(()=>client.login('test@example.com','private-password'),error=>error.code==='rate_limited'&&!error.message.includes('sensitive'));
 assert.equal(calls,1);
});
test('MFA keeps cookies but no password; success yields a renewable session',async()=>{
 const responses=[Response.json({responseStatus:{type:'MFA_REQUIRED'},customerMfaInfo:{mfaLastMethodUsed:'email'}},{headers:{'set-cookie':'sso=test; Secure; HttpOnly'}}),
 Response.json({responseStatus:{type:'SUCCESSFUL'},serviceTicketId:'test-ticket'}),Response.json({access_token:'test-access',refresh_token:'test-refresh',expires_in:3600})];
 const client=new GarminClient(async(url,init)=>{assert(['sso.garmin.com','diauth.garmin.com'].includes(new URL(url).hostname));return responses.shift();});
 const login=await client.login('test@example.com','never-save-me');assert('pending' in login);assert(!JSON.stringify(login).includes('never-save-me'));
 const result=await client.verify(login.pending,'123456');assert.equal(result.session.refreshToken,'test-refresh');
});
test('the connection page client is valid JavaScript',()=>{new Script(CLIENT);});
