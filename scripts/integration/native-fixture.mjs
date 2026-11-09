/** Synthetic IM transport only; it has no QQ or platform connection. */
import {ImRuntime,identifier} from 'dsh-im-kit'
export const name='qq-chat-native-fixture'
export function apply(ctx){
 const runtime=new ImRuntime(),outputs=[]
 const account={tenantId:identifier('im.tenant','qa'),networkId:identifier('im.network','onebot11'),accountId:identifier('im.account','90000001')}
 ctx.effect(()=>()=>runtime.close())
 ctx.effect(()=>runtime.register({account,async availability(){return'available'},async send(message){outputs.push(structuredClone(message));return{status:'accepted',messageIds:[identifier('im.message','accepted-'+outputs.length)]}},async dispose(){}}))
 ctx.effect(()=>ctx.provide('im',runtime))
 ctx.effect(()=>ctx.provide('qqChatTest',{outputs,account,toolCalls:[],toolRegistrations:[],toolVisibility:[],toolContexts:[],attributions:[],sourceEvents:[]}))
}
