import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const code=readFileSync(new URL('../dist/worker.js',import.meta.url),'utf8');
const {default:worker}=await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
async function fixture(){
 const calls=[];const statement={bind(){return this},async first(){return null},async run(){return {success:true}}};
 const env={APP_PASSWORD:'test-passphrase',APP_URL:'https://jamtytrack.example',GARMIN_SYNC_TOKEN:'service-test-only',DB:{prepare(){return statement}},
  GARMIN_SYNC:{async fetch(request){calls.push(request);return new Response('service result')}}};
 const fetch=(path,init)=>worker.fetch(new Request(env.APP_URL+path,init),env,{waitUntil(){}});
 const response=await fetch('/api/auth/login',{method:'POST',body:new URLSearchParams({password:env.APP_PASSWORD})});
 return {fetch,calls,cookie:response.headers.get('set-cookie').split(';')[0]};
}
test('the Garmin page and API remain behind the existing login gate',async()=>{
 const f=await fixture();assert.equal((await f.fetch('/garmin')).status,401);assert.equal((await f.fetch('/api/garmin/status')).status,401);assert.equal(f.calls.length,0);
});
test('signed-in requests use the service binding without forwarding app cookies',async()=>{
 const f=await fixture();const response=await f.fetch('/api/garmin/status',{headers:{cookie:f.cookie}});
 assert.equal(response.status,200);assert.equal(new URL(f.calls[0].url).pathname,'/api/status');
 assert.equal(f.calls[0].headers.get('cookie'),null);assert.equal(f.calls[0].headers.get('authorization'),'Bearer service-test-only');
});
test('old Garmin bookmarks open the connection card in Settings',async()=>{
 const f=await fixture();const response=await f.fetch('/garmin',{headers:{cookie:f.cookie}});
 assert.equal(response.status,302);assert.equal(response.headers.get('location'),'/#settings/garmin');assert.equal(f.calls.length,0);
});
test('cross-origin changes are rejected and same-origin login requests reach the connector',async()=>{
 const f=await fixture();const init={method:'POST',headers:{cookie:f.cookie,origin:'https://untrusted.example','content-type':'application/json'},body:'{}'};
 assert.equal((await f.fetch('/api/garmin/login',init)).status,403);assert.equal(f.calls.length,0);
 init.headers.origin='https://jamtytrack.example';assert.equal((await f.fetch('/api/garmin/login',init)).status,200);assert.equal(f.calls.length,1);
});
