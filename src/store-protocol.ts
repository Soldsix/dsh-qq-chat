/** Validated private worker messages; storage never accepts SQL from a caller. */
import {z} from 'zod'
import {isAbsolute} from 'node:path'
import {receiptSchema,mappingSchema,resultSchema} from './record-schemas.ts'

/** Stable journal failures without filesystem paths or stored content. */
export const storeCode=z.enum(['unavailable','timeout','invalid-reply','startup-failed','already-owned','schema-unsupported','invalid-data','closed','worker-exited','cancelled'])
/** Operational storage failure whose public text contains only its code. */
export class StoreError extends Error{constructor(readonly code:z.infer<typeof storeCode>){super('Chat journal: '+code)}}
/** Initial worker configuration, before any database is opened. */
export const workerConfig=z.strictObject({protocol:z.literal(1),databasePath:z.string().refine(isAbsolute),busyMs:z.number().int().min(0).max(10000),runId:z.string().uuid()})
const id=z.number().int().positive(),key=z.string().regex(/^[a-f0-9]{64}$/)
/** Closed database operations; all source data travels as validated parameters. */
export const commandSchema=z.discriminatedUnion('method',[
  z.strictObject({id,method:z.literal('claim'),record:receiptSchema}),
  z.strictObject({id,method:z.literal('receipt'),key}),
  z.strictObject({id,method:z.literal('start'),key,sessionId:z.string().regex(/^im-chat-[a-f0-9]{64}$/)}),
  z.strictObject({id,method:z.literal('finish'),result:resultSchema}),
  z.strictObject({id,method:z.literal('prepare-send'),result:resultSchema}),
  z.strictObject({id,method:z.literal('mapping'),key}),
  z.strictObject({id,method:z.literal('save-mapping'),record:mappingSchema}),
  z.strictObject({id,method:z.literal('stats')}),
  z.strictObject({id,method:z.literal('list'),limit:z.number().int().min(1).max(2000),offset:z.number().int().nonnegative()}),
  z.strictObject({id,method:z.literal('close')}),
])
/** Wire operation union. */
export type StoreCommand=z.infer<typeof commandSchema>
/** Caller operation before the transport assigns a correlation number. */
export type StoreRequest={ [Method in StoreCommand['method']]:Omit<Extract<StoreCommand,{method:Method}>,'id'> }[StoreCommand['method']]
/** Responses are decoded again by each result's owning caller. */
export const replySchema=z.discriminatedUnion('type',[
  z.strictObject({type:z.literal('ready'),recovered:z.number().int().nonnegative()}),
  z.strictObject({type:z.literal('startup-error'),code:storeCode}),
  z.strictObject({type:z.literal('fatal'),code:storeCode}),
  z.strictObject({type:z.literal('result'),id,ok:z.literal(true),value:z.unknown()}),
  z.strictObject({type:z.literal('failure'),id,ok:z.literal(false),code:storeCode}),
])
