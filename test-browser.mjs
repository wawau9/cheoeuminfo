import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,rm} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {resolve,dirname,join} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';

const root=dirname(fileURLToPath(import.meta.url));
const qa=join(root,'.qa');
await mkdir(qa,{recursive:true});
const profile=join(qa,`edge-${Date.now()}`);
const html=await readFile(join(root,'index.html'),'utf8');
for (const name of ['customers.js','storage.js','app.js']) new Function(await readFile(join(root,name),'utf8'));
assert.equal(/<style>|<script>/.test(html),false,'HTML should use separate CSS and JS files');
assert.equal(/localStorage/.test(await readFile(join(root,'app.js'),'utf8')),false,'UI must not access localStorage');
assert.equal(/document\.|localStorage/.test(await readFile(join(root,'customers.js'),'utf8')),false,'Domain logic must not access DOM or storage');
let browser=spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',[
  '--headless=new','--no-first-run','--no-default-browser-check','--disable-background-networking',
  '--disable-component-update','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'
],{windowsHide:true,stdio:['ignore','ignore','pipe']});
let stderr=''; browser.stderr.on('data',d=>{stderr=(stderr+d).slice(-4000)});
const delay=ms=>new Promise(r=>setTimeout(r,ms));
let ws, sequence=0;const pending=new Map(),events=new Map(),errors=[],dialogs=[];
let acceptDialog=true;
function send(method,params={}) {
  return new Promise((res,rej)=>{
    const id=++sequence;
    const timer=setTimeout(()=>{pending.delete(id);rej(new Error(`Timeout: ${method}`))},12000);
    pending.set(id,{res,rej,timer}); ws.send(JSON.stringify({id,method,params}));
  });
}
function once(name) {return new Promise(res=>{events.set(name,res)})}
async function evaluate(expression) {
  const result=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true,userGesture:true});
  if(result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
const value=(id,v)=>`document.getElementById(${JSON.stringify(id)}).value=${JSON.stringify(v)};document.getElementById(${JSON.stringify(id)}).dispatchEvent(new Event('input',{bubbles:true}));`;
const click=selector=>evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
const KEY='esthetic-cheoeum-customers-v1',BACKUP=KEY+':before-visits-v2';
const ITEM_KEY='esthetic-cheoeum-treatment-items-v1';
const storedItems=()=>evaluate('JSON.parse(localStorage.getItem('+JSON.stringify(ITEM_KEY)+'))');
const itemAction=(name,index)=>evaluate('Array.from(document.querySelectorAll(".setting-item")).find(row=>row.querySelector("strong").textContent==='+JSON.stringify(name)+').querySelectorAll("button")['+index+'].click()');
const submitItem=async name=>{await evaluate(value('item-name',name));await evaluate('document.getElementById("item-form").requestSubmit()')};
const stored=()=>evaluate(`JSON.parse(localStorage.getItem(${JSON.stringify(KEY)}))`);
async function reload() {const loaded=once('Page.loadEventFired');await send('Page.reload');await loaded;}
async function fixture(raw) {
  await evaluate(`localStorage.clear();localStorage.setItem(${JSON.stringify(KEY)},${JSON.stringify(raw)})`);await reload();
}
const visible=()=>evaluate(`Array.from(document.querySelectorAll('section.panel')).filter(e=>!e.hidden).map(e=>e.id)`);
let checks=0;
const check=async(name,fn)=>{await fn();checks++;console.log('PASS '+name)};
try {
  let port;
  for(let i=0;i<120;i++) {try {port=(await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0];break}catch{await delay(100)}}
  if(!port)throw new Error('Browser did not start: '+stderr);
  const targets=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  ws=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);
  await new Promise((res,rej)=>{ws.onopen=res;ws.onerror=rej});
  ws.onmessage=event=>{
    const data=JSON.parse(event.data);
    if(data.id){const p=pending.get(data.id);if(p){clearTimeout(p.timer);pending.delete(data.id);data.error?p.rej(new Error(JSON.stringify(data.error))):p.res(data.result)}}
    else {
      if(data.method==='Runtime.exceptionThrown') errors.push(data.params.exceptionDetails);
      if(data.method==='Page.javascriptDialogOpening') {dialogs.push(data.params);send('Page.handleJavaScriptDialog',{accept:acceptDialog}).catch(()=>{})}
      const handler=events.get(data.method);if(handler){events.delete(data.method);handler(data.params)}
    }
  };
  await send('Page.enable');await send('Runtime.enable');
  const loaded=once('Page.loadEventFired');await send('Page.navigate',{url:pathToFileURL(join(root,'index.html')).href});await loaded;
  await check('Fresh install: sample customers and visit history, list only',async()=>{
    assert.equal((await stored()).length,2);assert.equal((await stored())[0].visits.length,2);
    assert.deepEqual(await visible(),['list-screen']);
    assert.equal(await evaluate(`Array.from(document.querySelectorAll('input,textarea')).filter(e=>e.getClientRects().length).length`),1);
  });
  await send('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});
  await writeFile(join(qa,'list-desktop.png'),Buffer.from((await send('Page.captureScreenshot',{captureBeyondViewport:true})).data,'base64'));
  const legacy=[{id:'legacy-1',name:'가상기존고객',phone:'010-0000-0099',visit:'2026-10-01',memo:'기존 기본 메모\n보존 확인',customField:'preserve-me'},{id:'legacy-2',name:'가상다른고객',phone:'010-0000-0088',visit:'2026-10-02',memo:'다른 고객 메모'}];
  const legacyRaw=JSON.stringify(legacy);
  await fixture(legacyRaw);
  await check('Legacy data is not rewritten on load; name and normalized phone search',async()=>{
    assert.equal(await evaluate(`localStorage.getItem(${JSON.stringify(KEY)})`),legacyRaw);
    await evaluate(value('search','기존'));assert.equal(await evaluate(`document.querySelectorAll('.customer').length`),1);
    await evaluate(value('search','01000000099'));assert.equal(await evaluate(`document.querySelectorAll('.customer').length`),1);
    await click('.customer');assert.deepEqual(await visible(),['detail-screen']);
    assert.equal(await evaluate(`document.getElementById('detail-memo').textContent`),legacy[0].memo);
    assert.equal(await evaluate(`document.getElementById('visit-empty').hidden`),false);
  });
  await check('Visit item validation and multiple selections, original backup',async()=>{
    await click('#new-visit');assert.deepEqual(await visible(),['visit-screen']);
    await evaluate(value('visit-date','2026-10-05')+value('visit-memo','가상 첫 관리\n기록'));
    await evaluate(`document.getElementById('visit-form').requestSubmit()`);
    assert.equal(await evaluate(`document.getElementById('status').classList.contains('error')`),true);
    assert.equal(await evaluate(`localStorage.getItem(${JSON.stringify(KEY)})`),legacyRaw);
    await click('.choice:nth-child(4) span');await click('.choice:nth-child(5) span');
    await evaluate(`document.getElementById('visit-form').requestSubmit()`);
    const data=await stored();assert.equal(data[0].visits.length,1);assert.deepEqual(data[0].visits[0].items,['보습','진정']);
    assert.equal(data[0].memo,legacy[0].memo);assert.equal(data[0].customField,'preserve-me');
    assert.deepEqual(data[1],{...legacy[1],visits:[]});
    assert.equal(await evaluate(`localStorage.getItem(${JSON.stringify(BACKUP)})`),legacyRaw);
  });
  await check('Visits accumulate and sort by visit date',async()=>{
    await click('#new-visit');await evaluate(value('visit-date','2026-10-07')+value('visit-memo','가상 두 번째 방문'));
    await click('.choice:nth-child(3) span');await click('.choice:nth-child(6) span');
    await evaluate(`document.getElementById('visit-form').requestSubmit()`);
    assert.equal((await stored())[0].visits.length,2);
    assert.deepEqual(await evaluate(`Array.from(document.querySelectorAll('.visit-card time'),e=>e.textContent)`),['2026-10-07','2026-10-05']);
  });
  await check('Past visit edits preserve identity, other visits, and customer details',async()=>{
    const prior=await stored();await click('.visit-card:last-child button');
    assert.equal(await evaluate(`document.querySelectorAll('.choice input:checked').length`),2);
    await evaluate(value('visit-date','2026-10-03')+value('visit-memo','수정된 가상 메모'));
    await click('.choice:nth-child(4) span');await click('.choice:nth-child(8) span');
    await evaluate(`document.getElementById('visit-form').requestSubmit()`);
    const data=await stored();assert.equal(data[0].visits.length,2);
    assert.equal(data[0].visits[0].id,prior[0].visits[0].id);assert.deepEqual(data[0].visits[0].items,['진정','기타']);
    assert.deepEqual(data[0].visits[1],prior[0].visits[1]);assert.equal(data[0].memo,legacy[0].memo);
  });
  await check('Customer edit keeps all visits and extra legacy fields',async()=>{
    const visits=(await stored())[0].visits;await click('#edit-customer');
    await evaluate(value('basic-memo','수정된 기본 메모'));
    await evaluate(`document.getElementById('customer-form').requestSubmit()`);
    const data=await stored();assert.deepEqual(data[0].visits,visits);assert.equal(data[0].customField,'preserve-me');
  });
  await check('Cancel prompts keep unsaved form when declined',async()=>{
    await click('#new-visit');await evaluate(value('visit-memo','저장 안 한 가상 메모'));acceptDialog=false;
    await click('#visit-cancel');assert.deepEqual(await visible(),['visit-screen']);assert.equal(dialogs.at(-1).type,'confirm');
    acceptDialog=true;await click('#visit-cancel');assert.deepEqual(await visible(),['detail-screen']);
    assert.equal((await stored())[0].visits.length,2);
  });
  await check('Mobile list, detail, and form have no horizontal overflow',async()=>{
    await send('Emulation.setDeviceMetricsOverride',{width:375,height:812,deviceScaleFactor:1,mobile:true});
    const noOverflow=()=>evaluate(`document.documentElement.scrollWidth<=window.innerWidth`);
    assert.equal(await noOverflow(),true);
    await writeFile(join(qa,'detail-mobile.png'),Buffer.from((await send('Page.captureScreenshot',{captureBeyondViewport:true})).data,'base64'));
    await click('#new-visit');assert.equal(await noOverflow(),true);
    assert.equal(await evaluate(`document.querySelectorAll('.choice').length`),8);
    await writeFile(join(qa,'visit-mobile.png'),Buffer.from((await send('Page.captureScreenshot',{captureBeyondViewport:true})).data,'base64'));
    await click('#visit-cancel');await click('#detail-back');assert.equal(await noOverflow(),true);
  });
  await check('Return to the page retains records and starts on list',async()=>{
    const before=await stored();const url=pathToFileURL(join(root,'index.html')).href;
    let load=once('Page.loadEventFired');await send('Page.navigate',{url:'about:blank'});await load;
    load=once('Page.loadEventFired');await send('Page.navigate',{url});await load;
    assert.deepEqual(await stored(),before);assert.deepEqual(await visible(),['list-screen']);await click('.customer');
  });
  await check('Visit deletion requires confirmation and preserves other visit',async()=>{
    acceptDialog=false;await click('.visit-card:last-child .danger');assert.equal((await stored())[0].visits.length,2);
    acceptDialog=true;await click('.visit-card:last-child .danger');assert.equal((await stored())[0].visits.length,1);
    assert.match(dialogs.at(-1).message,/管理|관리/);
  });
  await check('Customer deletion includes visits; declining is safe',async()=>{
    acceptDialog=false;await click('#delete-customer');assert.equal((await stored()).length,2);
    assert.match(dialogs.at(-1).message,/관리 기록 1건/);
    acceptDialog=true;await click('#delete-customer');assert.equal((await stored()).length,1);
    assert.deepEqual(await visible(),['list-screen']);
  });
  await check('New registration, phone validation recovery, safe memo rendering',async()=>{
    await click('#new-customer');await evaluate(value('name','가상신규고객')+value('phone','abc')+value('first-visit','2026-10-10')+value('basic-memo','<img src=x onerror=alert(1)>'));
    await evaluate(`document.getElementById('customer-form').requestSubmit()`);assert.equal((await stored()).length,1);
    await evaluate(value('phone','010-0000-0077'));await evaluate(`document.getElementById('customer-form').requestSubmit()`);
    assert.equal((await stored()).length,2);assert.deepEqual((await stored())[1].visits,[]);
    assert.equal(await evaluate(`document.querySelectorAll('#detail-memo img').length`),0);
    assert.equal(await evaluate(`document.getElementById('detail-memo').textContent`),'<img src=x onerror=alert(1)>');
  });
  await check('Storage write failure keeps input and existing data',async()=>{
    const prior=await stored();await click('#new-visit');await click('.choice:first-child span');await evaluate(value('visit-memo','저장 실패 후 유지'));
    await evaluate(`window.originalSetItem=Storage.prototype.setItem;Storage.prototype.setItem=function(){throw new DOMException('Quota','QuotaExceededError')}`);
    await evaluate(`document.getElementById('visit-form').requestSubmit()`);
    assert.deepEqual(await stored(),prior);assert.deepEqual(await visible(),['visit-screen']);
    assert.equal(await evaluate(`document.getElementById('visit-memo').value`),'저장 실패 후 유지');
    await evaluate(`Storage.prototype.setItem=window.originalSetItem`);await click('#visit-cancel');
  });
  await check('Conflicting storage changes cannot be overwritten',async()=>{
    await click('#edit-customer');await evaluate(value('basic-memo','충돌 테스트'));
    const changed=await stored();changed[0].memo='다른 창의 가상 변경';const raw=JSON.stringify(changed);
    await evaluate(`localStorage.setItem(${JSON.stringify(KEY)},${JSON.stringify(raw)});document.getElementById('customer-form').requestSubmit()`);
    assert.equal(await evaluate(`localStorage.getItem(${JSON.stringify(KEY)})`),raw);
    assert.equal(await evaluate(`document.getElementById('customer-fields').disabled`),true);
    await click('#customer-back');
  });
  await check('Malformed stored data remains untouched and saving is blocked',async()=>{
    await fixture('{broken-json');
    assert.equal(await evaluate(`localStorage.getItem(${JSON.stringify(KEY)})`),'{broken-json');
    assert.equal(await evaluate(`document.getElementById('new-customer').disabled`),true);
  });
  await check('Empty saved customer list does not recreate samples',async()=>{
    await fixture('[]');assert.equal((await stored()).length,0);assert.equal(await evaluate(`document.getElementById('list-empty').hidden`),false);
  });

  const historyFixture=[{...legacy[0],visits:[{id:'history-1',date:'2026-10-05',items:['보습','진정','예전 관리'],memo:'과거 기록의 가상 메모'}]}];
  const historyRaw=JSON.stringify(historyFixture);
  await fixture(historyRaw);
  await check('Settings screen opens independently without rewriting customer data',async()=>{
    await click('#open-settings');assert.deepEqual(await visible(),['settings-screen']);
    assert.equal(await evaluate('document.querySelectorAll(".setting-item").length'),8);
    assert.equal(await evaluate('localStorage.getItem('+JSON.stringify(KEY)+')'),historyRaw);
    assert.equal(await storedItems(),null);
  });
  await check('Add custom item and prevent whitespace/case/Unicode-normalized duplicates',async()=>{
    await submitItem('  모공   관리  ');assert.ok((await storedItems()).includes('모공 관리'));
    const previous=await storedItems();
    await submitItem('모공 관리');assert.deepEqual(await storedItems(),previous);
    assert.match(await evaluate('document.getElementById("status").textContent'),/이미/);
    await submitItem('ＰＨ');assert.ok((await storedItems()).includes('PH'));
    const next=await storedItems();await submitItem('ph');assert.deepEqual(await storedItems(),next);
    await submitItem('   ');assert.deepEqual(await storedItems(),next);
    await evaluate(value('item-name',''));
    assert.equal(await evaluate('localStorage.getItem('+JSON.stringify(KEY)+')'),historyRaw);
    assert.equal(await evaluate('localStorage.getItem('+JSON.stringify(BACKUP)+')'),null);
  });
  await check('Rename item and reject rename to duplicate without changing past records',async()=>{
    await itemAction('보습',0);await submitItem('진정');assert.ok((await storedItems()).includes('보습'));
    await submitItem('수분 관리');assert.ok((await storedItems()).includes('수분 관리'));assert.ok(!(await storedItems()).includes('보습'));
    assert.equal(await evaluate('localStorage.getItem('+JSON.stringify(KEY)+')'),historyRaw);
    await click('#settings-back');await click('.customer');
    assert.deepEqual(await evaluate('Array.from(document.querySelectorAll(".tag"),e=>e.textContent)'),['보습','진정','예전 관리']);
    await click('#detail-back');await click('#open-settings');
  });
  await check('Item delete confirmation can be declined; accepted delete preserves raw history',async()=>{
    acceptDialog=false;await itemAction('진정',1);assert.ok((await storedItems()).includes('진정'));
    assert.match(dialogs.at(-1).message,/과거 관리 기록/);
    acceptDialog=true;await itemAction('진정',1);assert.ok(!(await storedItems()).includes('진정'));
    assert.equal(await evaluate('localStorage.getItem('+JSON.stringify(KEY)+')'),historyRaw);
  });
  await check('New visit automatically uses current settings including added and renamed items',async()=>{
    await click('#settings-back');await click('.customer');await click('#new-visit');
    const names=await evaluate('Array.from(document.querySelectorAll(".choice input"),e=>e.value)');
    assert.ok(names.includes('모공 관리'));assert.ok(names.includes('수분 관리'));
    assert.ok(!names.includes('보습'));assert.ok(!names.includes('진정'));assert.ok(!names.includes('예전 관리'));
    await evaluate('Array.from(document.querySelectorAll(".choice input")).filter(e=>["모공 관리","수분 관리"].includes(e.value)).forEach(e=>e.click())');
    await evaluate(value('visit-date','2026-10-07')+value('visit-memo','사용자 항목으로 새 가상 기록'));
    await evaluate('document.getElementById("visit-form").requestSubmit()');
    const data=await stored();assert.equal(data[0].visits.length,2);assert.deepEqual(data[0].visits[0],historyFixture[0].visits[0]);
    assert.deepEqual([...data[0].visits[1].items].sort(),['모공 관리','수분 관리'].sort());
  });
  await check('Editing only old visit memo retains removed, renamed and unknown historical items',async()=>{
    await click('.visit-card:last-child button');
    assert.deepEqual(await evaluate('Array.from(document.querySelectorAll(".choice input:checked"),e=>e.value)'),['보습','진정','예전 관리']);
    assert.equal(await evaluate('Array.from(document.querySelectorAll(".choice span")).filter(e=>e.textContent.includes("과거 항목")).length'),3);
    await evaluate(value('visit-memo','과거 항목 유지, 메모만 수정'));await evaluate('document.getElementById("visit-form").requestSubmit()');
    assert.deepEqual((await stored())[0].visits[0].items,['보습','진정','예전 관리']);
    assert.equal((await stored())[0].visits[0].memo,'과거 항목 유지, 메모만 수정');
  });
  await check('Settings reload persists item add/rename/delete and current visit choices',async()=>{
    const expectedItems=await storedItems(),expectedCustomers=await stored();await reload();
    assert.deepEqual(await storedItems(),expectedItems);assert.deepEqual(await stored(),expectedCustomers);
    await click('#open-settings');
    assert.deepEqual(await evaluate('Array.from(document.querySelectorAll(".setting-name"),e=>e.textContent)'),expectedItems);
  });
  await check('Unsaved item editor prompts before leaving or changing edit target',async()=>{
    await evaluate(value('item-name','가상 미저장 항목'));acceptDialog=false;await click('#settings-back');
    assert.deepEqual(await visible(),['settings-screen']);
    await itemAction('주름',0);assert.equal(await evaluate('document.getElementById("item-name").value'),'가상 미저장 항목');
    acceptDialog=true;await itemAction('주름',0);await evaluate(value('item-name','가상 미저장 이름'));
    acceptDialog=false;await click('#item-cancel');assert.equal(await evaluate('document.getElementById("item-name").value'),'가상 미저장 이름');
    acceptDialog=true;await click('#item-cancel');assert.equal(await evaluate('document.getElementById("item-name").value'),'');
  });
  await check('Settings save failure preserves settings, history and input for retry',async()=>{
    const expectedItems=await storedItems(),expectedCustomers=await stored();
    await evaluate('window.originalSetItem=Storage.prototype.setItem;Storage.prototype.setItem=function(){throw new DOMException("Quota","QuotaExceededError")}');
    await submitItem('저장 실패 가상 항목');
    assert.deepEqual(await storedItems(),expectedItems);assert.deepEqual(await stored(),expectedCustomers);
    assert.equal(await evaluate('document.getElementById("item-name").value'),'저장 실패 가상 항목');
    assert.equal(await evaluate('document.getElementById("status").classList.contains("error")'),true);
    await evaluate('Storage.prototype.setItem=window.originalSetItem');await evaluate('document.getElementById("item-form").requestSubmit()');
    assert.ok((await storedItems()).includes('저장 실패 가상 항목'));
  });
  await check('Long and HTML-looking item names stay safe and fit mobile layout',async()=>{
    await submitItem('가상'.repeat(20));await submitItem('<img src=x onerror=alert(1)>');
    assert.equal(await evaluate('document.querySelectorAll("#settings-items img").length'),0);
    await send('Emulation.setDeviceMetricsOverride',{width:375,height:812,deviceScaleFactor:1,mobile:true});
    assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true);
    await writeFile(join(qa,'settings-mobile.png'),Buffer.from((await send('Page.captureScreenshot',{captureBeyondViewport:true})).data,'base64'));
    await click('#settings-back');await click('.customer');await click('#new-visit');
    assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true);
    await click('#visit-cancel');await click('#detail-back');await click('#open-settings');
  });
  await check('Deleting all items persists empty settings, preserves history and permits adding again',async()=>{
    const dataBefore=await stored();for(const name of await storedItems())await itemAction(name,1);
    assert.deepEqual(await storedItems(),[]);assert.deepEqual(await stored(),dataBefore);await reload();
    assert.deepEqual(await storedItems(),[]);await click('.customer');await click('#new-visit');
    assert.equal(await evaluate('document.querySelectorAll(".choice input").length'),0);
    await evaluate('document.getElementById("visit-form").requestSubmit()');
    assert.deepEqual(await stored(),dataBefore);await click('#visit-cancel');
    await click('.visit-card:last-child button');await evaluate(value('visit-memo','항목 전체 삭제 후에도 과거 기록 수정'));
    await evaluate('document.getElementById("visit-form").requestSubmit()');
    assert.deepEqual((await stored())[0].visits[0].items,['보습','진정','예전 관리']);
    await click('#detail-back');await click('#open-settings');await submitItem('다시 추가한 가상 항목');
    assert.deepEqual(await storedItems(),['다시 추가한 가상 항목']);
  });
  await check('Concurrent item change blocks overwriting settings or customer data',async()=>{
    const customersBefore=await stored();
    await evaluate('localStorage.setItem('+JSON.stringify(ITEM_KEY)+',JSON.stringify(["다른 창의 가상 항목"]))');
    await submitItem('충돌 중 가상 추가');assert.deepEqual(await storedItems(),['다른 창의 가상 항목']);
    assert.deepEqual(await stored(),customersBefore);assert.equal(await evaluate('document.getElementById("item-fields").disabled'),true);
    await click('#settings-back');await reload();
  });
  await check('Malformed item configuration never resets existing customers or settings',async()=>{
    const customersBefore=await stored();const raw='["중복","중복"]';
    await evaluate('localStorage.setItem('+JSON.stringify(ITEM_KEY)+','+JSON.stringify(raw)+')');await reload();
    assert.deepEqual(await stored(),customersBefore);assert.equal(await evaluate('localStorage.getItem('+JSON.stringify(ITEM_KEY)+')'),raw);
    assert.equal(await evaluate('document.getElementById("new-customer").disabled'),true);
  });

  await check('Full browser process restart retains customers and visit records',async()=>{
    const records=[{...legacy[0],visits:[{id:'restart-visit',date:'2026-10-05',items:['여드름','주름','바디'],memo:'브라우저 재실행 테스트'}]}];
    await fixture(JSON.stringify(records));
    const restartItems=['재실행 가상 항목','주름'];
    await evaluate('localStorage.setItem('+JSON.stringify(ITEM_KEY)+','+JSON.stringify(JSON.stringify(['재실행 가상 항목','주름']))+')');
    await reload();
    const messageHandler=ws.onmessage;
    // 정상 종료로 Chromium의 저장소 쓰기를 마친 뒤 같은 프로필을 다시 엽니다.
    const exited=new Promise((res,rej)=>{
      const timer=setTimeout(()=>rej(new Error('Browser close timed out')),10000);
      browser.once('exit',()=>{clearTimeout(timer);res()});
    });
    await send('Browser.close');await exited;ws.close();
    browser=spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',[
      '--headless=new','--no-first-run','--no-default-browser-check','--disable-background-networking',
      '--disable-component-update','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'
    ],{windowsHide:true,stdio:['ignore','ignore','pipe']});
    browser.stderr.on('data',()=>{});
    let restartTarget;
    for(let i=0;i<120;i++) {
      try {
        const restartPort=(await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0];
        const targets=await(await fetch(`http://127.0.0.1:${restartPort}/json/list`)).json();
        restartTarget=targets.find(t=>t.type==='page');if(restartTarget)break;
      } catch {}
      await delay(100);
    }
    assert.ok(restartTarget,'Browser restart failed');
    ws=new WebSocket(restartTarget.webSocketDebuggerUrl);
    await new Promise((res,rej)=>{ws.onopen=res;ws.onerror=rej});ws.onmessage=messageHandler;
    await send('Page.enable');await send('Runtime.enable');
    const load=once('Page.loadEventFired');await send('Page.navigate',{url:pathToFileURL(join(root,'index.html')).href});await load;
    assert.deepEqual(await stored(),records);assert.deepEqual(await storedItems(),restartItems);assert.deepEqual(await visible(),['list-screen']);
    await click('.customer');assert.equal(await evaluate(`document.querySelectorAll('.visit-card').length`),1);
    assert.deepEqual(await evaluate(`Array.from(document.querySelectorAll('.tag'),e=>e.textContent)`),['여드름','주름','바디']);
    await click('#new-visit');assert.deepEqual(await evaluate('Array.from(document.querySelectorAll(".choice input"),e=>e.value)'),restartItems);await click('#visit-cancel');
  });
  assert.equal(errors.length,0,JSON.stringify(errors));
  console.log(checks+' CHECKS PASSED; isolated test profile only; user browser data was not accessed.');
  await writeFile(join(qa,'result.txt'),'All '+checks+' browser checks passed. Test data only.\n','utf8');
} finally {
  if(ws)ws.close();browser.kill();
  for(const entry of pending.values())clearTimeout(entry.timer);
  await delay(800);
  // Resolve and verify the exact generated directory before recursive cleanup.
  if(dirname(resolve(profile))!==resolve(qa))throw new Error('Unsafe profile cleanup path');
  await rm(profile,{recursive:true,force:true,maxRetries:4,retryDelay:300}).catch(()=>{});
}




