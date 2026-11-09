/** Installed-tarball DSH test with a real native model adapter and a synthetic HTTP endpoint. */
import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {once} from 'node:events'
import {createServer} from 'node:http'
import {mkdir,mkdtemp,readFile,writeFile,realpath,copyFile} from 'node:fs/promises'
import {fileURLToPath,pathToFileURL} from 'node:url'
import {join,relative,isAbsolute,basename,delimiter} from 'node:path'
import {createWriteStream} from 'node:fs'
import {createHash} from 'node:crypto'
import {verifyInstalledArchive} from './verify-installed.mjs'
import {imKitArchive} from './inputs.mjs'
import {pnpmScript} from './pnpm.mjs'
import {fixtureMarker} from './fixture-marker.mjs'
import {parse} from 'yaml'
import {setTimeout as delay} from 'node:timers/promises'
const root=fileURLToPath(new URL('../../',import.meta.url)),dsh=join(root,'node_modules','@deepseek-ai','dsh','lib','bin.js')
const args=process.argv
const library=await imKitArchive(),manifest=JSON.parse(await readFile(join(root,'package.json'),'utf8'))
await mkdir(join(root,'.test-artifacts','native'),{recursive:true})
const resumeIndex=args.indexOf('--resume-run')
const resumed=resumeIndex>=0
const area=resumed?await realpath(args[resumeIndex+1]):await mkdtemp(join(root,'.test-artifacts','native','install-'))
const areaRelative=relative(join(root,'.test-artifacts','native'),area)
assert.ok(!isAbsolute(areaRelative)&&!areaRelative.startsWith('..'),'Resume target must stay in this repository native-test directory')
const attempt=await mkdtemp(join(area,'attempt-'))
const home=join(area,'home'),profile='qq-chat-native',profileRoot=join(home,'profiles',profile)
const archives=[]
const override=args.indexOf('--chat-archive'),chatArchive=override>=0?await realpath(args[override+1]):join(root,'artifacts',manifest.name+'-'+manifest.version+'.tgz')
for(const path of [library,chatArchive]){
 const name=path.split(/[\\/]/).at(-1),target=join(attempt,name);await copyFile(path,target)
 archives.push({path:target,name,sha256:createHash('sha256').update(await readFile(target)).digest('hex')})
}
await writeFile(join(attempt,'inputs.json'),JSON.stringify(archives.map(({name,sha256})=>({name,sha256})),null,2)+'\n')
const captures=[];let active=0,peak=0,catalogReads=0
const server=createServer(async(request,response)=>{
 if(request.url==='/fixture/status'){response.setHeader('Content-Type','application/json');response.end(JSON.stringify({requests:captures.length,active}));return}
 if(request.url?.endsWith('/models')){catalogReads++;response.setHeader('Content-Type','application/json');response.end(JSON.stringify({object:'list',data:[{id:'deepseek-flash',object:'model',owned_by:'fixture',input_modalities:['text'],output_modalities:['text'],api_capabilities:{anthropic_messages:{}}}]}));return}
 if(!request.url?.endsWith('/messages')){response.statusCode=404;response.end();return}
 let raw='';for await(const chunk of request)raw+=chunk
 const data=JSON.parse(raw);captures.push(data);const serial=captures.length;active++;peak=Math.max(peak,active)
 const closed=new AbortController();response.once('close',()=>closed.abort())
 try{
 response.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache'})
 const marker=fixtureMarker(data)
 await delay(marker==='NATIVE_PREVIEW_HOLD'?30000:30,undefined,{signal:closed.signal})
 const send=(type,payload)=>response.write('event: '+type+'\ndata: '+JSON.stringify({type,...payload})+'\n\n')
 send('message_start',{message:{id:'fixture-'+serial,type:'message',role:'assistant',model:data.model,content:[],stop_reason:null,stop_sequence:null,usage:{input_tokens:10,output_tokens:0}}})
 if(marker==='NATIVE_TOOL_REQUEST'){
  send('content_block_start',{index:0,content_block:{type:'tool_use',id:'fixture-call-'+serial,name:'fixture_echo',input:{}}})
  send('content_block_delta',{index:0,delta:{type:'input_json_delta',partial_json:JSON.stringify({text:'synthetic'})}})
  send('content_block_stop',{index:0})
  send('message_delta',{delta:{stop_reason:'tool_use',stop_sequence:null},usage:{output_tokens:10}})
  send('message_stop',{});response.end();return
 }
 send('content_block_start',{index:0,content_block:{type:'thinking',thinking:'',signature:''}})
 send('content_block_delta',{index:0,delta:{type:'thinking_delta',thinking:'SYNTHETIC_REASONING_NOT_FOR_DELIVERY'}})
 send('content_block_delta',{index:0,delta:{type:'signature_delta',signature:'synthetic-local-signature'}})
 send('content_block_stop',{index:0})
 send('content_block_start',{index:1,content_block:{type:'text',text:''}})
 send('content_block_delta',{index:1,delta:{type:'text_delta',text:'NATIVE_REPLY_'+serial}})
 send('content_block_stop',{index:1})
 send('message_delta',{delta:{stop_reason:'end_turn',stop_sequence:null},usage:{output_tokens:10}})
 send('message_stop',{});response.end()
 }catch(error){if(!closed.signal.aborted)response.destroy(error)}finally{active--}
})
server.listen(0,'127.0.0.1');await once(server,'listening');server.unref()
const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!/KEY|SECRET|TOKEN|PASSWORD/i.test(key)&&key.toUpperCase()!=='PATH'))
Object.assign(env,{PATH:join(root,'node_modules','.bin')+delimiter+(process.env.PATH??process.env.Path??''),DSH_PRIMARY_RUNTIME:''})
await mkdir(join(attempt,'temp'),{recursive:true});Object.assign(env,{TEMP:join(attempt,'temp'),TMP:join(attempt,'temp')})
Object.assign(env,{DSH_HOME:home,DSH_SYSTEM_PROMPT:'Synthetic native chat integration fixture. No private persona or skills.',DEEPSEEK_API_KEY:'synthetic-local-only',DEEPSEEK_BASE_URL:'http://127.0.0.1:'+server.address().port+'/anthropic'})
const records=[]
async function run(command,arguments_,cwd){
 const deadline=AbortSignal.timeout(300000),log=createWriteStream(join(attempt,'setup-'+records.length+'.log'))
 const child=spawn(command,arguments_,{cwd,env,windowsHide:true,signal:deadline,stdio:['ignore','pipe','pipe']})
 await writeFile(join(attempt,'setup-live.json'),JSON.stringify({pid:child.pid,args:arguments_,startedAt:new Date().toISOString()})+'\n')
 let stdout='',stderr='',failure;child.stdout.on('data',data=>{stdout+=data;log.write(data)});child.stderr.on('data',data=>{stderr+=data;log.write(data)});child.once('error',error=>{failure=error})
 const [code,signal]=await new Promise(resolve=>child.once('close',(...values)=>resolve(values)))
 await new Promise(resolve=>log.end(resolve))
 records.push({args:arguments_,code,signal,timedOut:deadline.aborted,stdout,stderr})
 await writeFile(join(attempt,'installation.json'),JSON.stringify(records,null,2)+'\n')
 if(failure)throw failure;assert.equal(deadline.aborted,false,'Setup command timed out');assert.equal(code,0,stderr.slice(-1500));return stdout
}
const composition=resumed?'':await run(process.execPath,[dsh,'--profile',profile,'--from-default-profile','sdk','--dump-config'],area)
const profileManifest=JSON.parse(await readFile(join(profileRoot,'package.json'),'utf8'))
profileManifest.pnpm={...profileManifest.pnpm,overrides:manifest.overrides}
await writeFile(join(profileRoot,'package.json'),JSON.stringify(profileManifest,null,2)+'\n')
await writeFile(join(profileRoot,'.npmrc'),'package-import-method=copy\nstore-dir='+join(root,'.test-artifacts','pnpm-store').replaceAll('\\','/')+'\ncache-dir='+join(root,'.test-artifacts','pnpm-cache').replaceAll('\\','/')+'\n')
const pnpm=await pnpmScript(root)
const peers=Object.entries(manifest.peerDependencies).filter(([name])=>name!=='dsh-im-kit').map(([name,version])=>name+'@'+version)
await run(process.execPath,[pnpm,'add','@deepseek-ai/dsh@0.2.2-rc.1','@deepseek-ai/dsh-llm-deepseek-api-key@0.2.2-rc.1',...peers,'--ignore-scripts'],profileRoot)
await run(process.execPath,[dsh,'plugin','--profile',profile,'add',archives[1].path],area)
const installedFiles=await verifyInstalledArchive(archives[1].path,join(profileRoot,'node_modules','dsh-qq-chat'),join(attempt,'installed-files.json'))
const overlay=[{id:'qq-chat-runtime',config:{enabled:true,namespace:'native-'+basename(attempt).toLowerCase(),databasePath:join(attempt,'state.sqlite3'),workspacePath:join(attempt,'workspace'),presetId:'chat-fixture',provider:'deepseek-official',model:'deepseek-flash',reasoningEffort:'off',maxTokens:128,sessionIdleMs:200}},
 {insert:[...composition.includes('@deepseek-ai/dsh-agent-preset-registry')?[]:[{id:'chat-fixture-preset-registry',name:'@deepseek-ai/dsh-agent-preset-registry',config:{default:'chat-fixture'}}],{id:'chat-fixture-preset',name:'@deepseek-ai/dsh-agent-preset',config:{id:'chat-fixture',plugins:[{id:'scoped-echo',name:pathToFileURL(fileURLToPath(new URL('./native-tool-fixture.mjs',import.meta.url))).href}]}},
  {id:'chat-fixture-transport',name:pathToFileURL(fileURLToPath(new URL('./native-fixture.mjs',import.meta.url))).href},
  {id:'chat-fixture-probe',name:pathToFileURL(fileURLToPath(new URL('./native-probe.mjs',import.meta.url))).href,config:{resultPath:join(attempt,'result.json'),observationUrl:'http://127.0.0.1:'+server.address().port+'/fixture/status',scopeModuleUrl:pathToFileURL(join(profileRoot,'node_modules','@deepseek-ai','dsh-scope','lib','index.js')).href}}]}]
