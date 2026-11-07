/** Synthetic identities and isolated filesystem paths for public tests. */
import {mkdir,mkdtemp} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import {join} from 'node:path'
import {identifier,scopeKey} from 'dsh-im-kit'
import {requestId,fingerprint,mappingId,sessionId} from '../dist/identity.js'
import {SqliteJournal} from '../dist/journal.js'
export const root=fileURLToPath(new URL('../.test-artifacts/',import.meta.url))
export function message(id='1',options={}){
 const now=Date.now()
 const scope={account:{tenantId:identifier('im.tenant','qa'),networkId:identifier('im.network','onebot11'),accountId:identifier('im.account',options.account??'90000001')},kind:options.kind??'group',peerId:identifier('im.peer',options.peer??'90000100')}
 return {scope,messageId:identifier('im.message',id),senderId:identifier('im.user',options.sender??'90000002'),sentAt:now,receivedAt:now,directedToBot:options.directed??true,parts:[{type:'text',text:options.text??'synthetic hello'}],...options.override}
}
export function receipt(input,mode='live'){
 return {requestId:requestId(input,mode),scopeKey:scopeKey(input.scope),fingerprint:fingerprint(input),mode,phase:'queued',input,updatedAt:Date.now(),sessionId:null,result:null}
}
export function mapping(input,mode='live',preset='qa'){
 const key=mappingId('qa',input.scope,mode,preset)
 return {mappingId:key,scopeKey:scopeKey(input.scope),mode,presetId:preset,sessionId:sessionId(key),lastSenderId:null,lastReplyAt:0,lastDelivery:null,createdAt:Date.now()}
}
export async function area(prefix='store-'){await mkdir(root,{recursive:true});return mkdtemp(join(root,prefix))}
export async function journal(t,path){
 const directory=path??await area()
 const options={databasePath:join(directory,'chat.sqlite3'),busyMs:20,timeoutMs:3000,startupMs:5000,shutdownMs:3000}
 const store=await SqliteJournal.open(options)
 t?.after(()=>store.close())
 return {store,options,directory}
}
