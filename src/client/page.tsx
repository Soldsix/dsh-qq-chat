/** Native chat settings and isolated text preview; failed queries retain edits and results. */
import {useEffect,useId,useRef,useState,type ReactNode} from 'react'
import {brandString} from '@deepseek-ai/dsh-brand'
import {Button,Input,Switch,Toast} from '@deepseek-ai/dsh-client-ui-primitives'
import type {HostObservable,InjectFace,PropsLocale,PropsRuntime} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import {CONFIG_FIELDS,isConfigKey,type ConfigKey} from '../config-fields.ts'
import {draftPatch,fieldValue,type FormDraft} from '../config-draft.ts'
import type {ControlSnapshot,ControlFailure,SaveRequest,RestartRequest,PreviewRequest,PreviewResponse,CancelPreviewRequest,CancelPreviewResponse,PreviewId} from '../control-types.ts'

/** Sanitized failure passed by the native Remote facade. */
export class PageProblem extends Error{constructor(readonly reason:ControlFailure|'unavailable',readonly field?:ConfigKey){super(reason)}}
/** Host business operations injected into the page slot. */
export interface PageFace{
  readonly read:()=>Promise<ControlSnapshot>
  readonly save:(request:SaveRequest)=>Promise<ControlSnapshot>
  readonly restart:(request:RestartRequest)=>Promise<ControlSnapshot>
  readonly preview:(request:PreviewRequest)=>Promise<PreviewResponse>
  readonly cancel:(request:CancelPreviewRequest)=>Promise<CancelPreviewResponse>
  readonly notify:(text:string,success:boolean)=>void
}
/** Native page runtime, dictionary and business actions. */
export type PageProps=PropsRuntime<'plugins.bundle.config'>&PropsLocale<'qqChat'>&PageFace
/** Transient owner feedback outlives navigation away from this page. */
export interface Notice{readonly id:number;readonly text:string;readonly success:boolean}
/** App-wide notice state and explicit dismissal. */
export interface NoticeFace{readonly hooks:{readonly notice:HostObservable<Notice|null>};readonly dismiss:(id:number)=>void}

/**
 * Render native feedback outside the settings page's lifetime.
 * @param props - shared notice subscription and dismissal.
 * @returns a native toast, or no output.
 */
export function NoticeHost({useNotice,dismiss}:InjectFace<NoticeFace>):ReactNode{
  const notice=useNotice(value=>value)
  return notice?<Toast key={notice.id} text={notice.text} {...notice.success?{tone:'success' as const}:{}} onDone={()=>dismiss(notice.id)}/>:null
}

/**
 * Provide the chat settings page in its bundle configuration slot.
 * @param props - slot presentation, dictionary and owner operations.
 * @returns the full page; summary placement adds no duplicate content.
 */
export function ChatPage({view,...props}:PageProps):ReactNode{return view==='page'?<ConfigurationPage {...props}/>:null}

