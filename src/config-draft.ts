/** Browser form drafts preserve raw edits until the operator saves. */
import {CONFIG_FIELDS,isConfigKey,type Config,type ConfigKey} from './config-fields.ts'

/** Raw fields are retained during polling and failed saves. */
export type FormDraft=Partial<Record<ConfigKey,string|boolean>>
/** Valid patch or the first locally invalid field. */
export type DraftResult={readonly ok:true;readonly patch:Partial<Config>}|{readonly ok:false;readonly field:ConfigKey}

/**
 * Format a setting for a native input without changing the saved setting.
 * @param config - current parsed settings.
 * @param key - declared field.
 * @returns boolean or editable text, with lists separated by newlines.
 */
export function fieldValue(config:Config,key:ConfigKey):string|boolean{
  const value=config[key];return Array.isArray(value)?value.join('\n'):typeof value==='boolean'?value:String(value)
}

/**
 * Keep only changed fields after checking browser input representations.
 * @param draft - unsaved native form edits.
 * @param baseline - settings revision the operator started editing.
 * @returns typed changed fields or a locally invalid field.
 */
export function draftPatch(draft:FormDraft,baseline:Config):DraftResult{
  const patch:Record<string,unknown>={}
  for(const [key,raw]of Object.entries(draft)){
    if(!isConfigKey(key))continue
    const kind=CONFIG_FIELDS[key]
    let value:unknown=raw
    if(kind==='boolean'){if(typeof raw!=='boolean')return{ok:false,field:key}}
    else{
      if(typeof raw!=='string')return{ok:false,field:key}
      if(kind==='number'){
        if(!/^-?\d+$/.test(raw.trim())||!Number.isSafeInteger(Number(raw)))return{ok:false,field:key}
        value=Number(raw)
      }else if(kind==='list')value=raw.split(/[\n,]/).map(part=>part.trim()).filter(Boolean)
      else if(kind==='trigger'&&!['directed','followup'].includes(raw)||kind==='reply'&&!['quote','mention','plain'].includes(raw)||kind==='locale'&&!['zh','en'].includes(raw))return{ok:false,field:key}
    }
    if(JSON.stringify(value)!==JSON.stringify(baseline[key]))patch[key]=value
  }
  return{ok:true,patch:patch as Partial<Config>}
}
