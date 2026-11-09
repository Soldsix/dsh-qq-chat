import {test} from 'node:test'
import assert from 'node:assert/strict'
import {setTimeout as delay} from 'node:timers/promises'
import {ChatKernel} from '../dist/kernel.js'
import {Config,resolveConfig} from '../dist/config.js'
import {StoreError} from '../dist/store-protocol.js'
import {SqliteJournal} from '../dist/journal.js'
import {journal,message,root} from './helpers.mjs'

async function until(predicate){for(let index=0;index<500;index++){if(predicate())return;await delay(2)}throw Error('Fixture did not reach expected state')}
async function fixture(t,{config={},run,port:portOptions={},wrapStore}={}){
 const opened=await journal(),store=wrapStore?wrapStore(opened.store):opened.store
 const calls=[],sent=[];let active=0,peak=0,disposed=0
 const model={async resolvePreset(){return'qa'},async run(map,input,id,signal){calls.push({map,input,id});active++;peak=Math.max(peak,active);try{return{sessionId:map.sessionId,text:'reply '+input.messageId,fromOffset:2,toOffset:9,admitted:true,externalInput:false,completed:true,...await run?.(map,input,id,signal)}}finally{active--}},async dispose(){disposed++}}
 const port={async availability(){return'available'},async send(output,signal){sent.push(output);return{status:'accepted',messageIds:[]}},...portOptions}
 const kernel=new ChatKernel(resolveConfig(Config({enabled:true,...config}),root),store,model)
 t.after(()=>kernel.close())
 return{...opened,kernel,calls,sent,port,get peak(){return peak},get disposed(){return disposed},submit(input,signal=new AbortController().signal){return kernel.submit(input,'live',port,signal)}}
}

