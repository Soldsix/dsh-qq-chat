/** Owner-only native settings and local text preview, independent of runtime reloads. */
import type {Context} from '@deepseek-ai/cordis'
import type {Entry} from '@deepseek-ai/cordis-plugin-loader'
import z from '@deepseek-ai/schemastery'
import {brandString} from '@deepseek-ai/dsh-brand'
import {Remote,RemoteError,TypertRemoteService,principalOf} from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-config-editor'
import type {} from './index.ts'
import {Config as RuntimeConfig,ConfigIssue,validateConfig} from './config.ts'
import {CONFIG_FIELDS,isConfigKey,type Config as Settings,type ConfigKey} from './config-fields.ts'
import {configRevision} from './config-revision.ts'
import {isRecord} from './wire.ts'
import type {ControlFailure,ControlSnapshot,SaveRequest,PreviewRequest,PreviewResponse,PreviewId,CancelPreviewResponse} from './control-types.ts'

/** This controller can edit exactly one named runtime row. */
export interface ControlConfig{readonly targetEntryId:string;readonly statusRefreshMs:number}
/** Native control remains mounted while the chat runtime is disabled or restarted. */
export const Config:z<ControlConfig>=z.object({targetEntryId:z.string().default('qq-chat-runtime'),statusRefreshMs:z.number().min(250).max(60000).step(1).default(3000)})

declare module '@deepseek-ai/cordis'{interface Context{readonly qqChatControl:ChatControl}}

function failure(reason:ControlFailure,field?:ConfigKey):RemoteError<'qq-chat/control'>{return new RemoteError('qq-chat/control','Chat control operation could not complete',{reason,...field===undefined?{}:{field}})}
function parseSettings(value:unknown):Settings{
  try{
    if(!isRecord(value)||Object.keys(value).some(key=>!isConfigKey(key)))throw failure('config-invalid')
    const parsed:Settings=z.resolve(value,RuntimeConfig,{})[0]
    validateConfig(parsed);return parsed
  }catch(error){throw failure('config-invalid',error instanceof ConfigIssue?error.field:undefined)}
}
function revisionFrom(value:unknown):string{
  if(!isRecord(value)||typeof value['revision']!=='string'||!/^[a-f0-9]{64}$/.test(value['revision']))throw failure('request-invalid')
  return value['revision']
}
function saveFrom(value:unknown):SaveRequest{
  const revision=revisionFrom(value)
  if(!isRecord(value)||Object.keys(value).some(key=>key!=='revision'&&key!=='patch')||!isRecord(value['patch']))throw failure('request-invalid')
  const patch=value['patch']
  for(const [key,item]of Object.entries(patch)){
    if(!isConfigKey(key))throw failure('request-invalid')
    const kind=CONFIG_FIELDS[key]
    if(kind==='boolean'?typeof item!=='boolean':kind==='number'?!Number.isSafeInteger(item):kind==='list'?!Array.isArray(item)||!item.every(entry=>typeof entry==='string'):typeof item!=='string')throw failure('config-invalid',key)
  }
  return{revision,patch:patch as Partial<Settings>}
}
function previewIdFrom(value:unknown):PreviewId{
  if(!isRecord(value)||typeof value['previewId']!=='string'||!/^\w[\w-]{15,79}$/.test(value['previewId']))throw failure('request-invalid')
  return brandString<PreviewId>(value['previewId'])
}
function previewFrom(value:unknown):PreviewRequest{
  const revision=revisionFrom(value),previewId=previewIdFrom(value)
  if(!isRecord(value)||Object.keys(value).some(key=>!['revision','previewId','text'].includes(key))||typeof value['text']!=='string'||!value['text'].trim())throw failure('request-invalid')
  return{revision,previewId,text:value['text']}
}

