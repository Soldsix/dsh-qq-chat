/** Durable source admission, fair conversation queues and single-attempt delivery. */
import {scopeKey,identifier,type InboundMessage,type OutboundMessage,type UserId,type DeliveryReceipt} from 'dsh-im-kit'
import type {Spec} from './config.ts'
import type {ChatJournal,ChatModelRunner,DeliveryPort,ChatMode,ChatResult,RequestId,MappingId,MappingRecord,Reason} from './types.ts'
import {requestId,fingerprint,mappingId,sessionId} from './identity.ts'
import {StoreError} from './store-protocol.ts'
import {sensitiveOutput} from './privacy.ts'
import {failureText} from './copy.ts'
import type {KernelStatus} from './runtime-status.ts'
export type {KernelStatus} from './runtime-status.ts'

interface Task{
  readonly id:RequestId;readonly lane:MappingId;readonly input:InboundMessage;readonly mode:ChatMode
  readonly port:DeliveryPort;readonly signal:AbortSignal;readonly resolve:(result:ChatResult)=>void
  running:boolean;settled:boolean;timer:ReturnType<typeof setTimeout>|null;abort:(()=>void)|null
  mapping:MappingRecord|null
}
interface Lane{readonly tasks:Task[];running:boolean}
interface Contact{readonly senderId:UserId;readonly at:number}
/** Orchestration is shared by actual transport and explicitly isolated text preview. */
export class ChatKernel{
  private readonly lifetime=new AbortController()
  private readonly claims=new Map<RequestId,{fingerprint:string;result:Promise<ChatResult>}>()
  private readonly lanes=new Map<MappingId,Lane>()
  private readonly contacts=new Map<MappingId,Contact>()
  private readonly ready:MappingId[]=[]
  private readonly readySet=new Set<MappingId>()
  private readonly running=new Set<Promise<void>>()
  private readonly finalizing=new Set<Promise<void>>()
  private queued=0
  private active=0
  private lastFailure:string|null=null
  private stopping:Promise<void>|undefined
  constructor(private readonly config:Spec,private readonly journal:ChatJournal,private readonly model:ChatModelRunner,private readonly changed:()=>void=()=>{}){}

  /** @returns detached queue metadata without chat bodies or model output. */
  status():KernelStatus{return{queued:this.queued,running:this.active,checking:Math.max(0,this.claims.size-this.queued-this.active),stopping:this.lifetime.signal.aborted,lastFailure:this.lastFailure}}
  private notify():void{try{this.changed()}catch(error){/* Status observers do not own admitted work. */}}
  private base(id:RequestId,status:ChatResult['status'],reason:Reason|null):ChatResult{return{requestId:id,status,reason,modelOutcome:'not-started',modelReason:null,sessionId:null,receipt:null,reply:null,fromOffset:null,toOffset:null}}

  /**
   * Admit a normalized source once; repeated observations do not generate or send again.
   * @param input - trusted source whose original payload remains in the journal.
   * @param mode - live or isolated preview mapping.
   * @param port - availability and one-attempt delivery provider.
   * @param signal - caller cancellation joined with runtime lifetime.
   * @returns terminal model and delivery outcomes without automatic retry.
   */
  submit(input:InboundMessage,mode:ChatMode,port:DeliveryPort,signal:AbortSignal,policy:'reply'|'ignore'|'default'='default'):Promise<ChatResult>{
    const id=requestId(input,mode),digest=fingerprint(input)
    if(this.lifetime.signal.aborted||signal.aborted)return Promise.resolve(this.base(id,'cancelled','cancelled'))
    const existing=this.claims.get(id)
    if(existing)return Promise.resolve(this.base(id,existing.fingerprint===digest?'duplicate':'failed',existing.fingerprint===digest?null:'source-conflict'))
    const combined=AbortSignal.any([signal,this.lifetime.signal])
    const result=this.admit(input,id,digest,mode,port,combined,policy).catch(error=>{
      this.lastFailure=error instanceof StoreError?'storage/'+error.code:'runtime/failure'
      return this.base(id,combined.aborted?'cancelled':'failed',combined.aborted?'cancelled':'storage-unavailable')
    })
    this.claims.set(id,{fingerprint:digest,result});this.notify()
    void result.then(()=>{this.claims.delete(id);this.notify()})
    return result
  }

