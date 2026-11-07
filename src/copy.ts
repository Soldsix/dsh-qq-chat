/** Safe operational replies contain neither provider exceptions nor local environment data. */
import type {Reason} from './types.ts'
/**
 * Produce a brief failure notice without including diagnostic data.
 * @param reason - sanitized operational outcome.
 * @param locale - configured notice language.
 * @returns text suitable for an explicitly addressed request.
 */
export function failureText(reason:Reason,locale:'zh'|'en'):string{
  const key=reason==='capacity'?'busy':reason==='queue-timeout'?'queue':reason==='sensitive-output'?'privacy':reason==='reply-too-long'?'length':reason==='input-too-long'?'input':'failed'
  const texts={
    zh:{busy:'这会儿消息有点多，请稍后再发一次。',queue:'这条消息排队太久了，请重新发我一次。',privacy:'这条回复包含本机或凭据信息，不能发出。',length:'这次内容超过了文字发送上限，请缩小一下范围。',input:'这条消息太长，请拆开或缩小范围。',failed:'这次回复没完成，请稍后再试。'},
    en:{busy:'Too many requests are pending. Please send this again shortly.',queue:'This request waited too long. Please send it again.',privacy:'This reply contains local or credential data and cannot be sent.',length:'This answer exceeds the text delivery limit. Please narrow the request.',input:'This message is too long. Please split it or narrow its scope.',failed:'This reply could not be completed. Please try again shortly.'},
  }
  return texts[locale][key]
}
