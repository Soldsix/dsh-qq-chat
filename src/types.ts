/** Branded chat requests, persistent receipts and replaceable execution interfaces. */
import type {Branded} from '@deepseek-ai/dsh-brand'
import type {SessionId} from '@deepseek-ai/dsh-session'
import type {InboundMessage,ConversationScope,ScopeKey,Availability,OutboundMessage,DeliveryReceipt,UserId} from 'dsh-im-kit'
import type {ChatStatus,ModelOutcome,Reason} from './outcomes.ts'
import type {JournalStats} from './runtime-status.ts'
export type {Reason} from './outcomes.ts'
export type {JournalStats} from './runtime-status.ts'

/** One source message identity across live and preview traffic. */
export type RequestId=Branded<'qq-chat.request'>
/** One exact preset and conversation mapping. */
export type MappingId=Branded<'qq-chat.mapping'>
/** Whether delivery reaches a transport or stays inside the local preview. */
export type ChatMode='live'|'preview'
/** Optional live routing provider; default leaves the built-in trigger unchanged. */
export interface ChatTurnPolicy{
  /** @param input - fresh, durably admitted group source. @returns block only for an operator-configured sender guard; ordinary explicit mentions must remain allowed. Runs once before intent classification, including explicit mentions. */
  guard?(input:InboundMessage):'allow'|'block'
  /** @param input - original group source before routing; implementations must bound any retained context. */
  seen?(input:InboundMessage):void
  /** @param input - original source event. @param signal - routing deadline and delivery lifetime; stop owned work when aborted. @returns explicit decision or delegation to the built-in trigger. */
  decide(input:InboundMessage,signal:AbortSignal):Promise<'reply'|'ignore'|'default'>
  /** @param input - original source event. @param result - chat outcome; accepted replies may be observed before durable finalization. */
  observe(input:InboundMessage,result:ChatResult):void
}
/** Logical outcome, independently carrying the transport receipt when one exists. */
export interface ChatResult{
  readonly requestId:RequestId
  readonly status:ChatStatus
  readonly reason:Reason|null
  readonly modelOutcome:ModelOutcome
  readonly modelReason:Reason|null
  readonly sessionId:SessionId|null
  readonly receipt:DeliveryReceipt|null
  readonly reply:string|null
  readonly fromOffset:number|null
  readonly toOffset:number|null
}
/** Original admitted source remains in the journal even if generation fails. */
export interface ReceiptRecord{
  readonly requestId:RequestId
  readonly scopeKey:ScopeKey
  readonly fingerprint:string
  readonly mode:ChatMode
  readonly phase:'queued'|'running'|'sending'|'settled'|'interrupted'
  readonly input:InboundMessage
  readonly updatedAt:number
  readonly sessionId:SessionId|null
  readonly result:ChatResult|null
}
/** Scope mapping contains no message body or preset text. */
export interface MappingRecord{
  readonly mappingId:MappingId
  readonly scopeKey:ScopeKey
  readonly mode:ChatMode
  readonly presetId:string
  readonly sessionId:SessionId
  readonly lastSenderId:UserId|null
  readonly lastReplyAt:number
  readonly lastDelivery:'pending'|'accepted'|'failed'|'uncertain'|null
  readonly createdAt:number
}
/** Persistence admits a source once and never retries a send. */
export interface ChatJournal{
  /**
   * Atomically retain an admitted source without replacing existing content.
   * @param record - complete normalized source and initial request metadata.
   * @returns created, identical duplicate, or conflicting source identity.
   */
  claim(record:ReceiptRecord):Promise<'created'|'duplicate'|'conflict'>
  /**
   * @param requestId - exact scoped request identity.
   * @returns retained source/result, or undefined if it was never admitted.
   */
  receipt(requestId:RequestId):Promise<ReceiptRecord|undefined>
  /**
   * Persist running state before handing input to the model.
   * @param requestId - admitted request identity.
   * @param sessionId - native Session selected for this request.
   */
  start(requestId:RequestId,sessionId:SessionId):Promise<void>
  /**
   * Persist public output and uncertain intent before dispatch.
   * @param result - complete output and interval metadata for one sending attempt.
   */
  prepareSend(result:ChatResult):Promise<void>
  /**
   * Record a terminal outcome without resending or regenerating.
   * @param result - independent model and delivery outcomes.
   */
  finish(result:ChatResult):Promise<void>
  /**
   * @param mappingId - exact scope, preset and mode identity.
   * @returns retained mapping metadata, or undefined if it does not exist.
   */
  mapping(mappingId:MappingId):Promise<MappingRecord|undefined>
  /**
   * Save routing metadata without rewriting native Session messages.
   * @param record - validated scope/preset mapping and previous delivery state.
   */
  saveMapping(record:MappingRecord):Promise<void>
  /** @returns aggregate counts without loading stored source bodies. */
  stats():Promise<JournalStats>
  /** @returns shared completion after storage work and owned worker termination are joined. */
  close():Promise<void>
}
/** One complete, explicitly owned agent interval; not a per-followup completion promise. */
export interface ModelInterval{
  readonly text:string
  readonly sessionId:SessionId
  readonly fromOffset:number
  readonly toOffset:number
  readonly admitted:boolean
  readonly externalInput:boolean
  readonly completed:boolean
}
/** Agent reuse and transcript collection are supplied by the DSH adapter. */
export interface ChatModelRunner{
  /** @returns native resolved preset identity; unavailable presets reject. */
  resolvePreset():Promise<string>
  /**
   * Execute one exclusively owned whole-agent interval and flush its Session.
   * @param mapping - exact native Session and preset mapping.
   * @param message - admitted trusted source.
   * @param requestId - durable identity carried in the logged user message.
   * @param signal - cancellation whose computation must settle before return.
   * @returns final public text and completion/admission metadata, never hidden reasoning.
   */
  run(mapping:MappingRecord,message:InboundMessage,requestId:RequestId,signal:AbortSignal):Promise<ModelInterval>
  /** @returns completion after every cached Agent and eviction is disposed. */
  dispose():Promise<void>
}
/** Final transport replacement used by the same live and local-preview orchestration. */
export interface DeliveryPort{
  /**
   * Check availability before expensive work and again before sending.
   * @param scope - authenticated destination, never selected by member content.
   * @param signal - bounded cancellation the provider must observe.
   * @returns current availability without sending a probe.
   */
  availability(scope:ConversationScope,signal:AbortSignal):Promise<Availability>
  /**
   * Dispatch one final attempt without internal retries.
   * @param message - destination, durable operation identity and complete output parts.
   * @param signal - bounded cancellation; abort after dispatch may remain uncertain.
   * @returns server acceptance, definite failure or uncertainty; acceptance is not phone verification.
   */
  send(message:OutboundMessage,signal:AbortSignal):Promise<DeliveryReceipt>
}