  private async loadMapping(input:InboundMessage,mode:ChatMode):Promise<MappingRecord>{
    const preset=await this.model.resolvePreset(),key=mappingId(this.config.namespace,input.scope,mode,preset)
    const saved=await this.journal.mapping(key),scope=scopeKey(input.scope)
    if(saved){if(saved.scopeKey!==scope||saved.presetId!==preset||saved.mode!==mode||saved.sessionId!==sessionId(key))throw new StoreError('invalid-data');return saved}
    return{mappingId:key,scopeKey:scope,mode,presetId:preset,sessionId:sessionId(key),lastSenderId:null,lastReplyAt:0,lastDelivery:null,createdAt:Date.now()}
  }
  private async admit(input:InboundMessage,id:RequestId,digest:string,mode:ChatMode,port:DeliveryPort,signal:AbortSignal,policy:'reply'|'ignore'|'default'):Promise<ChatResult>{
    const lane=mappingId(this.config.namespace,input.scope,mode,'')
    const direct=input.scope.kind==='private'||input.directedToBot||policy==='reply'
    if(!direct&&policy==='ignore')return this.base(id,'ignored','not-directed')
    if(!direct){
      if(this.config.trigger!=='followup')return this.base(id,'ignored','not-directed')
      let contact=this.contacts.get(lane)
      if(!contact){
        const map=await this.loadMapping(input,mode)
        if(map.lastSenderId)contact={senderId:map.lastSenderId,at:map.lastReplyAt}
      }
      if(!contact||contact.senderId!==input.senderId||Date.now()-contact.at>this.config.followupWindowMs)return this.base(id,'ignored','not-directed')
    }
    if(signal.aborted)return this.base(id,'cancelled','cancelled')
    const claimed=await this.journal.claim({requestId:id,scopeKey:scopeKey(input.scope),fingerprint:digest,mode,phase:'queued',input,updatedAt:Date.now(),sessionId:null,result:null})
    if(claimed!=='created')return this.base(id,claimed==='duplicate'?'duplicate':'failed',claimed==='duplicate'?null:'source-conflict')
    const terminal=async(result:ChatResult)=>{await this.journal.finish(result);return result}
    if(signal.aborted)return terminal(this.base(id,'cancelled','cancelled'))
    const now=Date.now(),sourceTime=input.sentAt>0?Math.min(input.sentAt,input.receivedAt):input.receivedAt
    if(now-sourceTime>this.config.maxSourceAgeMs)return terminal(this.base(id,'ignored','stale'))
    let availability:Awaited<ReturnType<DeliveryPort['availability']>>
    try{availability=await port.availability(input.scope,AbortSignal.any([signal,AbortSignal.timeout(this.config.sendTimeoutMs)]))}catch(error){availability='offline'}
    if(availability!=='available')return terminal(this.base(id,'ignored',availability==='muted'?'muted':availability==='disabled'?'disabled':'offline'))
    const current=this.lanes.get(lane)
    if(this.queued+this.active>=this.config.maxPending||(current?.tasks.length??0)+(current?.running?1:0)>=this.config.maxPendingPerScope){
      const task=this.makeTask(input,id,mode,port,signal,lane,()=>{})
      return this.deliver(task,{...this.base(id,'failed','capacity'),reply:failureText('capacity',this.config.locale)})
    }
    this.contacts.delete(lane);this.contacts.set(lane,{senderId:input.senderId,at:now})
    while(this.contacts.size>this.config.maxLiveSessions){const oldest=this.contacts.keys().next().value;if(oldest!==undefined)this.contacts.delete(oldest)}
    return new Promise(resolve=>{
      const task=this.makeTask(input,id,mode,port,signal,lane,resolve)
      const queue=current??{tasks:[],running:false};this.lanes.set(lane,queue);queue.tasks.push(task);this.queued++
      task.abort=()=>{if(!task.running)this.cancelQueued(task,'cancelled')}
      signal.addEventListener('abort',task.abort,{once:true})
      task.timer=setTimeout(()=>this.cancelQueued(task,'queue-timeout'),this.config.queueTimeoutMs)
      if(signal.aborted)this.cancelQueued(task,'cancelled');else{this.schedule(lane);this.pump()}
      this.notify()
    })
  }
  private makeTask(input:InboundMessage,id:RequestId,mode:ChatMode,port:DeliveryPort,signal:AbortSignal,lane:MappingId,resolve:(result:ChatResult)=>void):Task{return{id,lane,input,mode,port,signal,resolve,running:false,settled:false,timer:null,abort:null,mapping:null}}
  private schedule(key:MappingId):void{const lane=this.lanes.get(key);if(lane&&!lane.running&&lane.tasks.length&&!this.readySet.has(key)){this.ready.push(key);this.readySet.add(key)}}
  private clear(task:Task):void{if(task.timer!==null)clearTimeout(task.timer);if(task.abort)task.signal.removeEventListener('abort',task.abort);task.timer=null;task.abort=null}
  private removeEmpty(key:MappingId):void{
    const lane=this.lanes.get(key)
    if(lane&&!lane.running&&!lane.tasks.length){this.lanes.delete(key);this.readySet.delete(key);for(let index=this.ready.length-1;index>=0;index--)if(this.ready[index]===key)this.ready.splice(index,1)}
  }
  private cancelQueued(task:Task,reason:'cancelled'|'queue-timeout'):void{
    if(task.running||task.settled)return
    const lane=this.lanes.get(task.lane),index=lane?.tasks.indexOf(task)??-1
    if(!lane||index<0)return
    lane.tasks.splice(index,1);this.queued--;task.settled=true;this.clear(task);this.removeEmpty(task.lane)
    const action=(async()=>{
      let result=this.base(task.id,reason==='cancelled'?'cancelled':'failed',reason)
      if(reason==='queue-timeout'&&!task.signal.aborted)result=await this.deliver(task,{...result,reply:failureText(reason,this.config.locale)})
      else await this.journal.finish(result)
      task.resolve(result)
    })().catch(error=>{this.lastFailure=error instanceof StoreError?'storage/'+error.code:'runtime/failure';task.resolve(this.base(task.id,'failed','storage-unavailable'))})
    this.finalizing.add(action);void action.then(()=>{this.finalizing.delete(action);this.notify()});this.pump();this.notify()
  }
  private pump():void{
    while(!this.lifetime.signal.aborted&&this.active<this.config.maxConcurrent&&this.ready.length){
      const key=this.ready.shift();if(key===undefined)break;this.readySet.delete(key)
      const lane=this.lanes.get(key);if(!lane||lane.running)continue
      const task=lane.tasks.shift();if(!task)continue
      lane.running=true;task.running=true;this.queued--;this.active++;this.clear(task)
      const operation=this.run(task).then(result=>{task.settled=true;task.resolve(result)},error=>{this.lastFailure=error instanceof StoreError?'storage/'+error.code:'runtime/failure';task.settled=true;task.resolve(this.base(task.id,task.signal.aborted?'cancelled':'failed',task.signal.aborted?'cancelled':'storage-unavailable'))}).finally(()=>{
        lane.running=false;this.active--;this.running.delete(operation);this.removeEmpty(key);this.schedule(key);this.pump();this.notify()
      })
      this.running.add(operation)
    }
  }
  private async run(task:Task):Promise<ChatResult>{
    if(task.signal.aborted){const result=this.base(task.id,'cancelled','cancelled');await this.journal.finish(result);return result}
    let result=this.base(task.id,task.mode==='preview'?'previewed':'responded',null)
    const timeout=AbortSignal.timeout(this.config.modelTimeoutMs),signal=AbortSignal.any([task.signal,timeout])
    try{
      const map=await this.loadMapping(task.input,task.mode);task.mapping=map
      await this.journal.saveMapping({...map,lastDelivery:'pending'})
      await this.journal.start(task.id,map.sessionId)
      result={...result,sessionId:map.sessionId}
      const size=task.input.parts.reduce((size,part)=>size+(part.type==='text'?part.text.length:part.type==='card'?part.content.length:0),0)
      if(size>this.config.maxInputChars)throw new ModelProblem('input-too-long','not-started')
      const interval=await this.model.run(map,task.input,task.id,signal)
      if(interval.sessionId!==map.sessionId)throw new ModelProblem('external-input','failed')
      result={...result,fromOffset:interval.fromOffset,toOffset:interval.toOffset,modelOutcome:'completed'}
      if(interval.externalInput)throw new ModelProblem('external-input','failed')
      if(!interval.admitted||!interval.completed)throw new ModelProblem('model-failed','failed')
      if(!interval.text.trim())throw new ModelProblem('empty-output','failed')
      if(interval.text.length>this.config.maxReplyChars)throw new ModelProblem('reply-too-long','completed')
      if(sensitiveOutput(interval.text))throw new ModelProblem('sensitive-output','completed')
      result={...result,reply:interval.text}
    }catch(error){
      if(error instanceof StoreError)throw error
      const reason=task.signal.aborted?'cancelled':timeout.aborted?'model-timeout':error instanceof ModelProblem?error.reason:'model-failed'
      result={...result,status:task.signal.aborted?'cancelled':'failed',reason,modelOutcome:task.signal.aborted?'cancelled':error instanceof ModelProblem?error.outcome:'failed',modelReason:reason,reply:task.signal.aborted?null:failureText(reason,this.config.locale)}
      if(reason!=='cancelled')this.lastFailure=reason
    }
    if(task.signal.aborted){result={...result,status:'cancelled',reason:'cancelled',reply:null};await this.journal.finish(result);return result}
    return this.deliver(task,result)
  }
  private async deliver(task:Task,base:ChatResult):Promise<ChatResult>{
    if(task.signal.aborted){const result={...base,status:'cancelled' as const,reason:'cancelled' as const,reply:null};await this.journal.finish(result);return result}
    const text=base.reply
    if(text===null){await this.journal.finish(base);return base}
    const parts:OutboundMessage['parts']=task.input.scope.kind==='private'||this.config.replyMode==='plain'?[{type:'text',text}]:this.config.replyMode==='quote'?[{type:'reply',messageId:task.input.messageId},{type:'text',text}]:[{type:'mention',userId:task.input.senderId},{type:'text',text}]
    const outbound:OutboundMessage={scope:task.input.scope,operationId:identifier('im.operation','chat-'+task.id),parts}
    await this.journal.prepareSend({...base,status:'uncertain',reason:'delivery-uncertain',receipt:null})
    if(task.signal.aborted){const result={...base,status:'cancelled' as const,reason:'cancelled' as const,reply:null};await this.journal.finish(result);return result}
    let receipt:DeliveryReceipt
    try{receipt=await task.port.send(outbound,AbortSignal.any([task.signal,AbortSignal.timeout(this.config.sendTimeoutMs)]))}
    catch(error){receipt={status:'uncertain',code:'provider-error'}}
    const result:ChatResult=receipt.status==='accepted'?{...base,receipt}:receipt.status==='uncertain'?{...base,status:'uncertain',reason:'delivery-uncertain',receipt}:{...base,status:receipt.code==='cancelled'?'cancelled':'failed',reason:receipt.code==='cancelled'?'cancelled':receipt.code==='muted'?'muted':receipt.code==='offline'?'offline':'delivery-rejected',receipt}
    await this.journal.finish(result)
    if(task.mapping){
      const accepted=receipt.status==='accepted'
      try{await this.journal.saveMapping({...task.mapping,lastDelivery:base.modelOutcome!=='completed'?'failed':receipt.status==='accepted'?'accepted':receipt.status==='uncertain'?'uncertain':'failed',lastReplyAt:accepted?Date.now():task.mapping.lastReplyAt,lastSenderId:accepted?task.input.senderId:task.mapping.lastSenderId})}
      catch(error){this.lastFailure=error instanceof StoreError?'storage/'+error.code:'storage/unavailable'}
    }
    return result
  }
  /** Reject new sources, cancel queued/running work, and join every owned resource. */
  close():Promise<void>{
    if(this.stopping)return this.stopping
    this.lifetime.abort();this.notify()
    this.stopping=(async()=>{
      await Promise.allSettled([...this.claims.values()].map(entry=>entry.result))
      await Promise.allSettled([...this.running,...this.finalizing])
      const errors:unknown[]=[]
      try{await this.model.dispose()}catch(error){errors.push(error)}
      try{await this.journal.close()}catch(error){errors.push(error)}
      if(errors.length)throw new AggregateError(errors,'Chat cleanup failed')
    })()
    return this.stopping
  }
}
class ModelProblem extends Error{constructor(readonly reason:Reason,readonly outcome:ChatResult['modelOutcome']){super(reason)}}
