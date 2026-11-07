/** Native bundle page and app-wide operation feedback independent of chat reloads. */
import type {Context} from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-gateway/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import {createSnapshotStore} from '@deepseek-ai/dsh-client-store'
import type {RemoteResult} from '@deepseek-ai/dsh-typert-protocol/types'
import {controlRemote} from './remote.ts'
import {en,zh,type LocaleKey} from './locales.ts'
import {ChatPage,NoticeHost,PageProblem,type Notice,type NoticeFace,type PageFace} from './page.tsx'
import styles from './style.css'

declare module '@deepseek-ai/dsh-client-ui-slots'{interface LocaleNamespaceMap{/** Owner chat settings, state and preview copy. */qqChat:LocaleKey}}
/** Runtime services supplied by the native Web profile. */
export const inject=['remote','locale','slots']
function unwrap<T>(result:RemoteResult<T>):T{
  if(result.ok)return result.value
  if(result.error.code==='qq-chat/control')throw new PageProblem(result.error.details.reason,result.error.details.field)
  throw new PageProblem('unavailable')
}

/**
 * Mount strict Remote descriptors and the native bundle configuration page.
 * @param ctx - browser Cordis context with gateway, locale and slot services.
 * @returns completion of the owned Remote namespace mount.
 */
export async function apply(ctx:Context):Promise<void>{
  await ctx.remote.$mount(controlRemote)
  ctx.effect(()=>ctx.locale.register('qqChat',{en,zh}))
  ctx.effect(()=>{const element=document.createElement('style');element.dataset['qqChat']='true';element.textContent=styles;document.head.append(element);return()=>element.remove()})
  const notice=createSnapshotStore<Notice|null>(null);let serial=0
  ctx.inject(['remote.qqChatControl'],child=>{
    const face:PageFace={
      read:async()=>unwrap(await child.remote.qqChatControl.describe()),
      save:async request=>unwrap(await child.remote.qqChatControl.save(request)),
      restart:async request=>unwrap(await child.remote.qqChatControl.restart(request)),
      preview:async request=>unwrap(await child.remote.qqChatControl.preview(request)),
      cancel:async request=>unwrap(await child.remote.qqChatControl.cancelPreview(request)),
      notify:(text,success)=>notice.set({id:++serial,text,success}),
    }
    child.slots.inject('plugins.bundle.config',()=>child.slots.register({name:'plugins.bundle.config',key:'dsh-qq-chat',locale:'qqChat',inject:()=>face},ChatPage))
  })
  ctx.slots.inject('shell.overlay',()=>ctx.slots.register({name:'shell.overlay',id:'qq-chat.notice',inject:():NoticeFace=>({hooks:{notice},dismiss:id=>{if(notice.getSnapshot()?.id===id)notice.set(null)}})},NoticeHost))
}
