import {GarminClient, GarminError, normalizeWalks, object, offsetDay} from './garmin.ts';
import type {Pending, Session} from './garmin.ts';
import {authorized, seal, unseal} from './secrets.ts';
import {allowAttempt, config, connection, locked, reconcile, syncStart} from './store.ts';
import {PAGE, CLIENT} from './page.ts';
const headers = {'cache-control':'no-store', 'x-content-type-options':'nosniff', 'referrer-policy':'no-referrer'};
function json(value: unknown, status=200) {return Response.json(value,{status,headers});}
async function fail(env: Env, error: unknown): Promise<GarminError> {
  const safe = error instanceof GarminError ? error : new GarminError('internal', 'The Garmin service could not finish this request. Your sign-in details were not logged.');
  const pause = ['reconnect','blocked','challenge','token_exchange'].includes(safe.code);
  const cooldown = safe.code==='rate_limited' ? Date.now()+3_600_000 : 0;
  if(cooldown)safe.retryAt=cooldown;
  if (!['busy','cooldown','login_limit'].includes(safe.code)) {
    await env.DB.prepare('UPDATE garmin_connection SET last_error=?,error_code=?,cooldown_until=MAX(cooldown_until,?),enabled=CASE WHEN ? THEN 0 ELSE enabled END WHERE id=1')
      .bind(safe.message,safe.code,cooldown,pause?1:0).run();
  }
  console.log(JSON.stringify({event:'garmin_error',code:safe.code}));
  return safe;
}
async function status(env: Env) {
  const row=await connection(env.DB); const settings=await config(env.DB,env.HABIT_ID);
  const sum=await env.DB.prepare('SELECT COALESCE(SUM(distance_meters),0) AS meters FROM garmin_activities WHERE day=?').bind(settings.today).first<{meters:number}>();
  const recent=await env.DB.prepare('SELECT day,distance_meters AS distanceMeters FROM garmin_activities ORDER BY started_at DESC LIMIT 10').all();
  let pendingMfa=false;
  if(row.pending_cipher)pendingMfa=(await unseal<Pending>(row.pending_cipher,env.ENCRYPTION_KEY)).expiresAt>Date.now();
  return {connected:Boolean(row.enabled&&row.session_cipher),hasSession:Boolean(row.session_cipher),pendingMfa,
    lastSync:row.last_sync_at,error:row.last_error,cooldownUntil:row.cooldown_until,habitName:settings.habit.name,targetKm:settings.habit.target_value,
    todayKm:Number(sum?.meters||0)/1000,recent:recent.results};
}
async function sync(env: Env) {
  const row=await connection(env.DB);
  if(!row.enabled||!row.session_cipher)return;
  await allowAttempt(env.DB,false);
  const settings=await config(env.DB,env.HABIT_ID); const start=syncStart(row,settings.today,settings.timezone);
  let session=await unseal<Session>(row.session_cipher,env.ENCRYPTION_KEY);const client=new GarminClient();
  const saveSession=async()=>env.DB.prepare('UPDATE garmin_connection SET session_cipher=? WHERE id=1').bind(await seal(session,env.ENCRYPTION_KEY)).run();
  if(session.expiresAt<Date.now()+300_000){session=await client.refresh(session);await saveSession();}
  let rows:unknown[];
  try{rows=await client.activities(session,offsetDay(start,-1),offsetDay(settings.today,1));}
  catch(error){
    if(!(error instanceof GarminError)||error.code!=='reconnect')throw error;
    session=await client.refresh(session);await saveSession();
    rows=await client.activities(session,offsetDay(start,-1),offsetDay(settings.today,1));
  }
  const walks=normalizeWalks(rows,settings.timezone,start,settings.today);
  await reconcile(env.DB,env.HABIT_ID,walks,start,settings.today,settings.habit.target_value);
  console.log(JSON.stringify({event:'garmin_sync',walks:walks.length}));
}
async function complete(env: Env, result: {session:Session}|{pending:Pending}) {
  if('pending' in result){
    await env.DB.prepare('UPDATE garmin_connection SET pending_cipher=?,last_error=NULL,error_code=NULL WHERE id=1')
      .bind(await seal(result.pending,env.ENCRYPTION_KEY)).run();return;
  }
  const settings=await config(env.DB,env.HABIT_ID);
  // Prove authenticated API access before saving a session or enabling the cron.
  const rows=await new GarminClient().activities(result.session,offsetDay(settings.today,-1),offsetDay(settings.today,1));
  const walks=normalizeWalks(rows,settings.timezone,settings.today,settings.today);
  await env.DB.prepare(`UPDATE garmin_connection SET session_cipher=?,pending_cipher=NULL,enabled=1,since_day=?,last_error=NULL,
    error_code=NULL,cooldown_until=0,auth_count=0 WHERE id=1`).bind(await seal(result.session,env.ENCRYPTION_KEY),settings.today).run();
  await reconcile(env.DB,env.HABIT_ID,walks,settings.today,settings.today,settings.habit.target_value);
}
async function readBody(request:Request):Promise<Record<string,unknown>>{
  if(!(request.headers.get('content-type')||'').startsWith('application/json'))throw new GarminError('content_type','Expected a JSON request.',415);
  const reader=request.body?.getReader();let text='';let bytes=0;const decoder=new TextDecoder();
  if(reader)while(true){const part=await reader.read();if(part.done)break;bytes+=part.value.length;
    if(bytes>4096){await reader.cancel();throw new GarminError('body_size','The request is too large.',413);}text+=decoder.decode(part.value,{stream:true});}
  try{return object(JSON.parse(text+decoder.decode()));}catch{throw new GarminError('body','Invalid request.',400);}
}
export default {
  async fetch(request,env){
    if(!await authorized(request,env.GARMIN_SYNC_TOKEN))return json({error:'Not authorized'},401);
    const path=new URL(request.url).pathname;
    try{
      if(request.method==='GET'){
        if(path==='/')return new Response(PAGE,{headers:{...headers,'content-type':'text/html; charset=utf-8',
          'content-security-policy':"default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"}});
        if(path==='/api/client.js')return new Response(CLIENT,{headers:{...headers,'content-type':'text/javascript; charset=utf-8'}});
        if(path==='/api/status')return json(await status(env));
        if(path==='/api/probe')return json(await new GarminClient().probe());
        return json({error:'Not found'},404);
      }
      if(request.method!=='POST')return json({error:'Method not allowed'},405);
      if(!['/api/login','/api/verify','/api/sync','/api/disconnect','/api/cancel'].includes(path))return json({error:'Not found'},404);
      const input=await readBody(request);
      await locked(env.DB,async()=>{
        if(path==='/api/login'){
          if(typeof input.email!=='string'||input.email.length>254||!input.email.includes('@')||typeof input.password!=='string'||!input.password||input.password.length>1024)
            throw new GarminError('input','Enter your Garmin email and password.',400);
          await allowAttempt(env.DB,true);
          await complete(env,await new GarminClient().login(input.email.trim(),input.password));
        }else if(path==='/api/verify'){
          if(typeof input.code!=='string'||!/^\d{4,12}$/.test(input.code))throw new GarminError('input','Enter the verification code from Garmin.',400);
          await allowAttempt(env.DB,true);const row=await connection(env.DB);
          if(!row.pending_cipher)throw new GarminError('expired','Sign in before entering a verification code.',400);
          await complete(env,await new GarminClient().verify(await unseal<Pending>(row.pending_cipher,env.ENCRYPTION_KEY),input.code));
        }else if(path==='/api/sync'){
          const row=await connection(env.DB);
          if(row.last_sync_at&&Date.now()-Date.parse(row.last_sync_at)<60_000)throw new GarminError('busy','Your walks were just synced. Try again in a minute.',429);
          await sync(env);
        }else if(path==='/api/disconnect'){
          await env.DB.batch([
            env.DB.prepare('UPDATE garmin_connection SET session_cipher=NULL,pending_cipher=NULL,enabled=0,last_error=NULL,error_code=NULL WHERE id=1'),
            env.DB.prepare("UPDATE habit_entries SET source='app',note='Previously synced recorded walks from Garmin' WHERE source='garmin' AND habit_id=?").bind(env.HABIT_ID),
            env.DB.prepare('DELETE FROM garmin_activities'),env.DB.prepare('DELETE FROM garmin_habit_days'),
          ]);
        }else await env.DB.prepare('UPDATE garmin_connection SET pending_cipher=NULL,last_error=NULL,error_code=NULL WHERE id=1').run();
      });
      return json(await status(env));
    }catch(error){const safe=await fail(env,error);return json({error:safe.message,code:safe.code,retryAt:safe.retryAt},safe.status);}
  },
  async scheduled(_event,env){
    try{const row=await connection(env.DB);if(!row.enabled||row.cooldown_until>Date.now())return;
      await locked(env.DB,()=>sync(env));
    }catch(error){await fail(env,error);}
  },
} satisfies ExportedHandler<Env>;
