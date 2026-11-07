/** Owner controls use real Cordis lifetimes and only synthetic runtime services. */
import test from 'node:test'
import assert from 'node:assert/strict'
import {Context} from '@deepseek-ai/cordis'
import Control,{Config as ControlConfig} from '../dist/control.js'
import {Config} from '../dist/config.js'
import {configRevision} from '../dist/config-revision.js'
import {CONFIG_FIELDS} from '../dist/config-fields.js'
import {draftPatch,fieldValue} from '../dist/config-draft.js'
import {saveSchema,snapshotSchema,previewSchema,previewResponseSchema,cancelPreviewSchema} from '../dist/control-codecs.js'

const rejected=reason=>error=>error.code==='qq-chat/control'&&error.details.reason===reason&&!error.message.includes('synthetic-private-diagnostic')
const revision='a'.repeat(64),previewId='preview-synthetic-owner-0001'
const result=status=>({requestId:'synthetic-request',status,reason:status==='cancelled'?'cancelled':null,modelOutcome:status==='cancelled'?'cancelled':'completed',modelReason:null,sessionId:'synthetic-session',receipt:null,reply:null,fromOffset:0,toOffset:1})

async function mount(t,{preview,editFailure=false}={}){
 const ctx=new Context(),fibers=[],writes=[],calls=[]
 const entry={options:{id:'qq-chat-runtime',name:'dsh-qq-chat',config:{enabled:true}},disabled:false,fiber:{config:{enabled:true},effectiveConfig:Config({enabled:true}),state:2,restarts:0,async restart(){this.restarts++}}}
 const runtime={
  configRevision:configRevision(entry.fiber.effectiveConfig),
  status:()=>({transportAttached:false,runtime:{queued:0,running:0,checking:0,stopping:false,lastFailure:null},model:{sessions:0,lastFailure:null}}),
  historyCounts:async()=>({receipts:0,queued:0,running:0,interrupted:0,responded:0,uncertain:0,mappings:0}),
  async preview(text,signal,id){calls.push({text,signal,id});return preview?preview(text,signal,id):{result:result('previewed'),outbound:[{parts:[{type:'text',text:'CAPTURED_PUBLIC_TEXT'}]}]}},
 }
 const editor={
  entries:()=>[entry],configuration:()=>[{entry,inherited:{enabled:false},override:{model:'synthetic-model'}}],
  async edit(target,change){
   assert.equal(target,entry)
   if(editFailure)throw Error('synthetic-private-diagnostic must not cross Remote')
   const next=change(structuredClone(entry.options.config))
   writes.push(next);entry.options.config=next;entry.fiber.config=next;entry.fiber.effectiveConfig=Config(next);runtime.configRevision=configRevision(entry.fiber.effectiveConfig)
  },
 }
 const services=ctx.plugin({name:'chat-control-fixture',apply(ctx){
  ctx.effect(()=>ctx.provide('configEditor',editor));ctx.effect(()=>ctx.provide('qqChat',runtime))
  for(const name of ['agents','sessionPersistence','tools'])ctx.effect(()=>ctx.provide(name,{}))
  ctx.effect(()=>ctx.provide('agentPresets',{readDocument(){throw Error('Preset documents must not be read by owner control')}}))
 }});fibers.push(services);await services.await()
 const fiber=ctx.plugin(Control,ControlConfig({}));fibers.push(fiber);await fiber.await()
 t.after(async()=>{for(const item of fibers.reverse())await item.dispose()})
 return{ctx,control:ctx.qqChatControl,entry,runtime,writes,calls,fiber}
}

test('owner state uses effective settings and detached metadata without preset documents',async t=>{
 const {control,entry}=await mount(t)
 entry.fiber.config={enabled:false,model:{'!!js':'synthetic expression'}}
 const snapshot=await control.describe()
 assert.equal(snapshot.config.enabled,true);assert.equal(snapshot.appliedRevision,snapshot.revision);assert.equal(snapshot.runtime.transportAttached,false)
 assert.deepEqual(snapshot.services,{agents:true,presets:true,persistence:true,tools:true})
 snapshot.config.allowedTools.push('changed');assert.deepEqual(entry.fiber.effectiveConfig.allowedTools,[])
 assert.deepEqual(snapshot.overriddenFields,['model'])
})

test('revision checked saves reject unknown and cross-field invalid edits before writing',async t=>{
 const {control,writes}=await mount(t),before=await control.describe()
 const saved=await control.save({revision:before.revision,patch:{maxConcurrent:2,allowedTools:['fixture_echo']}})
 assert.notEqual(saved.revision,before.revision);assert.equal(writes.length,1)
 await assert.rejects(async()=>control.save({revision:before.revision,patch:{enabled:false}}),rejected('revision-conflict'))
 for(const patch of [{hiddenSecret:'synthetic-only'},{maxConcurrent:'3'},{allowedTools:['x','x']},{provider:'provider-without-model'},{maxConcurrent:128,maxLiveSessions:1}])await assert.rejects(async()=>control.save({revision:saved.revision,patch}),error=>['request-invalid','config-invalid'].includes(error.details?.reason))
 assert.equal(writes.length,1)
})

