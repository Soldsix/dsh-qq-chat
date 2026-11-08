/** Install the released OneBot provider and exercise actual loopback frames through native DSH chat. */
import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {once} from 'node:events'
import {createServer} from 'node:http'
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises'
import {join,delimiter} from 'node:path'
import {fileURLToPath,pathToFileURL} from 'node:url'
import {setTimeout as delay} from 'node:timers/promises'
import {WebSocketServer} from 'ws'
import {pnpmScript} from './pnpm.mjs'
import {verifyInstalledArchive} from './verify-installed.mjs'
const root=fileURLToPath(new URL('../../',import.meta.url)),manifest=JSON.parse(await readFile(join(root,'package.json'),'utf8'))
const runs=join(root,'.test-artifacts','onebot-composition');await mkdir(runs,{recursive:true})
const area=await mkdtemp(join(runs,'run-')),home=join(area,'home'),profile='chat-onebot-composition',profileRoot=join(home,'profiles',profile),dsh=join(root,'node_modules','@deepseek-ai','dsh','lib','bin.js')
const env={...Object.fromEntries(Object.entries(process.env).filter(([key])=>!/KEY|SECRET|TOKEN|PASSWORD/i.test(key)&&key.toUpperCase()!=='PATH')),PATH:join(root,'node_modules','.bin')+delimiter+(process.env.PATH??process.env.Path??''),DSH_HOME:home,DSH_PRIMARY_RUNTIME:'',DSH_SYSTEM_PROMPT:'Synthetic OneBot composition fixture.',DEEPSEEK_API_KEY:'synthetic-no-external-model',ONEBOT_ACCESS_TOKEN:'composition-token'}
const setup=[]
async function run(argv,cwd){const deadline=AbortSignal.timeout(300000),child=spawn(process.execPath,argv,{cwd,env,windowsHide:true,signal:deadline,stdio:['ignore','pipe','pipe']});let output='',failure;child.stdout.on('data',p=>output+=p);child.stderr.on('data',p=>output+=p);child.once('error',error=>{failure=error});const [code,signal]=await once(child,'close');setup.push({argv,code,signal,outputBytes:Buffer.byteLength(output)});await writeFile(join(area,'setup.json'),JSON.stringify(setup,null,2)+'\n');assert.equal(deadline.aborted,false);if(failure)throw failure;assert.equal(code,0,output.slice(-2000));return output}
const composition=await run([dsh,'--profile',profile,'--from-default-profile','sdk','--dump-config'],area)
const packagePath=join(profileRoot,'package.json'),config=JSON.parse(await readFile(packagePath,'utf8'));config.pnpm={...config.pnpm,overrides:manifest.overrides};await writeFile(packagePath,JSON.stringify(config,null,2)+'\n')
await writeFile(join(profileRoot,'.npmrc'),'package-import-method=copy\nstore-dir='+join(root,'.test-artifacts','pnpm-store').replaceAll('\\','/')+'\ncache-dir='+join(root,'.test-artifacts','pnpm-cache').replaceAll('\\','/')+'\n')
const pnpm=await pnpmScript(root),peers=Object.entries(manifest.peerDependencies).map(([name,version])=>name+'@'+version)
await run([pnpm,'add','@deepseek-ai/dsh@0.2.2-rc.1','@deepseek-ai/dsh-llm-deepseek-api-key@0.2.2-rc.1',...peers,'--ignore-scripts'],profileRoot)
await run([dsh,'plugin','--profile',profile,'add','https://github.com/Soldsix/dsh-qq-onebot/releases/download/v0.2.1/dsh-qq-onebot-0.2.1.tgz'],area)
const archive=join(root,'artifacts',manifest.name+'-'+manifest.version+'.tgz');await run([dsh,'plugin','--profile',profile,'add',archive],area)
const installedFiles=await verifyInstalledArchive(archive,join(profileRoot,'node_modules','dsh-qq-chat'),join(area,'installed-files.json'))
const current=JSON.parse(await readFile(packagePath,'utf8'));assert.equal(current.dependencies?.['dsh-im-kit'],undefined)
const captures=[],outgoing=[],actions=[],peersConnected=[]
const model=createServer(async(request,response)=>{
 if(request.url?.endsWith('/models')){response.setHeader('Content-Type','application/json');response.end(JSON.stringify({data:[{id:'deepseek-flash',object:'model',owned_by:'fixture'}]}));return}
 if(!request.url?.endsWith('/messages')){response.statusCode=404;response.end();return}
 let raw='';for await(const p of request)raw+=p;const body=JSON.parse(raw);captures.push(body)
 const serial=captures.length,text='COMPOSITION_REPLY_'+serial,send=(type,data)=>response.write('event: '+type+'\ndata: '+JSON.stringify({type,...data})+'\n\n')
 response.writeHead(200,{'Content-Type':'text/event-stream'});send('message_start',{message:{id:'composition-'+serial,type:'message',role:'assistant',model:body.model,content:[],stop_reason:null,stop_sequence:null,usage:{input_tokens:10,output_tokens:0}}});send('content_block_start',{index:0,content_block:{type:'text',text:''}});send('content_block_delta',{index:0,delta:{type:'text_delta',text}});send('content_block_stop',{index:0});send('message_delta',{delta:{stop_reason:'end_turn',stop_sequence:null},usage:{output_tokens:10}});send('message_stop',{});response.end()
})
model.listen(0,'127.0.0.1');await once(model,'listening');model.unref()
const ws=new WebSocketServer({host:'127.0.0.1',port:0});await once(ws,'listening')
ws.on('connection',(peer,request)=>{assert.equal(request.headers.authorization,'Bearer composition-token');peersConnected.push(peer);peer.on('message',raw=>{const frame=JSON.parse(raw.toString());actions.push(frame.action);let data={};if(frame.action==='get_login_info')data={user_id:90000001};else if(frame.action==='get_status')data={online:true,good:true};else if(frame.action==='get_group_member_info')data={user_id:90000001,role:'member',shut_up_timestamp:0};else if(frame.action==='send_group_msg'){outgoing.push(frame.params);data={message_id:600+outgoing.length}}peer.send(JSON.stringify({status:'ok',retcode:0,data,echo:frame.echo}))})})
env.DEEPSEEK_BASE_URL='http://127.0.0.1:'+model.address().port+'/anthropic'
const readyPath=join(area,'ready.json'),resultPath=join(area,'result.json')
const overlay=[{id:'qq-onebot-transport',config:{enabled:true,tenantId:'composition',accountId:'90000001',allowedGroups:['90000100'],forwardUrl:'ws://127.0.0.1:'+ws.address().port}},{id:'qq-chat-runtime',config:{enabled:true,presetId:'composition-preset',provider:'deepseek-official',model:'deepseek-flash',reasoningEffort:'off',maxTokens:128}}, {insert:[...composition.includes('@deepseek-ai/dsh-agent-preset-registry')?[]:[{id:'composition-registry',name:'@deepseek-ai/dsh-agent-preset-registry',config:{default:'composition-preset'}}],{id:'composition-preset',name:'@deepseek-ai/dsh-agent-preset',config:{id:'composition-preset',plugins:[]}},{id:'composition-probe',name:pathToFileURL(fileURLToPath(new URL('./onebot-probe.mjs',import.meta.url))).href,config:{readyPath,resultPath}}]}]
await writeFile(join(profileRoot,'cordis.patch.yml'),JSON.stringify(overlay,null,2)+'\n')
const child=spawn(process.execPath,[join(profileRoot,'node_modules','@deepseek-ai','dsh','lib','bin.js'),'--profile',profile],{cwd:area,env,windowsHide:true,stdio:['pipe','pipe','pipe']});let exitCode,stdout='',stderr='';child.stdout.on('data',p=>stdout+=p);child.stderr.on('data',p=>stderr+=p);const exit=once(child,'close').then(([code,signal])=>{exitCode=code;return{code,signal}})
async function until(predicate){const deadline=Date.now()+60000;while(!await predicate()){assert.equal(exitCode,undefined,'Composition app exited early');assert.ok(Date.now()<deadline,'Composition wait timed out');await delay(20)}}
async function file(path){let value;await until(async()=>{try{value=JSON.parse(await readFile(path,'utf8'));return true}catch(error){if(error.code!=='ENOENT')throw error;return false}});return value}
let result
try{
 await file(readyPath)
 const packet=(id,text,directed,sender=90000002)=>({post_type:'message',message_type:'group',time:Math.floor(Date.now()/1000),self_id:90000001,user_id:sender,group_id:90000100,message_id:id,message:[...directed?[{type:'at',data:{qq:'90000001'}}]:[],{type:'text',data:{text}}]})
 peersConnected[0].send(JSON.stringify(packet(500,'COMPOSED_FIRST',true)));await until(()=>outgoing.length===1)
 const followup=packet(501,'COMPOSED_FOLLOWUP',false);peersConnected[0].send(JSON.stringify(followup));await until(()=>outgoing.length===2)
 peersConnected[0].send(JSON.stringify(packet(502,'UNRELATED_CHAT',false,90000003)));peersConnected[0].send(JSON.stringify(followup))
 result=await file(resultPath);assert.equal(result.passed,true,JSON.stringify(result.error));assert.equal(outgoing.length,2);assert.equal(captures.length,2)
 assert.deepEqual(outgoing.map(message=>message.message[0]),[{type:'reply',data:{id:'500'}},{type:'reply',data:{id:'501'}}])
 assert.ok(JSON.stringify(captures[1].messages).includes('COMPOSED_FIRST')&&JSON.stringify(captures[1].messages).includes('COMPOSITION_REPLY_1'))
 assert.ok(outgoing.every(message=>message.group_id==='90000100'||message.group_id===90000100))
 child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:1,method:'shutdown',params:{}})+'\n');const stopped=await Promise.race([exit,delay(15000).then(()=>{throw Error('Composition shutdown timed out')})]);assert.deepEqual(stopped,{code:0,signal:null})
 await writeFile(join(area,'summary.json'),JSON.stringify({passed:true,checks:result.checks,installedFiles,modelRequests:captures.length,wireSends:outgoing.length,onebotRelease:'v0.2.1',realQqMessagesSent:0,realModelApiRequests:0},null,2)+'\n');console.log(JSON.stringify({area,passed:true,checks:result.checks,wireSends:outgoing.length,realQqMessagesSent:0}))
}finally{if(exitCode===undefined){child.stdin.end();const fallback=setTimeout(()=>child.kill(),5000);await exit;clearTimeout(fallback)}for(const peer of ws.clients)peer.terminate();await new Promise(resolve=>ws.close(resolve));await new Promise(resolve=>model.close(resolve));await writeFile(join(area,'process.json'),JSON.stringify({exitCode,stdout,stderr,actions},null,2)+'\n')}