/** Parsed settings and preview use the same services as live chat. */
export class ChatControl extends TypertRemoteService{
  static inject=['configEditor']
  static Config=Config
  private readonly lifetime=new AbortController()
  private tail:Promise<void>=Promise.resolve()
  private readonly previews=new Map<PreviewId,{readonly controller:AbortController;readonly done:Promise<PreviewResponse>}>()
  constructor(ctx:Context,private readonly config:ControlConfig){
    super(ctx,'qqChatControl')
    if(!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(config.targetEntryId))throw new Error('targetEntryId must name a profile row')
    ctx.effect(()=>async()=>{
      this.lifetime.abort()
      const work=[...this.previews.values()].map(value=>value.done)
      await Promise.allSettled([this.tail,...work])
    })
  }
  private owner():void{
    if(principalOf(this.ctx.invocation))throw failure('forbidden')
    if(this.lifetime.signal.aborted||this.ctx.invocation?.signal.aborted)throw failure('cancelled')
  }
  private target():Entry{
    const entries=this.ctx.configEditor.entries(),entry=entries.find(value=>value.options.id===this.config.targetEntryId)
    if(!entry||entry.options.name!=='dsh-qq-chat'||!entry.fiber||entries.some(value=>value!==entry&&value.options.name==='dsh-qq-chat'))throw failure('entry-unavailable')
    return entry
  }
  private settings(entry:Entry):Settings{return parseSettings(entry.fiber?.effectiveConfig)}
  private async snapshot():Promise<ControlSnapshot>{
    const entry=this.target(),config=this.settings(entry),runtime=this.ctx.get('qqChat')
    const layers=this.ctx.configEditor.configuration().find(value=>value.entry===entry)
    return{
      config:structuredClone(config),revision:configRevision(config),appliedRevision:runtime?.configRevision??null,
      entryActive:entry.fiber?.state===2,entryDisabled:entry.disabled,
      overriddenFields:Object.keys(layers?.override??{}).filter(isConfigKey),refreshMs:this.config.statusRefreshMs,
      services:{agents:Boolean(this.ctx.get('agents')),presets:Boolean(this.ctx.get('agentPresets')),persistence:Boolean(this.ctx.get('sessionPersistence')),tools:Boolean(this.ctx.get('tools'))},
      runtime:runtime?.status()??null,counts:runtime?await runtime.historyCounts():null,
    }
  }
  private serial<T>(operation:()=>Promise<T>):Promise<T>{
    this.owner()
    const task=this.tail.then(()=>{if(this.lifetime.signal.aborted)throw failure('cancelled');return operation()})
    this.tail=task.then(()=>{},()=>{});return task
  }
  /**
   * Read configuration and metadata without live messages or preset documents.
   * @returns detached operator settings, runtime counters and required-service availability.
   */
  @Remote
  describe():Promise<ControlSnapshot>{return this.serial(()=>this.snapshot())}
  /**
   * Persist only declared settings through the normal profile editor.
   * @param request - expected revision and changed fields.
   * @returns current settings and independently observed runtime state.
   */
  @Remote
  save(request:unknown):Promise<ControlSnapshot>{
    this.owner();const edit=saveFrom(request)
    return this.serial(async()=>{
      const entry=this.target(),current=this.settings(entry)
      if(configRevision(current)!==edit.revision)throw failure('revision-conflict')
      parseSettings({...current,...edit.patch})
      try{
        await this.ctx.configEditor.edit(entry,raw=>{
          if(configRevision(this.settings(entry))!==edit.revision)throw failure('revision-conflict')
          return{...raw,...edit.patch}
        })
      }catch(error){if(isRecord(error)&&error['isDSHRemoteError']===true&&error['code']==='qq-chat/control')throw error;throw failure('apply-failed')}
      return this.snapshot()
    })
  }
  /**
   * Restart the saved runtime without deleting sources or Session mappings.
   * @param request - expected revision; unsaved settings are rejected.
   * @returns metadata after the awaited normal Cordis restart.
   */
  @Remote
  restart(request:unknown):Promise<ControlSnapshot>{
    this.owner();const revision=revisionFrom(request)
    if(!isRecord(request)||Object.keys(request).some(key=>key!=='revision'))throw failure('request-invalid')
    return this.serial(async()=>{
      const entry=this.target(),config=this.settings(entry)
      if(configRevision(config)!==revision)throw failure('revision-conflict')
      if(!config.enabled||entry.disabled)throw failure('runtime-unavailable')
      try{await entry.fiber?.restart()}catch(error){throw failure('apply-failed')}
      return this.snapshot()
    })
  }
  /**
   * Run saved settings with no executable tools and no live messaging transport.
   * @param request - owner text, saved revision and unique preview identity.
   * @returns actual captured public output; model failure and cancellation stay distinct.
   */
  @Remote
  preview(request:unknown):Promise<PreviewResponse>{
    this.owner();const edit=previewFrom(request),entry=this.target(),config=this.settings(entry)
    if(configRevision(config)!==edit.revision)throw failure('revision-conflict')
    if(edit.text.length>config.maxInputChars)throw failure('config-invalid','maxInputChars')
    const runtime=this.ctx.get('qqChat')
    if(!config.enabled||!runtime||runtime.configRevision!==edit.revision)throw failure('runtime-unavailable')
    if(this.previews.has(edit.previewId))throw failure('preview-active')
    const controller=new AbortController(),signals=[this.lifetime.signal,controller.signal]
    if(this.ctx.invocation)signals.push(this.ctx.invocation.signal)
    const operation=Promise.resolve().then(async()=>{
      try{
        const {result,outbound}=await runtime.preview(edit.text,AbortSignal.any(signals),edit.previewId)
        return{previewId:edit.previewId,status:result.status,reason:result.reason,modelOutcome:result.modelOutcome,modelReason:result.modelReason,output:outbound.map(message=>message.parts.filter(part=>part.type==='text').map(part=>part.text).join(''))}
      }catch(error){throw failure('preview-failed')}
    })
    this.previews.set(edit.previewId,{controller,done:operation})
    void operation.then(()=>this.previews.delete(edit.previewId),()=>this.previews.delete(edit.previewId))
    return operation
  }
  /**
   * Abort one local preview without cancelling other previews or live chat.
   * @param request - identity of the preview to stop.
   * @returns whether an active preview received the abort request.
   */
  @Remote
  cancelPreview(request:unknown):CancelPreviewResponse{
    this.owner();const id=previewIdFrom(request)
    if(!isRecord(request)||Object.keys(request).some(key=>key!=='previewId'))throw failure('request-invalid')
    const operation=this.previews.get(id);operation?.controller.abort();return{requested:Boolean(operation)}
  }
}

export default ChatControl
