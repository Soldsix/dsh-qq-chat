/** Deployment settings shared by native configuration, workers and operator views. */
export interface Config {
  enabled: boolean
  namespace: string
  databasePath: string
  workspacePath: string
  presetId: string
  provider: string
  model: string
  reasoningEffort: string
  maxTokens: number
  allowedTools: string[]
  isolateGroupSenders: boolean
  trigger: 'directed' | 'followup'
  followupWindowMs: number
  replyMode: 'quote' | 'mention' | 'plain'
  locale: 'zh' | 'en'
  maxConcurrent: number
  maxPending: number
  maxPendingPerScope: number
  maxLiveSessions: number
  sessionIdleMs: number
  maxSourceAgeMs: number
  maxInputChars: number
  maxReplyChars: number
  queueTimeoutMs: number
  modelTimeoutMs: number
  sendTimeoutMs: number
  storageTimeoutMs: number
  storageBusyMs: number
  storageStartupMs: number
  shutdownTimeoutMs: number
}

/** Exhaustive editable fields; no secret value is accepted here. */
export const CONFIG_FIELDS = {
  enabled:'boolean', namespace:'text', databasePath:'text', workspacePath:'text', presetId:'text',
  provider:'text', model:'text', reasoningEffort:'text', maxTokens:'number', allowedTools:'list',
  isolateGroupSenders:'boolean', trigger:'trigger', followupWindowMs:'number', replyMode:'reply', locale:'locale',
  maxConcurrent:'number', maxPending:'number', maxPendingPerScope:'number', maxLiveSessions:'number',
  sessionIdleMs:'number', maxSourceAgeMs:'number', maxInputChars:'number', maxReplyChars:'number',
  queueTimeoutMs:'number', modelTimeoutMs:'number', sendTimeoutMs:'number', storageTimeoutMs:'number',
  storageBusyMs:'number', storageStartupMs:'number', shutdownTimeoutMs:'number',
} as const satisfies Record<keyof Config,string>

/** Public operator field name. */
export type ConfigKey = keyof Config

/**
 * Check one external field against the exhaustive settings registry.
 * @param value - candidate field name.
 * @returns whether the field is a declared chat setting.
 */
export function isConfigKey(value:string):value is ConfigKey{return Object.hasOwn(CONFIG_FIELDS,value)}
