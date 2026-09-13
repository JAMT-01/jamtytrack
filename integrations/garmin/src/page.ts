export const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Garmin · Jamtytrack</title>
<style>
:root{font-family:system-ui,sans-serif;color:#211d18;background:#f7f6f2;color-scheme:light}*{box-sizing:border-box}body{margin:0;padding:32px 20px}main{max-width:620px;margin:auto}a{color:#805013}header{display:flex;justify-content:space-between;gap:20px;align-items:center;margin-bottom:30px}header a{text-decoration:none;font-weight:650}h1{font-size:32px;letter-spacing:-1px;margin:0 0 10px}p{line-height:1.6;color:#696157}section{padding:25px;margin:20px 0;background:white;border:1px solid #e8e3da;border-radius:22px}h2{font-size:19px;margin:0 0 16px}label{display:block;font-size:14px;font-weight:600;margin:17px 0 7px}input{display:block;width:100%;padding:13px;border:1px solid #cfc8bd;border-radius:10px;font:inherit}button{border:0;border-radius:12px;padding:13px 18px;font:inherit;font-weight:650;cursor:pointer;background:#ed780c;color:#201810}button:disabled{opacity:.5;cursor:wait}form button{width:100%;margin-top:20px}.muted{font-size:13px}.secondary{background:#f0ece5;margin-right:7px}.danger{background:#fbe7e4;color:#98231b}.status{background:#ece9e2;border-radius:9px;padding:12px;margin-top:14px;font-size:14px;line-height:1.5}.status.error{background:#fff0eb;color:#9d3315}.status:empty{display:none}#distance{font-size:35px;font-weight:750;letter-spacing:-1px}#recent{padding-left:20px;line-height:1.8}#actions{display:flex;gap:8px;flex-wrap:wrap}footer{font-size:12px;color:#82796e;line-height:1.6}[hidden]{display:none!important}
</style><script src="/api/garmin/client.js" defer></script></head><body><main><header><a href="/">← Jamtytrack</a><span>Walking habit</span></header>
<h1>Connect Garmin</h1><p>Your recorded walks can complete your daily walking habit automatically.</p>
<div id="message" class="status" role="status" aria-live="polite">Loading connection status…</div>
<section id="summary" hidden><h2 id="habit-name">Walk 10 km</h2><div id="distance"></div><p id="sync-status"></p><div id="actions"><button id="sync" class="secondary">Sync now</button><button id="disconnect" class="danger">Disconnect</button></div><h2 style="margin-top:24px">Recent imported walks</h2><ul id="recent"></ul></section>
<section id="signin" hidden><h2>Sign in to Garmin Connect</h2><p class="muted">Your password is used for sign-in and is never saved. Only the resulting session is stored, encrypted, in your Cloudflare account.</p><form id="login-form"><label for="email">Garmin email</label><input id="email" name="email" type="email" autocomplete="username" required maxlength="254"><label for="password">Garmin password</label><input id="password" name="password" type="password" autocomplete="current-password" required maxlength="1024"><button type="submit">Connect and sync walks</button></form></section>
<section id="verification" hidden><h2>Verify your Garmin sign-in</h2><p>Enter the verification code from Garmin.</p><form id="mfa-form"><label for="code">Verification code</label><input id="code" name="code" inputmode="numeric" autocomplete="one-time-code" required maxlength="12"><button type="submit">Verify and connect</button></form><button id="restart" class="secondary" style="margin-top:12px">Start again</button></section>
<section><h2>How it works</h2><p>Save a <strong>Walk</strong> activity on your Garmin and sync the watch with Garmin Connect. Jamtytrack checks every 15 minutes and adds up your recorded walking distances using your app’s timezone.</p><p>Automatic check-ins begin today. Your existing manual history stays intact. You can disconnect at any time.</p><p class="muted">This is a personal, unofficial Garmin integration. If Garmin requires verification or rejects cloud access, we’ll show the problem here and pause syncing.</p></section>
<footer>Connection details are sent only to Garmin and your own Jamtytrack services. Meal and photo data are not sent to Garmin.</footer></main></body></html>`;

export const CLIENT = `'use strict';
const byId=id=>document.getElementById(id);let busy=false;let canSync=false;
function message(text,error=false){byId('message').textContent=text;byId('message').classList.toggle('error',error);}
function buttons(){document.querySelectorAll('button').forEach(b=>b.disabled=busy);byId('sync').disabled=busy||!canSync;}
async function api(path,body){
 const response=await fetch('/api/garmin/'+path,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),cache:'no-store'});
 let data;try{data=await response.json();}catch{throw new Error('The connection service did not respond. Please reload.');}
 if(!response.ok)throw new Error(data.error||'The request could not be completed.');return data;
}
async function refresh(){
 const state=await api('status');
 byId('summary').hidden=!state.hasSession;byId('signin').hidden=state.pendingMfa||state.connected;
 byId('verification').hidden=!state.pendingMfa;
 byId('habit-name').textContent=state.habitName;
 byId('distance').textContent=state.todayKm.toFixed(2)+' / '+state.targetKm+' km';
 byId('sync-status').textContent=(state.connected?'Automatic sync is on. ':'Automatic sync is paused. ')+(state.lastSync?'Last synced '+new Date(state.lastSync).toLocaleString()+'.':'No successful sync yet.');
 canSync=state.connected&&state.cooldownUntil<=Date.now();buttons();
 byId('recent').replaceChildren();
 for(const walk of state.recent){const li=document.createElement('li');li.textContent=walk.day+' · '+(walk.distanceMeters/1000).toFixed(2)+' km';byId('recent').append(li);}
 if(!state.recent.length){const li=document.createElement('li');li.textContent='No walks imported yet.';byId('recent').append(li);}
 if(state.error){message(state.error+(state.cooldownUntil>Date.now()?' Try again after '+new Date(state.cooldownUntil).toLocaleTimeString()+'.':''),true);}
 else if(state.pendingMfa){message('Garmin is waiting for your verification code.');}
 else if(state.connected){message('Garmin is connected. Recorded walks will sync automatically.');}
 else{message('Sign in below to test the connection and start syncing.');}
}
async function run(action,text){
 if(busy)return;busy=true;buttons();message(text);
 try{await action();await refresh();}catch(error){try{await refresh();}catch{}message(error.message,true);}
 finally{busy=false;buttons();}
}
byId('login-form').addEventListener('submit',event=>{event.preventDefault();
 const email=byId('email').value;const password=byId('password').value;byId('password').value='';
 run(()=>api('login',{email,password}),'Connecting to Garmin…');});
byId('mfa-form').addEventListener('submit',event=>{event.preventDefault();const code=byId('code').value;byId('code').value='';run(()=>api('verify',{code}),'Verifying your sign-in…');});
byId('sync').addEventListener('click',()=>run(()=>api('sync',{}),'Checking your recorded walks…'));
byId('disconnect').addEventListener('click',()=>run(()=>api('disconnect',{}),'Disconnecting Garmin…'));
byId('restart').addEventListener('click',()=>run(()=>api('cancel',{}),'Resetting sign-in…'));
refresh().catch(error=>message(error.message,true));
`;
