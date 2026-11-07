/** Stable revision of the parsed operator settings, excluding derived paths. */
import {createHash} from 'node:crypto'
import {CONFIG_FIELDS,type Config} from './config-fields.ts'

/**
 * Hash every declared setting in registry order.
 * @param config - validated operator settings before path resolution.
 * @returns an opaque revision for optimistic configuration edits.
 */
export function configRevision(config:Config):string{
  return createHash('sha256').update(JSON.stringify(Object.keys(CONFIG_FIELDS).map(key=>[key,config[key as keyof Config]]))).digest('hex')
}
