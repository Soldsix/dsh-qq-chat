/** Observe the composed transport and chat services without bypassing inbound WebSocket parsing. */
import assert from 'node:assert/strict'
import {writeFile,rename} from 'node:fs/promises'
import {setImmediate as nextTurn,setTimeout as delay} from 'node:timers/promises'
export const name='chat-onebot-composition-probe'
export const inject=['qqChat','qqOnebot','im']
async function record(path,data){await writeFile(path+'.tmp',JSON.stringify(data,null,2)+'\n');await rename(path+'.tmp',path)}
export function apply(ctx,config){
 const lifetime=new AbortController(),seen=[]
 ctx.effect(()=>ctx.im.subscribe(message=>{seen.push({id:message.messageId,directed:message.directedToBot,sender:message.senderId})},()=>true))
 const wait=async predicate=>{const deadline=Date.now()+30000;while(!await predicate()){lifetime.signal.throwIfAborted();assert.ok(Date.now()<deadline,'Composition condition timed out');await delay(15,undefined,{signal:lifetime.signal})}}
 const work=nextTurn().then(async()=>{
  try{
   await wait(()=>ctx.qqOnebot.status().online&&ctx.qqChat.status().transportAttached)
   await record(config.readyPath,{online:true})
   await wait(async()=>seen.length===3&&ctx.qqOnebot.status().duplicates===1&&(await ctx.qqChat.historyCounts()).responded===2&&ctx.qqChat.status().runtime.running===0)
   assert.deepEqual(seen.map(message=>message.directed),[true,false,false])
   const counts=await ctx.qqChat.historyCounts();assert.equal(counts.mappings,1);assert.equal(counts.receipts,2)
   await record(config.resultPath,{passed:true,checks:['real-onebot-parser-to-native-agent','unmentioned-same-sender-followup','unrelated-sender-not-admitted','transport-replay-suppressed','one-durable-session-for-followup'],seen:seen.length,counts,realQqMessagesSent:0})
  }catch(error){await record(config.resultPath,{passed:false,error:{message:error.message},realQqMessagesSent:0})}
 })
 ctx.effect(()=>async()=>{lifetime.abort();await work})
}