function ConfigurationPage({t,read,save,restart,preview,cancel,notify}:PropsLocale<'qqChat'>&PageFace):ReactNode{
  const id=useId()
  const [snapshot,setSnapshot]=useState<ControlSnapshot|null>(null),[baseline,setBaseline]=useState<ControlSnapshot|null>(null)
  const [draft,setDraft]=useState<FormDraft>({}),[invalid,setInvalid]=useState<ConfigKey|null>(null)
  const [queryFailed,setQueryFailed]=useState(false),[reading,setReading]=useState(false),[busy,setBusy]=useState(false),[refreshKey,setRefreshKey]=useState(0)
  const [text,setText]=useState(''),[previewing,setPreviewing]=useState(false),[result,setResult]=useState<PreviewResponse|null>(null),[previewProblem,setPreviewProblem]=useState<string|null>(null)
  const mounted=useRef(true),editing=useRef(false),writing=useRef(false),sequence=useRef(0),activePreview=useRef<PreviewId|null>(null)
  const patch=baseline?draftPatch(draft,baseline.config):null
  const dirty=patch?.ok===false||(patch?.ok===true&&Object.keys(patch.patch).length>0)
  editing.current=dirty
  const problemText=(error:unknown)=>error instanceof PageProblem&&error.reason!=='unavailable'?t(`failure.${error.reason}`):t('unavailable')
  function accept(next:ControlSnapshot,reset:boolean):void{
    setSnapshot(next)
    if(reset||(!editing.current&&!writing.current)){setBaseline(next);setDraft({});setInvalid(null)}
  }
  useEffect(()=>{
    mounted.current=true
    let live=true,timer:ReturnType<typeof setTimeout>|undefined
    const poll=async()=>{
      const turn=++sequence.current;setReading(true)
      let interval:number|undefined
      try{
        const next=await read();interval=next.refreshMs
        if(live&&turn===sequence.current){accept(next,false);setQueryFailed(false)}
      }catch(error){if(live&&turn===sequence.current)setQueryFailed(true)}
      finally{if(live&&turn===sequence.current)setReading(false)}
      if(live&&interval!==undefined)timer=setTimeout(()=>{void poll()},interval)
    }
    void poll()
    return()=>{live=false;mounted.current=false;sequence.current++;clearTimeout(timer)}
  },[read,refreshKey])
  useEffect(()=>()=>{
    const previewId=activePreview.current
    if(previewId)void cancel({previewId}).catch(error=>{/* Navigation cleanup cannot display a new page-local failure. */})
  },[cancel])

  async function write(kind:'save'|'restart'):Promise<void>{
    if(writing.current||activePreview.current||!baseline||!patch?.ok)return
    writing.current=true;sequence.current++;setBusy(true);setInvalid(null)
    try{
      const next=kind==='save'?await save({revision:baseline.revision,patch:patch.patch}):await restart({revision:baseline.revision})
      notify(t(kind==='save'?'saved':'restarted'),true);sequence.current++
      if(mounted.current){accept(next,true);setQueryFailed(false)}
    }catch(error){notify(problemText(error),false);if(mounted.current&&error instanceof PageProblem)setInvalid(error.field??null)}
    finally{writing.current=false;if(mounted.current)setBusy(false)}
  }
  async function runPreview():Promise<void>{
    if(activePreview.current||writing.current||dirty||!baseline||!text.trim())return
    const previewId=brandString<PreviewId>(crypto.randomUUID())
    activePreview.current=previewId;setPreviewing(true);setPreviewProblem(null)
    try{
      const next=await preview({revision:baseline.revision,previewId,text})
      if(mounted.current)setResult(next)
    }catch(error){if(mounted.current)setPreviewProblem(problemText(error))}
    finally{activePreview.current=null;if(mounted.current){setPreviewing(false);setRefreshKey(value=>value+1)}}
  }
  async function stopPreview():Promise<void>{
    const previewId=activePreview.current;if(!previewId)return
    try{const response=await cancel({previewId});if(response.requested)notify(t('cancelling'),true)}catch(error){notify(problemText(error),false)}
  }
  if(!snapshot||!baseline)return<section className="qqchat-page">
    {queryFailed?<div role="alert"><p>{t('loadFailed')}</p><Button onClick={()=>setRefreshKey(value=>value+1)} disabled={reading}>{t('refresh')}</Button></div>:<span className="qqchat-spinner" role="status" aria-label={t('loading')}/>}
  </section>

  const fieldError=patch?.ok===false?patch.field:invalid
  const renderField=(key:ConfigKey)=>{
    const kind=CONFIG_FIELDS[key],label=t(`field.${key}`),inputId=`${id}-${key}`,value=draft[key]??fieldValue(baseline.config,key),error=fieldError===key
    const change=(next:string|boolean)=>{setDraft(previous=>({...previous,[key]:next}));setInvalid(null)}
    return<div className="qqchat-field" key={key}>
      {kind==='boolean'?<span>{label}</span>:<label htmlFor={inputId}>{label}</label>}
      {kind==='boolean'?<Switch label={label} checked={value===true} disabled={busy} onChange={change}/>:kind==='trigger'||kind==='reply'||kind==='locale'?<select id={inputId} disabled={busy} value={String(value)} aria-invalid={error} onChange={event=>change(event.currentTarget.value)}>
        {(kind==='trigger'?['followup','directed'] as const:kind==='reply'?['quote','mention','plain'] as const:['zh','en'] as const).map(option=><option key={option} value={option}>{t(option)}</option>)}
      </select>:kind==='list'?<textarea id={inputId} rows={3} value={String(value)} disabled={busy} spellCheck={false} autoComplete="off" aria-invalid={error} onChange={event=>change(event.currentTarget.value)}/>:<Input id={inputId} type={kind==='number'?'number':'text'} value={String(value)} disabled={busy} spellCheck={false} autoComplete="off" aria-invalid={error} onChange={event=>change(event.currentTarget.value)}/>}
      {error&&<span className="qqchat-field-error" role="alert">{t('failure.config-invalid')}</span>}
    </div>
  }
  const behavior:readonly ConfigKey[]=['enabled','isolateGroupSenders','trigger','followupWindowMs','replyMode','locale']
  const model:readonly ConfigKey[]=['presetId','provider','model','reasoningEffort','maxTokens','allowedTools']
  const advanced=Object.keys(CONFIG_FIELDS).filter(isConfigKey).filter(key=>!behavior.includes(key)&&!model.includes(key))
  const runtime=snapshot.runtime,services=Object.values(snapshot.services).every(Boolean)
  const canPreview=snapshot.config.enabled&&snapshot.appliedRevision===snapshot.revision&&snapshot.entryActive&&!snapshot.entryDisabled
  return<section className="qqchat-page">
    <p className="qqchat-description">{t('intro')}</p>
    <section className="qqchat-status" aria-live="polite">
      <strong>{!snapshot.config.enabled?t('disabled'):snapshot.appliedRevision===snapshot.revision?t('applied'):t('notApplied')}</strong>
      <dl>{(['active','transport','services'] as const).map((key,index)=><div key={key}><dt>{t(key)}</dt><dd>{[snapshot.entryActive,Boolean(runtime?.transportAttached),services][index]?t('yes'):t('no')}</dd></div>)}</dl>
      {runtime&&<p>{t('counts',{queued:runtime.runtime.queued,running:runtime.runtime.running,sessions:runtime.model.sessions})}</p>}
      {snapshot.counts&&<p>{t('history',{receipts:snapshot.counts.receipts,mappings:snapshot.counts.mappings,uncertain:snapshot.counts.uncertain})}</p>}
      {(runtime?.runtime.lastFailure||runtime?.model.lastFailure)&&<p>{t('diagnostic',{code:runtime.runtime.lastFailure??runtime.model.lastFailure??''})}</p>}
    </section>
    {queryFailed&&<p className="qqchat-error" role="alert">{t('loadFailed')}</p>}
    <form onSubmit={event=>{event.preventDefault();void write('save')}}>
      {dirty&&<p className="qqchat-help" role="status">{snapshot.revision!==baseline.revision?t('stale'):t('dirty')}</p>}
      <fieldset disabled={busy}><legend>{t('behavior')}</legend>{behavior.map(renderField)}<p className="qqchat-help">{t('isolationHelp')}</p></fieldset>
      <fieldset disabled={busy}><legend>{t('model')}</legend>{model.map(renderField)}<p className="qqchat-help">{t('modelHelp')}</p></fieldset>
      <details><summary>{t('advanced')}</summary><fieldset disabled={busy}>{advanced.map(renderField)}<p className="qqchat-help">{t('storageHelp')}</p></fieldset></details>
      <div className="qqchat-actions">
        <Button type="submit" variant="primary" disabled={busy||previewing||!dirty||patch?.ok===false}>{t('save')}</Button>
        <Button type="button" variant="outline" disabled={busy||previewing||dirty||!snapshot.config.enabled||snapshot.entryDisabled} onClick={()=>{void write('restart')}}>{t('restart')}</Button>
        <Button type="button" disabled={busy||reading} onClick={()=>setRefreshKey(value=>value+1)}>{t('refresh')}</Button>
        <Button type="button" disabled={busy||!dirty} onClick={()=>accept(snapshot,true)}>{t('discard')}</Button>
      </div>
    </form>
    <form className="qqchat-preview" onSubmit={event=>{event.preventDefault();void runPreview()}}>
      <h3>{t('preview')}</h3><p className="qqchat-help">{t('previewHelp')}</p>
      <label htmlFor={`${id}-preview`}>{t('previewLabel')}</label>
      <textarea id={`${id}-preview`} value={text} rows={4} maxLength={baseline.config.maxInputChars} disabled={previewing} spellCheck={false} onChange={event=>setText(event.currentTarget.value)}/>
      {dirty&&<p className="qqchat-help">{t('previewDirty')}</p>}
      <div className="qqchat-actions">
        <Button type="submit" variant="primary" disabled={!canPreview||busy||previewing||dirty||!text.trim()}>{t('runPreview')}</Button>
        <Button type="button" disabled={!previewing} onClick={()=>{void stopPreview()}}>{t('cancelPreview')}</Button>
      </div>
      {previewing&&<span role="status">{t('previewBusy')}</span>}
      {previewProblem&&<p className="qqchat-error" role="alert">{previewProblem}</p>}
      {result&&<section className="qqchat-result" aria-label={t('previewResult')}>
        <p>{t('previewOutcome',{status:t(`status.${result.status}`),model:t(`model.${result.modelOutcome}`)})}</p>
        {result.reason&&<p className="qqchat-help">{t('previewReason',{reason:t(`reason.${result.reason}`)})}</p>}
        {result.output.length?result.output.map((output,index)=><pre key={index}>{output}</pre>):<p className="qqchat-help">{t('previewEmpty')}</p>}
      </section>}
    </form>
  </section>
}