await writeFile(join(profileRoot,'cordis.patch.yml'),JSON.stringify(overlay,null,2)+'\n')
const profileDsh=join(profileRoot,'node_modules','@deepseek-ai','dsh','lib','bin.js')
const child=spawn(process.execPath,[profileDsh,'--profile',profile],{cwd:area,env,windowsHide:true,stdio:['pipe','pipe','pipe']})
let stdout='',stderr='',exitCode,result
child.stdout.on('data',data=>{stdout+=data});child.stderr.on('data',data=>{stderr+=data})
const exit=once(child,'close').then(([code,signal])=>{exitCode=code;return{code,signal}})
try{
 const deadline=Date.now()+60000
 while(Date.now()<deadline){
  try{result=JSON.parse(await readFile(join(attempt,'result.json'),'utf8'));break}catch(error){if(error.code!=='ENOENT')throw error}
  assert.equal(exitCode,undefined,'Native DSH exited before the probe');await delay(30)
 }
 assert.ok(result,'Native chat probe timed out');assert.equal(result.passed,true,JSON.stringify(result.error))
 assert.equal(captures.length,22)
 const text=value=>JSON.stringify(value.messages)
 assert.ok(text(captures[1]).includes('NATIVE_FIRST_QUESTION')&&text(captures[1]).includes('NATIVE_REPLY_1'))
 assert.ok(text(captures[2]).includes('NATIVE_FIRST_QUESTION')&&text(captures[2]).includes('NATIVE_AFTER_RELOAD'))
 for(const data of captures.filter(data=>/NATIVE_GROUP_TWO|NATIVE_GROUP_THREE|NATIVE_LOCAL_PREVIEW/.test(text(data))))assert.ok(!text(data).includes('NATIVE_FIRST_QUESTION'))
 const afterIdle=captures.find(data=>JSON.stringify(data.messages.at(-1)?.content).includes('NATIVE_AFTER_IDLE'))
 assert.ok(afterIdle&&text(afterIdle).includes('NATIVE_FIRST_QUESTION'))
 const isolatedFirst=captures.find(data=>JSON.stringify(data.messages.at(-1)?.content).includes('NATIVE_ISOLATE_A_FIRST'))
 const isolatedOther=captures.find(data=>JSON.stringify(data.messages.at(-1)?.content).includes('NATIVE_ISOLATE_B_FIRST'))
 const isolatedAgain=captures.find(data=>JSON.stringify(data.messages.at(-1)?.content).includes('NATIVE_ISOLATE_A_AGAIN'))
 assert.ok(isolatedFirst&&isolatedOther&&isolatedAgain)
 assert.ok(!text(isolatedFirst).includes('NATIVE_FIRST_QUESTION'))
 assert.ok(!text(isolatedOther).includes('NATIVE_ISOLATE_A_FIRST'))
 assert.ok(text(isolatedAgain).includes('NATIVE_ISOLATE_A_FIRST')&&!text(isolatedAgain).includes('NATIVE_ISOLATE_B_FIRST'))
 assert.ok(peak>=2)
 child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:1,method:'shutdown',params:{}})+'\n')
 const stopped=await Promise.race([exit,delay(15000).then(()=>{throw Error('Native shutdown did not settle')})])
 assert.deepEqual(stopped,{code:0,signal:null})
 const journalPath=join(attempt,'state.sqlite3'),journalHash=createHash('sha256').update(await readFile(journalPath)).digest('hex')
 const names=value=>Array.isArray(value)?value.flatMap(names):value&&typeof value==='object'?[...typeof value.name==='string'?[value.name]:[],...Object.values(value).flatMap(names)]:[]
 await run(process.execPath,[profileDsh,'plugin','--profile',profile,'remove',manifest.name],area)
 const removed=JSON.parse(await readFile(join(profileRoot,'package.json'),'utf8'))
 assert.equal(removed.dependencies?.[manifest.name],undefined)
 const yamlOptions={customTags:[{tag:'tag:yaml.org,2002:js',resolve:value=>value}]}
 const without=names(parse(await run(process.execPath,[profileDsh,'--profile',profile,'--dump-config'],area),yamlOptions))
 assert.ok(!without.includes('dsh-qq-chat')&&!without.includes('dsh-qq-chat/control'),'Removed bundle still appears in compiled configuration')
 assert.equal(createHash('sha256').update(await readFile(journalPath)).digest('hex'),journalHash,'Removal changed retained sources')
 await run(process.execPath,[profileDsh,'plugin','--profile',profile,'add',archives[1].path],area)
 await verifyInstalledArchive(archives[1].path,join(profileRoot,'node_modules','dsh-qq-chat'),join(attempt,'reinstalled-files.json'))
 const restored=names(parse(await run(process.execPath,[profileDsh,'--profile',profile,'--dump-config'],area),yamlOptions))
 assert.ok(restored.includes('dsh-qq-chat')&&restored.includes('dsh-qq-chat/control'),'Reinstalled bundle is absent from compiled configuration')
 assert.equal(createHash('sha256').update(await readFile(journalPath)).digest('hex'),journalHash,'Reinstallation changed retained sources')
 result.checks.push('native-cli-removal-and-reinstallation-preserve-durable-journal')
 await writeFile(join(attempt,'summary.json'),JSON.stringify({passed:true,archives:archives.map(({name,sha256})=>({name,sha256})),installedFilesVerified:installedFiles,checks:result.checks,nativeAdapterRequests:captures.length,peakConcurrentRequests:peak,catalogReads,sameSessionHistory:true,reloadHistory:true,scopeIsolation:true,normalShutdown:true,runtimeInSameInstallationGraph:true,modelBackend:'synthetic loopback Messages HTTP through the native DeepSeek adapter',realModelApiRequests:0,realQqMessagesSent:0},null,2)+'\n')
 console.log(JSON.stringify({area,attempt,passed:true,checks:result.checks,nativeAdapterRequests:captures.length,peak,realQqMessagesSent:0}))
}finally{
 if(exitCode===undefined){child.stdin.end();const timer=setTimeout(()=>child.kill(),5000);await exit;clearTimeout(timer)}
 await new Promise(resolve=>server.close(resolve))
 await writeFile(join(attempt,'process.json'),JSON.stringify({stdout,stderr,exitCode},null,2)+'\n')
 await writeFile(join(attempt,'installation.json'),JSON.stringify(records,null,2)+'\n')
 await writeFile(join(attempt,'model-metadata.json'),JSON.stringify({requests:captures.length,peakConcurrent:peak,catalogReads,models:captures.map(data=>data.model),messageCounts:captures.map(data=>data.messages?.length),fixtureMarkers:captures.map(data=>fixtureMarker(data)??null),syntheticUserMarkers:captures.map(data=>data.messages?.filter(message=>message.role==='user').map(message=>({kinds:Array.isArray(message.content)?message.content.map(block=>block.type):typeof message.content,markers:JSON.stringify(message.content).match(/(?:NATIVE_|UI_)[A-Z_]+/g)??[]}))??[]),toolDeclarations:captures.map(data=>data.tools?.map(tool=>tool.name)??[]),toolResults:captures.map(data=>data.messages?.at(-1)?.content?.filter?.(part=>part.type==='tool_result').map(part=>({isError:part.is_error,content:part.content}))??[])},null,2)+'\n')
}
