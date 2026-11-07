/** Real-model local-only smoke; it never registers or calls a messaging provider. */
import {writeFile,rename} from 'node:fs/promises'
import {setImmediate as nextTurn} from 'node:timers/promises'
import {credentialRef} from '@deepseek-ai/dsh-credentials'
export const name='qq-chat-real-api-probe'
export const inject=['qqChat','qqChatControl','credentials']
export function apply(ctx,config){
 const lifetime=new AbortController(),codes=[]
 ctx.on('qq-chat/diagnostic',({stage,error})=>codes.push({stage,code:typeof error?.code==='string'&&/^[A-Z0-9_:-]{1,80}$/.test(error.code)?error.code:'PROVIDER_OR_RUNTIME_ERROR'}))
 const work=nextTurn().then(async()=>{
  const checks=[],outputs=[]
  const record=async value=>{await writeFile(config.resultPath+'.tmp',JSON.stringify(value,null,2)+'\n');await rename(config.resultPath+'.tmp',config.resultPath)}
  try{
   const credential=await ctx.credentials.describe(credentialRef('DEEPSEEK_API_KEY'))
   if(!credential.configured){await record({passed:false,reason:'credential-unavailable',checks,realQqMessagesSent:0});return}
   const state=await ctx.qqChatControl.describe()
   if(state.runtime?.transportAttached)throw Error('LIVE_TRANSPORT_NOT_ALLOWED')
   const cases=[
    ['real-preview-context-first-0001','本次验收口令是“蓝鲸84”。请记住，只回复“记住了”。'],
    ['real-preview-context-second-0001','刚才的验收口令是什么？只回答口令。'],
    ['real-preview-context-third-0001','再写一次刚才的口令，再计算287乘43。只给出口令和计算结果。'],
   ]
   for(const [previewId,text]of cases){
    const started=performance.now(),result=await ctx.qqChatControl.preview({revision:state.revision,previewId,text})
    outputs.push({...result,elapsedMs:Math.round(performance.now()-started)})
    if(result.status!=='previewed'||result.modelOutcome!=='completed'||!result.output.some(value=>value.trim())){await record({passed:false,reason:'model-attempt-not-completed',checks,outputs,diagnosticCodes:codes,realQqMessagesSent:0});return}
   }
   checks.push('real-model-three-local-previews-with-public-outbound')
   if(!outputs[1].output.join('\n').includes('蓝鲸84'))throw Error('CONTEXT_RECALL_NOT_OBSERVED')
   if(!outputs[2].output.join('\n').includes('蓝鲸84')||!outputs[2].output.join('\n').replaceAll(',','').includes('12341'))throw Error('COMBINED_CONTEXT_AND_ARITHMETIC_NOT_OBSERVED')
   checks.push('real-model-retains-context-and-answers-followup')
   const replay=await ctx.qqChatControl.preview({revision:state.revision,previewId:cases[0][0],text:cases[0][1]})
   if(replay.status!=='duplicate')throw Error('SOURCE_REPLAY_NOT_SUPPRESSED')
   checks.push('durable-preview-replay-does-not-submit-a-new-model-turn')
   await record({passed:true,checks,outputs,counts:await ctx.qqChat.historyCounts(),modelRoute:{provider:'deepseek-official',model:'deepseek-flash'},realQqMessagesSent:0,realModelPreviewTurns:3,qualityScope:'Basic text, conversation recall and arithmetic only; not a comparative intelligence benchmark.'})
  }catch(error){await record({passed:false,reason:/^[A-Z_]+$/.test(error.message)?error.message:'REAL_API_SMOKE_FAILED',checks,outputs,diagnosticCodes:codes,realQqMessagesSent:0})}
 })
 ctx.effect(()=>async()=>{lifetime.abort();await work})
}
