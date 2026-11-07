/** Explicit native Client descriptors, independent of Host source reflection. */
import type {RemoteResult,TypertRemoteContribution} from '@deepseek-ai/dsh-typert-protocol/types'
import type {ControlSnapshot,SaveRequest,RestartRequest,PreviewRequest,PreviewResponse,CancelPreviewRequest,CancelPreviewResponse} from '../control-types.ts'
import {saveSchema,restartSchema,snapshotSchema,previewSchema,previewResponseSchema,cancelPreviewSchema,cancelResponseSchema} from '../control-codecs.ts'

declare module '@deepseek-ai/dsh-typert-protocol/types'{
  interface TypertRemoteNamespaceMap{
    /** Owner-only management and local text preview. */
    qqChatControl:{
      describe():Promise<RemoteResult<ControlSnapshot>>
      save(request:SaveRequest):Promise<RemoteResult<ControlSnapshot>>
      restart(request:RestartRequest):Promise<RemoteResult<ControlSnapshot>>
      preview(request:PreviewRequest):Promise<RemoteResult<PreviewResponse>>
      cancelPreview(request:CancelPreviewRequest):Promise<RemoteResult<CancelPreviewResponse>>
    }
  }
}

/** Strict codecs validate both calls and results before browser state changes. */
export const controlRemote:TypertRemoteContribution={
  package:'dsh-qq-chat',
  descriptors:['describe','save','restart','preview','cancelPreview'].map(method=>({
    id:`qqChatControl/${method}`,service:'qqChatControl',namespace:'qqChatControl',method,invocation:{kind:'direct'},
    parameters:method==='describe'?[]:[{name:'request',wire:'request',source:'json',codec:{mode:'strict',typeSymbol:`dsh-qq-chat#${method}Request`,create:()=>method==='save'?saveSchema:method==='restart'?restartSchema:method==='preview'?previewSchema:cancelPreviewSchema}}],
    result:{mode:'strict',typeSymbol:`dsh-qq-chat#${method}Response`,create:()=>method==='preview'?previewResponseSchema:method==='cancelPreview'?cancelResponseSchema:snapshotSchema},
  })),
}
