import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Script} from 'node:vm';
import {CLIENT, PAGE} from '../src/page.ts';

// Small DOM harness: exercise the shipped client through form events and a
// controlled clock/network, without contacting Garmin or using real credentials.
const settle=()=>new Promise<void>(resolve=>setImmediate(resolve));
function fixture(options:{initialCooldown?:boolean;statusFailsAfterLogin?:boolean}={}){
 let now=Date.parse('2026-09-13T18:25:40Z');const deadline=now+3_600_000;
 const node=()=>({textContent:'',hidden:false,disabled:false,value:'',handlers:{} as Record<string,Function>,
  classList:{toggle(){}},replaceChildren(){},append(){},addEventListener(event:string,fn:Function){this.handlers[event]=fn;}});
 const nodes=Object.fromEntries([...PAGE.matchAll(/id="([^"]+)"/g)].map(match=>[match[1],node()]));
 const login=node(),verify=node();const submits=[login,verify];const buttons=[...submits,nodes.sync,nodes.disconnect,nodes.restart];
 const calls:string[]=[];let rejected=Boolean(options.initialCooldown);let tick:()=>void;
 new Script(CLIENT).runInNewContext({
  document:{getElementById:(id:string)=>nodes[id],createElement:node,querySelectorAll:(selector:string)=>selector==='button'?buttons:submits},
  Date:class extends Date{static now(){return now;}},setInterval:(fn:()=>void)=>{tick=fn;},
  fetch:async(url:string,init:RequestInit)=>{
   calls.push(init.method+' '+url);
   if(init.method==='POST'){rejected=true;return Response.json({error:'Garmin rejected the sign-in.',code:'rate_limited',retryAt:deadline},{status:429});}
   if(rejected&&options.statusFailsAfterLogin)throw new Error('Status temporarily unavailable');
   return Response.json({connected:false,hasSession:false,pendingMfa:false,habitName:'Walk 10 km',targetKm:10,todayKm:0,
    recent:[],error:rejected?'Garmin returned a rate-limit response.':null,cooldownUntil:rejected?deadline:0});
  },
 });
 function submit(){nodes.email.value='test@example.com';nodes.password.value='test-password';nodes['login-form'].handlers.submit({preventDefault(){}});}
 return {nodes,login,verify,calls,submit,expire(){now=deadline+1;tick();}};
}

test('a failed sign-in keeps its retry deadline visible after the status refresh',async()=>{
 const f=fixture();await settle();assert.equal(f.login.disabled,false);
 f.submit();await settle();
 assert.equal(f.nodes.message.textContent,'Garmin rejected the sign-in.');
 assert.equal(f.nodes.cooldown.hidden,false);assert.match(f.nodes['retry-time'].textContent,/Try again after/);
 assert.match(f.nodes['retry-countdown'].textContent,/60m 0s/);
 assert.equal(f.login.disabled,true);assert.equal(f.verify.disabled,true);assert.equal(f.nodes.sync.disabled,true);
 assert.equal(f.nodes.password.value,'');
 f.submit();await settle();assert.equal(f.calls.filter(call=>call.startsWith('POST')).length,1);
});

test('the error response preserves the cooldown even when refreshing status fails',async()=>{
 const f=fixture({statusFailsAfterLogin:true});await settle();f.submit();await settle();
 assert.equal(f.nodes.cooldown.hidden,false);assert.match(f.nodes['retry-time'].textContent,/Try again after/);
 assert.equal(f.login.disabled,true);assert.equal(f.verify.disabled,true);
});

test('a loaded cooldown expires locally without retrying sign-in or fetching status',async()=>{
 const f=fixture({initialCooldown:true});await settle();assert.equal(f.login.disabled,true);
 const requests=f.calls.length;f.expire();await settle();
 assert.equal(f.login.disabled,false);assert.equal(f.verify.disabled,false);assert.equal(f.nodes.sync.disabled,true);
 assert.match(f.nodes['retry-time'].textContent,/pause has ended/);
 assert.equal(f.calls.length,requests);
});
