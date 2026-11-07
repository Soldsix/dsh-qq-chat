/** Durable journal decoding validates identities and rejects malformed retained state. */
import {z} from 'zod'
import {identifier,type InboundMessage} from 'dsh-im-kit'
import {brandString} from '@deepseek-ai/dsh-brand'
import type {SessionId} from '@deepseek-ai/dsh-session'
import type {RequestId,MappingId,ReceiptRecord,MappingRecord,ChatResult,JournalStats} from './types.ts'
import {CHAT_STATUSES,MODEL_OUTCOMES,REASONS} from './outcomes.ts'
const key=z.string().regex(/^[a-f0-9]{64}$/)
const req=key.transform(value=>brandString<RequestId>(value))
const map=key.transform(value=>brandString<MappingId>(value))
const session=z.string().regex(/^im-chat-[a-f0-9]{64}$/).transform(value=>brandString<SessionId>(value))
const scope=z.string().transform(value=>brandString<import('dsh-im-kit').ScopeKey>(value))
const timestamp=z.number().int().nonnegative()
const attachment=z.string().transform(value=>identifier('im.attachment',value))
const user=z.string().transform(value=>identifier('im.user',value))
const message=z.string().transform(value=>identifier('im.message',value))
const reason=z.enum(REASONS)
const delivery=z.discriminatedUnion('status',[
  z.strictObject({status:z.literal('accepted'),messageIds:z.array(message)}),
  z.strictObject({status:z.literal('failed'),code:z.enum(['offline','muted','disabled','cancelled','missing-transport','unavailable','rejected','permission-denied'])}),
  z.strictObject({status:z.literal('uncertain'),code:z.enum(['timeout','cancelled-after-dispatch','provider-error'])}),
])
/** Complete normalized source; attachment IDs remain references, never local filenames. */
export const inputSchema:z.ZodType<InboundMessage>=z.strictObject({
  scope:z.strictObject({account:z.strictObject({tenantId:z.string().transform(value=>identifier('im.tenant',value)),networkId:z.string().transform(value=>identifier('im.network',value)),accountId:z.string().transform(value=>identifier('im.account',value))}),kind:z.enum(['group','private']),peerId:z.string().transform(value=>identifier('im.peer',value))}),
  messageId:message,senderId:user,sentAt:timestamp,receivedAt:timestamp,directedToBot:z.boolean(),
  parts:z.array(z.discriminatedUnion('type',[
    z.strictObject({type:z.literal('text'),text:z.string()}),z.strictObject({type:z.literal('mention'),userId:user}),z.strictObject({type:z.literal('reply'),messageId:message}),
    z.strictObject({type:z.literal('image'),attachmentId:attachment}),z.strictObject({type:z.literal('audio'),attachmentId:attachment}),z.strictObject({type:z.literal('video'),attachmentId:attachment}),
    z.strictObject({type:z.literal('file'),attachmentId:attachment,name:z.string()}),z.strictObject({type:z.literal('forward'),resourceId:z.string().transform(value=>identifier('im.forward',value))}),
    z.strictObject({type:z.literal('card'),format:z.enum(['json','xml']),content:z.string()}),z.strictObject({type:z.literal('unsupported'),segmentType:z.string()}),
  ])),
})
/** Result decoding never accepts raw provider exceptions or thought streams. */
export const resultSchema:z.ZodType<ChatResult>=z.strictObject({requestId:req,status:z.enum(CHAT_STATUSES),reason:reason.nullable(),modelOutcome:z.enum(MODEL_OUTCOMES),modelReason:reason.nullable(),sessionId:session.nullable(),receipt:delivery.nullable(),reply:z.string().nullable(),fromOffset:timestamp.nullable(),toOffset:timestamp.nullable()})
/** Journal receipts preserve original source and independent model/delivery outcomes. */
export const receiptSchema:z.ZodType<ReceiptRecord>=z.strictObject({requestId:req,scopeKey:scope,fingerprint:key,mode:z.enum(['live','preview']),phase:z.enum(['queued','running','sending','settled','interrupted']),input:inputSchema,updatedAt:timestamp,sessionId:session.nullable(),result:resultSchema.nullable()})
/** Mapping metadata does not include preset bodies or chat text. */
export const mappingSchema:z.ZodType<MappingRecord>=z.strictObject({mappingId:map,scopeKey:scope,mode:z.enum(['live','preview']),presetId:z.string(),sessionId:session,lastSenderId:user.nullable(),lastReplyAt:timestamp,lastDelivery:z.enum(['pending','accepted','failed','uncertain']).nullable(),createdAt:timestamp})
/** Small SQL aggregate result. */
export const statsSchema:z.ZodType<JournalStats>=z.strictObject({receipts:timestamp,queued:timestamp,running:timestamp,interrupted:timestamp,responded:timestamp,uncertain:timestamp,mappings:timestamp})
/** JSON metadata queries carry no original message body. */
export const receiptMetaSchema=z.strictObject({requestId:req,scopeKey:scope,mode:z.enum(['live','preview']),phase:z.enum(['queued','running','sending','settled','interrupted']),updatedAt:timestamp,sessionId:session.nullable(),outcome:z.string().nullable()})
