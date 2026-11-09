/** Probe the installed bundle through its public services; no private Session reads. */
import assert from 'node:assert/strict'
import {writeFile,rename} from 'node:fs/promises'
import {setImmediate as nextTurn} from 'node:timers/promises'
import {setTimeout as delay} from 'node:timers/promises'
import {identifier} from 'dsh-im-kit'
export const name='qq-chat-native-probe'
export const inject=['im','qqChatTest','configEditor','qqChatControl','typertGateway','remoteAccess','tools','agentPresets']
async function record(path,data){await writeFile(path+'.tmp',JSON.stringify(data,null,2)+'\n');await rename(path+'.tmp',path)}
export function apply(ctx,config){
 const lifetime=new AbortController();let work
 let scopeApi
 const diagnostics=[]
 ctx.on('qq-chat/diagnostic',({stage,error})=>{diagnostics.push({stage,name:error?.name,message:error?.message,code:error?.code})})
 ctx.on('agent/created',({agent})=>{ctx.qqChatTest.toolVisibility.push({id:agent.id,tools:ctx.tools.definitions(agent).map(tool=>tool.name),preset:ctx.agentPresets.composedPreset(agent.ctx),sameScope:scopeApi?.scopeOf(agent.ctx)===agent,scopeIncludesTool:ctx.qqChatTest.toolContexts.map(context=>[...scopeApi.scopeChainOf(agent)].includes(scopeApi.scopeOf(context)))})})
 ctx.effect(()=>async()=>{lifetime.abort();await work})
 work=(async()=>{
  await nextTurn();lifetime.signal.throwIfAborted()
  scopeApi=await import(config.scopeModuleUrl)
  const checks=[],state=ctx.qqChatTest
  const source=(id,peer,text,directed=true)=>{const now=Date.now();return{scope:{account:state.account,kind:'group',peerId:identifier('im.peer',peer)},messageId:identifier('im.message',id),senderId:identifier('im.user','90000002'),sentAt:now,receivedAt:now,directedToBot:directed,parts:[{type:'text',text}]}}
  const send=async value=>{const report=await ctx.im.publish(value,lifetime.signal);assert.equal(report.failed,0);assert.ok(report.accepted>0)}
  const runtime=()=>{const service=ctx.get('qqChat');assert.ok(service);return service}
  try{
   const readyEntry=ctx.configEditor.entries().find(value=>value.options.id==='qq-chat-runtime');assert.ok(readyEntry?.fiber);await readyEntry.fiber.await()
   assert.equal(runtime().status().transportAttached,true)
   const a=source('101','90000100','NATIVE_FIRST_QUESTION')
   await send(a);assert.equal(state.outputs.length,1);assert.equal(state.outputs[0].parts[0].messageId,'101')
   assert.ok(state.outputs[0].parts.some(part=>part.type==='text'&&part.text.startsWith('NATIVE_REPLY_')),'The first reply did not come from the native model adapter')
   checks.push('native-agent-first-reply')
   await send(source('102','90000100','NATIVE_FOLLOWUP',false));assert.equal(state.outputs.length,2)
   assert.equal((await runtime().historyCounts()).mappings,1)
   checks.push('same-session-unmentioned-followup')
   await send({...a,receivedAt:a.receivedAt+1});assert.equal(state.outputs.length,2)
   checks.push('durable-source-replay-does-not-regenerate')
   const entry=ctx.configEditor.entries().find(value=>value.options.id==='qq-chat-runtime');assert.ok(entry)
   await ctx.configEditor.edit(entry,raw=>({...raw,enabled:false}))
   assert.equal(ctx.get('qqChat'),undefined)
   await ctx.configEditor.edit(entry,raw=>({...raw,enabled:true}))
   await send(source('103','90000100','NATIVE_AFTER_RELOAD',false));assert.equal(state.outputs.length,3)
   assert.equal((await runtime().historyCounts()).mappings,1)
   checks.push('native-reload-resumes-session-and-contact-without-replay')
   await Promise.all([send(source('104','90000200','NATIVE_GROUP_TWO')),send(source('105','90000300','NATIVE_GROUP_THREE'))])
   assert.equal(state.outputs.length,5)
   assert.equal((await runtime().historyCounts()).mappings,3)
   checks.push('parallel-independent-conversations')
   const preview=await runtime().preview('NATIVE_LOCAL_PREVIEW',lifetime.signal)
   assert.equal(preview.result.status,'previewed');assert.equal(preview.outbound.length,1);assert.equal(state.outputs.length,5)
   checks.push('same-orchestration-local-preview-does-not-publish')
   assert.ok(state.outputs.every(output=>!JSON.stringify(output).includes('SYNTHETIC_REASONING')))
   checks.push('reasoning-is-not-delivered')
   const control=ctx.qqChatControl,controlUid=ctx.configEditor.entries().find(value=>value.options.id==='qq-chat-control')?.fiber?.uid
   assert.ok(controlUid!==undefined)
   const peer={id:'chat-owner-fixture',ctx,principal:{kind:'owner'},signal:lifetime.signal,interactions:'none',async dispose(){}}
   const invoke=(method,args={},caller=peer)=>ctx.typertGateway.invoke({namespace:'qqChatControl',method,args,peer:caller,signal:lifetime.signal})
   let saved=await invoke('describe');assert.equal(saved.appliedRevision,saved.revision)
   checks.push('native-owner-control-through-src-gateway')
   ctx.effect(()=>ctx.remoteAccess.registerPolicy('chat-test-guest',{bindings:()=>[{resource:{kind:'global'},role:{name:'qa-chat',resource:'global',actions:['qqChatControl/describe','qqChatControl/save','qqChatControl/restart','qqChatControl/preview','qqChatControl/cancelPreview']}}]}))
   const guest={...peer,id:'chat-guest-fixture',principal:{kind:'chat-test-guest'}}
   for(const [method,args]of [['describe',{}],['save',{request:{revision:saved.revision,patch:{enabled:false}}}],['restart',{request:{revision:saved.revision}}],['preview',{request:{revision:saved.revision,previewId:'preview-guest-test-0001',text:'test'}}],['cancelPreview',{request:{previewId:'preview-guest-test-0001'}}]])await assert.rejects(invoke(method,args,guest),error=>error.code==='qq-chat/control'&&error.details.reason==='forbidden')
   checks.push('all-owner-operations-refuse-non-owner-even-with-global-policy')
   await assert.rejects(invoke('save',{request:{revision:'0'.repeat(64),patch:{enabled:false}}}),error=>error.details?.reason==='revision-conflict')
   await assert.rejects(invoke('save',{request:{revision:saved.revision,patch:{maxConcurrent:128,maxLiveSessions:1}}}),error=>error.details?.reason==='config-invalid')
   await assert.rejects(invoke('preview',{request:{revision:saved.revision,previewId:'preview-test-0001',text:'test',destination:'some-group'}}),error=>error.details?.reason==='request-invalid')
   checks.push('stale-invalid-and-live-destination-edits-refused')
   const previewRequest={revision:saved.revision,previewId:'preview-control-first-0001',text:'NATIVE_OWNER_PREVIEW'}
   const controlled=await invoke('preview',{request:previewRequest});assert.equal(controlled.status,'previewed');assert.ok(controlled.output[0].startsWith('NATIVE_REPLY_'));assert.equal(state.outputs.length,5)
   const replay=await invoke('preview',{request:previewRequest});assert.equal(replay.status,'duplicate');assert.equal(replay.output.length,0)
   checks.push('owner-preview-captures-real-outbound-and-durable-id-replay-does-not-regenerate')
   const observe=async()=>{const response=await fetch(config.observationUrl);assert.equal(response.status,200);return response.json()}
   const until=async check=>{const limit=Date.now()+5000;while(!await check()){assert.ok(Date.now()<limit,'Native test condition timed out');await delay(15)}}
   const before=(await observe()).requests,slowId='preview-control-hold-0001'
   const slow=invoke('preview',{request:{revision:saved.revision,previewId:slowId,text:'NATIVE_PREVIEW_HOLD'}})
   await until(async()=>((await observe()).requests>before))
   await send(source('106','90000400','NATIVE_PARALLEL_DURING_PREVIEW'));assert.equal(state.outputs.length,6)
   assert.equal((await invoke('cancelPreview',{request:{previewId:slowId}})).requested,true)
   assert.equal((await slow).status,'cancelled')
   assert.equal(runtime().status().runtime.lastFailure,null);assert.equal(runtime().status().model.lastFailure,null)
   await until(async()=>((await observe()).active===0))
   const afterCancel=await invoke('preview',{request:{revision:saved.revision,previewId:'preview-control-after-cancel-0001',text:'NATIVE_AFTER_CANCEL'}});assert.equal(afterCancel.status,'previewed')
   checks.push('native-preview-cancel-joins-http-and-does-not-block-other-conversations')
   await send(source('107','90000500','NATIVE_TOOL_REQUEST DENIED'))
   assert.equal(state.toolCalls.length,0);assert.equal(state.outputs.length,7)
   saved=await invoke('save',{request:{revision:saved.revision,patch:{allowedTools:['fixture_echo']}}})
   assert.equal(saved.appliedRevision,saved.revision)
   await send(source('108','90000600','NATIVE_TOOL_REQUEST ALLOWED'))
   assert.equal(state.toolCalls.length,1);assert.equal(state.outputs.length,8)
   const toolPreview=await invoke('preview',{request:{revision:saved.revision,previewId:'preview-control-tools-denied-0001',text:'NATIVE_TOOL_REQUEST PREVIEW'}})
   assert.equal(toolPreview.status,'previewed');assert.equal(state.toolCalls.length,1);assert.equal(state.outputs.length,8)
   checks.push('native-scoped-tool-guard-denies-by-default-allows-explicit-and-denies-preview')
   await until(async()=>runtime().status().model.sessions===0)
   await send(source('109','90000100','NATIVE_AFTER_IDLE',false));assert.equal(state.outputs.length,9)
   checks.push('native-idle-eviction-resumes-durable-history')
   const restarted=await invoke('restart',{request:{revision:saved.revision}});assert.equal(restarted.appliedRevision,restarted.revision)
   const isolated=await invoke('save',{request:{revision:restarted.revision,patch:{isolateGroupSenders:true}}})
   assert.equal(isolated.appliedRevision,isolated.revision)
   await send(source('isolate-a1','90000100','NATIVE_ISOLATE_A_FIRST'))
   await send({...source('isolate-b1','90000100','NATIVE_ISOLATE_B_FIRST'),senderId:identifier('im.user','90000003')})
   await send(source('isolate-a2','90000100','NATIVE_ISOLATE_A_AGAIN'))
   assert.equal(state.outputs.length,12)
   checks.push('per-sender-native-session-isolation')
   let guards=0,decisions=0
   ctx.effect(()=>ctx.provide('qqTurnPolicy',{guard(input){guards++;if(input.messageId==='native-guarded')return'block';if(input.messageId==='native-guard-error')throw Error('Synthetic guard failure');return'allow'},async decide(){decisions++;throw Error('Synthetic classifier failure')},observe(){}}))
   const guarded=source('native-guarded','90000100','NATIVE_GUARDED')
   await send(guarded);await send(guarded);assert.equal(state.outputs.length,12);assert.equal(guards,1)
   checks.push('native-sender-guard-blocks-explicit-source-once-without-model-work')
   await send(source('native-human-explicit','90000100','NATIVE_HUMAN_EXPLICIT'));assert.equal(state.outputs.length,13);assert.equal(decisions,0)
   await send(source('native-guard-error','90000100','NATIVE_GUARD_ERROR'));assert.equal(state.outputs.length,14);assert.equal(decisions,0)
   checks.push('ordinary-explicit-mentions-bypass-intent-even-after-guard-failure')
   await send(source('native-classifier-error','90000100','NATIVE_UNQUOTED_CLASSIFIER_ERROR',false));assert.equal(state.outputs.length,14);assert.equal(decisions,1)
   assert.ok(diagnostics.some(item=>item.stage==='turn-policy'));assert.ok(diagnostics.some(item=>item.stage==='turn-policy-guard'))
   checks.push('classifier-failure-is-diagnosed-without-triggering-basic-followup')
   const disabled=await invoke('save',{request:{revision:isolated.revision,patch:{enabled:false}}})
   assert.equal(disabled.runtime,null);assert.equal(disabled.appliedRevision,null)
   assert.equal(ctx.configEditor.entries().find(value=>value.options.id==='qq-chat-control')?.fiber?.uid,controlUid)
   await assert.rejects(invoke('preview',{request:{revision:disabled.revision,previewId:'preview-while-disabled-0001',text:'test'}}),error=>error.details?.reason==='runtime-unavailable')
   checks.push('native-restart-and-disable-preserve-independent-control-entry')
   await record(config.resultPath,{passed:true,checks,realQqMessagesSent:0,fixtureDeliveries:state.outputs.length,toolExecutions:state.toolCalls.length,control:await control.describe()})
  }catch(error){await record(config.resultPath,{passed:false,checks,error:{message:error.message,stack:error.stack,diagnostics,toolRegistrations:state.toolRegistrations,toolVisibility:state.toolVisibility,toolScopes:state.toolContexts.map(context=>({scoped:Boolean(scopeApi.scopeOf(context)),tools:ctx.tools.definitions(scopeApi.scopeOf(context)).map(tool=>tool.name)})),globalTools:ctx.tools.definitions().map(tool=>tool.name)}})}
 })()
}
