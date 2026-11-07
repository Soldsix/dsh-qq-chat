/** Shared JSON outcome values without Host-only runtime imports. */
export const CHAT_STATUSES=['responded','previewed','ignored','duplicate','failed','uncertain','cancelled'] as const
/** Logical chat result, independent of delivery and model outcomes. */
export type ChatStatus=typeof CHAT_STATUSES[number]
/** Model attempt state; an accepted failure notice does not imply model success. */
export const MODEL_OUTCOMES=['not-started','completed','failed','cancelled','unknown'] as const
/** Model attempt result. */
export type ModelOutcome=typeof MODEL_OUTCOMES[number]
/** Stable reasons shared by durable results and owner pages. */
export const REASONS=['not-directed','stale','capacity','queue-timeout','disabled','offline','muted','source-conflict','model-failed','model-timeout','empty-output','reply-too-long','input-too-long','sensitive-output','external-input','cancelled','restarted','storage-unavailable','delivery-rejected','delivery-uncertain'] as const
/** Sanitized reason without provider exceptions or message bodies. */
export type Reason=typeof REASONS[number]
