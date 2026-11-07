/** Conservative public-output checks; tool execution permissions are enforced separately. */
/**
 * Find common local paths, private endpoints and credential formats without echoing them.
 * @param text - complete public output to inspect before delivery.
 * @returns whether a supported sensitive pattern was found; this is not a complete disclosure filter.
 */
export function sensitiveOutput(text:string):boolean{
  let normalized=text.normalize('NFKC').replace(/[\u200b-\u200f\u202a-\u202e\u2060-\u206f]/g,'')
  normalized=normalized.replace(/(?:%[a-f0-9]{2})+/gi,encoded=>{try{return decodeURIComponent(encoded)}catch(error){return encoded}})
  if(/\b[a-z]:[\\/]|\bfile:\/\/|\/(?:Users|home|root|etc|var|tmp)\/|\bsk-[a-z0-9_-]{16,}|\bBearer\s+[a-z0-9._-]{16,}|\blocalhost(?::\d+)?\b/i.test(normalized))return true
  for(const value of normalized.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g)??[]){
    const parts=value.split('.').map(Number),a=parts[0],b=parts[1]
    if(parts.some(value=>value>255))continue
    if(a===10||a===127||(a===192&&b===168)||(a===172&&b!==undefined&&b>=16&&b<=31)||(a===169&&b===254))return true
  }
  return /(?:\[|\s|^)(?:::1|f[cd][a-f0-9]{2}:[a-f0-9:]+|fe80:[a-f0-9:]+)(?:\]|\s|$)/i.test(normalized)
}
