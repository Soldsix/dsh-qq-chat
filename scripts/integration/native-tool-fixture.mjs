/** Preset-scoped synthetic tool used to verify actual native execution guards. */
export const name='qq-chat-native-tool'
export const inject=['tools','qqChatTest']
export function apply(ctx){
 ctx.qqChatTest.toolRegistrations.push('fixture_echo')
 ctx.qqChatTest.toolContexts.push(ctx)
 ctx.effect(()=>ctx.tools.register({
  name:'fixture_echo',description:'Synthetic local tool for chat guard verification.',parameters:{type:'object',properties:{text:{type:'string'}},required:['text'],additionalProperties:false},
  output:{schema:{type:'object',properties:{ok:{type:'boolean'}},required:['ok'],additionalProperties:false},render:()=>[{type:'text',text:'FIXTURE_TOOL_EXECUTED'}]},
  async execute(_args,execution){execution.signal.throwIfAborted();ctx.qqChatTest.toolCalls.push('fixture_echo');return{ok:true}},
 }))
}
