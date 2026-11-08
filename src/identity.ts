/** Deterministic request and mapping identities without interpreting content as authority. */
import {createHash} from 'node:crypto'
import {brandString} from '@deepseek-ai/dsh-brand'
import {scopeKey,messageKey,type MessagePart,type InboundMessage,type ConversationScope,type UserId} from 'dsh-im-kit'
import type {SessionId} from '@deepseek-ai/dsh-session'
import type {ChatMode,RequestId,MappingId} from './types.ts'

function hash(value:unknown):string{return createHash('sha256').update(JSON.stringify(value)).digest('hex')}
function part(value:MessagePart):readonly unknown[]{
  switch(value.type){
    case'text':return[value.type,value.text]
    case'mention':return[value.type,value.userId]
    case'reply':return[value.type,value.messageId]
    case'image':case'audio':case'video':return[value.type,value.attachmentId]
    case'file':return[value.type,value.attachmentId,value.name]
    case'forward':return[value.type,value.resourceId]
    case'card':return[value.type,value.format,value.content]
    case'unsupported':return[value.type,value.segmentType]
    default:{const unreachable:never=value;throw new Error('Unknown message part: '+String(unreachable))}
  }
}
/**
 * Derive a deduplication identity without inspecting source content.
 * @param message - trusted conversation and source identity.
 * @param mode - separate live and preview traffic.
 * @returns deterministic request identity.
 */
export function requestId(message:InboundMessage,mode:ChatMode):RequestId{return brandString<RequestId>(hash([mode,messageKey(message.scope,message.messageId)]))}
/**
 * Compare original content while excluding replay-time receivedAt observations.
 * @param message - normalized source and its original timestamp.
 * @returns digest for detecting content changes under a source identity.
 */
export function fingerprint(message:InboundMessage):string{return hash([scopeKey(message.scope),message.messageId,message.senderId,message.sentAt,message.directedToBot,message.parts.map(part)])}
/**
 * Separate presets, accounts, privacy scopes and local previews.
 * @param namespace - validated deployment data namespace.
 * @param scope - authenticated conversation identity.
 * @param mode - live or preview mapping.
 * @param presetId - native resolved preset identity.
 * @param senderId - authenticated sender when the group uses per-sender sessions.
 * @returns exact conversation/preset mapping identity.
 */
export function mappingId(namespace:string,scope:ConversationScope,mode:ChatMode,presetId:string,senderId?:UserId):MappingId{return brandString<MappingId>(hash(senderId===undefined?[namespace,mode,scopeKey(scope),presetId]:[namespace,mode,scopeKey(scope),presetId,'sender',senderId]))}
/**
 * Derive a Session identity reusable after unloading the chat plugin.
 * @param mapping - exact conversation/preset identity.
 * @returns stable native DSH Session identity.
 */
export function sessionId(mapping:MappingId):SessionId{return brandString<SessionId>('im-chat-'+mapping)}
