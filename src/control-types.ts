/** Browser-safe owner operations; no live conversation bodies or preset documents. */
import type {Branded} from '@deepseek-ai/dsh-brand'
import type {Config,ConfigKey} from './config-fields.ts'
import type {ChatStatus,ModelOutcome,Reason} from './outcomes.ts'
import type {KernelStatus,JournalStats} from './runtime-status.ts'
import type {} from '@deepseek-ai/dsh-typert-protocol/types'

/** One owner-created local preview operation, distinct from a messaging request. */
export type PreviewId=Branded<'qq-chat.preview'>

/** Metadata-only native state; settings visibility does not imply a running model. */
export interface ControlSnapshot{
  readonly config:Config
  readonly revision:string
  readonly appliedRevision:string|null
  readonly entryActive:boolean
  readonly entryDisabled:boolean
  readonly overriddenFields:readonly ConfigKey[]
  readonly refreshMs:number
  readonly services:{readonly agents:boolean;readonly presets:boolean;readonly persistence:boolean;readonly tools:boolean}
  readonly runtime:{readonly transportAttached:boolean;readonly runtime:KernelStatus;readonly model:{readonly sessions:number;readonly lastFailure:string|null}}|null
  readonly counts:JournalStats|null
}

/** Revision-checked patch of declared operator fields. */
export interface SaveRequest{readonly revision:string;readonly patch:Partial<Config>}
/** Explicit restart of the saved runtime without deleting data. */
export interface RestartRequest{readonly revision:string}
/** Local preview uses the saved settings and can never publish to QQ. */
export interface PreviewRequest{readonly revision:string;readonly previewId:PreviewId;readonly text:string}
/** Cancel only one named preview; other live and preview requests remain independent. */
export interface CancelPreviewRequest{readonly previewId:PreviewId}
/** Cancellation confirms an abort request, not that the model completed successfully. */
export interface CancelPreviewResponse{readonly requested:boolean}

/** Final public text from this preview's actual outbound records. */
export interface PreviewResponse{
  readonly previewId:PreviewId
  readonly status:ChatStatus
  readonly reason:Reason|null
  readonly modelOutcome:ModelOutcome
  readonly modelReason:Reason|null
  readonly output:readonly string[]
}

/** Stable failure reasons localized by the owner page. */
export type ControlFailure='forbidden'|'request-invalid'|'config-invalid'|'revision-conflict'|'entry-unavailable'|'runtime-unavailable'|'apply-failed'|'preview-active'|'preview-failed'|'cancelled'

declare module '@deepseek-ai/dsh-typert-protocol/types'{
  interface RemoteErrorDetailsMap{
    /** Sanitized owner-only failure without source text or native exceptions. */
    'qq-chat/control':{readonly reason:ControlFailure;readonly field?:ConfigKey}
  }
}
