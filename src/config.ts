/** Explicit configuration resolution before storage or model work starts. */
import z from '@deepseek-ai/schemastery'
import {isAbsolute,join} from 'node:path'
import type {Config as Settings,ConfigKey} from './config-fields.ts'

/** Schema-parsed operator settings. */
export interface Config extends Settings{}

/** Native profile settings; all deployment-varying limits are explicit. */
export const Config:z<Config>=z.object({
  enabled:z.boolean().default(false),namespace:z.string().default('qq-chat'),
  databasePath:z.string().default(''),workspacePath:z.string().default(''),presetId:z.string().default(''),
  provider:z.string().default(''),model:z.string().default(''),reasoningEffort:z.string().default(''),
  maxTokens:z.number().min(0).max(1048576).step(1).default(0),allowedTools:z.array(z.string()).default([]),
  isolateGroupSenders:z.boolean().default(false),
  trigger:z.union([z.const('directed'),z.const('followup')]).default('followup'),
  followupWindowMs:z.number().min(0).max(3600000).step(1).default(60000),
  replyMode:z.union([z.const('quote'),z.const('mention'),z.const('plain')]).default('quote'),
  locale:z.union([z.const('zh'),z.const('en')]).default('zh'),
  maxConcurrent:z.number().min(1).max(128).step(1).default(4),
  maxPending:z.number().min(1).max(65536).step(1).default(128),
  maxPendingPerScope:z.number().min(1).max(4096).step(1).default(16),
  maxLiveSessions:z.number().min(1).max(4096).step(1).default(32),
  sessionIdleMs:z.number().min(100).max(86400000).step(1).default(300000),
  maxSourceAgeMs:z.number().min(1000).max(86400000).step(1).default(300000),
  maxInputChars:z.number().min(1).max(1048576).step(1).default(32768),
  maxReplyChars:z.number().min(1).max(1048576).step(1).default(12000),
  queueTimeoutMs:z.number().min(50).max(3600000).step(1).default(120000),
  modelTimeoutMs:z.number().min(50).max(3600000).step(1).default(120000),
  sendTimeoutMs:z.number().min(50).max(300000).step(1).default(15000),
  storageTimeoutMs:z.number().min(50).max(60000).step(1).default(5000),
  storageBusyMs:z.number().min(0).max(10000).step(1).default(1000),
  storageStartupMs:z.number().min(100).max(60000).step(1).default(10000),
  shutdownTimeoutMs:z.number().min(100).max(60000).step(1).default(5000),
})

/** Enabled, profile-owned filesystem locations. */
export interface Spec extends Config{readonly databasePath:string;readonly workspacePath:string}

/** Field error without echoing configuration values. */
export class ConfigIssue extends Error{constructor(readonly field:ConfigKey){super('Invalid chat configuration field: '+field)}}

/**
 * Validate cross-field choices without opening files or resolving a preset.
 * @param config - schema-parsed settings; invalid relationships throw ConfigIssue.
 */
export function validateConfig(config:Config):void{
  if(!/^[a-z][a-z0-9_-]{0,63}$/.test(config.namespace))throw new ConfigIssue('namespace')
  for(const field of ['databasePath','workspacePath'] as const)if(config[field]&&!isAbsolute(config[field]))throw new ConfigIssue(field)
  if(Boolean(config.provider)!==Boolean(config.model))throw new ConfigIssue(config.provider?'model':'provider')
  for(const field of ['presetId','provider','model','reasoningEffort'] as const)if(config[field]!==config[field].trim()||/[\r\n\0]/.test(config[field]))throw new ConfigIssue(field)
  if(config.maxPendingPerScope>config.maxPending)throw new ConfigIssue('maxPendingPerScope')
  if(config.maxLiveSessions<config.maxConcurrent)throw new ConfigIssue('maxLiveSessions')
  if(config.storageBusyMs>=config.storageTimeoutMs)throw new ConfigIssue('storageBusyMs')
  if(new Set(config.allowedTools).size!==config.allowedTools.length||config.allowedTools.some(name=>!/^[a-zA-Z][a-zA-Z0-9_.:-]{0,127}$/.test(name)))throw new ConfigIssue('allowedTools')
}

/**
 * Resolve disabled state or explicit profile-local paths before any IO.
 * @param config - schema-parsed settings.
 * @param profileDir - absolute directory owned by the current DSH profile.
 * @returns enabled settings with absolute paths, or null when disabled.
 */
export function resolveConfig(config:Config,profileDir:string):Spec|null{
  validateConfig(config)
  if(!config.enabled)return null
  if(!isAbsolute(profileDir))throw new Error('Chat requires an absolute DSH profile directory')
  const data=join(profileDir,'data',config.namespace)
  return{...config,databasePath:config.databasePath||join(data,'state.sqlite3'),workspacePath:config.workspacePath||join(data,'workspace')}
}
