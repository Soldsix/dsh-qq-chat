/** Strict native Client JSON codecs; Host authorization remains separate. */
import * as z from 'zod/mini'
import {brandString} from '@deepseek-ai/dsh-brand'
import {CONFIG_FIELDS,type Config,type ConfigKey} from './config-fields.ts'
import {CHAT_STATUSES,MODEL_OUTCOMES,REASONS} from './outcomes.ts'
import type {ControlSnapshot,SaveRequest,RestartRequest,PreviewRequest,PreviewResponse,CancelPreviewRequest,CancelPreviewResponse,PreviewId} from './control-types.ts'

const integer=z.int(),counter=z.int().check(z.nonnegative())
const revision=z.string().check(z.regex(/^[a-f0-9]{64}$/))
const previewId=z.pipe(z.string().check(z.regex(/^\w[\w-]{15,79}$/)),z.transform(value=>brandString<PreviewId>(value)))
const nullableText=z.nullable(z.string()),reason=z.nullable(z.enum(REASONS))
const config=z.strictObject({
  enabled:z.boolean(),namespace:z.string(),databasePath:z.string(),workspacePath:z.string(),presetId:z.string(),provider:z.string(),model:z.string(),reasoningEffort:z.string(),
  maxTokens:integer,allowedTools:z.array(z.string()),isolateGroupSenders:z.boolean(),trigger:z.enum(['directed','followup']),followupWindowMs:integer,replyMode:z.enum(['quote','mention','plain']),locale:z.enum(['zh','en']),
  maxConcurrent:integer,maxPending:integer,maxPendingPerScope:integer,maxLiveSessions:integer,sessionIdleMs:integer,maxSourceAgeMs:integer,maxInputChars:integer,maxReplyChars:integer,
  queueTimeoutMs:integer,modelTimeoutMs:integer,sendTimeoutMs:integer,storageTimeoutMs:integer,storageBusyMs:integer,storageStartupMs:integer,shutdownTimeoutMs:integer,
} satisfies {[Key in keyof Config]:z.ZodMiniType<Config[Key]>})

/** Only declared partial fields can cross the native save endpoint. */
export const saveSchema:z.ZodMiniType<SaveRequest>=z.strictObject({revision,patch:z.pipe(z.partial(config),z.transform(value=>Object.fromEntries(Object.entries(value).filter(([,item])=>item!==undefined)) as Partial<Config>))})
/** Restart never accepts changed settings. */
export const restartSchema:z.ZodMiniType<RestartRequest>=z.strictObject({revision})
/** Preview cannot choose a live destination or enable tools. */
export const previewSchema:z.ZodMiniType<PreviewRequest>=z.strictObject({revision,previewId,text:z.string().check(z.minLength(1),z.maxLength(1048576))})
/** Explicit cancellation selects only a named preview. */
export const cancelPreviewSchema:z.ZodMiniType<CancelPreviewRequest>=z.strictObject({previewId})
/** Whether one currently active preview received cancellation. */
export const cancelResponseSchema:z.ZodMiniType<CancelPreviewResponse>=z.strictObject({requested:z.boolean()})
/** Public captured text and orthogonal outcomes; no thought, native exception or Session body. */
export const previewResponseSchema:z.ZodMiniType<PreviewResponse>=z.strictObject({previewId,status:z.enum(CHAT_STATUSES),reason,modelOutcome:z.enum(MODEL_OUTCOMES),modelReason:reason,output:z.array(z.string())})
/** Metadata and settings are validated before entering browser state. */
export const snapshotSchema:z.ZodMiniType<ControlSnapshot>=z.strictObject({
  config,revision,appliedRevision:z.nullable(revision),entryActive:z.boolean(),entryDisabled:z.boolean(),overriddenFields:z.array(z.enum(Object.keys(CONFIG_FIELDS) as [ConfigKey,...ConfigKey[]])),refreshMs:z.int().check(z.minimum(250),z.maximum(60000)),
  services:z.strictObject({agents:z.boolean(),presets:z.boolean(),persistence:z.boolean(),tools:z.boolean()}),
  runtime:z.nullable(z.strictObject({transportAttached:z.boolean(),runtime:z.strictObject({queued:counter,running:counter,checking:counter,stopping:z.boolean(),lastFailure:nullableText}),model:z.strictObject({sessions:counter,lastFailure:nullableText})})),
  counts:z.nullable(z.strictObject({receipts:counter,queued:counter,running:counter,interrupted:counter,responded:counter,uncertain:counter,mappings:counter})),
})
