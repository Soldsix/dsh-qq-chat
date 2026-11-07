/** Read only the newest native user block; assistant prefill is not a new test command. */
export function fixtureMarker(body){
 const user=body.messages?.filter(message=>message.role==='user').at(-1)
 const content=user?.content
 if(typeof content==='string')return content.match(/(?:NATIVE_|UI_)[A-Z_]+/g)?.at(-1)
 for(const block of [...content??[]].reverse()){
  if(block.type==='tool_result')return undefined
  if(block.type==='text'){const marker=block.text.match(/(?:NATIVE_|UI_)[A-Z_]+/g)?.at(-1);if(marker)return marker}
 }
 return undefined
}
