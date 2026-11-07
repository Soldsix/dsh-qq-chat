/** Awaited worker ownership and bounded RPC around the durable SQLite journal. */
import {Worker} from 'node:worker_threads'
import {randomUUID} from 'node:crypto'
import {z} from 'zod'
import {replySchema,StoreError,type StoreRequest} from './store-protocol.ts'
import {receiptSchema,mappingSchema,statsSchema,receiptMetaSchema} from './record-schemas.ts'
import type {ChatJournal,RequestId,MappingId,ReceiptRecord,MappingRecord,ChatResult,JournalStats} from './types.ts'
import type {SessionId} from '@deepseek-ai/dsh-session'

/** Per-instance filesystem and worker waiting limits. */
export interface JournalOptions{readonly databasePath:string;readonly busyMs:number;readonly timeoutMs:number;readonly startupMs:number;readonly shutdownMs:number}
interface Pending{resolve:(value:unknown)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}
function decode<Value>(schema:{parse(value:unknown):Value},value:unknown):Value{try{return schema.parse(value)}catch(error){throw new StoreError('invalid-reply')}}

/** Durable source receipts are stored without blocking the Host event loop. */
export class SqliteJournal implements ChatJournal{
  private readonly worker:Worker
  private readonly pending=new Map<number,Pending>()
  private serial=0
  private stopping:Promise<void>|undefined
  private fault:StoreError|undefined
  private exited=false
  private readonly done:Promise<number>
  private readonly ready:Promise<void>
  private constructor(private readonly options:JournalOptions){
    this.worker=new Worker(new URL('./store-worker.js',import.meta.url),{workerData:{protocol:1,databasePath:options.databasePath,busyMs:options.busyMs,runId:randomUUID()}})
    this.done=new Promise(resolve=>this.worker.once('exit',code=>{this.exited=true;this.fail(new StoreError('worker-exited'));resolve(code)}))
    this.ready=new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{this.fail(new StoreError('timeout'));reject(this.fault)},options.startupMs)
      const startupFailure=(error:Error)=>{clearTimeout(timer);reject(error)}
      this.worker.once('error',()=>startupFailure(new StoreError('startup-failed')))
      void this.done.then(()=>startupFailure(new StoreError('worker-exited')))
      this.worker.on('message',(input:unknown)=>{
        const decoded=replySchema.safeParse(input)
        if(!decoded.success){const error=new StoreError('invalid-reply');this.fail(error);startupFailure(error);return}
        const reply=decoded.data
        if(reply.type==='ready'){clearTimeout(timer);resolve();return}
        if(reply.type==='startup-error'){const error=new StoreError(reply.code);this.fail(error);startupFailure(error);return}
        if(reply.type==='fatal'){const error=new StoreError(reply.code);this.fail(error);startupFailure(error);return}
        const pending=this.pending.get(reply.id)
        if(!pending)return
        this.pending.delete(reply.id);clearTimeout(pending.timer)
        if(reply.type==='failure')pending.reject(new StoreError(reply.code));else pending.resolve(reply.value)
      })
    })
    this.worker.on('error',()=>this.fail(new StoreError('worker-exited')))
  }
  /** Open and verify the worker's database readiness, not just its online event. */
  static async open(options:JournalOptions):Promise<SqliteJournal>{
    const journal=new SqliteJournal(options)
    try{await journal.ready;return journal}catch(error){await journal.close();throw error}
  }
  private fail(error:StoreError):void{
    this.fault??=error
    for(const pending of this.pending.values()){clearTimeout(pending.timer);pending.reject(this.fault)}
    this.pending.clear()
  }
  private request(request:StoreRequest):Promise<unknown>{
    if(this.fault)return Promise.reject(this.fault)
    if(this.stopping&&request.method!=='close')return Promise.reject(new StoreError('closed'))
    const id=++this.serial
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{this.pending.delete(id);reject(new StoreError('timeout'))},this.options.timeoutMs)
      this.pending.set(id,{resolve,reject,timer})
      try{this.worker.postMessage({...request,id})}catch(error){this.pending.delete(id);clearTimeout(timer);reject(new StoreError('unavailable'))}
    })
  }
  /** Atomically admit a source once; changed content under the same identity is a conflict. */
  async claim(record:ReceiptRecord):Promise<'created'|'duplicate'|'conflict'>{return decode(z.enum(['created','duplicate','conflict']),await this.request({method:'claim',record}))}
  /** Read only the named receipt, preserving all original source fields. */
  async receipt(requestId:RequestId):Promise<ReceiptRecord|undefined>{const value=await this.request({method:'receipt',key:requestId});return value===null?undefined:decode(receiptSchema,value)}
  /** Record running state before handing input to the model. */
  async start(requestId:RequestId,sessionId:SessionId):Promise<void>{await this.request({method:'start',key:requestId,sessionId})}
  /** Persist the complete public output and uncertain delivery intent before dispatch. */
  async prepareSend(result:ChatResult):Promise<void>{await this.request({method:'prepare-send',result})}
  /** Persist one terminal outcome without resending or regenerating. */
  async finish(result:ChatResult):Promise<void>{await this.request({method:'finish',result})}
  /** Read one exact preset and scope mapping. */
  async mapping(mappingId:MappingId):Promise<MappingRecord|undefined>{const value=await this.request({method:'mapping',key:mappingId});return value===null?undefined:decode(mappingSchema,value)}
  /** Save metadata without rewriting the DSH Session or its messages. */
  async saveMapping(record:MappingRecord):Promise<void>{await this.request({method:'save-mapping',record})}
  /** Aggregate metadata inside SQLite instead of loading all source messages. */
  async stats():Promise<JournalStats>{return decode(statsSchema,await this.request({method:'stats'}))}
  /**
   * Page owner diagnostics without retrieving any stored message body.
   * @param limit - bounded page size validated by the worker protocol.
   * @param offset - nonnegative starting position.
   * @returns request identities, times and outcomes without input or reply bodies.
   */
  async list(limit:number,offset:number):Promise<z.infer<typeof receiptMetaSchema>[]>{return decode(z.array(receiptMetaSchema),await this.request({method:'list',limit,offset}))}
  /** Stop new RPCs, drain SQLite's ordered port and await worker termination. */
  close():Promise<void>{
    if(this.stopping)return this.stopping
    this.stopping=(async()=>{
      if(this.exited)return
      const deadline=setTimeout(()=>{void this.worker.terminate()},this.options.shutdownMs)
      try{if(!this.fault)await this.request({method:'close'});else await this.worker.terminate();await this.done}
      finally{clearTimeout(deadline);this.fail(new StoreError('closed'));if(!this.exited){await this.worker.terminate();await this.done}}
    })()
    return this.stopping
  }
}
