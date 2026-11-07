/** Exercise the packaged native page in an isolated DSH Web profile and fresh headless browser. */
import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {once} from 'node:events'
import {createServer} from 'node:http'
import {createHash} from 'node:crypto'
import {mkdtemp,mkdir,readFile,writeFile,realpath,copyFile,link,unlink,stat} from 'node:fs/promises'
import {createWriteStream} from 'node:fs'
import {join,relative,isAbsolute,basename} from 'node:path'
import {fileURLToPath} from 'node:url'
import {setTimeout as delay} from 'node:timers/promises'
import {verifyInstalledArchive} from './verify-installed.mjs'
import {fixtureMarker} from './fixture-marker.mjs'

const root=fileURLToPath(new URL('../../',import.meta.url)),args=process.argv
const input=args.indexOf('--im-kit-archive');assert.ok(input>=0&&args[input+1],'Pass --im-kit-archive PATH')
const library=await realpath(args[input+1]),manifest=JSON.parse(await readFile(join(root,'package.json'),'utf8'))
const cache=args.indexOf('--browser-cache')
process.env.PLAYWRIGHT_BROWSERS_PATH=cache>=0?await realpath(args[cache+1]):process.env.PLAYWRIGHT_BROWSERS_PATH??join(root,'.test-artifacts','browsers')
const {chromium}=await import('playwright')
const runs=join(root,'.test-artifacts','native-web');await mkdir(runs,{recursive:true})
const resume=args.indexOf('--resume-run'),resumed=resume>=0
const area=resumed?await realpath(args[resume+1]):await mkdtemp(join(runs,'web-install-'))
const owned=relative(runs,area);assert.ok(!owned.startsWith('..')&&!isAbsolute(owned),'Resume target must stay in this repository Web test directory')
const attempt=await mkdtemp(join(area,'attempt-')),home=join(area,'home'),profile='qq-chat-web',profileRoot=join(home,'profiles',profile)
const dsh=join(root,'node_modules','@deepseek-ai','dsh','lib','bin.js'),archives=[]
for(const source of[library,join(root,'artifacts',manifest.name+'-'+manifest.version+'.tgz')]){
 const target=join(attempt,basename(source));await copyFile(source,target)
 archives.push({path:target,name:basename(target),sha256:createHash('sha256').update(await readFile(target)).digest('hex')})
}
await writeFile(join(attempt,'inputs.json'),JSON.stringify(archives.map(({name,sha256})=>({name,sha256})),null,2)+'\n')
const captures=[];let active=0
const model=createServer(async(request,response)=>{
 if(request.url?.endsWith('/models')){response.setHeader('Content-Type','application/json');response.end(JSON.stringify({data:[{id:'deepseek-flash',object:'model',owned_by:'fixture'}]}));return}
 if(!request.url?.endsWith('/messages')){response.statusCode=404;response.end();return}
 let raw='';for await(const part of request)raw+=part
 const body=JSON.parse(raw),serial=captures.push(body),closed=new AbortController();active++
 response.once('close',()=>closed.abort())
 try{
  response.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache'})
  const marker=fixtureMarker(body)
  await delay(marker==='NATIVE_PREVIEW_HOLD'?30000:30,undefined,{signal:closed.signal})
  const send=(type,payload)=>response.write('event: '+type+'\ndata: '+JSON.stringify({type,...payload})+'\n\n')
  send('message_start',{message:{id:'web-fixture-'+serial,type:'message',role:'assistant',model:body.model,content:[],stop_reason:null,stop_sequence:null,usage:{input_tokens:10,output_tokens:0}}})
  send('content_block_start',{index:0,content_block:{type:'text',text:''}})
  send('content_block_delta',{index:0,delta:{type:'text_delta',text:'WEB_CAPTURED_REPLY_'+serial}})
  send('content_block_stop',{index:0});send('message_delta',{delta:{stop_reason:'end_turn',stop_sequence:null},usage:{output_tokens:10}});send('message_stop',{});response.end()
 }catch(error){if(!closed.signal.aborted)response.destroy(error)}finally{active--}
})
model.listen(0,'127.0.0.1');await once(model,'listening');model.unref()
const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!/KEY|SECRET|TOKEN|PASSWORD/i.test(key)))
await mkdir(join(attempt,'temp'),{recursive:true});Object.assign(env,{TEMP:join(attempt,'temp'),TMP:join(attempt,'temp')})
Object.assign(env,{DSH_HOME:home,DSH_SYSTEM_PROMPT:'Synthetic Web integration fixture. No private persona or skills.',DEEPSEEK_API_KEY:'synthetic-loopback-only',DEEPSEEK_BASE_URL:'http://127.0.0.1:'+model.address().port+'/anthropic'})
const installation=[]
async function run(command,argv,cwd){
 const signal=AbortSignal.timeout(300000),log=createWriteStream(join(attempt,'setup-'+installation.length+'.log'))
 const child=spawn(command,argv,{cwd,env,windowsHide:true,signal,stdio:['ignore','pipe','pipe']})
 await writeFile(join(attempt,'setup-live.json'),JSON.stringify({pid:child.pid,args:argv,startedAt:new Date().toISOString()})+'\n')
 let stdout='',stderr='',failure
 child.stdout.on('data',part=>{stdout+=part;log.write(part)});child.stderr.on('data',part=>{stderr+=part;log.write(part)});child.once('error',error=>{failure=error})
 const [code,exitSignal]=await new Promise(resolve=>child.once('close',(...values)=>resolve(values)))
 await new Promise(resolve=>log.end(resolve))
 installation.push({args:argv,code,signal:exitSignal,timedOut:signal.aborted,stdout,stderr})
 await writeFile(join(attempt,'installation.json'),JSON.stringify(installation,null,2)+'\n')
 if(failure)throw failure;assert.equal(signal.aborted,false);assert.equal(code,0,stderr.slice(-1600));return stdout
}
if(!resumed)await run(process.execPath,[dsh,'--profile',profile,'--from-default-profile','web','--dump-config'],area)
const profileManifest=JSON.parse(await readFile(join(profileRoot,'package.json'),'utf8'))
profileManifest.pnpm={...profileManifest.pnpm,overrides:manifest.overrides}
await writeFile(join(profileRoot,'package.json'),JSON.stringify(profileManifest,null,2)+'\n')
await writeFile(join(profileRoot,'.npmrc'),'package-import-method=copy\nstore-dir='+join(root,'.test-artifacts','pnpm-store').replaceAll('\\','/')+'\ncache-dir='+join(root,'.test-artifacts','pnpm-cache').replaceAll('\\','/')+'\n')
let pnpm
find:for(const dir of(process.env.PATH??'').split(';'))for(const candidate of[join(dir,'pnpm.cjs'),join(dir,'node_modules','pnpm','bin','pnpm.cjs'),join(dir,'node_modules','corepack','dist','pnpm.js')]){try{await realpath(candidate);pnpm=candidate;break find}catch(error){if(error.code!=='ENOENT')throw error}}
assert.ok(pnpm,'pnpm is required for an isolated profile')
const peers=Object.entries(manifest.peerDependencies).filter(([name])=>name!=='dsh-im-kit').map(([name,version])=>name+'@'+version)
await run(process.execPath,[pnpm,'add',archives[0].path,'@deepseek-ai/dsh@0.2.2-rc.1',...peers,'--ignore-scripts'],profileRoot)
await run(process.execPath,[dsh,'plugin','--profile',profile,'add',archives[1].path],area)
const installedFiles=await verifyInstalledArchive(archives[1].path,join(profileRoot,'node_modules','dsh-qq-chat'),join(attempt,'installed-files.json'))
const overlay=[
 {id:'qq-chat-runtime',config:{enabled:false,namespace:'web-'+basename(attempt).toLowerCase(),databasePath:join(attempt,'state.sqlite3'),workspacePath:join(attempt,'workspace'),presetId:'web-chat-fixture',provider:'deepseek-official',model:'deepseek-flash',reasoningEffort:'off',maxTokens:128}},
 {id:'qq-chat-control',config:{statusRefreshMs:250}},
 {id:'session-title-llm',disabled:true},{id:'session-telemetry-otel',disabled:true},
 {insert:[{id:'web-chat-fixture',name:'@deepseek-ai/dsh-agent-preset',config:{id:'web-chat-fixture',plugins:[]}}]},
]
await writeFile(join(profileRoot,'cordis.patch.yml'),JSON.stringify(overlay,null,2)+'\n')
const profileDsh=join(profileRoot,'node_modules','@deepseek-ai','dsh','lib','bin.js')
const child=spawn(process.execPath,[profileDsh,'--profile',profile,'--host','127.0.0.1','--port','0','--no-open'],{cwd:area,env,windowsHide:true,stdio:['pipe','pipe','pipe']})
let stdout='',stderr='',exitCode,context,page,origin
const errors=[],consoleErrors=[],checks=[]
const exit=once(child,'close').then(([code,signal])=>{exitCode=code;return{code,signal}})
const ready=new Promise((resolve,reject)=>{
 const timer=setTimeout(()=>reject(Error('Isolated DSH Web did not become ready')),60000)
 const inspect=()=>{const match=(stdout+'\n'+stderr).match(/https?:\/\/127\.0\.0\.1:\d+[^\s\u001b]*/);if(match){clearTimeout(timer);resolve(match[0])}}
 child.stdout.on('data',part=>{stdout+=part;inspect()});child.stderr.on('data',part=>{stderr+=part;inspect()})
 void exit.then(()=>{clearTimeout(timer);reject(Error('Isolated Web exited before ready: '+stderr.slice(-1200)))})
})
try{
 const login=await ready;origin=new URL(login).origin
 await mkdir(join(attempt,'temp'),{recursive:true})
 context=await chromium.launchPersistentContext(join(attempt,'browser-profile'),{headless:true,viewport:{width:1280,height:1000},locale:'zh-CN',colorScheme:'light',downloadsPath:join(attempt,'downloads'),env:{...env,TEMP:join(attempt,'temp'),TMP:join(attempt,'temp')}})
 await context.route('**/*',route=>{const url=new URL(route.request().url());return url.origin===origin||['data:','blob:'].includes(url.protocol)?route.continue():route.abort()})
 await context.addInitScript(()=>{
  window.__chatQaHmr=[]
  const Source=window.EventSource
  window.EventSource=class extends Source{
   constructor(...options){super(...options);this.addEventListener('message',event=>{
    try{const frame=JSON.parse(event.data);if(frame.type==='rebuilt')window.__chatQaHmr.push({type:frame.type,id:frame.id,rev:frame.rev});else if(frame.type==='graph')window.__chatQaHmr.push({type:frame.type,entries:frame.graph?.entries?.map(row=>({id:row.id,rev:row.rev}))})}catch(error){/* Non-plugin SSE messages are not part of this diagnostic. */}
   })}
  }
  let loader;Object.defineProperty(window,'__ModuleLoader__',{configurable:true,get:()=>loader,set:value=>{loader=value;const create=value.create;value.create=function(options){const modules=create.call(this,options);window.__chatQaModules=modules;return modules}}})
 })
 page=context.pages()[0]??await context.newPage();page.setDefaultTimeout(15000)
 page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(['error','warning'].includes(message.type()))consoleErrors.push(message.type()+': '+message.text().slice(0,1600))})
 await page.goto(login,{waitUntil:'domcontentloaded'})
 await page.getByRole('button',{name:/^继续$|^Continue$/}).click({timeout:20000})
 await page.getByRole('button',{name:/^插件$|^Plugins$/}).first().click({timeout:20000})
 await page.getByText('dsh-qq-chat',{exact:true}).first().click()
 const form=page.locator('.qqchat-page')
 await form.getByText(/自动聊天未启用|Automatic chat is disabled/).waitFor()
 checks.push('native-page-loaded-while-chat-disabled')
 const siblingIndex=args.indexOf('--mutate-sibling-profile')
 let dependencyIsolation
 if(siblingIndex>=0){
  const sibling=await realpath(args[siblingIndex+1]),relativeSibling=relative(runs,sibling)
  assert.ok(!relativeSibling.startsWith('..')&&!isAbsolute(relativeSibling),'Sibling profile escaped this repository Web tests')
  const bundle=join(profileRoot,'node_modules','@deepseek-ai','dsh-client-ui-session','lib','client.js'),oldBundle=join(sibling,'node_modules','@deepseek-ai','dsh-client-ui-session','lib','client.js')
  const before=await stat(bundle),sharedBefore=await stat(oldBundle),temporary=join(attempt,'sibling-test-link.js')
  assert.equal(before.nlink,1,'Web test dependencies must be copied rather than shared hard links')
  await link(oldBundle,temporary);await unlink(temporary)
  const after=await stat(bundle),sharedAfter=await stat(oldBundle)
  assert.equal(before.ctimeMs,after.ctimeMs);assert.notEqual(sharedBefore.ctimeMs,sharedAfter.ctimeMs)
  dependencyIsolation={packageImportMethod:'copy',sessionBundleLinkCount:after.nlink,siblingCtimeChanged:true,ownCtimeUnchanged:true}
  checks.push('sibling-hardlink-mutation-does-not-change-copied-client-artifact')
 }
 if(args.includes('--diagnose-shared-link')){
  const source=join(profileRoot,'node_modules','@deepseek-ai','dsh-client-ui-session','lib','client.js'),temporary=join(attempt,'temporary-ui-session-link.js')
  const before=await stat(source),hash=createHash('sha256').update(await readFile(source)).digest('hex')
  await link(source,temporary);await unlink(temporary)
  const after=await stat(source),deadline=Date.now()+10000
  while(Date.now()<deadline&&!errors.length)await delay(100)
  const hmr=await page.evaluate(()=>window.__chatQaHmr)
  const result={diagnostic:true,bytesUnchanged:hash===createHash('sha256').update(await readFile(source)).digest('hex'),before:{nlink:before.nlink,ctimeMs:before.ctimeMs},after:{nlink:after.nlink,ctimeMs:after.ctimeMs},hmr,clientErrors:errors,consoleErrorCount:consoleErrors.length,realQqMessagesSent:0}
  await writeFile(join(attempt,'shared-link-diagnostic.json'),JSON.stringify(result,null,2)+'\n')
  console.log(JSON.stringify({area,attempt,diagnostic:true,bytesUnchanged:result.bytesUnchanged,rebuiltEvents:hmr.filter(frame=>frame.type==='rebuilt').map(frame=>frame.id),clientErrors:errors,realQqMessagesSent:0}))
  assert.equal(result.bytesUnchanged,true);assert.ok(hmr.some(frame=>frame.type==='rebuilt'&&frame.id==='@deepseek-ai/dsh-client-ui-session'))
 }else{
 await form.getByRole('switch',{name:/启用自动聊天|Enable automatic chat/}).click()
 await form.getByRole('button',{name:/^保存并应用$|^Save and apply$/}).click()
 await form.getByText(/已保存配置正在运行|Saved settings are running/).waitFor()
 assert.equal(captures.length,0)
 checks.push('native-save-activates-without-qq-or-model-probe')
 await form.getByLabel(/^模型（空为沿用宿主）$|^Model \(empty: inherit\)$/).fill('')
 await form.getByRole('button',{name:/^保存并应用$|^Save and apply$/}).click()
 await form.locator('[aria-invalid="true"]').waitFor()
 assert.equal(await form.getByLabel(/^模型（空为沿用宿主）$|^Model \(empty: inherit\)$/).inputValue(),'')
 await form.getByRole('button',{name:/放弃修改|Discard changes/}).click()
 checks.push('invalid-model-pair-keeps-draft-and-running-chat')
 await form.getByLabel(/输出 Token 上限|Output token cap/).fill('256')
 await form.getByRole('button',{name:/刷新状态|Refresh status/}).click()
 await form.getByText(/有未保存的修改|Unsaved changes/).waitFor()
 assert.equal(await form.getByLabel(/输出 Token 上限|Output token cap/).inputValue(),'256')
 await form.getByRole('button',{name:/放弃修改|Discard changes/}).click()
 checks.push('native-refresh-retains-unsaved-draft')
 const inputText=form.getByLabel(/^试用消息$|^Preview message$/)
 await inputText.fill('UI_PREVIEW_GOOD')
 await form.getByRole('button',{name:/开始本地试用|Run local preview/}).click()
 await form.getByText('WEB_CAPTURED_REPLY_1',{exact:true}).waitFor()
 assert.equal(captures.length,1);assert.equal(captures[0].tools?.length??0,0)
 checks.push('native-local-preview-through-dsh-model-and-final-outbound')
 await inputText.fill('NATIVE_PREVIEW_HOLD')
 await form.getByRole('button',{name:/开始本地试用|Run local preview/}).click()
 const deadline=Date.now()+10000;while(captures.length<2){assert.ok(Date.now()<deadline);await delay(20)}
 await form.getByRole('button',{name:/取消试用|Cancel preview/}).click()
 await form.getByText(/结果：已取消|Result cancelled/).waitFor()
 const idle=Date.now()+5000;while(active){assert.ok(Date.now()<idle);await delay(20)}
 await inputText.fill('UI_AFTER_CANCEL')
 await form.getByRole('button',{name:/开始本地试用|Run local preview/}).click()
 await form.getByText('WEB_CAPTURED_REPLY_3',{exact:true}).waitFor()
 checks.push('native-preview-cancel-and-following-preview-recover')
 await page.setViewportSize({width:1280,height:1700});await form.evaluate(element=>element.scrollIntoView({block:'start'}));await page.screenshot({path:join(attempt,'light.png'),fullPage:true})
 await page.emulateMedia({colorScheme:'dark'});await page.screenshot({path:join(attempt,'dark.png'),fullPage:true})
 await page.getByRole('button',{name:/^收起侧边栏$|^Collapse sidebar$/}).click()
 await page.setViewportSize({width:520,height:1700});await form.evaluate(element=>element.scrollIntoView({block:'start'}))
 assert.ok(await form.evaluate(element=>element.scrollWidth<=element.clientWidth+2),'Chat page overflows a narrow viewport')
 assert.ok(await form.evaluate(element=>[...element.querySelectorAll('input,select,textarea')].filter(input=>input.getClientRects().length).every(input=>{const rect=input.getBoundingClientRect();return rect.left>=0&&rect.right<=innerWidth})),'Visible chat field is outside viewport')
 await page.screenshot({path:join(attempt,'narrow.png'),fullPage:true});checks.push('native-light-dark-and-narrow-page')
 await page.setViewportSize({width:1280,height:1000});await page.getByRole('button',{name:/^打开侧边栏$|^Open sidebar$/}).click()
 await page.reload({waitUntil:'domcontentloaded'})
 await page.getByRole('button',{name:/^插件$|^Plugins$/}).first().click({timeout:20000});await page.getByText('dsh-qq-chat',{exact:true}).first().click()
 await form.getByText(/已保存配置正在运行|Saved settings are running/).waitFor()
 await inputText.fill('UI_AFTER_BROWSER_RELOAD');await form.getByRole('button',{name:/开始本地试用|Run local preview/}).click()
 await form.getByText('WEB_CAPTURED_REPLY_4',{exact:true}).waitFor()
 assert.ok(JSON.stringify(captures[3].messages).includes('UI_PREVIEW_GOOD'))
 checks.push('browser-reload-preserves-settings-and-preview-history')
 await form.getByRole('button',{name:/按已保存配置重启|Restart saved configuration/}).click()
 await page.getByText(/^聊天运行时已重启$|^Chat runtime restarted$/).waitFor()
 await form.getByRole('switch',{name:/启用自动聊天|Enable automatic chat/}).click();await form.getByRole('button',{name:/^保存并应用$|^Save and apply$/}).click()
 await form.getByText(/自动聊天未启用|Automatic chat is disabled/).waitFor();checks.push('restart-and-disable-keep-native-control-page')
 assert.deepEqual(errors,[]);assert.deepEqual(consoleErrors,[]);assert.equal(captures.length,4)
 const hmr=await page.evaluate(()=>window.__chatQaHmr??[])
 await writeFile(join(attempt,'result.json'),JSON.stringify({passed:true,checks,installedFilesVerified:installedFiles,nativeAdapterRequests:captures.length,clientErrors:errors,consoleErrors,dependencyIsolation,hmr,qqMessagesSent:0,realModelApiRequests:0,modelBackend:'native Messages adapter to synthetic loopback HTTP'},null,2)+'\n')
 console.log(JSON.stringify({area,attempt,passed:true,checks,nativeAdapterRequests:captures.length,qqMessagesSent:0}))
 }
}catch(error){
 if(page)await page.screenshot({path:join(attempt,'failure.png'),fullPage:true}).catch(()=>{})
 const boot=await page?.evaluate(()=>({entries:window.__DSH_BOOT__?.entries?.filter(row=>row.id==='dsh-qq-chat').map(row=>({id:row.id,inject:row.inject})),state:window.__chatQaModules?.entries.state.getSnapshot(),exports:Object.keys(window.__chatQaModules?.loadCache.get('dsh-qq-chat')?.exports??{}),style:document.querySelectorAll('style[data-qq-chat]').length,text:document.body.innerText.slice(-1800)})).catch(()=>null)
 const hmr=await page?.evaluate(()=>window.__chatQaHmr??[]).catch(()=>[])
 await writeFile(join(attempt,'result.json'),JSON.stringify({passed:false,checks,error:{message:error.message,stack:error.stack},clientErrors:errors,consoleErrors,boot,hmr},null,2)+'\n');throw error
}finally{
 await context?.close()
 if(exitCode===undefined){child.kill('SIGINT');const fallback=setTimeout(()=>child.kill(),5000);await exit;clearTimeout(fallback)}
 await new Promise(resolve=>model.close(resolve))
 const redact=text=>text.replace(/https?:\/\/127\.0\.0\.1:\d+[^\s\u001b]*/g,url=>new URL(url).origin+'/<auth-redacted>')
 await writeFile(join(attempt,'process.json'),JSON.stringify({stdout:redact(stdout),stderr:redact(stderr),exitCode},null,2)+'\n')
 await writeFile(join(attempt,'model-metadata.json'),JSON.stringify({requests:captures.length,active,models:captures.map(body=>body.model),messageCounts:captures.map(body=>body.messages.length)},null,2)+'\n')
}