test('one group reuses its Session for a same-sender followup and ignores unrelated conversation',async t=>{
 const f=await fixture(t),a=message('1'),b=message('2',{directed:false,text:'and the second question?'})
 assert.equal((await f.submit(a)).status,'responded')
 assert.equal((await f.submit(b)).status,'responded')
 const unrelated=await f.submit(message('3',{sender:'90000003',directed:false}))
 assert.equal(unrelated.reason,'not-directed');assert.equal(f.calls.length,2)
 assert.equal(f.calls[0].map.sessionId,f.calls[1].map.sessionId)
 assert.equal(f.calls[1].map.lastDelivery,'accepted')
 assert.deepEqual(f.sent[1].parts,[{type:'reply',messageId:b.messageId},{type:'text',text:'reply 2'}])
})
test('an explicit group mention bypasses an ordinary ignore decision but an admitted sender guard can block it',async t=>{
 const f=await fixture(t),signal=new AbortController().signal
 const human=await f.kernel.submit(message('human-explicit'),'live',f.port,signal,'default',undefined,async()=> 'ignore')
 assert.equal(human.status,'responded')
 const bot=message('guarded-explicit',{sender:'other-bot'}),blocked=await f.kernel.submit(bot,'live',f.port,signal,'default',undefined,async()=> 'block')
 assert.equal(blocked.status,'ignored');assert.equal(blocked.modelOutcome,'not-started');assert.equal(f.calls.length,1);assert.equal(f.sent.length,1)
 assert.deepEqual((await f.store.receipt(blocked.requestId)).input,bot)
 assert.equal((await f.kernel.submit(bot,'live',f.port,signal,'default',undefined,async()=>{throw Error('duplicate invoked routing')})).status,'duplicate')
})
test('optional per-sender group sessions keep each member in a distinct persistent mapping',async t=>{
 const f=await fixture(t,{config:{isolateGroupSenders:true}})
 const a1=message('isolation-a1',{sender:'alice'}),b1=message('isolation-b1',{sender:'bob'}),a2=message('isolation-a2',{sender:'alice'})
 const a=await f.submit(a1),b=await f.submit(b1),again=await f.submit(a2)
 assert.equal(a.status,'responded');assert.equal(b.status,'responded');assert.equal(again.status,'responded')
 assert.notEqual(a.sessionId,b.sessionId);assert.equal(a.sessionId,again.sessionId)
 assert.equal((await f.store.mapping(f.calls[0].map.mappingId)).sessionId,a.sessionId)
 const shared=await fixture(t),old=await shared.submit(message('isolation-shared',{sender:'alice'}))
 assert.notEqual(old.sessionId,a.sessionId)
})
test('per-sender mapping is reused after journal and runtime restart',async t=>{
 const f=await fixture(t,{config:{isolateGroupSenders:true}}),first=await f.submit(message('restart-a1',{sender:'alice'}))
 await f.kernel.close()
 const reopened=await SqliteJournal.open(f.options),calls=[]
 const model={async resolvePreset(){return'qa'},async run(map,input){calls.push(map);return{sessionId:map.sessionId,text:'synthetic',fromOffset:0,toOffset:1,admitted:true,externalInput:false,completed:true}},async dispose(){}}
 const kernel=new ChatKernel(resolveConfig(Config({enabled:true,isolateGroupSenders:true}),root),reopened,model)
 t.after(()=>kernel.close())
 const result=await kernel.submit(message('restart-a2',{sender:'alice'}),'live',f.port,new AbortController().signal)
 assert.equal(result.status,'responded');assert.equal(result.sessionId,first.sessionId);assert.equal(calls[0].lastDelivery,'accepted')
})
test('per-sender setting retains the existing private conversation mapping',async t=>{
 const shared=await fixture(t),isolated=await fixture(t,{config:{isolateGroupSenders:true}})
 const a=await shared.submit(message('private-1',{kind:'private'})),b=await isolated.submit(message('private-2',{kind:'private'}))
 assert.equal(a.sessionId,b.sessionId)
})
test('optional policy routes an unaddressed message without changing its original source and never suppresses direct messages',async t=>{
 const f=await fixture(t,{config:{trigger:'directed'}}),signal=new AbortController().signal,quoted=message('policy-1',{directed:false}),direct=message('policy-2')
 assert.equal((await f.kernel.submit(quoted,'live',f.port,signal,'reply')).status,'responded')
 assert.equal(f.calls[0].input.directedToBot,false)
 assert.equal((await f.kernel.submit(direct,'live',f.port,signal,'ignore')).status,'responded')
 assert.equal((await f.kernel.submit(message('policy-3',{directed:false}),'live',f.port,signal,'ignore')).reason,'not-directed')
})
test('routing runs after durable admission once per source and never for stale or conflicting replays',async t=>{
 const f=await fixture(t,{config:{trigger:'directed'}}),signal=new AbortController().signal,source=message('route-1',{directed:false}),seen=[]
 let release,entered;const wait=new Promise(resolve=>{release=resolve}),started=new Promise(resolve=>{entered=resolve})
 t.after(()=>release())
 const routing=async input=>{seen.push(input);entered();await wait;return'reply'}
 const first=f.kernel.submit(source,'live',f.port,signal,'default',undefined,routing)
 await started
 assert.equal((await f.kernel.submit(source,'live',f.port,signal,'default',undefined,routing)).status,'duplicate')
 assert.equal((await f.kernel.submit({...source,parts:[{type:'text',text:'changed'}]},'live',f.port,signal,'default',undefined,routing)).reason,'source-conflict')
 release();assert.equal((await first).status,'responded')
 assert.equal((await f.kernel.submit(source,'live',f.port,signal,'default',undefined,routing)).status,'duplicate')
 const old=message('route-old',{directed:false,override:{sentAt:1,receivedAt:1}})
 assert.equal((await f.kernel.submit(old,'live',f.port,signal,'default',undefined,routing)).reason,'stale')
 assert.equal(seen.length,1);assert.equal(f.calls.length,1);assert.equal(f.sent.length,1)
 assert.deepEqual((await f.store.receipt((await f.kernel.submit(old,'live',f.port,signal)).requestId)).input,old)
})
test('routing records ignored sources and cannot suppress an explicit mention',async t=>{
 const f=await fixture(t,{config:{trigger:'directed'}}),signal=new AbortController().signal,route=async()=> 'ignore'
 const ignored=message('route-ignore',{directed:false}),direct=message('route-direct')
 const result=await f.kernel.submit(ignored,'live',f.port,signal,'default',undefined,route)
 assert.equal(result.reason,'not-directed');assert.deepEqual((await f.store.receipt(result.requestId)).input,ignored)
 assert.equal((await f.kernel.submit(direct,'live',f.port,signal,'default',undefined,route)).status,'responded')
 assert.equal(f.calls.length,1)
})
test('accepted-reply observation happens before a delayed durable finish and is never invoked for failure notices',async t=>{
 let release,entered;const hold=new Promise(resolve=>{release=resolve}),blocked=new Promise(resolve=>{entered=resolve}),observed=[]
 t.after(()=>release())
 const f=await fixture(t,{wrapStore(store){
  const wrapper={};for(const name of ['claim','receipt','start','prepareSend','mapping','saveMapping','stats','close'])wrapper[name]=store[name].bind(store)
  wrapper.finish=async result=>{if(result.status==='responded'){entered();await hold}return store.finish(result)};return wrapper
 }})
 const pending=f.kernel.submit(message('receipt-1'),'live',f.port,new AbortController().signal,'default',result=>observed.push(result))
 const timeout=AbortSignal.timeout(30000);await Promise.race([blocked,new Promise((_,reject)=>timeout.addEventListener('abort',()=>reject(Error('Durable finish barrier timed out')),{once:true}))]);assert.equal(observed.length,1);assert.equal(observed[0].receipt.status,'accepted');assert.equal(observed[0].modelOutcome,'completed')
 release();assert.equal((await pending).status,'responded')
 const failing=await fixture(t,{run:async()=>{throw Error('synthetic model error')}}),notices=[]
 await failing.kernel.submit(message('receipt-2'),'live',failing.port,new AbortController().signal,'default',result=>notices.push(result))
 assert.deepEqual(notices,[])
})
test('different groups, private chats and account identities run independently under a global concurrency bound',async t=>{
 let release,entered;const gate=new Promise(resolve=>{release=resolve}),twoEntered=new Promise(resolve=>{entered=resolve});t.after(()=>release())
 let count=0;const f=await fixture(t,{config:{maxConcurrent:2},run:async()=>{if(++count===2)entered();await gate}})
 const sources=[message('1'),message('1',{peer:'90000200'}),message('1',{kind:'private'}),message('1',{account:'90000003'})]
 const pending=Promise.all(sources.map(input=>f.submit(input)))
 const timeout=AbortSignal.timeout(30000);await Promise.race([twoEntered,new Promise((_,reject)=>timeout.addEventListener('abort',()=>reject(Error('Two model calls did not enter')),{once:true}))]);assert.equal(f.peak,2);release()
 const results=await pending
 assert.ok(results.every(result=>result.status==='responded'))
 assert.equal(new Set(f.calls.map(call=>call.map.sessionId)).size,4)
 assert.equal(f.sent.find(output=>output.scope.kind==='private').parts[0].type,'text')
})
test('a busy group yields its next slot to another waiting group',async t=>{
 let release;const gate=new Promise(resolve=>{release=resolve})
 const f=await fixture(t,{config:{maxConcurrent:1},run:async(_map,input)=>{if(input.messageId==='1')await gate}})
 const first=f.submit(message('1'));await until(()=>f.calls.length===1)
 const second=f.submit(message('2')),other=f.submit(message('3',{peer:'90000200'}))
 await until(()=>f.kernel.status().queued===2);release()
 await Promise.all([first,second,other])
 assert.deepEqual(f.calls.map(call=>call.input.messageId),['1','3','2'])
})
test('duplicate and conflicting live sources never trigger a second model or send',async t=>{
 let release;const gate=new Promise(resolve=>{release=resolve})
 const f=await fixture(t,{run:async()=>gate}),source=message('1'),first=f.submit(source)
 await until(()=>f.calls.length===1)
 assert.equal((await f.submit({...source,receivedAt:source.receivedAt+1})).status,'duplicate')
 assert.equal((await f.submit({...source,parts:[{type:'text',text:'different body'}]})).reason,'source-conflict')
 release();await first
 assert.equal((await f.submit(source)).status,'duplicate')
 assert.equal(f.calls.length,1);assert.equal(f.sent.length,1)
})
test('uncertain delivery is durable and a replay after reload does not regenerate or resend',async t=>{
 const f=await fixture(t,{port:{async send(output){f.sent.push(output);return{status:'uncertain',code:'timeout'}}}})
 const source=message('1'),first=await f.submit(source)
 assert.equal(first.status,'uncertain');assert.equal(first.modelOutcome,'completed')
 await f.kernel.close()
 const reopened=await SqliteJournal.open(f.options);let models=0,sends=0
 const model={async resolvePreset(){return'qa'},async run(){models++;throw Error('Replay must not run')},async dispose(){}}
 const kernel=new ChatKernel(resolveConfig(Config({enabled:true}),root),reopened,model);t.after(()=>kernel.close())
 const replay=await kernel.submit(source,'live',{async availability(){return'available'},async send(){sends++;throw Error('Replay must not send')}},new AbortController().signal)
 assert.equal(replay.status,'duplicate');assert.equal(models,0);assert.equal(sends,0)
 assert.equal((await reopened.receipt(first.requestId)).result.receipt.code,'timeout')
})
test('muted, stale and unavailable sources retain receipts without model computation',async t=>{
 for(const availability of ['muted','offline','throws']){
  const f=await fixture(t,{port:{async availability(){if(availability==='throws')throw Error('fixture failure');return availability}}})
  const result=await f.submit(message(availability))
  assert.equal(result.reason,availability==='muted'?'muted':'offline');assert.equal(f.calls.length,0);assert.equal(f.sent.length,0)
  assert.equal((await f.store.receipt(result.requestId)).phase,'settled')
 }
 const f=await fixture(t),old=message('old',{override:{sentAt:1,receivedAt:1}}),result=await f.submit(old)
 assert.equal(result.reason,'stale');assert.equal(f.calls.length,0)
 assert.deepEqual((await f.store.receipt(result.requestId)).input,old)
})
test('cancelling one queued source does not cancel another conversation',async t=>{
 let release;const gate=new Promise(resolve=>{release=resolve})
 const f=await fixture(t,{config:{maxConcurrent:1},run:async(_map,input)=>{if(input.messageId==='1')await gate}})
 const first=f.submit(message('1'));await until(()=>f.calls.length===1)
 const cancelled=new AbortController(),second=f.submit(message('2'),cancelled.signal),other=f.submit(message('3',{peer:'90000200'}))
 await until(()=>f.kernel.status().queued===2);cancelled.abort()
 assert.equal((await second).status,'cancelled');release()
 assert.equal((await first).status,'responded');assert.equal((await other).status,'responded')
 assert.deepEqual(f.calls.map(call=>call.input.messageId),['1','3'])
})
test('model timeout makes one safe notice and preserves model failure separately from its accepted receipt',async t=>{
 const f=await fixture(t,{config:{modelTimeoutMs:50},run:async(_map,_input,_id,signal)=>{await delay(10000,undefined,{signal})}})
 const result=await f.submit(message('1'))
 assert.equal(result.status,'failed');assert.equal(result.reason,'model-timeout');assert.equal(result.modelOutcome,'failed')
 assert.equal(result.modelReason,'model-timeout');assert.equal(result.receipt.status,'accepted')
 assert.equal(f.calls.length,1);assert.equal(f.sent.length,1)
})
test('sensitive model output and an interrupted final interval are not forwarded',async t=>{
 for(const result of [{text:'F%3A%5Cfixture%5Csecret.txt'},{text:'token '+'sk-'+'x'.repeat(32)},{text:'the local service is 192.168.42.7'},{text:'partial answer',completed:false},{text:'another input',externalInput:true}]){
  const f=await fixture(t,{run:async()=>result}),outcome=await f.submit(message('1'))
  assert.equal(outcome.status,'failed');assert.equal(f.sent.length,1)
  assert.ok(!f.sent[0].parts.some(part=>part.type==='text'&&part.text===result.text))
 }
})
test('model failure and uncertain failure-notice delivery remain independent',async t=>{
 const f=await fixture(t,{run:async()=>{throw Error('fixture private exception')},port:{async send(output){f.sent.push(output);throw Error('uncertain sender')}}})
 const result=await f.submit(message('1'))
 assert.equal(result.status,'uncertain');assert.equal(result.modelOutcome,'failed');assert.equal(result.modelReason,'model-failed')
 assert.equal(result.receipt.status,'uncertain');assert.equal(f.sent.length,1)
 assert.ok(!JSON.stringify(f.sent).includes('private exception'))
})
test('a mapping sidecar failure after accepted delivery cannot rewrite the accepted receipt',async t=>{
 const f=await fixture(t,{wrapStore(store){
  const wrapper={};for(const name of ['claim','receipt','start','prepareSend','finish','mapping','stats','close'])wrapper[name]=store[name].bind(store)
  let writes=0;wrapper.saveMapping=async record=>{if(++writes>1)throw new StoreError('unavailable');return store.saveMapping(record)}
  return wrapper
 }})
 const result=await f.submit(message('1'))
 assert.equal(result.status,'responded');assert.equal(result.receipt.status,'accepted')
 assert.equal((await f.store.receipt(result.requestId)).result.receipt.status,'accepted')
 assert.equal(f.kernel.status().lastFailure,'storage/unavailable')
})
test('shutdown cancels active computation, joins workers and never sends its partial output',async t=>{
 const f=await fixture(t,{run:async(_map,_input,_id,signal)=>{await delay(10000,undefined,{signal})}})
 const pending=f.submit(message('1'));await until(()=>f.calls.length===1)
 await f.kernel.close();assert.equal((await pending).status,'cancelled');assert.equal(f.sent.length,0)
 assert.equal(f.disposed,1);assert.equal(f.kernel.status().running,0)
})
test('capacity and queue expiry send one notice without spending a model attempt',async t=>{
 for(const mode of ['capacity','queue']){
  let release;const gate=new Promise(resolve=>{release=resolve})
  const f=await fixture(t,{config:{maxConcurrent:1,maxPending:mode==='capacity'?1:4,maxPendingPerScope:mode==='capacity'?1:4,queueTimeoutMs:50},run:async(_map,input)=>{if(input.messageId==='1')await gate}})
  const first=f.submit(message('1'));await until(()=>f.calls.length===1)
  const second=await f.submit(message('2'))
  assert.equal(second.reason,mode==='capacity'?'capacity':'queue-timeout');assert.equal(second.modelOutcome,'not-started')
  assert.equal(f.calls.length,1);assert.equal(f.sent.length,1);assert.equal(f.sent[0].parts[0].messageId,'2')
  release();await first
 }
})
test('input limits retain the complete source without invoking the model',async t=>{
 const f=await fixture(t,{config:{maxInputChars:5}}),input=message('1',{text:'complete original text'}),result=await f.submit(input)
 assert.equal(result.reason,'input-too-long');assert.equal(result.modelOutcome,'not-started');assert.equal(f.calls.length,0)
 assert.deepEqual((await f.store.receipt(result.requestId)).input,input)
})
