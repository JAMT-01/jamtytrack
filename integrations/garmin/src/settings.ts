import {PAGE, CLIENT_BODY} from './page.ts';

// Keep one copy of the connection forms and their behavior. Shadow DOM scopes
// their styles and IDs so Garmin actions cannot affect other Settings forms.
const styles=PAGE.split('<style>')[1].split('</style>')[0];
const content=PAGE.slice(PAGE.indexOf('<div id="message"'),PAGE.indexOf('</main>'));
const panel=`<style>${styles}
:host{display:block;font:inherit;color:inherit}h2{font-size:17px;letter-spacing:-.3px;margin:0 0 8px}p{font-size:14px;margin:6px 0 14px}section{padding:18px 0;margin:0;border:0;border-radius:0;background:transparent}section+section{border-top:1px solid #e8e3da}input,button{font-family:inherit}#summary{padding-top:18px}#distance{font-size:30px}.status{margin-top:12px}footer{margin-top:12px}
</style><h2>Garmin Connect</h2><p>Automatically track your recorded walks toward your daily walking habit.</p>${content}`;

export const SETTINGS_CLIENT = `(function(){'use strict';
function mount(root){${CLIENT_BODY}}
const markup=${JSON.stringify(panel)};
let host=null;let dispose=null;let queued=false;
let openRequested=location.hash==='#settings/garmin';
function settle(){
 if(host&&!host.isConnected){if(dispose)dispose();host=null;dispose=null;}
 const page=document.querySelector('.settings-page');
 if(openRequested&&!page){
  const settings=Array.from(document.querySelectorAll('.side-nav button,.bottom-nav button')).find(button=>button.textContent.trim()==='Settings'&&button.getClientRects().length);
  if(settings)settings.click();
  return;
 }
 const main=page&&page.querySelector('.settings-main');
 if(main&&!host){
  host=document.createElement('section');host.className='settings-card';host.id='garmin-settings';
  host.setAttribute('aria-label','Garmin Connect');
  const root=host.attachShadow({mode:'open'});root.innerHTML=markup;
  const telegram=Array.from(main.querySelectorAll('.settings-card')).find(card=>card.querySelector('h2')?.textContent.trim()==='Telegram companion');
  main.insertBefore(host,telegram||null);dispose=mount(root);
 }
 if(openRequested&&host){
  openRequested=false;host.scrollIntoView({block:'start'});
  history.replaceState(null,'',location.pathname+location.search);
 }
}
function queue(){if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;settle();});}
new MutationObserver(queue).observe(document.body,{childList:true,subtree:true});
window.addEventListener('hashchange',()=>{openRequested=location.hash==='#settings/garmin';queue();});
settle();
})();`;
