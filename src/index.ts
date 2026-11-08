/** Independently installable chat consumer with an isolated native text-preview operation. */
import type {Context} from '@deepseek-ai/cordis'
import {mkdir} from 'node:fs/promises'
import {randomUUID} from 'node:crypto'
import {identifier,type OutboundMessage} from 'dsh-im-kit'
import type {} from 'dsh-im-kit/cordis'
import type {} from '@deepseek-ai/dsh-app-boot'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-tools'
import {Config,resolveConfig,type Config as Settings} from './config.ts'
import {SqliteJournal} from './journal.ts'
import {ChatKernel} from './kernel.ts'
import {DshModelRunner} from './dsh-runner.ts'
import {configRevision} from './config-revision.ts'
import type {ChatResult,ChatTurnPolicy} from './types.ts'
import type {PreviewId} from './control-types.ts'

export {Config,resolveConfig}
export type * from './types.ts'
/** Native plugin identity. */
export const name='qq-chat'
/** The model and durable Session remain supplied by the Host. */
export const inject=['profileContext','agents','agentPresets','sessions','sessionPersistence','tools']

/** Host-only chat operations; no model-facing management tool is registered. */
export interface ChatService{
  /** Revision of the parsed settings actually running in this instance. */
  readonly configRevision:string
  /** @returns transport attachment, queue and model-cache metadata without source bodies. */
  status():{transportAttached:boolean;runtime:ReturnType<ChatKernel['status']>;model:ReturnType<DshModelRunner['status']>}
  /** @returns aggregate durable receipt and mapping counts without source bodies. */
  historyCounts():ReturnType<SqliteJournal['stats']>
  /**
   * Capture public outbound text in an independent persistent conversation with tools disabled.
   * @param text - synthetic owner input; no live destination is accepted.
   * @param signal - cancellation of this preview only.
   * @param previewId - optional durable identity; repeated identical requests do not regenerate.
   * @returns model/delivery result and locally captured outbound messages.
   */
  preview(text:string,signal:AbortSignal,previewId?:PreviewId):Promise<{result:ChatResult;outbound:readonly OutboundMessage[]}>
}
declare module '@deepseek-ai/cordis'{interface Context{readonly qqChat:ChatService;readonly qqTurnPolicy:ChatTurnPolicy}}

/**
 * Mount chat with an optional messaging provider and independent local preview.
 * @param ctx - profile-owned native agent, persistence and tool services.
 * @param config - parsed deployment settings; disabled state opens no storage.
 * @returns completion of reversible runtime installation.
 */
export async function apply(ctx:Context,config:Settings):Promise<void>{
  const spec=resolveConfig(config,ctx.profileContext.dir)
  if(!spec)return
  const journal=await SqliteJournal.open({databasePath:spec.databasePath,busyMs:spec.storageBusyMs,timeoutMs:spec.storageTimeoutMs,startupMs:spec.storageStartupMs,shutdownMs:spec.shutdownTimeoutMs})
  ctx.effect(()=>()=>journal.close())
  await mkdir(spec.workspacePath,{recursive:true,mode:0o700})
  const runner=new DshModelRunner(ctx,spec),kernel=new ChatKernel(spec,journal,runner)
  ctx.effect(()=>()=>kernel.close())
  let transportAttached=false
  const service:ChatService={
    configRevision:configRevision(config),
    status:()=>({transportAttached,runtime:kernel.status(),model:runner.status()}),
    historyCounts:()=>journal.stats(),
    async preview(text,signal,previewId){
      const now=Date.now(),outbound:OutboundMessage[]=[]
      const source={scope:{account:{tenantId:identifier('im.tenant',spec.namespace),networkId:identifier('im.network','local-preview'),accountId:identifier('im.account','owner-preview')},kind:'private' as const,peerId:identifier('im.peer','text-preview')},messageId:identifier('im.message','preview-'+(previewId??randomUUID())),senderId:identifier('im.user','owner-preview'),sentAt:0,receivedAt:now,directedToBot:true,parts:[{type:'text' as const,text}]}
      const result=await kernel.submit(source,'preview',{async availability(){return'available'},async send(message){outbound.push(structuredClone(message));return{status:'accepted',messageIds:[]}}},signal)
      return{result,outbound}
    },
  }
  ctx.effect(()=>ctx.provide('qqChat',service))
  ctx.inject(['im'],child=>{
    transportAttached=true;child.effect(()=>()=>{transportAttached=false})
    child.effect(()=>child.im.subscribe(async(message,signal)=>{
      const provider=child.get('qqTurnPolicy');let decision:'reply'|'ignore'|'default'='default'
      if(provider&&message.scope.kind==='group'&&!message.directedToBot){try{decision=await provider.decide(message,signal)}catch(error){try{child.emit('qq-chat/diagnostic',{stage:'turn-policy',error})}catch(observerError){/* Diagnostics do not own the incoming message. */}}}
      let observed=false
      const observe=(result:ChatResult)=>{if(provider&&child.get('qqTurnPolicy')===provider){try{provider.observe(message,result);observed=true}catch(error){try{child.emit('qq-chat/diagnostic',{stage:'turn-policy-observe',error})}catch(observerError){/* Diagnostics do not own the completed result. */}}}}
      const result=await kernel.submit(message,'live',child.im,signal,decision,observe)
      if(!observed)observe(result)
    },()=>true))
  })
}