test('save and preview failures never echo native diagnostics and restart does not clear mappings',async t=>{
 const {control,entry}=await mount(t,{editFailure:true,preview:async()=>{throw Error('synthetic-private-diagnostic')}})
 const state=await control.describe()
 await assert.rejects(control.save({revision:state.revision,patch:{enabled:false}}),rejected('apply-failed'))
 await assert.rejects(control.preview({revision:state.revision,previewId,text:'hello'}),rejected('preview-failed'))
 await control.restart({revision:state.revision});assert.equal(entry.fiber.restarts,1)
 await assert.rejects(async()=>control.restart({revision:state.revision,target:'some-other-entry'}),rejected('request-invalid'))
})

test('preview captures only public outbound text and cannot choose destinations or override tools',async t=>{
 const {control,calls}=await mount(t),state=await control.describe()
 const response=await control.preview({revision:state.revision,previewId,text:'synthetic question'})
 assert.deepEqual(response.output,['CAPTURED_PUBLIC_TEXT']);assert.equal(response.modelOutcome,'completed');assert.equal(calls[0].id,previewId)
 for(const extra of [{destination:'other-group'},{allowedTools:['some-tool']},{enabled:true}])await assert.rejects(async()=>control.preview({revision:state.revision,previewId,text:'hello',...extra}),rejected('request-invalid'))
 assert.equal(calls.length,1)
})

test('cancelling one preview and disposing control join owned work without cancelling its sibling',async t=>{
 let completeSecond
 const second=new Promise(resolve=>{completeSecond=resolve})
 const {control,fiber}=await mount(t,{preview:async(_text,signal,id)=>{
  if(id.endsWith('0002'))await second
  else await new Promise(resolve=>{if(signal.aborted)resolve();else signal.addEventListener('abort',resolve,{once:true})})
  return{result:result(signal.aborted?'cancelled':'previewed'),outbound:[]}
 }})
 const state=await control.describe()
 const first=control.preview({revision:state.revision,previewId,text:'first'})
 const sibling=control.preview({revision:state.revision,previewId:'preview-synthetic-owner-0002',text:'second'})
 await assert.rejects(async()=>control.preview({revision:state.revision,previewId,text:'duplicate active'}),rejected('preview-active'))
 assert.equal(control.cancelPreview({previewId}).requested,true)
 assert.equal((await first).status,'cancelled')
 completeSecond();assert.equal((await sibling).status,'previewed')
 const third=control.preview({revision:state.revision,previewId:'preview-synthetic-owner-0003',text:'third'})
 await fiber.dispose();assert.equal((await third).status,'cancelled')
 assert.throws(()=>control.describe(),rejected('cancelled'))
})

test('browser drafts retain multiline values and native codecs reject extra authority or output fields',()=>{
 const config=Config({}),draft={allowedTools:'first_tool\nsecond_tool',maxTokens:'0',enabled:false}
 assert.deepEqual(draftPatch(draft,config),{ok:true,patch:{allowedTools:['first_tool','second_tool']}})
 for(const value of ['','1.5','NaN','9007199254740993'])assert.deepEqual(draftPatch({maxTokens:value},config),{ok:false,field:'maxTokens'})
 assert.equal(fieldValue({...config,allowedTools:['a','b']},'allowedTools'),'a\nb')
 assert.deepEqual(Object.keys(CONFIG_FIELDS).sort(),Object.keys(config).sort())
 assert.notEqual(configRevision(config),configRevision({...config,maxInputChars:config.maxInputChars+1}))
 assert.deepEqual(saveSchema.parse({revision,patch:{enabled:false}}),{revision,patch:{enabled:false}})
 for(const value of [{revision,patch:{secret:'synthetic'}},{revision,patch:{maxConcurrent:1.5}}])assert.throws(()=>saveSchema.parse(value))
 assert.throws(()=>previewSchema.parse({revision,previewId,text:'hello',destination:'live-group'}))
 assert.throws(()=>cancelPreviewSchema.parse({previewId,cancelAll:true}))
 assert.throws(()=>previewResponseSchema.parse({previewId,status:'previewed',reason:null,modelOutcome:'completed',modelReason:null,output:['text'],thinking:'synthetic'}))
 assert.throws(()=>snapshotSchema.parse({config,revision,appliedRevision:null,entryActive:true,entryDisabled:false,overriddenFields:[],refreshMs:3000,services:{agents:true,presets:true,persistence:true,tools:true},runtime:{online:true},counts:null}))
})
